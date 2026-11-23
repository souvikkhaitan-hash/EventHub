import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.exceptions import NotFound
from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIClient

from events.models import Event, EventStaffMembership

from .batch_services import create_draft_batch
from .models import CertificateTemplate
from .permissions import certificate_event_ids


class CertificateStaffAccessTests(TestCase):
    def setUp(self):
        User = get_user_model()

        self.owner = User.objects.create_user(
            username="cert_staff_owner"
        )
        self.coordinator = User.objects.create_user(
            username="cert_staff_coordinator"
        )
        self.volunteer = User.objects.create_user(
            username="cert_staff_volunteer"
        )

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )
        self.owner.groups.add(group)

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Certificate Staff Workshop",
            description="Certificate access test.",
            category="workshop",
            venue="Lab 1",
            start_datetime=now + timedelta(days=2),
            end_datetime=now + timedelta(days=2, hours=2),
            registration_deadline=now + timedelta(days=1),
            capacity=50,
        )

        self.other_event = Event.objects.create(
            organizer=self.owner,
            title="Other Certificate Event",
            description="Separate event.",
            category="seminar",
            venue="Hall 2",
            start_datetime=now + timedelta(days=3),
            end_datetime=now + timedelta(days=3, hours=2),
            registration_deadline=now + timedelta(days=2),
            capacity=50,
        )

        self.membership = EventStaffMembership.objects.create(
            event=self.event,
            user=self.coordinator,
            role="certificates",
            assigned_by=self.owner,
        )

        EventStaffMembership.objects.create(
            event=self.event,
            user=self.volunteer,
            role="attendance",
            assigned_by=self.owner,
        )

        self.template = CertificateTemplate.objects.create(
            event=self.event,
            name="Workshop Certificate",
            created_by=self.owner,
        )

        self.other_template = CertificateTemplate.objects.create(
            event=self.other_event,
            name="Other Event Certificate",
            created_by=self.owner,
        )

        self.client = APIClient()
        self.client.force_authenticate(
            user=self.coordinator
        )

    def test_coordinator_can_list_assigned_event_templates(self):
        response = self.client.get(
            f"/api/certificates/events/{self.event.pk}/templates/"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_coordinator_cannot_list_other_event_templates(self):
        response = self.client.get(
            f"/api/certificates/events/{self.other_event.pk}/templates/"
        )

        self.assertEqual(response.status_code, 404)

    def test_coordinator_can_read_assigned_template_versions(self):
        response = self.client.get(
            f"/api/certificates/templates/{self.template.pk}/versions/"
        )

        self.assertEqual(response.status_code, 200)

    def test_coordinator_cannot_read_other_template_versions(self):
        response = self.client.get(
            f"/api/certificates/templates/{self.other_template.pk}/versions/"
        )

        self.assertEqual(response.status_code, 404)

    def test_attendance_volunteer_cannot_access_certificates(self):
        self.client.force_authenticate(
            user=self.volunteer
        )

        response = self.client.get(
            f"/api/certificates/events/{self.event.pk}/templates/"
        )

        self.assertEqual(response.status_code, 403)

    def test_coordinator_can_read_recipients_and_batches(self):
        for suffix in ["recipients", "batches"]:
            with self.subTest(endpoint=suffix):
                response = self.client.get(
                    f"/api/certificates/events/{self.event.pk}/{suffix}/"
                )

                self.assertEqual(response.status_code, 200)

    def test_removed_coordinator_loses_access(self):
        self.membership.is_active = False
        self.membership.save(
            update_fields=["is_active"]
        )

        response = self.client.get(
            f"/api/certificates/events/{self.event.pk}/templates/"
        )

        self.assertEqual(response.status_code, 403)

    def test_inactive_account_has_no_certificate_scope(self):
        self.coordinator.is_active = False
        self.coordinator.save(
            update_fields=["is_active"]
        )

        self.assertFalse(
            certificate_event_ids(
                self.coordinator
            ).exists()
        )

    def test_draft_service_rechecks_removed_access(self):
        self.membership.is_active = False
        self.membership.save(
            update_fields=["is_active"]
        )

        # Isolate authorization from payload hashing/rendering.
        # Access must fail before any batch or PDF is created.
        with patch(
            "certificates.batch_services.batch_request_hash",
            return_value="a" * 64,
        ):
            with self.assertRaises(NotFound):
                create_draft_batch(
                    self.coordinator,
                    self.event.pk,
                    {},
                )

    def test_coordinator_cannot_publish(self):
        response = self.client.post(
            f"/api/certificates/batches/{uuid.uuid4()}/publish/",
            {
                "review_hash": "a" * 64,
                "confirm_review": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_coordinator_cannot_revoke(self):
        response = self.client.post(
            (
                "/api/certificates/documents/"
                f"{uuid.uuid4()}/revocation/"
            ),
            {
                "reason": "Test reason",
                "issued_sha256": "a" * 64,
                "confirm": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_owner_still_has_template_access(self):
        self.client.force_authenticate(
            user=self.owner
        )

        response = self.client.get(
            f"/api/certificates/events/{self.event.pk}/templates/"
        )

        self.assertEqual(response.status_code, 200)