import hashlib

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import (
    IntegrityError,
    close_old_connections,
    connection,
    connections,
    transaction,
)
from django.test import TestCase, TransactionTestCase
from django.urls import reverse

from rest_framework.test import APIClient

from .models import CertificateBatch, GeneratedCertificate
from .services import render_sample_pdf
from .test_batches import BatchFixtureMixin


User = get_user_model()


class PublicationFixtureMixin(BatchFixtureMixin):
    def create_draft(self):
        response = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        return response.data

    def publish(self, batch, **changes):
        return self.client.post(
            reverse(
                "publish-certificate-batch",
                args=[batch["id"]],
            ),
            {
                "review_hash": batch["review_hash"],
                "confirm_review": True,
                **changes,
            },
            format="json",
        )

    def student_document_url(self, certificate_id):
        return reverse(
            "student-certificate-document",
            args=[certificate_id],
        )


class CertificatePublicationTests(
    PublicationFixtureMixin,
    TestCase,
):
    def test_publication_creates_final_pdf_and_scopes_student_access(self):
        batch = self.create_draft()

        with patch(
            "certificates.publication_services.render_sample_pdf",
            wraps=render_sample_pdf,
        ) as renderer:
            response = self.publish(batch)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "published")
        self.assertIsNone(
            renderer.call_args.kwargs["preview_label"]
        )

        certificate = GeneratedCertificate.objects.get()
        self.assertTrue(certificate.is_active)
        self.assertTrue(certificate.issued_document)
        self.assertNotEqual(
            certificate.document.name,
            certificate.issued_document.name,
        )

        # Draft remains preserved.
        self.assertTrue(
            certificate.document.storage.exists(
                certificate.document.name
            )
        )

        self.client.force_authenticate(user=self.student)

        listing = self.client.get(reverse("my-certificates"))
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data["count"], 1)

        downloaded = self.client.get(
            self.student_document_url(certificate.id)
        )
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(
            downloaded["Cache-Control"],
            "private, no-store",
        )

        content = b"".join(downloaded.streaming_content)
        self.assertTrue(content.startswith(b"%PDF-"))
        self.assertEqual(
            hashlib.sha256(content).hexdigest(),
            certificate.issued_sha256,
        )

        peer = User.objects.create_user(
            username="publication_peer"
        )
        self.client.force_authenticate(user=peer)

        self.assertEqual(
            self.client.get(reverse("my-certificates")).data["count"],
            0,
        )
        self.assertEqual(
            self.client.get(
                self.student_document_url(certificate.id)
            ).status_code,
            404,
        )

    def test_drafts_and_publication_are_protected(self):
        batch = self.create_draft()
        certificate = GeneratedCertificate.objects.get()

        self.client.force_authenticate(user=self.student)

        self.assertEqual(
            self.client.get(reverse("my-certificates")).data["count"],
            0,
        )
        self.assertEqual(
            self.client.get(
                self.student_document_url(certificate.id)
            ).status_code,
            404,
        )
        self.assertEqual(self.publish(batch).status_code, 403)

        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.publish(batch).status_code, 404)

        csrf_client = APIClient(enforce_csrf_checks=True)
        csrf_client.force_login(self.owner)

        response = csrf_client.post(
            reverse(
                "publish-certificate-batch",
                args=[batch["id"]],
            ),
            {
                "review_hash": batch["review_hash"],
                "confirm_review": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_publication_rechecks_eligibility_and_changed_details(self):
        batch = self.create_draft()

        original_check_in = self.ticket.checked_in_at
        self.ticket.checked_in_at = None
        self.ticket.save(update_fields=["checked_in_at"])

        self.assertEqual(self.publish(batch).status_code, 400)

        self.ticket.checked_in_at = original_check_in
        self.ticket.save(update_fields=["checked_in_at"])

        self.event.title = "Changed after draft review"
        self.event.save(update_fields=["title"])

        self.assertEqual(self.publish(batch).status_code, 409)

        stored_batch = CertificateBatch.objects.get()
        certificate = GeneratedCertificate.objects.get()

        self.assertEqual(stored_batch.status, "draft")
        self.assertFalse(certificate.is_active)
        self.assertFalse(certificate.issued_document)

    def test_retry_does_not_regenerate_issued_document(self):
        batch = self.create_draft()

        self.assertEqual(self.publish(batch).status_code, 200)

        certificate = GeneratedCertificate.objects.get()
        original_path = certificate.issued_document.name
        original_hash = certificate.issued_sha256

        self.assertEqual(self.publish(batch).status_code, 200)

        certificate.refresh_from_db()

        self.assertEqual(
            certificate.issued_document.name,
            original_path,
        )
        self.assertEqual(
            certificate.issued_sha256,
            original_hash,
        )

    def test_duplicate_active_certificate_is_blocked(self):
        first = self.create_draft()
        second = self.create_draft()

        self.assertEqual(self.publish(first).status_code, 200)
        self.assertEqual(self.publish(second).status_code, 409)

        active = GeneratedCertificate.objects.get(is_active=True)
        other = GeneratedCertificate.objects.get(batch_id=second["id"])

        # Verify the database constraint independently of the API.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GeneratedCertificate.objects.filter(
                    id=other.id
                ).update(
                    is_active=True,
                    issued_document=active.issued_document.name,
                    issued_sha256=active.issued_sha256,
                )

        self.assertEqual(
            GeneratedCertificate.objects.filter(
                is_active=True
            ).count(),
            1,
        )

    def test_review_confirmation_and_hash_are_required(self):
        batch = self.create_draft()

        self.assertEqual(
            self.publish(batch, confirm_review=False).status_code,
            400,
        )
        self.assertEqual(
            self.publish(batch, review_hash="0" * 64).status_code,
            409,
        )

        self.assertFalse(
            GeneratedCertificate.objects.get().is_active
        )

    def test_failed_publication_rolls_back_and_removes_final_file(self):
        batch = self.create_draft()
        before = self.stored_files()

        with patch(
            "certificates.publication_services.GeneratedCertificate.save",
            side_effect=RuntimeError("Simulated publication failure"),
        ):
            with self.assertRaisesMessage(
                RuntimeError,
                "Simulated publication failure",
            ):
                self.publish(batch)

        certificate = GeneratedCertificate.objects.get()
        stored_batch = CertificateBatch.objects.get()

        self.assertEqual(stored_batch.status, "draft")
        self.assertFalse(certificate.is_active)
        self.assertFalse(certificate.issued_document)
        self.assertEqual(self.stored_files(), before)

    def test_modified_draft_file_cannot_be_published(self):
        batch = self.create_draft()
        certificate = GeneratedCertificate.objects.get()

        with certificate.document.storage.open(
            certificate.document.name,
            "wb",
        ) as document:
            document.write(b"Modified draft content")

        self.assertEqual(self.publish(batch).status_code, 409)
        self.assertFalse(
            GeneratedCertificate.objects.get().is_active
        )


@skipUnless(
    connection.vendor == "postgresql",
    "Requires PostgreSQL row locks.",
)
class CertificatePublicationConcurrencyTests(
    PublicationFixtureMixin,
    TransactionTestCase,
):
    def test_two_batches_compete_for_one_active_certificate(self):
        first = self.create_draft()
        second = self.create_draft()
        barrier = Barrier(2)

        def send_request(batch):
            close_old_connections()

            try:
                client = APIClient()
                client.force_authenticate(user=self.owner)

                barrier.wait(timeout=10)

                response = client.post(
                    reverse(
                        "publish-certificate-batch",
                        args=[batch["id"]],
                    ),
                    {
                        "review_hash": batch["review_hash"],
                        "confirm_review": True,
                    },
                    format="json",
                )

                return response.status_code
            finally:
                connections["default"].close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(send_request, batch)
                for batch in [first, second]
            ]
            statuses = [
                future.result(timeout=30)
                for future in futures
            ]

        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(
            GeneratedCertificate.objects.filter(
                is_active=True
            ).count(),
            1,
        )