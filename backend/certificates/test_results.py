import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from rest_framework.test import APIClient

from events.models import (
    EventTeam,
    Registration,
    TeamMembership,
)

from .models import (
    AwardResult,
    CertificateBatch,
    GeneratedCertificate,
)
from .test_batches import BatchFixtureMixin


class ResultsFixtureMixin(BatchFixtureMixin):
    def setUp(self):
        super().setUp()

        self.results_url = (
            f"/api/certificates/events/{self.event.id}/results/"
        )

    def result_payload(self, **changes):
        data = {
            "request_key": str(uuid.uuid4()),
            "registration_id": self.registration.id,
            "position": "1st place",
        }
        data.update(changes)
        return data

    def create_result(self, payload=None):
        return self.client.post(
            self.results_url,
            payload or self.result_payload(),
            format="json",
        )

    def withdraw(self, result_id, reason="Incorrect position."):
        return self.client.post(
            f"/api/certificates/results/{result_id}/withdraw/",
            {"reason": reason, "confirm": True},
            format="json",
        )

    def make_team(self):
        self.event.registration_mode = "team"
        self.event.save(update_fields=["registration_mode"])

        team = EventTeam.objects.create(
            event=self.event,
            leader=self.student,
            name="Result Test Team",
            status="confirmed",
        )

        peer = get_user_model().objects.create_user(
            username="result_peer"
        )

        peer_registration = Registration.objects.create(
            event=self.event,
            student=peer,
        )

        TeamMembership.objects.create(
            team=team,
            registration=self.registration,
            role="leader",
        )

        TeamMembership.objects.create(
            team=team,
            registration=peer_registration,
            role="member",
        )

        return team, peer_registration


