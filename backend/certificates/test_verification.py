import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.utils import timezone

from rest_framework.test import APIClient

from events.models import Event, Registration

from .models import (
    CertificateBatch,
    CertificateRevocation,
    CertificateTemplate,
    CertificateTemplateVersion,
    GeneratedCertificate,
)


@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class CertificateVerificationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        group, _ = Group.objects.get_or_create(name="Organizer")

        cls.owner = User.objects.create_user(
            username="verification_owner"
        )
        cls.other = User.objects.create_user(
            username="verification_other"
        )
        cls.student = User.objects.create_user(
            username="verification_student"
        )

        cls.owner.groups.add(group)
        cls.other.groups.add(group)

        now = timezone.now()

        cls.event = Event.objects.create(
            organizer=cls.owner,
            title="Verification Test Event",
            description="Isolated test.",
            category="workshop",
            venue="Test Lab",
            registration_deadline=now - timedelta(days=4),
            start_datetime=now - timedelta(days=3),
            end_datetime=now - timedelta(days=2),
            capacity=20,
            status="published",
        )

        cls.registration = Registration.objects.create(
            event=cls.event,
            student=cls.student,
            status="registered",
        )

        template = CertificateTemplate.objects.create(
            event=cls.event,
            name="Verification template",
            created_by=cls.owner,
        )

        version = CertificateTemplateVersion.objects.create(
            template=template,
            number=1,
            background="test/background.png",
            image_width=1200,
            image_height=800,
            fields=[],
            images=[],
            created_by=cls.owner,
        )

        cls.batch = CertificateBatch.objects.create(
            event=cls.event,
            template_version=version,
            request_key=uuid.uuid4(),
            request_hash="a" * 64,
            status="published",
            created_by=cls.owner,
            published_at=now,
            published_by=cls.owner,
        )

        cls.certificate = GeneratedCertificate.objects.create(
            batch=cls.batch,
            registration=cls.registration,
            participant_name="Test Participant",
            values={
                "event_name": "Saved Event Title",
                "event_date": "12 November 2026",
                "certificate_type": "Participation",
            },
            document="test/draft.pdf",
            sha256="b" * 64,
            issued_document="test/issued.pdf",
            issued_sha256="c" * 64,
            is_active=True,
        )

    def setUp(self):
        self.client = APIClient()
        certificate_id = self.certificate.id
        self.verify_url = (
            f"/api/certificates/verify/{certificate_id}/"
        )
        self.revoke_url = (
            f"/api/certificates/documents/"
            f"{certificate_id}/revocation/"
        )

    def payload(self, **changes):
        data = {
            "reason": "Participant name needs correction.",
            "issued_sha256": "c" * 64,
            "confirm": True,
        }
        data.update(changes)
        return data

    def revoke(self, **changes):
        self.client.force_authenticate(self.owner)
        return self.client.post(
            self.revoke_url,
            self.payload(**changes),
            format="json",
        )

    def test_public_verification_uses_saved_values(self):
        response = self.client.get(self.verify_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "valid")
        self.assertEqual(
            response.data["event_name"],
            "Saved Event Title",
        )
        self.assertEqual(
            set(response.data),
            {
                "certificate_id",
                "status",
                "participant_name",
                "event_name",
                "event_date",
                "certificate_type",
                "published_at",
            },
        )
        self.assertEqual(
            response["Cache-Control"],
            "no-store",
        )

    def test_unknown_and_draft_certificates_are_not_public(self):
        unknown = (
            f"/api/certificates/verify/{uuid.uuid4()}/"
        )
        self.assertEqual(
            self.client.get(unknown).status_code,
            404,
        )

        GeneratedCertificate.objects.filter(
            pk=self.certificate.pk
        ).update(is_active=False)

        CertificateBatch.objects.filter(
            pk=self.batch.pk
        ).update(
            status="draft",
            published_at=None,
            published_by=None,
        )

        self.assertEqual(
            self.client.get(self.verify_url).status_code,
            404,
        )

    def test_revocation_preserves_files_and_records_audit(self):
        response = self.revoke()
        self.assertEqual(response.status_code, 200)

        certificate = GeneratedCertificate.objects.get(
            pk=self.certificate.pk
        )
        record = CertificateRevocation.objects.get(
            certificate=certificate
        )

        self.assertFalse(certificate.is_active)
        self.assertEqual(
            certificate.document.name,
            "test/draft.pdf",
        )
        self.assertEqual(
            certificate.issued_document.name,
            "test/issued.pdf",
        )
        self.assertEqual(record.revoked_by, self.owner)
        self.assertEqual(
            record.reason,
            self.payload()["reason"],
        )

        self.client.force_authenticate(user=None)
        public = self.client.get(self.verify_url)

        self.assertEqual(public.data["status"], "revoked")
        self.assertNotIn("reason", public.data)
        self.assertNotIn("revoked_by", public.data)

        self.client.force_authenticate(self.student)
        download = self.client.get(
            f"/api/certificates/mine/"
            f"{certificate.id}/document/"
        )
        self.assertEqual(download.status_code, 404)

    def test_retry_preserves_original_revocation(self):
        self.assertEqual(self.revoke().status_code, 200)

        first = CertificateRevocation.objects.get(
            certificate=self.certificate
        )

        self.assertEqual(self.revoke().status_code, 200)

        second = CertificateRevocation.objects.get(
            certificate=self.certificate
        )
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(first.revoked_at, second.revoked_at)

        changed = self.revoke(reason="A different reason.")
        self.assertEqual(changed.status_code, 409)

        second.refresh_from_db()
        self.assertEqual(
            second.reason,
            self.payload()["reason"],
        )

    def test_other_organizer_and_student_cannot_revoke(self):
        self.client.force_authenticate(self.other)

        self.assertEqual(
            self.client.get(self.revoke_url).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                self.revoke_url,
                self.payload(),
                format="json",
            ).status_code,
            404,
        )

        self.client.force_authenticate(self.student)

        self.assertEqual(
            self.client.post(
                self.revoke_url,
                self.payload(),
                format="json",
            ).status_code,
            403,
        )

    def test_confirmation_and_matching_hash_are_required(self):
        self.assertEqual(
            self.revoke(confirm=False).status_code,
            400,
        )
        self.assertEqual(
            self.revoke(issued_sha256="d" * 64).status_code,
            409,
        )
        self.assertEqual(
            self.revoke(reason="   ").status_code,
            400,
        )
        self.assertFalse(
            CertificateRevocation.objects.exists()
        )

    def test_revocation_failure_rolls_back(self):
        with patch(
            "certificates.verification_views."
            "CertificateRevocation.objects.create",
            side_effect=RuntimeError("Simulated database failure"),
        ):
            with self.assertRaises(RuntimeError):
                self.revoke()

        certificate = GeneratedCertificate.objects.get(
            pk=self.certificate.pk
        )

        self.assertTrue(certificate.is_active)
        self.assertFalse(
            CertificateRevocation.objects.exists()
        )

    def test_session_request_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        response = client.post(
            self.revoke_url,
            self.payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            CertificateRevocation.objects.exists()
        )