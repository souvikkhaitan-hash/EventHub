import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase

from rest_framework.test import APIClient

from events.models import (
    Event,
    EventTicket,
    Registration,
    TeamMembership,
)

from .models import (
    AwardResult,
    CertificateTemplateVersion,
    GeneratedCertificate,
)
from .services import render_sample_pdf
from .test_results import ResultsFixtureMixin


class AwardFixtureMixin(ResultsFixtureMixin):
    def setUp(self):
        super().setUp()

        self.award_version = (
            CertificateTemplateVersion.objects.create(
                template=self.version.template,
                number=2,
                background=self.version.background.name,
                image_width=1200,
                image_height=800,
                fields=[
                    *self.version.fields,
                    {
                        "placeholder": "position",
                        "x": 0.1,
                        "y": 0.65,
                        "width": 0.8,
                        "height": 0.1,
                        "font_size": 24,
                    },
                ],
                created_by=self.owner,
            )
        )

    def award_payload(self, result_id, **changes):
        data = self.payload()
        data.update({
            "template_version_id": self.award_version.id,
            "award_result_id": str(result_id),
            **changes,
        })
        return data

    def draft_award(self, result_id, **changes):
        return self.client.post(
            self.url,
            self.award_payload(result_id, **changes),
            format="json",
        )

    def publish_batch(self, batch):
        return self.client.post(
            f"/api/certificates/batches/{batch['id']}/publish/",
            {
                "review_hash": batch["review_hash"],
                "confirm_review": True,
            },
            format="json",
        )


