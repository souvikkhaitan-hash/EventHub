import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIClient

from .models import (
    Event,
    EventStaffMembership,
    EventTicket,
    Registration,
)


class EventReferenceTests(TestCase):
    def setUp(self):
        User = get_user_model()

        self.owner = User.objects.create_user(
            username="reference_owner"
        )
        self.manager = User.objects.create_user(
            username="reference_manager"
        )
        self.student = User.objects.create_user(
            username="reference_student",
            email="private@example.com",
        )

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )
        self.owner.groups.add(group)

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Reference Workshop",
            description="Test event.",
            category="workshop",
            venue="Lab",
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=2),
            registration_deadline=now + timedelta(hours=12),
            capacity=30,
        )

        self.registration = Registration.objects.create(
            event=self.event,
            student=self.student,
        )

        EventStaffMembership.objects.create(
            event=self.event,
            user=self.manager,
            role="manager",
            assigned_by=self.owner,
        )

        self.url = (
            f"/api/events/manage/{self.event.pk}/"
            "reference-download/"
        )

        self.client = APIClient()

    def download_as_owner(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Cache-Control"],
            "private, no-store",
        )

        # Django's test client closes the consumed stream.
        content = b"".join(response.streaming_content)
        return json.loads(content)

    def test_owner_can_download_without_creating_tickets(self):
        data = self.download_as_owner()

        self.assertEqual(
            data["schema"],
            "eventhub.event_reference.v1",
        )
        self.assertEqual(data["registration_count"], 1)
        self.assertIsNone(
            data["registrations"][0]["ticket"]
        )
        self.assertFalse(EventTicket.objects.exists())

        participant = data["registrations"][0]["participant"]
        self.assertNotIn("email", participant)
        self.assertNotIn("password", participant)

    def test_existing_ticket_uuid_is_preserved(self):
        ticket = EventTicket.objects.create(
            registration=self.registration
        )

        data = self.download_as_owner()

        self.assertEqual(
            data["registrations"][0]["ticket"]["uuid"],
            str(ticket.token),
        )

    def test_cancelled_registration_is_explicitly_labelled(self):
        self.registration.status = "cancelled"
        self.registration.save(update_fields=["status"])

        data = self.download_as_owner()

        self.assertEqual(
            data["registrations"][0]["registration_status"],
            "cancelled",
        )

    def test_manager_cannot_download_private_reference(self):
        self.client.force_authenticate(user=self.manager)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404)