class AwardResultsTests(ResultsFixtureMixin, TestCase):
    def test_individual_result_and_exact_retry(self):
        payload = self.result_payload()
        first = self.create_result(payload)
        retry = self.create_result(payload)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(first.data["id"], retry.data["id"])
        self.assertEqual(
            first.data["recipient_registration_ids"],
            [self.registration.id],
        )
        self.assertEqual(AwardResult.objects.count(), 1)

    def test_changed_retry_and_duplicate_result_are_blocked(self):
        payload = self.result_payload()

        self.assertEqual(
            self.create_result(payload).status_code,
            201,
        )

        changed = {
            **payload,
            "position": "2nd place",
        }

        self.assertEqual(
            self.create_result(changed).status_code,
            409,
        )
        self.assertEqual(
            self.create_result().status_code,
            409,
        )

    def test_owner_only_and_no_invitation_codes(self):
        self.create_result()
        response = self.client.get(self.results_url)

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("invitation_code", str(response.data))
        self.assertNotIn("email", str(response.data))

        self.client.force_authenticate(self.other)

        self.assertEqual(
            self.client.get(self.results_url).status_code,
            404,
        )
        self.assertEqual(
            self.create_result().status_code,
            404,
        )

        self.client.force_authenticate(self.student)

        self.assertEqual(
            self.client.get(self.results_url).status_code,
            403,
        )
        self.assertEqual(
            self.create_result().status_code,
            403,
        )

    def test_future_cancelled_event_and_registration_are_blocked(self):
        original_end = self.event.end_datetime

        self.event.end_datetime = (
            timezone.now() + timedelta(days=1)
        )
        self.event.save(update_fields=["end_datetime"])

        self.assertEqual(
            self.create_result().status_code,
            400,
        )

        self.event.end_datetime = original_end
        self.event.status = "cancelled"
        self.event.save(update_fields=["end_datetime", "status"])

        self.assertEqual(
            self.create_result().status_code,
            400,
        )

        self.event.status = "published"
        self.event.save(update_fields=["status"])

        self.registration.status = "cancelled"
        self.registration.save(update_fields=["status"])

        self.assertEqual(
            self.create_result().status_code,
            400,
        )

    def test_wrong_event_target_is_rejected(self):
        response = self.create_result(
            self.result_payload(registration_id=999999)
        )
        self.assertEqual(response.status_code, 404)

    def test_target_and_position_validation(self):
        cases = [
            {"position": " "},
            {"position": "Winner\nOther"},
            {"team_id": 1},
        ]

        for changes in cases:
            response = self.create_result(
                self.result_payload(**changes)
            )
            self.assertEqual(response.status_code, 400)

        data = self.result_payload()
        del data["registration_id"]

        self.assertEqual(
            self.create_result(data).status_code,
            400,
        )

    def test_team_roster_is_saved_and_attendance_still_required(self):
        team, peer = self.make_team()

        response = self.create_result({
            "request_key": str(uuid.uuid4()),
            "team_id": team.id,
            "position": "Winner",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            set(response.data["recipient_registration_ids"]),
            {self.registration.id, peer.id},
        )

        detail = self.client.get(
            f"/api/certificates/results/"
            f"{response.data['id']}/recipients/"
        )

        rows = {
            row["registration_id"]: row
            for row in detail.data["recipients"]
        }

        self.assertTrue(
            rows[self.registration.id]["eligible"]
        )
        self.assertFalse(rows[peer.id]["eligible"])

        self.assertIn(
            "attendance_missing",
            [
                reason["code"]
                for reason in rows[peer.id]["reasons"]
            ],
        )
        self.assertNotIn("invitation_code", str(detail.data))

    def test_forming_team_and_wrong_target_type_are_blocked(self):
        team, _ = self.make_team()

        self.assertEqual(
            self.create_result().status_code,
            400,
        )

        team.status = "forming"
        team.save(update_fields=["status"])

        response = self.create_result({
            "request_key": str(uuid.uuid4()),
            "team_id": team.id,
            "position": "Winner",
        })

        self.assertEqual(response.status_code, 400)

    def test_withdrawal_preserves_history_and_allows_correction(self):
        created = self.create_result()
        result_id = created.data["id"]

        first = self.withdraw(result_id)
        self.assertEqual(first.status_code, 200)

        retry = self.withdraw(result_id)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(
            first.data["withdrawn_at"],
            retry.data["withdrawn_at"],
        )

        self.assertEqual(
            self.withdraw(
                result_id,
                "Changed reason",
            ).status_code,
            409,
        )

        corrected = self.create_result(
            self.result_payload(position="2nd place")
        )

        self.assertEqual(corrected.status_code, 201)
        self.assertEqual(AwardResult.objects.count(), 2)

        detail = self.client.get(
            f"/api/certificates/results/{result_id}/recipients/"
        )

        self.assertFalse(
            detail.data["recipients"][0]["eligible"]
        )

    def test_active_award_certificate_blocks_withdrawal(self):
        result = self.create_result()

        batch = CertificateBatch.objects.create(
            event=self.event,
            template_version=self.version,
            request_key=uuid.uuid4(),
            request_hash="a" * 64,
            created_by=self.owner,
            status="published",
            published_by=self.owner,
            published_at=timezone.now(),
        )

        certificate = GeneratedCertificate.objects.create(
            batch=batch,
            registration=self.registration,
            award_result_id=result.data["id"],
            participant_name="Test Student",
            values={},
            document="test/draft.pdf",
            sha256="b" * 64,
            issued_document="test/issued.pdf",
            issued_sha256="c" * 64,
            is_active=True,
        )

        self.assertEqual(
            self.withdraw(result.data["id"]).status_code,
            409,
        )

        certificate.is_active = False
        certificate.save(update_fields=["is_active"])

        self.assertEqual(
            self.withdraw(result.data["id"]).status_code,
            200,
        )

    def test_roster_failure_rolls_back_result(self):
        with patch(
            "certificates.result_views."
            "AwardResultRecipient.objects.bulk_create",
            side_effect=RuntimeError("Roster failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.create_result()

        self.assertFalse(AwardResult.objects.exists())

    def test_result_writes_require_csrf(self):
        created = self.create_result()

        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        self.assertEqual(
            client.post(
                self.results_url,
                self.result_payload(),
                format="json",
            ).status_code,
            403,
        )

        self.assertEqual(
            client.post(
                f"/api/certificates/results/"
                f"{created.data['id']}/withdraw/",
                {"reason": "Correction", "confirm": True},
                format="json",
            ).status_code,
            403,
        )


@skipUnless(
    connection.vendor == "postgresql",
    "Requires PostgreSQL row locking",
)
class AwardResultsConcurrencyTests(
    ResultsFixtureMixin,
    TransactionTestCase,
):
    def test_two_results_compete_for_same_participant(self):
        barrier = Barrier(2)
        owner_id = self.owner.id
        url = self.results_url

        payloads = [
            self.result_payload(position=value)
            for value in ["Winner", "Runner-up"]
        ]

        def submit(payload):
            connections.close_all()

            try:
                client = APIClient()

                client.force_authenticate(
                    get_user_model().objects.get(pk=owner_id)
                )

                barrier.wait(timeout=10)

                return client.post(
                    url,
                    payload,
                    format="json",
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(submit, payloads))

        self.assertEqual(sorted(statuses), [201, 409])
        self.assertEqual(
            AwardResult.objects.filter(is_active=True).count(),
            1,
        )