class AwardCertificateTests(AwardFixtureMixin, TestCase):
    def test_award_uses_saved_position_and_ignores_submitted_position(self):
        result = self.create_result()

        draft = self.draft_award(
            result.data["id"],
            position="Fake winner",
        )

        self.assertEqual(draft.status_code, 201)

        certificate = GeneratedCertificate.objects.get()

        self.assertEqual(
            str(certificate.award_result_id),
            result.data["id"],
        )
        self.assertEqual(
            certificate.values["position"],
            "1st place",
        )
        self.assertEqual(
            certificate.values["certificate_type"],
            "Achievement",
        )
        self.assertEqual(
            self.publish_batch(draft.data).status_code,
            200,
        )

    def test_participation_and_award_can_both_be_active(self):
        participation = self.client.post(
            self.url,
            self.payload(),
            format="json",
        )

        self.assertEqual(
            self.publish_batch(participation.data).status_code,
            200,
        )

        result = self.create_result()
        award = self.draft_award(result.data["id"])

        self.assertEqual(award.status_code, 201)
        self.assertEqual(
            self.publish_batch(award.data).status_code,
            200,
        )
        self.assertEqual(
            GeneratedCertificate.objects.filter(
                is_active=True
            ).count(),
            2,
        )

        self.client.force_authenticate(self.student)

        listing = self.client.get("/api/certificates/mine/")
        self.assertEqual(listing.data["count"], 2)

        for row in listing.data["results"]:
            document = self.client.get(row["download_url"])
            self.assertEqual(document.status_code, 200)

            content = b"".join(document.streaming_content)
            self.assertTrue(content.startswith(b"%PDF-"))

    def test_duplicate_active_award_is_blocked(self):
        result = self.create_result()
        first = self.draft_award(result.data["id"])
        second = self.draft_award(result.data["id"])

        self.assertEqual(
            self.publish_batch(first.data).status_code,
            200,
        )
        self.assertEqual(
            self.publish_batch(second.data).status_code,
            409,
        )

    def test_request_key_cannot_switch_between_participation_and_award(self):
        result = self.create_result()
        payload = self.payload()

        self.assertEqual(
            self.client.post(
                self.url,
                payload,
                format="json",
            ).status_code,
            201,
        )

        payload.update({
            "award_result_id": result.data["id"],
            "template_version_id": self.award_version.id,
        })

        self.assertEqual(
            self.client.post(
                self.url,
                payload,
                format="json",
            ).status_code,
            409,
        )

    def test_award_retry_returns_same_batch(self):
        result = self.create_result()
        payload = self.award_payload(result.data["id"])

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

    def test_award_template_requires_position_and_participation_rejects_it(self):
        result = self.create_result()

        missing_position = self.draft_award(
            result.data["id"],
            template_version_id=self.version.id,
        )
        self.assertEqual(missing_position.status_code, 400)

        participation = self.payload()
        participation["template_version_id"] = (
            self.award_version.id
        )

        self.assertEqual(
            self.client.post(
                self.url,
                participation,
                format="json",
            ).status_code,
            400,
        )

    def test_withdrawn_result_blocks_generation_and_publication(self):
        result = self.create_result()
        draft = self.draft_award(result.data["id"])

        self.assertEqual(draft.status_code, 201)
        self.assertEqual(
            self.withdraw(result.data["id"]).status_code,
            200,
        )
        self.assertEqual(
            self.draft_award(result.data["id"]).status_code,
            400,
        )
        self.assertEqual(
            self.publish_batch(draft.data).status_code,
            400,
        )
        self.assertFalse(
            GeneratedCertificate.objects.filter(
                is_active=True
            ).exists()
        )

    def test_changed_result_blocks_publication(self):
        result = self.create_result()
        draft = self.draft_award(result.data["id"])

        AwardResult.objects.filter(
            pk=result.data["id"]
        ).update(position="2nd place")

        self.assertEqual(
            self.publish_batch(draft.data).status_code,
            409,
        )

    def test_unawarded_participant_is_rejected(self):
        result = self.create_result()

        peer = get_user_model().objects.create_user(
            username="unawarded_peer"
        )

        registration = Registration.objects.create(
            event=self.event,
            student=peer,
        )

        EventTicket.objects.create(
            registration=registration,
            checked_in_at=self.event.start_datetime,
        )

        response = self.draft_award(
            result.data["id"],
            recipients=[{
                "registration_id": registration.id,
                "participant_name": "Unawarded Peer",
            }],
        )

        self.assertEqual(response.status_code, 400)

    def test_unknown_or_other_event_result_is_rejected(self):
        self.assertEqual(
            self.draft_award(uuid.uuid4()).status_code,
            404,
        )

        result = self.create_result()

        self.client.force_authenticate(self.other)

        self.assertEqual(
            self.draft_award(result.data["id"]).status_code,
            404,
        )

        self.client.force_authenticate(self.owner)

        other_event = Event.objects.get(pk=self.event.pk)
        other_event.pk = None
        other_event.save()

        AwardResult.objects.filter(
            pk=result.data["id"]
        ).update(event=other_event)

        self.assertEqual(
            self.draft_award(result.data["id"]).status_code,
            404,
        )

    def test_team_award_requires_attendance_and_original_roster(self):
        team, peer = self.make_team()

        result = self.create_result({
            "request_key": str(uuid.uuid4()),
            "team_id": team.id,
            "position": "Winner",
        })

        response = self.draft_award(
            result.data["id"],
            recipients=[{
                "registration_id": peer.id,
                "participant_name": "Peer Student",
            }],
        )

        self.assertEqual(response.status_code, 400)

        attended = self.draft_award(result.data["id"])
        self.assertEqual(attended.status_code, 201)

        # Simulate a roster change outside the normal team API.
        TeamMembership.objects.filter(
            registration=self.registration
        ).delete()

        self.assertEqual(
            self.publish_batch(attended.data).status_code,
            400,
        )

    def test_later_team_member_cannot_receive_original_award(self):
        team, _ = self.make_team()

        result = self.create_result({
            "request_key": str(uuid.uuid4()),
            "team_id": team.id,
            "position": "Winner",
        })

        student = get_user_model().objects.create_user(
            username="late_award_member"
        )

        registration = Registration.objects.create(
            event=self.event,
            student=student,
        )

        EventTicket.objects.create(
            registration=registration,
            checked_in_at=self.event.start_datetime,
        )

        TeamMembership.objects.create(
            team=team,
            registration=registration,
            role="member",
        )

        response = self.draft_award(
            result.data["id"],
            recipients=[{
                "registration_id": registration.id,
                "participant_name": "Late Member",
            }],
        )

        self.assertEqual(response.status_code, 400)

    def test_award_preview_uses_real_result_and_requires_csrf(self):
        result = self.create_result()

        url = (
            f"/api/certificates/versions/"
            f"{self.award_version.id}/award-preview/"
        )

        payload = {
            "award_result_id": result.data["id"],
            "registration_id": self.registration.id,
            "participant_name": "Reviewed Name",
        }

        with patch(
            "certificates.award_views.render_sample_pdf",
            wraps=render_sample_pdf,
        ) as renderer:
            response = self.client.post(
                url,
                payload,
                format="json",
            )

            self.assertEqual(response.status_code, 200)
            self.assertTrue(
                b"".join(
                    response.streaming_content
                ).startswith(b"%PDF-")
            )

            values = renderer.call_args.kwargs[
                "resolved_values"
            ]

            self.assertEqual(values["position"], "1st place")
            self.assertEqual(
                values["participant_name"],
                "Reviewed Name",
            )

        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        self.assertEqual(
            client.post(
                url,
                payload,
                format="json",
            ).status_code,
            403,
        )

    def test_revoked_award_stays_revoked_on_publish_retry(self):
        result = self.create_result()
        draft = self.draft_award(result.data["id"])

        self.assertEqual(
            self.publish_batch(draft.data).status_code,
            200,
        )

        certificate = GeneratedCertificate.objects.get()

        revoke = self.client.post(
            f"/api/certificates/documents/"
            f"{certificate.id}/revocation/",
            {
                "reason": "Incorrect result",
                "confirm": True,
                "issued_sha256": certificate.issued_sha256,
            },
            format="json",
        )

        self.assertEqual(revoke.status_code, 200)
        self.assertEqual(
            self.publish_batch(draft.data).status_code,
            200,
        )

        certificate.refresh_from_db()
        self.assertFalse(certificate.is_active)

        self.assertEqual(
            self.withdraw(result.data["id"]).status_code,
            200,
        )


@skipUnless(
    connection.vendor == "postgresql",
    "Requires PostgreSQL row locking",
)
class AwardPublicationConcurrencyTests(
    AwardFixtureMixin,
    TransactionTestCase,
):
    def test_two_batches_compete_for_same_active_award(self):
        result = self.create_result()

        drafts = [
            self.draft_award(result.data["id"]).data
            for _ in range(2)
        ]

        barrier = Barrier(2)
        owner_id = self.owner.id

        def publish(batch):
            connections.close_all()

            try:
                client = APIClient()

                client.force_authenticate(
                    get_user_model().objects.get(pk=owner_id)
                )

                barrier.wait(timeout=10)

                response = client.post(
                    f"/api/certificates/batches/"
                    f"{batch['id']}/publish/",
                    {
                        "review_hash": batch["review_hash"],
                        "confirm_review": True,
                    },
                    format="json",
                )

                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(publish, drafts))

        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(
            GeneratedCertificate.objects.filter(
                is_active=True
            ).count(),
            1,
        )