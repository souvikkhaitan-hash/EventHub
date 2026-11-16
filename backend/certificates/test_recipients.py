from datetime import timedelta
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from events.models import (
    Event,
    EventTeam,
    EventTicket,
    Registration,
    TeamMembership,
)

from .models import CertificateTemplateVersion
from .services import render_sample_pdf


User = get_user_model()


@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class CertificateRecipientTests(TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)

        settings_override = override_settings(
            CERTIFICATE_STORAGE_ROOT=directory.name
        )
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.owner = User.objects.create_user(
            username="recipient_owner"
        )
        self.other = User.objects.create_user(
            username="recipient_other"
        )
        self.student = User.objects.create_user(
            username="souvik",
            first_name="Souvik",
            last_name="Khaitan",
        )

        self.owner.groups.add(group)
        self.other.groups.add(group)

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Completed Workshop",
            description="Recipient test event.",
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

        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

        output = BytesIO()
        Image.new("RGB", (1200, 800), "white").save(
            output,
            format="PNG",
        )

        uploaded = self.client.post(
            reverse(
                "event-certificate-templates",
                args=[self.event.id],
            ),
            {
                "name": "Participation",
                "background": SimpleUploadedFile(
                    "background.png",
                    output.getvalue(),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(uploaded.status_code, 201)

        self.version_id = uploaded.data["versions"][0]["id"]

        self.list_url = reverse(
            "event-certificate-recipients",
            args=[self.event.id],
        )
        self.preview_url = reverse(
            "certificate-recipient-preview",
            args=[self.version_id],
        )

    def preview(self, **changes):
        return self.client.post(
            self.preview_url,
            {
                "registration_id": self.registration.id,
                **changes,
            },
            format="json",
        )

    def make_team(self):
        self.event.registration_mode = "team"
        self.event.save(update_fields=["registration_mode"])

        team = EventTeam.objects.create(
            event=self.event,
            leader=self.student,
            name="Code Warriors",
            status="confirmed",
        )

        TeamMembership.objects.create(
            team=team,
            registration=self.registration,
            role="leader",
        )

        peer = User.objects.create_user(
            username="recipient_peer"
        )
        peer_registration = Registration.objects.create(
            event=self.event,
            student=peer,
        )
        TeamMembership.objects.create(
            team=team,
            registration=peer_registration,
            role="member",
        )

        return team

    def test_owner_sees_actual_recipient_and_eligibility(self):
        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Cache-Control"],
            "private, no-store",
        )

        row = response.data["results"][0]

        self.assertEqual(
            row["participant_name"],
            "Souvik Khaitan",
        )
        self.assertEqual(
            row["registration_id"],
            self.registration.id,
        )
        self.assertTrue(row["eligible"])
        self.assertFalse(row["needs_name"])
        self.assertEqual(row["reasons"], [])
        self.assertNotIn("invitation_code", row)

    def test_other_organizer_and_student_cannot_access(self):
        self.client.force_authenticate(user=self.other)

        self.assertEqual(
            self.client.get(self.list_url).status_code,
            404,
        )
        self.assertEqual(self.preview().status_code, 404)

        self.client.force_authenticate(user=self.student)

        self.assertEqual(
            self.client.get(self.list_url).status_code,
            403,
        )
        self.assertEqual(self.preview().status_code, 403)

    def test_ineligible_states_are_explained_and_block_preview(self):
        now = timezone.now()

        cases = [
            ("attendance_missing", "attendance"),
            ("registration_cancelled", "registration"),
            ("event_not_finished", "future"),
            ("event_not_published", "cancelled_event"),
        ]

        for expected_code, state in cases:
            with self.subTest(state=state):
                Event.objects.filter(id=self.event.id).update(
                    status="published",
                    start_datetime=now - timedelta(days=2),
                    end_datetime=now - timedelta(days=1),
                )
                Registration.objects.filter(
                    id=self.registration.id
                ).update(status="registered")

                EventTicket.objects.filter(
                    id=self.ticket.id
                ).update(
                    checked_in_at=now - timedelta(days=2)
                )

                if state == "attendance":
                    EventTicket.objects.filter(
                        id=self.ticket.id
                    ).update(checked_in_at=None)

                elif state == "registration":
                    Registration.objects.filter(
                        id=self.registration.id
                    ).update(status="cancelled")

                elif state == "future":
                    Event.objects.filter(
                        id=self.event.id
                    ).update(
                        start_datetime=now + timedelta(days=1),
                        end_datetime=now + timedelta(days=2),
                    )

                else:
                    Event.objects.filter(
                        id=self.event.id
                    ).update(status="cancelled")

                response = self.client.get(self.list_url)
                row = response.data["results"][0]

                self.assertFalse(row["eligible"])
                self.assertIn(
                    expected_code,
                    {
                        reason["code"]
                        for reason in row["reasons"]
                    },
                )
                self.assertEqual(
                    self.preview().status_code,
                    400,
                )

    def test_team_participant_requires_confirmed_team(self):
        team = self.make_team()

        response = self.client.get(
            self.list_url,
            {"search": "souvik"},
        )
        row = response.data["results"][0]

        self.assertTrue(row["eligible"])
        self.assertEqual(row["team_name"], "Code Warriors")
        self.assertNotIn("invitation_code", row)

        team.status = "forming"
        team.save(update_fields=["status"])

        self.assertEqual(self.preview().status_code, 400)

    def test_missing_name_requires_explicit_reviewed_name(self):
        self.student.first_name = ""
        self.student.last_name = ""
        self.student.save(
            update_fields=["first_name", "last_name"]
        )

        response = self.client.get(self.list_url)
        row = response.data["results"][0]

        self.assertTrue(row["needs_name"])
        self.assertEqual(row["participant_name"], "")
        self.assertEqual(self.preview().status_code, 400)

        response = self.preview(
            participant_name="Souvik Khaitan"
        )

        self.assertEqual(response.status_code, 200)
        content = b"".join(response.streaming_content)
        self.assertTrue(content.startswith(b"%PDF-"))

        self.student.refresh_from_db()
        self.assertEqual(self.student.first_name, "")

    def test_preview_uses_database_team_and_no_fictional_award(self):
        self.make_team()

        with patch(
            "certificates.recipient_views.render_sample_pdf",
            wraps=render_sample_pdf,
        ) as renderer:
            response = self.preview(
                team_name="Forged Team",
                position="Winner",
            )

            self.assertEqual(response.status_code, 200)

            content = b"".join(response.streaming_content)
            self.assertTrue(content.startswith(b"%PDF-"))

            values = renderer.call_args.kwargs[
                "resolved_values"
            ]

            self.assertEqual(
                values["participant_name"],
                "Souvik Khaitan",
            )
            self.assertEqual(
                values["team_name"],
                "Code Warriors",
            )
            self.assertEqual(values["position"], "")
            self.assertEqual(
                values["certificate_type"],
                "Participation",
            )
            self.assertEqual(
                values["certificate_id"],
                "PREVIEW-ONLY",
            )

    def test_registration_from_another_event_is_rejected(self):
        other_event = Event.objects.create(
            organizer=self.other,
            title="Other Workshop",
            description="Another event.",
            category="workshop",
            venue="Other Lab",
            start_datetime=self.event.start_datetime,
            end_datetime=self.event.end_datetime,
            registration_deadline=self.event.registration_deadline,
            capacity=30,
            status="published",
        )

        other_registration = Registration.objects.create(
            event=other_event,
            student=self.student,
        )

        response = self.preview(
            registration_id=other_registration.id
        )

        self.assertEqual(response.status_code, 404)

    def test_recipient_preview_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        response = client.post(
            self.preview_url,
            {"registration_id": self.registration.id},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_award_placeholder_requires_results_feature(self):
        version = CertificateTemplateVersion.objects.get(
            id=self.version_id
        )

        version.fields = [{
            **version.fields[0],
            "placeholder": "position",
            "text": "",
        }]
        version.save(update_fields=["fields"])

        self.assertEqual(self.preview().status_code, 400)