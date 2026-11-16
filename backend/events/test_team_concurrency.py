from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import close_old_connections, connection
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from .models import (
    Event,
    EventTeam,
    Registration,
    TeamMembership,
)


User = get_user_model()


@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class TeamRegistrationConcurrencyTests(TransactionTestCase):
    """
    Run competing requests using separate database connections.

    PostgreSQL is required because these tests exercise the
    row locks used by the team registration endpoints.
    """

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest(
                "These tests require PostgreSQL row-level locking."
            )

        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.organizer = User.objects.create_user(
            username="team_race_organizer"
        )
        self.organizer.groups.add(organizer_group)

        self.leaders = [
            User.objects.create_user(
                username=f"team_race_leader_{number}"
            )
            for number in range(2)
        ]

        self.students = [
            User.objects.create_user(
                username=f"team_race_student_{number}"
            )
            for number in range(2)
        ]

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.organizer,
            title="Concurrent Team Registration Test",
            description="Isolated automated test event.",
            category="technical",
            venue="Test Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=10, hours=2),
            registration_deadline=now + timedelta(days=8),
            capacity=10,
            registration_mode="team",
            min_team_size=2,
            max_team_size=2,
            max_teams=10,
            status="published",
        )

    def create_forming_team(self, leader, name):
        """
        Prepare a valid forming team with its leader registered.
        """
        team = EventTeam.objects.create(
            event=self.event,
            name=name,
            leader=leader,
            status="forming",
        )

        registration = Registration.objects.create(
            event=self.event,
            student=leader,
            status="registered",
        )

        TeamMembership.objects.create(
            team=team,
            registration=registration,
            role="leader",
        )

        return team

    def run_competing_requests(self, requests):
        """
        Each tuple contains: user ID, endpoint URL, JSON body.

        Each worker logs in separately, obtains a CSRF token,
        then waits until both requests are ready.
        """
        barrier = Barrier(2)

        def send_request(request_details):
            user_id, url, body = request_details

            close_old_connections()

            try:
                # Bound database waits so a locking defect fails
                # instead of leaving the test waiting indefinitely.
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SET lock_timeout TO '10s'"
                    )
                    cursor.execute(
                        "SET statement_timeout TO '20s'"
                    )

                user = User.objects.get(pk=user_id)

                client = APIClient(
                    enforce_csrf_checks=True
                )
                client.force_login(user)

                csrf_response = client.get(
                    reverse("csrf-token")
                )

                if csrf_response.status_code != 200:
                    raise AssertionError(
                        "Unable to obtain a CSRF token: "
                        f"{csrf_response.status_code}"
                    )

                csrf_token = csrf_response.json()["csrfToken"]

                barrier.wait(timeout=15)

                response = client.post(
                    url,
                    body,
                    format="json",
                    HTTP_X_CSRFTOKEN=csrf_token,
                )

                return response.status_code

            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(
                executor.map(send_request, requests)
            )

    def test_two_students_compete_for_last_team_place(self):
        team = self.create_forming_team(
            self.leaders[0],
            "One Place Remaining",
        )

        url = reverse(
            "join-event-team",
            args=[self.event.id],
        )

        results = self.run_competing_requests([
            (
                student.id,
                url,
                {"invitation_code": str(team.invitation_code)},
            )
            for student in self.students
        ])

        self.assertEqual(sorted(results), [201, 409])

        # One leader and exactly one successful new member.
        self.assertEqual(
            team.memberships.count(),
            2,
        )

        self.assertEqual(
            Registration.objects.filter(
                event=self.event,
                status="registered",
            ).count(),
            2,
        )

        self.assertEqual(
            TeamMembership.objects.filter(
                team=team,
                registration__student__in=self.students,
            ).count(),
            1,
        )

    def test_students_in_different_teams_compete_for_last_event_seat(self):
        first_team = self.create_forming_team(
            self.leaders[0],
            "First Team",
        )

        second_team = self.create_forming_team(
            self.leaders[1],
            "Second Team",
        )

        # Two leaders already occupy two of three seats.
        self.event.capacity = 3
        self.event.save(update_fields=["capacity"])

        url = reverse(
            "join-event-team",
            args=[self.event.id],
        )

        results = self.run_competing_requests([
            (
                self.students[0].id,
                url,
                {
                    "invitation_code":
                    str(first_team.invitation_code)
                },
            ),
            (
                self.students[1].id,
                url,
                {
                    "invitation_code":
                    str(second_team.invitation_code)
                },
            ),
        ])

        self.assertEqual(sorted(results), [201, 409])

        # The event must never contain four active registrations.
        self.assertEqual(
            Registration.objects.filter(
                event=self.event,
                status="registered",
            ).count(),
            3,
        )

        self.assertEqual(
            TeamMembership.objects.filter(
                team__event=self.event,
            ).count(),
            3,
        )

        self.assertEqual(
            sorted([
                first_team.memberships.count(),
                second_team.memberships.count(),
            ]),
            [1, 2],
        )

    def test_two_students_compete_for_last_available_team(self):
        self.event.max_teams = 1
        self.event.save(update_fields=["max_teams"])

        url = reverse(
            "create-event-team",
            args=[self.event.id],
        )

        results = self.run_competing_requests([
            (
                self.students[0].id,
                url,
                {"name": "Competing Team Alpha"},
            ),
            (
                self.students[1].id,
                url,
                {"name": "Competing Team Beta"},
            ),
        ])

        self.assertEqual(sorted(results), [201, 409])

        self.assertEqual(
            EventTeam.objects.filter(
                event=self.event,
            ).exclude(
                status="withdrawn",
            ).count(),
            1,
        )

        # The rejected request must not leave an orphan booking.
        self.assertEqual(
            Registration.objects.filter(
                event=self.event,
                status="registered",
            ).count(),
            1,
        )

        self.assertEqual(
            TeamMembership.objects.filter(
                team__event=self.event,
            ).count(),
            1,
        )

    def test_same_student_cannot_join_two_teams_concurrently(self):
        first_team = self.create_forming_team(
            self.leaders[0],
            "Duplicate Join Alpha",
        )

        second_team = self.create_forming_team(
            self.leaders[1],
            "Duplicate Join Beta",
        )

        student = self.students[0]

        url = reverse(
            "join-event-team",
            args=[self.event.id],
        )

        results = self.run_competing_requests([
            (
                student.id,
                url,
                {
                    "invitation_code":
                    str(first_team.invitation_code)
                },
            ),
            (
                student.id,
                url,
                {
                    "invitation_code":
                    str(second_team.invitation_code)
                },
            ),
        ])

        self.assertEqual(sorted(results), [201, 409])

        self.assertEqual(
            Registration.objects.filter(
                event=self.event,
                student=student,
                status="registered",
            ).count(),
            1,
        )

        self.assertEqual(
            TeamMembership.objects.filter(
                team__event=self.event,
                registration__student=student,
            ).count(),
            1,
        )

        self.assertEqual(
            sorted([
                first_team.memberships.count(),
                second_team.memberships.count(),
            ]),
            [1, 2],
        )