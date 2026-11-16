import hashlib
import uuid

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from PIL import Image

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from events.models import Event, EventTicket, Registration

from .models import (
    CertificateBatch,
    CertificateTemplate,
    CertificateTemplateVersion,
    GeneratedCertificate,
)


User = get_user_model()


class BatchFixtureMixin:
    def setUp(self):
        super().setUp()

        directory = TemporaryDirectory()
        self.storage_directory = directory.name
        self.addCleanup(directory.cleanup)

        settings_override = override_settings(
            CERTIFICATE_STORAGE_ROOT=directory.name,
            ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
        )
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.owner = User.objects.create_user(
            username="batch_owner"
        )
        self.other = User.objects.create_user(
            username="batch_other"
        )
        self.student = User.objects.create_user(
            username="batch_student"
        )

        self.owner.groups.add(group)
        self.other.groups.add(group)

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Completed Batch Workshop",
            description="Isolated batch test.",
            category="workshop",
            venue="Test Lab",
            start_datetime=now - timedelta(days=2),
            end_datetime=now - timedelta(days=1),
            registration_deadline=now - timedelta(days=3),
            capacity=30,
            status="published",
        )

        self.registration = Registration.objects.create(
            event=self.event,
            student=self.student,
        )

        self.ticket = EventTicket.objects.create(
            registration=self.registration,
            checked_in_at=self.event.start_datetime,
            checked_in_by=self.owner,
        )

        template = CertificateTemplate.objects.create(
            event=self.event,
            name="Batch participation",
            created_by=self.owner,
        )

        output = BytesIO()
        Image.new("RGB", (1200, 800), "white").save(
            output,
            format="PNG",
        )

        self.version = CertificateTemplateVersion(
            template=template,
            number=1,
            image_width=1200,
            image_height=800,
            fields=[{
                "placeholder": "participant_name",
                "x": 0.1,
                "y": 0.4,
                "width": 0.8,
                "height": 0.2,
                "font_size": 28,
            }],
            created_by=self.owner,
        )

        self.version.background.save(
            "background.png",
            ContentFile(output.getvalue()),
            save=False,
        )
        self.version.save()

        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

        self.url = reverse(
            "event-certificate-batches",
            args=[self.event.id],
        )

    def payload(self):
        return {
            "template_version_id": self.version.id,
            "request_key": str(uuid.uuid4()),
            "recipients": [{
                "registration_id": self.registration.id,
                "participant_name": "Souvik Khaitan",
            }],
        }

    def stored_files(self):
        return {
            str(path)
            for path in Path(self.storage_directory).rglob("*")
            if path.is_file()
        }


