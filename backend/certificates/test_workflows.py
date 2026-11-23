"""Run against local PostgreSQL; mail is captured, never sent to real inboxes."""
import hashlib
import io
import tempfile
import uuid
from datetime import timedelta
from unittest.mock import patch

from PIL import Image
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core import mail
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APIClient

from events.models import Event, EventStaffMembership, EventTicket, Registration
from .models import CertificateBatch, CertificateTemplate, CertificateTemplateVersion, GeneratedCertificate
from eventhub_notifications.models import Notification, NotificationEvent
from eventhub_notifications.services import process_event_step
from .workflow_models import CertificateWorkflow, CertificateWorkflowRecipient
from .workflow_services import (
    change_workflow, create_workflow, manifest_for,
    process_workflow_step, recipient_review, review_hash_for,
)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                   DEFAULT_FROM_EMAIL="EventHub <test@example.com>",
                   FRONTEND_URL="http://localhost:5173")
class CertificateWorkflowTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        override = override_settings(CERTIFICATE_STORAGE_BACKEND="local", CERTIFICATE_STORAGE_ROOT=self.directory.name)
        override.enable()
        self.addCleanup(override.disable)
        User = get_user_model()
        self.group, _ = Group.objects.get_or_create(name="Organizer")
        self.owner = User.objects.create_user(username="workflow_owner", email="owner@example.com", first_name="Event", last_name="Owner")
        self.owner.groups.add(self.group)
        self.other = User.objects.create_user(username="workflow_other", email="other@example.com")
        self.other.groups.add(self.group)
        self.coordinator = User.objects.create_user(username="workflow_coordinator", email="coordinator@example.com")
        now = timezone.now()
        self.event = Event.objects.create(title="Workflow Workshop", description="Test", category="workshop", venue="Lab",
            start_datetime=now-timedelta(hours=3), end_datetime=now-timedelta(hours=2),
            registration_deadline=now-timedelta(hours=4), capacity=2000, status="published", organizer=self.owner)
        EventStaffMembership.objects.create(event=self.event, user=self.coordinator, role="certificates", assigned_by=self.owner)
        self.template = CertificateTemplate.objects.create(event=self.event, name="Participation", created_by=self.owner)
        self.version = CertificateTemplateVersion.objects.create(template=self.template, number=1,
            image_width=1200, image_height=800, created_by=self.owner,
            fields=[{"placeholder":"participant_name", "x":.1, "y":.45, "width":.8, "height":.1, "font_size":28}], images=[])
        image = io.BytesIO()
        Image.new("RGB", (1200, 800), "white").save(image, format="PNG")
        self.version.background.save("background.png", ContentFile(image.getvalue()), save=True)
        self.registrations = []
        for index in range(2):
            student = User.objects.create_user(username=f"workflow_student_{index}", email=f"student-{index}@example.com", first_name="Student", last_name=str(index))
            registration = Registration.objects.create(event=self.event, student=student)
            EventTicket.objects.create(registration=registration, checked_in_at=now-timedelta(hours=3), checked_in_by=self.owner)
            self.registrations.append(registration)

    def payload(self, key=None):
        return {"template_version_id":self.version.pk, "request_key":key or uuid.uuid4(),
                "recipients":[{"registration_id":row.pk} for row in self.registrations]}

    def ready(self, actor=None):
        workflow, _ = create_workflow(actor or self.owner, self.event.pk, self.payload())
        while process_workflow_step():
            workflow.refresh_from_db()
            if workflow.status == "failed":
                self.fail(workflow.error_message)
        workflow.refresh_from_db()
        self.assertEqual(workflow.status, "ready")
        return workflow

    def approve(self, workflow, actor=None):
        return change_workflow(actor or self.owner, workflow.pk, {
            "action":"publish", "confirm_review":True, "review_hash":review_hash_for(workflow)})

    def publish(self, workflow):
        self.approve(workflow)
        while process_workflow_step():
            workflow.refresh_from_db()
            if workflow.status == "failed": self.fail(workflow.error_message)
        workflow.refresh_from_db()
        self.assertEqual(workflow.status, "published")

    def test_real_pdf_workflow_and_notification(self):
        workflow = self.ready()
        self.assertEqual(workflow.generated, 2)
        self.assertFalse(GeneratedCertificate.objects.filter(is_active=True).exists())
        self.publish(workflow)
        self.assertEqual(workflow.published, 2)
        for certificate in GeneratedCertificate.objects.filter(batch__event=self.event):
            with certificate.issued_document.open("rb") as document:
                content = document.read()
            self.assertTrue(content.startswith(b"%PDF"))
            self.assertEqual(hashlib.sha256(content).hexdigest(), certificate.issued_sha256)
            self.assertTrue(certificate.is_active)
        while process_event_step(): pass
        self.assertEqual(Notification.objects.filter(kind="certificate_ready").count(),2)
        self.assertEqual(len(getattr(mail,"outbox",[])),0)

    def test_queue_does_not_render_pdfs(self):
        with patch("certificates.workflow_services.create_draft_batch") as render:
            workflow, created = create_workflow(self.owner, self.event.pk, self.payload())
        self.assertTrue(created)
        self.assertEqual(workflow.total, 2)
        self.assertEqual(workflow.recipients.first().participant_name, "Student 0")
        render.assert_not_called()

    def test_request_retry_returns_same_snapshot(self):
        data = self.payload()
        first, _ = create_workflow(self.owner, self.event.pk, data)
        student = self.registrations[0].student
        student.first_name = "Changed"
        student.save(update_fields=["first_name"])
        second, created = create_workflow(self.owner, self.event.pk, data)
        self.assertFalse(created)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(second.recipients.first().participant_name, "Student 0")

    def test_missing_name_cannot_be_silently_replaced_by_username(self):
        student = self.registrations[0].student
        student.first_name = student.last_name = ""
        student.save(update_fields=["first_name", "last_name"])
        with self.assertRaises(ValidationError): create_workflow(self.owner, self.event.pk, self.payload())
        self.assertFalse(CertificateWorkflow.objects.exists())

    def test_name_correction_is_a_snapshot_not_profile_edit(self):
        data = self.payload()
        data["recipients"][0]["participant_name"] = "Official Corrected Name"
        workflow, _ = create_workflow(self.owner, self.event.pk, data)
        self.assertEqual(workflow.recipients.first().participant_name, "Official Corrected Name")
        self.assertEqual(get_user_model().objects.get(pk=self.registrations[0].student_id).first_name, "Student")

    def test_coordinator_can_generate_but_cannot_publish(self):
        workflow = self.ready(self.coordinator)
        with self.assertRaises(PermissionDenied): self.approve(workflow, self.coordinator)
        self.publish(workflow)

    def test_other_owner_cannot_access_event(self):
        with self.assertRaises(NotFound): create_workflow(self.other, self.event.pk, self.payload())

    def test_revoked_coordinator_stops_before_generation(self):
        workflow, _ = create_workflow(self.coordinator, self.event.pk, self.payload())
        EventStaffMembership.objects.filter(event=self.event, user=self.coordinator).update(is_active=False)
        with patch("certificates.workflow_services.create_draft_batch") as generate:
            process_workflow_step()
        workflow.refresh_from_db()
        self.assertEqual(workflow.status, "failed")
        generate.assert_not_called()
        # The current owner can take over generation without rewriting its original requester.
        change_workflow(self.owner, workflow.pk, {"action":"retry"})
        process_workflow_step()
        workflow.refresh_from_db()
        self.assertEqual(workflow.status, "ready")
        self.assertEqual(workflow.created_by_id, self.coordinator.pk)

    def test_revoked_owner_cannot_finish_queued_publication(self):
        workflow = self.ready()
        self.approve(workflow)
        self.owner.groups.clear()
        process_workflow_step()
        workflow.refresh_from_db()
        self.assertEqual(workflow.status, "failed")
        self.assertFalse(GeneratedCertificate.objects.filter(is_active=True).exists())

    def test_changed_review_hash_is_rejected(self):
        workflow = self.ready()
        with self.assertRaises(APIExceptionForConflict):
            change_workflow(self.owner, workflow.pk, {"action":"publish", "confirm_review":True, "review_hash":"0"*64})

    def test_existing_issued_participants_are_excluded_from_next_review(self):
        workflow = self.ready()
        self.publish(workflow)
        review = recipient_review(self.owner, self.event.pk, self.version.pk)
        self.assertEqual(review["already_issued_count"], 2)
        self.assertEqual(review["eligible_count"], 0)

    def test_failed_step_retries_same_key_and_retains_completed_part(self):
        from .batch_services import create_draft_batch as actual_generate
        with patch("certificates.workflow_services.CHUNK_SIZE", 1):
            workflow, _ = create_workflow(self.owner, self.event.pk, self.payload())
            process_workflow_step()
            with patch("certificates.workflow_services.create_draft_batch", side_effect=ValidationError("blocked")) as failed:
                process_workflow_step()
            failed_key = failed.call_args.args[2]["request_key"]
            workflow.refresh_from_db()
            self.assertEqual(workflow.generated, 1)
            change_workflow(self.owner, workflow.pk, {"action":"retry"})
            with patch("certificates.workflow_services.create_draft_batch", wraps=actual_generate) as retried:
                process_workflow_step()
            self.assertEqual(failed_key, retried.call_args.args[2]["request_key"])
            self.assertEqual(workflow.parts.count(), 2)

    def test_partial_publication_can_stop_without_revoking_completed_work(self):
        with patch("certificates.workflow_services.CHUNK_SIZE", 1): workflow = self.ready()
        self.approve(workflow)
        process_workflow_step()
        workflow.refresh_from_db()
        self.assertEqual(workflow.published, 1)
        change_workflow(self.owner, workflow.pk, {"action":"cancel"})
        self.assertFalse(process_workflow_step())
        self.assertEqual(GeneratedCertificate.objects.filter(is_active=True).count(), 1)
        self.assertEqual(NotificationEvent.objects.filter(kind="certificate_ready").count(), 1)

    def test_private_api_and_cross_event_denial(self):
        workflow, _ = create_workflow(self.owner, self.event.pk, self.payload())
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(reverse("certificate-workflow-detail", args=[workflow.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        client.force_authenticate(self.other)
        self.assertEqual(client.get(reverse("certificate-workflow-detail", args=[workflow.pk])).status_code, 404)

    def test_mutation_requires_csrf_for_session_login(self):
        workflow, _ = create_workflow(self.owner, self.event.pk, self.payload())
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)
        response = client.post(reverse("certificate-workflow-detail", args=[workflow.pk]), {"action":"cancel"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_duplicate_recipient_api_request_is_rejected(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        data = self.payload()
        data["recipients"].append(data["recipients"][0])
        response = client.post(reverse("event-certificate-workflows", args=[self.event.pk]), data, format="json")
        self.assertEqual(response.status_code, 400)

    def test_one_thousand_recipient_orchestration_without_pdf_benchmark_claim(self):
        # Rendering is substituted in this test. It verifies selection, chunking,
        # state persistence and association of 1,000 recipients, not rendering speed.
        Registration.objects.filter(event=self.event).update(status="cancelled")
        User = get_user_model()
        students = User.objects.bulk_create([User(username=f"bulk_{index}", email=f"bulk-{index}@example.com",
            first_name="Bulk", last_name=str(index)) for index in range(1000)], batch_size=200)
        registrations = Registration.objects.bulk_create([Registration(event=self.event, student=student) for student in students], batch_size=200)
        EventTicket.objects.bulk_create([EventTicket(registration=registration, checked_in_at=timezone.now()-timedelta(hours=3))
                                        for registration in registrations], batch_size=200)
        data = {"template_version_id":self.version.pk, "request_key":uuid.uuid4(),
                "recipients":[{"registration_id":row.pk} for row in registrations]}
        workflow, _ = create_workflow(self.owner, self.event.pk, data)
        def simulated_generate(actor, event_id, payload):
            batch = CertificateBatch.objects.create(event_id=event_id, template_version=self.version, created_by=actor,
                request_key=payload["request_key"], request_hash="a"*64)
            GeneratedCertificate.objects.bulk_create([GeneratedCertificate(batch=batch,
                registration_id=row["registration_id"], participant_name=row["participant_name"], document="simulated.pdf", sha256="a"*64)
                for row in payload["recipients"]])
            return batch.pk, True
        with patch("certificates.workflow_services.create_draft_batch", side_effect=simulated_generate) as generate:
            while process_workflow_step(): pass
        workflow.refresh_from_db()
        self.assertEqual(workflow.total, 1000)
        self.assertEqual(workflow.generated, 1000)
        self.assertEqual(workflow.status, "ready")
        self.assertEqual(generate.call_count, 100)
        self.assertEqual(workflow.recipients.filter(certificate__isnull=False).count(), 1000)


# The existing batch service owns the exact conflict type.
from .batch_services import BatchConflict as APIExceptionForConflict


# These tests require real PostgreSQL connections. SQLite cannot prove row locking.
import threading
from concurrent.futures import ThreadPoolExecutor
from django.db import close_old_connections
from django.test import TransactionTestCase, skipUnlessDBFeature


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                   DEFAULT_FROM_EMAIL="EventHub <test@example.com>",
                   FRONTEND_URL="http://localhost:5173")
class CertificateWorkflowConcurrencyTests(TransactionTestCase):
    setUp = CertificateWorkflowTests.setUp
    payload = CertificateWorkflowTests.payload
    ready = CertificateWorkflowTests.ready
    approve = CertificateWorkflowTests.approve
    publish = CertificateWorkflowTests.publish

    @skipUnlessDBFeature("has_select_for_update_skip_locked")
    def test_two_workers_do_not_generate_same_step(self):
        from .batch_services import create_draft_batch as actual_generate
        workflow, _ = create_workflow(self.owner, self.event.pk, self.payload())
        entered = threading.Event()
        release = threading.Event()
        def blocked(*args):
            entered.set()
            if not release.wait(15): raise RuntimeError("Test synchronization timed out.")
            return actual_generate(*args)
        def first_worker():
            close_old_connections()
            try: return process_workflow_step()
            finally: close_old_connections()
        with patch("certificates.workflow_services.create_draft_batch", side_effect=blocked) as generate:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(first_worker)
                try:
                    self.assertTrue(entered.wait(10))
                    self.assertFalse(process_workflow_step())
                finally:
                    release.set()
                self.assertTrue(future.result(timeout=20))
            self.assertEqual(generate.call_count, 1)
        workflow.refresh_from_db()
        self.assertEqual(workflow.generated, 2)

    @skipUnlessDBFeature("has_select_for_update_skip_locked")
    def test_two_submissions_create_only_one_unfinished_run(self):
        barrier = threading.Barrier(2)
        def submit():
            close_old_connections()
            try:
                user = get_user_model().objects.get(pk=self.owner.pk)
                barrier.wait(timeout=10)
                create_workflow(user, self.event.pk, self.payload())
                return "created"
            except APIExceptionForConflict:
                return "conflict"
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: submit(), range(2)))
        self.assertEqual(sorted(results), ["conflict", "created"])
        self.assertEqual(CertificateWorkflow.objects.count(), 1)

