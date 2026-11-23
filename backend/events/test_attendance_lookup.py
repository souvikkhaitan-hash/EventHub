from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIClient

from accounts.models import StudentProfile

from .models import (
    Event,
    EventStaffMembership,
    EventTicket,
    Registration,
)


class AttendanceLookupTests(TestCase):
    def setUp(self):
        User = get_user_model()

        self.owner = User.objects.create_user(
            username="lookup_owner"
        )
        self.volunteer = User.objects.create_user(
            username="lookup_volunteer"
        )
        self.student = User.objects.create_user(
            username="lookup_student",
            first_name="Test",
            last_name="Student",
        )

        group, _ = Group.objects.get_or_create(name="Organizer")
        self.owner.groups.add(group)

        StudentProfile.objects.create(
            user=self.student,
            roll_number="ROLL-100",
            department="BCA",
            academic_year="3",
        )

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Lookup Workshop",
            description="Test event.",
            category="workshop",
            venue="Lab",
            start_datetime=now + timedelta(minutes=20),
            end_datetime=now + timedelta(hours=2),
            registration_deadline=now + timedelta(minutes=10),
            capacity=50,
            status="published",
        )

        self.membership = EventStaffMembership.objects.create(
            event=self.event,
            user=self.volunteer,
            role="attendance",
            assigned_by=self.owner,
        )

        self.registration = Registration.objects.create(
            event=self.event,
            student=self.student,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.volunteer)

        self.base = f"/api/events/manage/{self.event.pk}/"

    def lookup(self, kind="roll", query="ROLL-100"):
        return self.client.get(
            self.base + "attendance-lookup/",
            {"kind": kind, "query": query},
        )

    def test_roll_lookup_is_read_only(self):
        response = self.lookup()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["registration_id"],
            self.registration.pk,
        )
        self.assertFalse(EventTicket.objects.exists())

    def test_uuid_lookup(self):
        ticket = EventTicket.objects.create(
            registration=self.registration
        )

        response = self.lookup("ticket", str(ticket.token))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        ticket.refresh_from_db()
        self.assertIsNone(ticket.checked_in_at)

    def test_invalid_uuid_is_rejected(self):
        response = self.lookup("ticket", "not-a-uuid")
        self.assertEqual(response.status_code, 400)

    def test_manual_check_in_records_staff_and_rejects_repeat(self):
        payload = {"registration_id": self.registration.pk}

        response = self.client.post(
            self.base + "check-in/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        ticket = EventTicket.objects.get(
            registration=self.registration
        )
        self.assertEqual(
            ticket.checked_in_by_id,
            self.volunteer.pk,
        )

        duplicate = self.client.post(
            self.base + "check-in/",
            payload,
            format="json",
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_cancelled_registration_cannot_check_in(self):
        self.registration.status = "cancelled"
        self.registration.save(update_fields=["status"])

        self.assertEqual(self.lookup().data["count"], 0)

        response = self.client.post(
            self.base + "check-in/",
            {"registration_id": self.registration.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(EventTicket.objects.exists())

    def test_both_identifiers_are_rejected(self):
        response = self.client.post(
            self.base + "check-in/",
            {
                "registration_id": self.registration.pk,
                "token": "invalid",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_removed_staff_cannot_lookup(self):
        self.membership.is_active = False
        self.membership.save(update_fields=["is_active"])

        self.assertEqual(self.lookup().status_code, 403)

    def test_non_unique_roll_returns_choices_without_check_in(self):
        other = get_user_model().objects.create_user(
            username="lookup_second_student"
        )

        StudentProfile.objects.create(
            user=other,
            roll_number="ROLL-100",
            department="BCA",
            academic_year="3",
        )

        Registration.objects.create(
            event=self.event,
            student=other,
        )

        response = self.lookup()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertFalse(EventTicket.objects.exists())