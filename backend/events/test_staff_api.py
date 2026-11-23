from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIClient

from .models import (
    Event,
    EventStaffHistory,
    EventStaffMembership,
    EventTicket,
    Registration,
)


class EventStaffAPITests(TestCase):
    def setUp(self):
        User = get_user_model()

        self.owner = User.objects.create_user(
            username="staff_test_owner"
        )
        self.volunteer = User.objects.create_user(
            username="staff_test_volunteer"
        )
        self.manager = User.objects.create_user(
            username="staff_test_manager"
        )
        self.student = User.objects.create_user(
            username="staff_test_student"
        )
        self.outsider = User.objects.create_user(
            username="staff_test_outsider"
        )

        group, _ = Group.objects.get_or_create(name="Organizer")
        self.owner.groups.add(group)

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Staff Permission Workshop",
            description="Test event.",
            category="workshop",
            venue="Lab 1",
            start_datetime=now + timedelta(minutes=20),
            end_datetime=now + timedelta(hours=2),
            registration_deadline=now + timedelta(minutes=10),
            capacity=50,
            status="published",
        )

        self.other_event = Event.objects.create(
            organizer=self.owner,
            title="Another Event",
            description="Another test event.",
            category="seminar",
            venue="Hall 2",
            start_datetime=now + timedelta(days=2),
            end_datetime=now + timedelta(days=2, hours=2),
            registration_deadline=now + timedelta(days=1),
            capacity=50,
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

        self.ticket = EventTicket.objects.create(
            registration=self.registration
        )

        self.client = APIClient()
        self.base = f"/api/events/manage/{self.event.pk}/"

    def login_as(self, user):
        self.client.force_authenticate(user=user)

    def test_owner_can_assign_manager_without_global_promotion(self):
        self.login_as(self.owner)

        response = self.client.post(
            self.base + "staff/",
            {
                "username": self.manager.username,
                "role": "manager",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertFalse(
            self.manager.groups.filter(name="Organizer").exists()
        )
        self.assertTrue(
            EventStaffHistory.objects.filter(
                membership_id=response.data["id"],
                action="assigned",
            ).exists()
        )

    def test_volunteer_can_read_attendance(self):
        self.login_as(self.volunteer)

        response = self.client.get(self.base + "attendance/")

        self.assertEqual(response.status_code, 200)

    def test_volunteer_cannot_edit_event(self):
        self.login_as(self.volunteer)

        response = self.client.patch(
            self.base,
            {"title": "Unauthorized change"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_volunteer_cannot_access_other_event(self):
        self.login_as(self.volunteer)

        response = self.client.get(
            f"/api/events/manage/{self.other_event.pk}/attendance/"
        )

        self.assertEqual(response.status_code, 404)

    def test_volunteer_cannot_manage_staff(self):
        self.login_as(self.volunteer)

        response = self.client.post(
            self.base + "staff/",
            {
                "username": self.outsider.username,
                "role": "manager",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_volunteer_can_check_in_another_participant(self):
        self.login_as(self.volunteer)

        response = self.client.post(
            self.base + "check-in/",
            {"token": str(self.ticket.token)},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.ticket.refresh_from_db()
        self.assertEqual(
            self.ticket.checked_in_by_id,
            self.volunteer.pk,
        )

        duplicate = self.client.post(
            self.base + "check-in/",
            {"token": str(self.ticket.token)},
            format="json",
        )

        self.assertEqual(duplicate.status_code, 409)

    def test_volunteer_cannot_check_in_self(self):
        registration = Registration.objects.create(
            event=self.event,
            student=self.volunteer,
        )
        ticket = EventTicket.objects.create(
            registration=registration
        )

        self.login_as(self.volunteer)

        response = self.client.post(
            self.base + "check-in/",
            {"token": str(ticket.token)},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        ticket.refresh_from_db()
        self.assertIsNone(ticket.checked_in_at)

    def test_owner_revocation_blocks_next_attendance_request(self):
        self.login_as(self.owner)

        response = self.client.patch(
            self.base + f"staff/{self.membership.pk}/",
            {
                "revision": 1,
                "is_active": False,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.login_as(self.volunteer)
        response = self.client.get(self.base + "attendance/")

        self.assertEqual(response.status_code, 403)

    def test_stale_staff_update_is_rejected(self):
        self.login_as(self.owner)
        url = self.base + f"staff/{self.membership.pk}/"

        first = self.client.patch(
            url,
            {"revision": 1, "role": "manager"},
            format="json",
        )
        self.assertEqual(first.status_code, 200)

        stale = self.client.patch(
            url,
            {"revision": 1, "is_active": False},
            format="json",
        )

        self.assertEqual(stale.status_code, 409)

    def test_manager_can_edit_but_cannot_assign_staff(self):
        EventStaffMembership.objects.create(
            event=self.event,
            user=self.manager,
            role="manager",
            assigned_by=self.owner,
        )
        self.login_as(self.manager)

        edit = self.client.patch(
            self.base,
            {"venue": "Lab 3"},
            format="json",
        )
        self.assertEqual(edit.status_code, 200)

        assign = self.client.post(
            self.base + "staff/",
            {
                "username": self.outsider.username,
                "role": "attendance",
            },
            format="json",
        )
        self.assertEqual(assign.status_code, 404)

    def test_staff_cannot_create_events(self):
        self.login_as(self.volunteer)

        response = self.client.post(
            "/api/events/manage/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_staff_list_contains_only_assigned_events(self):
        self.login_as(self.volunteer)

        response = self.client.get("/api/events/manage/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {event["id"] for event in response.data},
            {self.event.pk},
        )

    def test_certificate_role_does_not_grant_attendance_access(self):
        self.membership.role = "certificates"
        self.membership.save(update_fields=["role"])

        self.login_as(self.volunteer)

        response = self.client.get(self.base + "attendance/")

        self.assertEqual(response.status_code, 404)

    def test_staff_assignment_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        response = client.post(
            self.base + "staff/",
            {
                "username": self.manager.username,
                "role": "manager",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)