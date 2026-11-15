from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.contrib.auth.models import Group, User
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from .models import Event, Registration, EventTicket
from unittest.mock import patch
from django.test import override_settings
import json

# ============================================================
# FEATURE 2 — EVENT MANAGEMENT TESTS
# ============================================================

@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class EventTests(TestCase):

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.organizer = User.objects.create_user(
            username="priya_mehta",
            email="priya.mehta@example.com",
            password="Organizer@2026!"
        )
        self.organizer.groups.add(organizer_group)

        self.student = User.objects.create_user(
            username="arjun_sharma",
            email="arjun.sharma@example.com",
            password="Student@2026!"
        )

        self.other_organizer = User.objects.create_user(
            username="rahul_verma",
            email="rahul.verma@example.com",
            password="Organizer@2026!"
        )
        self.other_organizer.groups.add(organizer_group)

        self.start = timezone.now() + timedelta(days=20)
        self.end = self.start + timedelta(hours=6)
        self.deadline = self.start - timedelta(days=2)

        self.event_data = {
            "title": "CodeSprint 2026",
            "description": "A campus hackathon for student developers.",
            "category": "technical",
            "venue": "Innovation Lab, Block A",
            "start_datetime": self.start.isoformat(),
            "end_datetime": self.end.isoformat(),
            "registration_deadline": self.deadline.isoformat(),
            "capacity": 120,
        }

    def login_as(self, user, password):
        self.client.logout()

        csrf_response = self.client.get(reverse("csrf-token"))
        self.assertEqual(csrf_response.status_code, 200)

        token = csrf_response.json()["csrfToken"]

        response = self.client.post(
            reverse("login"),
            {
                "username": user.username,
                "password": password,
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 200)

    def get_csrf_token(self):
        response = self.client.get(reverse("csrf-token"))

        self.assertEqual(response.status_code, 200)
        return response.json()["csrfToken"]

    def create_event(self, organizer=None, status="draft"):
        return Event.objects.create(
            title=self.event_data["title"],
            description=self.event_data["description"],
            category="technical",
            venue=self.event_data["venue"],
            start_datetime=self.start,
            end_datetime=self.end,
            registration_deadline=self.deadline,
            capacity=120,
            organizer=organizer or self.organizer,
            status=status,
        )

    # TEST 1
    def test_public_event_list(self):
        self.create_event(status="published")

        response = self.client.get(reverse("public-events"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    # TEST 2
    def test_draft_event_is_not_public(self):
        self.create_event(status="draft")

        response = self.client.get(reverse("public-events"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)

    # TEST 3
    def test_student_cannot_create_event(self):
        self.login_as(self.student, "Student@2026!")

        response = self.client.post(
            reverse("organizer-events"),
            self.event_data,
            format="json",
            HTTP_X_CSRFTOKEN=self.get_csrf_token(),
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Event.objects.count(), 0)

    # TEST 4
    def test_organizer_can_create_event(self):
        self.login_as(self.organizer, "Organizer@2026!")

        response = self.client.post(
            reverse("organizer-events"),
            self.event_data,
            format="json",
            HTTP_X_CSRFTOKEN=self.get_csrf_token(),
        )

        self.assertEqual(response.status_code, 201)

        event = Event.objects.get(title="CodeSprint 2026")

        self.assertEqual(event.organizer, self.organizer)
        self.assertEqual(event.status, "draft")

    # TEST 5
    def test_organizer_can_publish_event(self):
        event = self.create_event()

        self.login_as(self.organizer, "Organizer@2026!")

        response = self.client.patch(
            reverse("organizer-event-detail", args=[event.id]),
            {"status": "published"},
            format="json",
            HTTP_X_CSRFTOKEN=self.get_csrf_token(),
        )

        self.assertEqual(response.status_code, 200)

        event.refresh_from_db()
        self.assertEqual(event.status, "published")

    # TEST 6
    def test_organizer_cannot_edit_another_event(self):
        event = self.create_event(
            organizer=self.other_organizer
        )

        self.login_as(self.organizer, "Organizer@2026!")

        response = self.client.patch(
            reverse("organizer-event-detail", args=[event.id]),
            {"title": "Unauthorized Change"},
            format="json",
            HTTP_X_CSRFTOKEN=self.get_csrf_token(),
        )

        self.assertEqual(response.status_code, 404)

        event.refresh_from_db()
        self.assertEqual(event.title, "CodeSprint 2026")

    # TEST 7
    def test_invalid_event_dates(self):
        self.login_as(self.organizer, "Organizer@2026!")

        invalid_data = self.event_data.copy()
        invalid_data["end_datetime"] = (
            self.start - timedelta(hours=1)
        ).isoformat()

        response = self.client.post(
            reverse("organizer-events"),
            invalid_data,
            format="json",
            HTTP_X_CSRFTOKEN=self.get_csrf_token(),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Event.objects.count(), 0)

    # TEST 8
    def test_event_creation_without_csrf(self):
        self.login_as(self.organizer, "Organizer@2026!")

        response = self.client.post(
            reverse("organizer-events"),
            self.event_data,
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Event.objects.count(), 0)

    # TEST 9
    def test_public_event_detail(self):
        event = self.create_event(status="published")

        response = self.client.get(
            reverse("public-event-detail", args=[event.id])
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], event.id)
        self.assertEqual(
            response.data["title"],
            "CodeSprint 2026"
        )

    # TEST 10
    def test_draft_event_detail_is_private(self):
        event = self.create_event(status="draft")

        response = self.client.get(
            reverse("public-event-detail", args=[event.id])
        )

        self.assertEqual(response.status_code, 404)

    # TEST 11
    def test_cancelled_event_detail_is_private(self):
        event = self.create_event(status="cancelled")

        response = self.client.get(
            reverse("public-event-detail", args=[event.id])
        )

        self.assertEqual(response.status_code, 404)

    # TEST 12
    def test_unknown_public_event_returns_404(self):
        response = self.client.get(
            reverse("public-event-detail", args=[999999])
        )

        self.assertEqual(response.status_code, 404)

    # TEST 13
    def test_past_event_not_public(self):
        event = self.create_event(status="published")

        now = timezone.now()

        Event.objects.filter(id=event.id).update(
            start_datetime=now - timedelta(days=2),
            end_datetime=now - timedelta(days=1),
            registration_deadline=now - timedelta(days=3),
        )

        list_response = self.client.get(
            reverse("public-events")
        )

        detail_response = self.client.get(
            reverse("public-event-detail", args=[event.id])
        )

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.data), 0)
        self.assertEqual(detail_response.status_code, 404)


# ============================================================
# FEATURE 3 — STUDENT REGISTRATION TESTS
# ============================================================

@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class RegistrationTests(TestCase):

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

        self.student = User.objects.create_user(
            username="student_one",
            password="StudentPass@123"
        )

        self.student_two = User.objects.create_user(
            username="student_two",
            password="StudentPass@123"
        )

        self.organizer = User.objects.create_user(
            username="organizer_one",
            password="OrganizerPass@123"
        )

        # Required for organizer permission tests.
        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )
        self.organizer.groups.add(organizer_group)

        now = timezone.now()

        self.event = Event.objects.create(
            title="EventHub Test Workshop",
            description="A workshop for students.",
            category="workshop",
            venue="Computer Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=10, hours=3),
            registration_deadline=now + timedelta(days=8),
            capacity=2,
            organizer=self.organizer,
            status="published",
        )

    def login_student(self, student=None):
        student = student or self.student

        self.client.force_login(student)

        response = self.client.get(reverse("csrf-token"))
        self.assertEqual(response.status_code, 200)

        return response.json()["csrfToken"]

    def register(self, token):
        return self.client.post(
            reverse("event-register", args=[self.event.id]),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

    # TEST 14
    def test_student_can_register(self):
        token = self.login_student()

        response = self.register(token)

        self.assertEqual(response.status_code, 201)

        self.assertTrue(
            Registration.objects.filter(
                event=self.event,
                student=self.student,
                status="registered"
            ).exists()
        )

    # TEST 15
    def test_duplicate_registration_rejected(self):
        token = self.login_student()

        first = self.register(token)
        second = self.register(token)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(Registration.objects.count(), 1)

    # TEST 16
    def test_event_capacity_enforced(self):
        token = self.login_student(self.student)
        self.assertEqual(self.register(token).status_code, 201)

        token = self.login_student(self.student_two)
        self.assertEqual(self.register(token).status_code, 201)

        third_student = User.objects.create_user(
            username="student_three",
            password="StudentPass@123"
        )

        token = self.login_student(third_student)
        response = self.register(token)

        self.assertEqual(response.status_code, 409)

        self.assertEqual(
            Registration.objects.filter(
                event=self.event,
                status="registered"
            ).count(),
            2
        )

    # TEST 17
    def test_draft_event_registration_rejected(self):
        self.event.status = "draft"
        self.event.save()

        token = self.login_student()
        response = self.register(token)

        self.assertEqual(response.status_code, 400)

    # TEST 18
    def test_registration_deadline_enforced(self):
        self.event.registration_deadline = (
            timezone.now() - timedelta(hours=1)
        )
        self.event.save()

        token = self.login_student()
        response = self.register(token)

        self.assertEqual(response.status_code, 400)

    # TEST 19
    def test_registration_requires_csrf(self):
        self.client.force_login(self.student)

        response = self.client.post(
            reverse("event-register", args=[self.event.id]),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Registration.objects.count(), 0)

    # TEST 20
    def test_student_can_cancel_registration(self):
        token = self.login_student()
        self.register(token)

        registration = Registration.objects.get(
            student=self.student,
            event=self.event
        )

        response = self.client.post(
            reverse("cancel-registration", args=[registration.id]),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 200)

        registration.refresh_from_db()
        self.assertEqual(registration.status, "cancelled")

    # TEST 21
    def test_cancelled_registration_can_be_reactivated(self):
        token = self.login_student()
        self.register(token)

        registration = Registration.objects.get(
            student=self.student,
            event=self.event
        )

        self.client.post(
            reverse("cancel-registration", args=[registration.id]),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        response = self.register(token)

        self.assertEqual(response.status_code, 201)

        registration.refresh_from_db()
        self.assertEqual(registration.status, "registered")
        self.assertEqual(Registration.objects.count(), 1)

    # TEST 22
    def test_student_cannot_cancel_another_students_registration(self):
        token = self.login_student(self.student)
        self.register(token)

        registration = Registration.objects.get(
            student=self.student,
            event=self.event
        )

        token = self.login_student(self.student_two)

        response = self.client.post(
            reverse("cancel-registration", args=[registration.id]),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 404)

        registration.refresh_from_db()
        self.assertEqual(registration.status, "registered")

    # TEST 23
    def test_my_registrations_are_private(self):
        token = self.login_student(self.student)
        self.register(token)

        self.login_student(self.student_two)

        response = self.client.get(reverse("my-registrations"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)

    # ========================================================
    # FEATURE 3C — PARTICIPANT AND CAPACITY TESTS
    # ========================================================

    # TEST 24
    def test_organizer_can_view_own_participants(self):
        Registration.objects.create(
            event=self.event,
            student=self.student,
            status="registered"
        )

        self.client.force_login(self.organizer)

        response = self.client.get(
            reverse("organizer-participants", args=[self.event.id])
        )

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            response.data["statistics"]["registered"],
            1
        )

        self.assertEqual(
            response.data["statistics"]["available_seats"],
            1
        )

        self.assertEqual(len(response.data["participants"]), 1)

    # TEST 25
    def test_student_cannot_view_participants(self):
        self.client.force_login(self.student)

        response = self.client.get(
            reverse("organizer-participants", args=[self.event.id])
        )

        self.assertEqual(response.status_code, 403)

    # TEST 26
    def test_organizer_cannot_reduce_capacity_below_registrations(self):
        Registration.objects.create(
            event=self.event,
            student=self.student,
            status="registered"
        )

        Registration.objects.create(
            event=self.event,
            student=self.student_two,
            status="registered"
        )

        self.client.force_login(self.organizer)

        token_response = self.client.get(reverse("csrf-token"))
        token = token_response.json()["csrfToken"]

        response = self.client.patch(
            reverse("organizer-event-detail", args=[self.event.id]),
            {"capacity": 1},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 400)

        self.event.refresh_from_db()
        self.assertEqual(self.event.capacity, 2)

    # TEST 27
    def test_other_organizer_cannot_view_participants(self):
        other_organizer = User.objects.create_user(
            username="other_organizer",
            password="OrganizerPass@123"
        )

        organizer_group = Group.objects.get(name="Organizer")
        other_organizer.groups.add(organizer_group)

        self.client.force_login(other_organizer)

        response = self.client.get(
            reverse("organizer-participants", args=[self.event.id])
        )

        self.assertEqual(response.status_code, 404)

    def test_organizer_cannot_access_student_registration_features(self):
        self.client.force_login(self.organizer)

        token_response = self.client.get(
            reverse("csrf-token")
        )

        token = token_response.json()["csrfToken"]

        # Organizer cannot register for an event.
        response = self.client.post(
            reverse("event-register", args=[self.event.id]),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 403)

        # Organizer cannot access student registration history.
        response = self.client.get(
            reverse("my-registrations")
        )

        self.assertEqual(response.status_code, 403)

    def test_ticket_token_rotates_after_reregistration(self):
        # Register student.
        csrf_token = self.login_student()

        first_response = self.register(csrf_token)

        self.assertEqual(first_response.status_code, 201)

        registration = Registration.objects.get(
            student=self.student,
            event=self.event,
        )

        # Obtain the original ticket.
        ticket_response = self.client.get(
            reverse(
                "student-ticket",
                args=[registration.id]
            )
        )

        self.assertEqual(ticket_response.status_code, 200)

        old_token = ticket_response.data["ticket"]["token"]

        # Cancel registration.
        cancel_response = self.client.post(
            reverse(
                "cancel-registration",
                args=[registration.id]
            ),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(cancel_response.status_code, 200)

        # Register again.
        second_response = self.register(csrf_token)

        self.assertEqual(second_response.status_code, 201)

        # Retrieve the new ticket.
        new_ticket_response = self.client.get(
            reverse(
                "student-ticket",
                args=[registration.id]
            )
        )

        self.assertEqual(new_ticket_response.status_code, 200)

        new_token = new_ticket_response.data["ticket"]["token"]

        # The old QR token must be invalidated.
        self.assertNotEqual(old_token, new_token)

        self.assertFalse(
            EventTicket.objects.filter(
                token=old_token
            ).exists()
        )

        # Only one ticket record exists for the registration.
        self.assertEqual(
            EventTicket.objects.filter(
                registration=registration
            ).count(),
            1
        )


# ============================================================
# FEATURE 3C — POSTGRESQL CONCURRENCY TEST
# ============================================================

@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class RegistrationConcurrencyTests(TransactionTestCase):

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest(
                "This test requires PostgreSQL row-level locking."
            )

        self.students = [
            User.objects.create_user(
                username=f"race_student_{number}",
                password="StudentPass@123"
            )
            for number in range(2)
        ]

        organizer = User.objects.create_user(
            username="race_organizer",
            password="OrganizerPass@123"
        )

        now = timezone.now()

        self.event = Event.objects.create(
            title="One Seat Workshop",
            description="Concurrency test event",
            category="workshop",
            venue="Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=10, hours=2),
            registration_deadline=now + timedelta(days=8),
            capacity=1,
            status="published",
            organizer=organizer,
        )

    # TEST 28
    def test_two_students_compete_for_last_seat(self):
        barrier = Barrier(2)

        def register_student(student):
            # Each thread uses its own database connection.
            close_old_connections()

            try:
                client = APIClient(enforce_csrf_checks=True)
                client.force_login(student)

                csrf_response = client.get(reverse("csrf-token"))

                self.assertEqual(csrf_response.status_code, 200)

                token = csrf_response.json()["csrfToken"]

                # Start both registration requests together.
                barrier.wait(timeout=15)

                response = client.post(
                    reverse("event-register", args=[self.event.id]),
                    {},
                    format="json",
                    HTTP_X_CSRFTOKEN=token,
                )

                return response.status_code

            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(
                executor.map(register_student, self.students)
            )

        # One student succeeds, the other is rejected.
        self.assertEqual(sorted(results), [201, 409])

        # PostgreSQL must contain only one active booking.
        active_registrations = Registration.objects.filter(
            event=self.event,
            status="registered"
        ).count()

        self.assertEqual(active_registrations, 1)

# ============================================================
# FEATURE 4A — QR TICKET AND ATTENDANCE TESTS
# ============================================================

@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class EventTicketTests(TestCase):

    def setUp(self):

        self.client = APIClient(
            enforce_csrf_checks=True
        )

        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.organizer = User.objects.create_user(
            username="ticket_organizer",
            password="OrganizerPass@123"
        )

        self.organizer.groups.add(organizer_group)

        self.student = User.objects.create_user(
            username="ticket_student",
            password="StudentPass@123"
        )

        self.other_student = User.objects.create_user(
            username="ticket_student_two",
            password="StudentPass@123"
        )

        now = timezone.now()

        # Event currently in progress, allowing check-in tests.
        self.event = Event.objects.create(
            title="QR Attendance Test Event",
            description="Test event for QR scanning.",
            category="workshop",
            venue="Computer Lab",
            start_datetime=now - timedelta(minutes=5),
            end_datetime=now + timedelta(hours=2),
            registration_deadline=now - timedelta(hours=1),
            capacity=20,
            organizer=self.organizer,
            status="published"
        )

        self.registration = Registration.objects.create(
            event=self.event,
            student=self.student,
            status="registered"
        )

    def login(self, user):

        self.client.force_login(user)

        response = self.client.get(
            reverse("csrf-token")
        )

        self.assertEqual(response.status_code, 200)

        return response.json()["csrfToken"]

    def get_ticket(self):

        return self.client.get(
            reverse(
                "student-ticket",
                args=[self.registration.id]
            )
        )

    def check_in(self, token, csrf_token):

        return self.client.post(
            reverse(
                "organizer-check-in",
                args=[self.event.id]
            ),
            {"token": str(token)},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

    # TEST 1
    def test_student_can_get_ticket(self):

        self.login(self.student)

        response = self.get_ticket()

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            EventTicket.objects.count(),
            1
        )

        self.assertIn(
            "token",
            response.data["ticket"]
        )

    # TEST 2
    def test_ticket_is_not_duplicated(self):

        self.login(self.student)

        first = self.get_ticket()
        second = self.get_ticket()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

        self.assertEqual(
            first.data["ticket"]["token"],
            second.data["ticket"]["token"]
        )

        self.assertEqual(
            EventTicket.objects.count(),
            1
        )

    # TEST 3
    def test_student_cannot_access_another_ticket(self):

        self.login(self.other_student)

        response = self.get_ticket()

        self.assertEqual(response.status_code, 404)

    # TEST 4
    def test_cancelled_registration_cannot_get_ticket(self):

        self.registration.status = "cancelled"
        self.registration.save()

        self.login(self.student)

        response = self.get_ticket()

        self.assertEqual(response.status_code, 400)

    # TEST 5
    def test_organizer_can_check_in_valid_ticket(self):

        self.login(self.student)

        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        csrf_token = self.login(self.organizer)

        response = self.check_in(
            token,
            csrf_token
        )

        self.assertEqual(response.status_code, 200)

        ticket = EventTicket.objects.get(
            registration=self.registration
        )

        self.assertIsNotNone(
            ticket.checked_in_at
        )

        self.assertEqual(
            ticket.checked_in_by,
            self.organizer
        )

    # TEST 6
    def test_duplicate_check_in_rejected(self):

        self.login(self.student)

        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        csrf_token = self.login(self.organizer)

        first = self.check_in(token, csrf_token)
        second = self.check_in(token, csrf_token)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)

    # TEST 7
    def test_invalid_ticket_rejected(self):

        csrf_token = self.login(self.organizer)

        response = self.check_in(
            "00000000-0000-4000-8000-000000000000",
            csrf_token
        )

        self.assertEqual(response.status_code, 404)
        
        # ORGANIZER OWNERSHIP
    def test_other_organizer_cannot_check_in_ticket(self):

        other_organizer = User.objects.create_user(
            username="attendance_other_organizer",
            password="OrganizerPass@123"
        )

        group = Group.objects.get(name="Organizer")
        other_organizer.groups.add(group)

        self.login(self.student)
        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        csrf_token = self.login(other_organizer)

        response = self.check_in(token, csrf_token)

        self.assertEqual(response.status_code, 404)

        ticket = EventTicket.objects.get(
            registration=self.registration
        )

        self.assertIsNone(ticket.checked_in_at)


    # STUDENT CANNOT MARK ATTENDANCE
    def test_student_cannot_check_in_ticket(self):

        self.login(self.student)
        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        csrf_token = self.login(self.student)

        response = self.check_in(token, csrf_token)

        self.assertEqual(response.status_code, 403)


    # CANCELLED REGISTRATION CANNOT CHECK IN
    def test_cancelled_registration_cannot_check_in(self):

        self.login(self.student)
        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        self.registration.status = "cancelled"
        self.registration.save(update_fields=["status"])

        csrf_token = self.login(self.organizer)

        response = self.check_in(token, csrf_token)

        self.assertEqual(response.status_code, 400)


    # CHECK-IN MUST NOT OPEN TOO EARLY
    def test_check_in_before_window_is_rejected(self):

        self.login(self.student)
        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        now = timezone.now()

        self.event.start_datetime = now + timedelta(days=2)
        self.event.end_datetime = now + timedelta(days=2, hours=2)

        self.event.save(
            update_fields=[
                "start_datetime",
                "end_datetime"
            ]
        )

        csrf_token = self.login(self.organizer)

        response = self.check_in(token, csrf_token)

        self.assertEqual(response.status_code, 400)


    # CHECK-IN REQUIRES CSRF
    def test_check_in_without_csrf_is_rejected(self):

        self.login(self.student)
        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        self.client.force_login(self.organizer)

        response = self.client.post(
            reverse(
                "organizer-check-in",
                args=[self.event.id]
            ),
            {"token": token},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        
    def test_organizer_can_view_attendance_dashboard(self):

        self.login(self.organizer)

        response = self.client.get(
            reverse(
                "organizer-attendance",
                args=[self.event.id]
            )
        )

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            response.data["statistics"]["registered"],
            1
        )

        self.assertEqual(
            response.data["statistics"]["checked_in"],
            0
        )


    def test_student_cannot_view_attendance_dashboard(self):

        self.login(self.student)

        response = self.client.get(
            reverse(
                "organizer-attendance",
                args=[self.event.id]
            )
        )

        self.assertEqual(response.status_code, 403)
        
    def test_check_in_after_event_end_is_rejected(self):

        # Log in as the student and generate their ticket.
        self.login(self.student)

        ticket_response = self.get_ticket()

        self.assertEqual(
            ticket_response.status_code,
            200
        )

        token = ticket_response.data["ticket"]["token"]

        # Move the event into the past while maintaining
        # the database's valid date relationships.
        now = timezone.now()

        self.event.start_datetime = (
            now - timedelta(hours=3)
        )

        self.event.end_datetime = (
            now - timedelta(hours=1)
        )

        # Registration deadline must remain before
        # the event's start time.
        self.event.registration_deadline = (
            now - timedelta(hours=4)
        )

        self.event.save(
            update_fields=[
                "start_datetime",
                "end_datetime",
                "registration_deadline",
            ]
        )

        # Log in as the event organizer.
        csrf_token = self.login(self.organizer)

        # Attempt to check in after the event has ended.
        response = self.check_in(
            token,
            csrf_token
        )

        # The backend must reject attendance.
        self.assertEqual(
            response.status_code,
            400
        )

        # Ensure attendance was not recorded.
        ticket = EventTicket.objects.get(
            registration=self.registration
        )

        self.assertIsNone(
            ticket.checked_in_at
        )

    def test_cancelled_event_cannot_check_in(self):

        self.login(self.student)

        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        self.event.status = "cancelled"

        self.event.save(update_fields=["status"])

        csrf_token = self.login(self.organizer)

        response = self.check_in(
            token,
            csrf_token
        )

        self.assertEqual(response.status_code, 400)

    def test_checked_in_registration_cannot_be_cancelled(self):

        student_csrf = self.login(self.student)

        ticket_response = self.get_ticket()

        token = ticket_response.data["ticket"]["token"]

        organizer_csrf = self.login(self.organizer)

        check_in_response = self.check_in(
            token,
            organizer_csrf
        )

        self.assertEqual(check_in_response.status_code, 200)

        student_csrf = self.login(self.student)

        response = self.client.post(
            reverse(
                "cancel-registration",
                args=[self.registration.id]
            ),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=student_csrf,
        )

        self.assertEqual(response.status_code, 409)

        self.registration.refresh_from_db()

        self.assertEqual(
            self.registration.status,
            "registered"
        )

    def test_checked_in_guard_independent_of_event_start(self):

        ticket = EventTicket.objects.create(
            registration=self.registration,
            checked_in_at=timezone.now(),
            checked_in_by=self.organizer,
        )

        now = timezone.now()

        self.event.start_datetime = now + timedelta(days=2)
        self.event.end_datetime = now + timedelta(days=2, hours=2)
        self.event.registration_deadline = now + timedelta(days=1)

        self.event.save(
            update_fields=[
                "start_datetime",
                "end_datetime",
                "registration_deadline",
            ]
        )

        csrf_token = self.login(self.student)

        response = self.client.post(
            reverse(
                "cancel-registration",
                args=[self.registration.id]
            ),
            {},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 409)

        self.registration.refresh_from_db()

        self.assertEqual(self.registration.status, "registered")

# ============================================================
# FEATURE 5A — ANALYTICS SECURITY TESTS
# ============================================================

@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
    ANALYTICS_INTERNAL_KEY="test-internal-key",
    ANALYTICS_SERVICE_URL="http://127.0.0.1:8001",
)
class OrganizerAnalyticsTests(TestCase):

    def setUp(self):

        self.client = APIClient(
            enforce_csrf_checks=True
        )

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.organizer = User.objects.create_user(
            username="analytics_organizer",
            password="OrganizerPass@123"
        )

        self.organizer.groups.add(group)

        self.student = User.objects.create_user(
            username="analytics_student",
            password="StudentPass@123"
        )

    def test_student_cannot_access_analytics(self):

        self.client.force_login(self.student)

        response = self.client.get(
            reverse("organizer-analytics")
        )

        self.assertEqual(response.status_code, 403)

    def test_organizer_analytics_uses_authenticated_id(self):

        self.client.force_login(self.organizer)

        mock_payload = {
            "organizer_id": self.organizer.id,
            "summary": {
                "total_events": 1
            },
            "events": [],
        }

        from io import BytesIO

        from unittest.mock import MagicMock

        mock_response = MagicMock()

        mock_response.__enter__.return_value.read.return_value = (
            json.dumps(mock_payload).encode("utf-8")
        )

        with patch(
            "events.views.urllib.request.urlopen",
            return_value=mock_response
        ) as mock_urlopen:

            response = self.client.get(
                reverse("organizer-analytics")
            )

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            response.data["organizer_id"],
            self.organizer.id
        )

        internal_request = mock_urlopen.call_args.args[0]

        self.assertIn(
            f"/organizers/{self.organizer.id}/overview",
            internal_request.full_url
        )