class CertificateBatchTests(BatchFixtureMixin, TestCase):
    def test_creates_private_draft_with_saved_pdf_and_values(self):
        response = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "draft")
        self.assertEqual(response.data["certificate_count"], 1)
        self.assertEqual(len(response.data["certificates"]), 1)

        row = response.data["certificates"][0]

        self.assertEqual(
            row["participant_name"],
            "Souvik Khaitan",
        )
        self.assertEqual(
            row["values"]["event_name"],
            self.event.title,
        )
        self.assertEqual(
            row["values"]["certificate_id"],
            str(row["id"]),
        )
        self.assertNotIn("document", row)

        document = self.client.get(row["download_url"])
        self.assertEqual(document.status_code, 200)
        self.assertEqual(
            document["Cache-Control"],
            "private, no-store",
        )

        content = b"".join(document.streaming_content)
        self.assertTrue(content.startswith(b"%PDF-"))
        self.assertEqual(
            hashlib.sha256(content).hexdigest(),
            row["sha256"],
        )

    def test_retry_returns_same_batch(self):
        payload = self.payload()

        first = self.client.post(
            self.url,
            payload,
            format="json",
        )
        second = self.client.post(
            self.url,
            payload,
            format="json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(CertificateBatch.objects.count(), 1)
        self.assertEqual(GeneratedCertificate.objects.count(), 1)

    def test_same_key_with_changed_details_is_rejected(self):
        payload = self.payload()

        first = self.client.post(
            self.url,
            payload,
            format="json",
        )
        self.assertEqual(first.status_code, 201)

        payload["recipients"][0]["participant_name"] = "Different Name"

        second = self.client.post(
            self.url,
            payload,
            format="json",
        )

        self.assertEqual(second.status_code, 409)
        self.assertEqual(CertificateBatch.objects.count(), 1)

    def test_duplicate_participants_are_rejected(self):
        payload = self.payload()
        payload["recipients"].append(
            dict(payload["recipients"][0])
        )

        response = self.client.post(
            self.url,
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(CertificateBatch.objects.count(), 0)

    def test_other_organizer_cannot_access_batch_or_document(self):
        created = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )
        self.assertEqual(created.status_code, 201)

        detail_url = reverse(
            "certificate-batch-detail",
            args=[created.data["id"]],
        )
        document_url = created.data["certificates"][0]["download_url"]

        self.client.force_authenticate(user=self.other)

        self.assertEqual(
            self.client.get(detail_url).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(document_url).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                self.url,
                self.payload(),
                format="json",
            ).status_code,
            404,
        )

    def test_students_cannot_generate_or_read_drafts(self):
        created = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )
        self.assertEqual(created.status_code, 201)

        document_url = created.data["certificates"][0]["download_url"]

        self.client.force_authenticate(user=self.student)

        self.assertEqual(
            self.client.post(
                self.url,
                self.payload(),
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(document_url).status_code,
            403,
        )

    def test_attendance_is_rechecked_before_generation(self):
        self.ticket.checked_in_at = None
        self.ticket.save(update_fields=["checked_in_at"])

        before = self.stored_files()

        response = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(CertificateBatch.objects.count(), 0)
        self.assertEqual(GeneratedCertificate.objects.count(), 0)
        self.assertEqual(self.stored_files(), before)

    def test_database_failure_removes_generated_file(self):
        before = self.stored_files()

        with patch(
            "certificates.batch_services.GeneratedCertificate.save",
            side_effect=RuntimeError("Simulated document failure"),
        ):
            with self.assertRaisesMessage(
                RuntimeError,
                "Simulated document failure",
            ):
                self.client.post(
                    self.url,
                    self.payload(),
                    format="json",
                )

        self.assertEqual(CertificateBatch.objects.count(), 0)
        self.assertEqual(GeneratedCertificate.objects.count(), 0)
        self.assertEqual(self.stored_files(), before)

    def test_saved_values_do_not_follow_later_event_edits(self):
        created = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )
        self.assertEqual(created.status_code, 201)

        certificate = GeneratedCertificate.objects.get()
        original_values = dict(certificate.values)
        original_hash = certificate.sha256

        self.event.title = "Changed title"
        self.event.save(update_fields=["title"])

        self.student.first_name = "Changed"
        self.student.save(update_fields=["first_name"])

        certificate.refresh_from_db()

        self.assertEqual(certificate.values, original_values)
        self.assertEqual(certificate.sha256, original_hash)

        with certificate.document.open("rb") as document:
            self.assertEqual(
                hashlib.sha256(document.read()).hexdigest(),
                original_hash,
            )

    def test_batch_creation_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        response = client.post(
            self.url,
            self.payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 403)


@skipUnless(
    connection.vendor == "postgresql",
    "Requires PostgreSQL row locks.",
)
class CertificateBatchConcurrencyTests(
    BatchFixtureMixin,
    TransactionTestCase,
):
    def test_concurrent_same_key_creates_one_batch(self):
        payload = self.payload()
        barrier = Barrier(2)

        def send_request():
            close_old_connections()

            try:
                client = APIClient()
                client.force_authenticate(user=self.owner)

                barrier.wait(timeout=10)

                response = client.post(
                    self.url,
                    payload,
                    format="json",
                )

                return response.status_code, str(response.data["id"])
            finally:
                connections["default"].close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(send_request)
                for _ in range(2)
            ]
            results = [
                future.result(timeout=30)
                for future in futures
            ]

        self.assertEqual(
            sorted(status for status, _ in results),
            [200, 201],
        )
        self.assertEqual(
            len({batch_id for _, batch_id in results}),
            1,
        )
        self.assertEqual(CertificateBatch.objects.count(), 1)
        self.assertEqual(GeneratedCertificate.objects.count(), 1)