@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class AttendanceConcurrencyTests(TransactionTestCase):

    def setUp(self):

        if connection.vendor != "postgresql":
            self.skipTest(
                "This test requires PostgreSQL."
            )

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.organizer = User.objects.create_user(
            username="concurrent_attendance_organizer",
            password="OrganizerPass@123"
        )

        self.organizer.groups.add(group)

        self.student = User.objects.create_user(
            username="concurrent_attendance_student",
            password="StudentPass@123"
        )

        now = timezone.now()

        self.event = Event.objects.create(
            title="Concurrent Attendance Test",
            description="Testing simultaneous QR scans.",
            category="workshop",
            venue="Lab",
            start_datetime=now - timedelta(minutes=5),
            end_datetime=now + timedelta(hours=2),
            registration_deadline=now - timedelta(hours=1),
            capacity=10,
            status="published",
            organizer=self.organizer,
        )

        self.registration = Registration.objects.create(
            event=self.event,
            student=self.student,
            status="registered"
        )

        self.ticket = EventTicket.objects.create(
            registration=self.registration
        )

    def test_simultaneous_ticket_check_in(self):

        barrier = Barrier(2)

        def check_in():

            close_old_connections()

            try:
                client = APIClient(
                    enforce_csrf_checks=True
                )

                client.force_login(self.organizer)

                csrf_response = client.get(
                    reverse("csrf-token")
                )

                token = csrf_response.json()["csrfToken"]

                barrier.wait(timeout=15)

                response = client.post(
                    reverse(
                        "organizer-check-in",
                        args=[self.event.id]
                    ),
                    {
                        "token": str(self.ticket.token)
                    },
                    format="json",
                    HTTP_X_CSRFTOKEN=token,
                )

                return response.status_code

            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:

            results = list(
                executor.map(
                    lambda _: check_in(),
                    range(2)
                )
            )

        # Exactly one request succeeds.
        self.assertEqual(
            sorted(results),
            [200, 409]
        )

        self.ticket.refresh_from_db()

        self.assertIsNotNone(
            self.ticket.checked_in_at
        )