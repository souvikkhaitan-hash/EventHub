from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from .models import Event, EventTeam, Registration, TeamMembership


User = get_user_model()


class TeamSecurityRegressionTests(TestCase):
    """
    Verify organizer response privacy, team ownership,
    and changes to limits after teams already exist.

    These tests authenticate directly to focus on permissions
    and business rules. They do not test browser login or CSRF.
    """

    @classmethod
    def setUpTestData(cls):
        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        cls.organizer = User.objects.create_user(
            username="security_organizer"
        )

        cls.other_organizer = User.objects.create_user(
            username="security_other_organizer"
        )

        cls.organizer.groups.add(organizer_group)
        cls.other_organizer.groups.add(organizer_group)

        cls.leader = User.objects.create_user(
            username="security_leader"
        )

        cls.member = User.objects.create_user(
            username="security_member"
        )

        cls.outsider = User.objects.create_user(
            username="security_outsider"
        )

        now = timezone.now()

        cls.event = Event.objects.create(
            organizer=cls.organizer,
            title="Team Security Test Event",
            description="An isolated automated test event.",
            category="technical",
            venue="Test Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=11),
            registration_deadline=now + timedelta(days=8),
            capacity=30,
            registration_mode="team",
            min_team_size=2,
            max_team_size=6,
            max_teams=10,
            status="published",
        )

        cls.team = EventTeam.objects.create(
            event=cls.event,
            name="Security Test Team",
            leader=cls.leader,
            status="confirmed",
        )

        for student, role in [
            (cls.leader, "leader"),
            (cls.member, "member"),
        ]:
            registration = Registration.objects.create(
                event=cls.event,
                student=student,
                status="registered",
            )

            TeamMembership.objects.create(
                team=cls.team,
                registration=registration,
                role=role,
            )

    def setUp(self):
        self.client = APIClient()

    def login_as(self, user):
        self.client.force_authenticate(user=user)

    def update_event(self, changes):
        self.login_as(self.organizer)

        return self.client.patch(
            reverse(
                "organizer-event-detail",
                args=[self.event.id],
            ),
            changes,
            format="json",
        )

    def test_organizer_team_response_omits_invitation_code(self):
        self.login_as(self.organizer)

        response = self.client.get(
            reverse(
                "organizer-event-teams",
                args=[self.event.id],
            )
        )

        self.assertEqual(response.status_code, 200)

        team_data = response.data["teams"][0]

        self.assertNotIn("invitation_code", team_data)
        self.assertEqual(team_data["member_count"], 2)
        self.assertEqual(len(team_data["members"]), 2)

    def test_student_can_still_retrieve_own_invitation_code(self):
        self.login_as(self.leader)

        response = self.client.get(
            reverse(
                "my-event-team",
                args=[self.event.id],
            )
        )

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            str(response.data["team"]["invitation_code"]),
            str(self.team.invitation_code),
        )

    def test_other_organizer_cannot_read_team_roster(self):
        self.login_as(self.other_organizer)

        response = self.client.get(
            reverse(
                "organizer-event-teams",
                args=[self.event.id],
            )
        )

        self.assertEqual(response.status_code, 404)
        self.assertNotIn("teams", response.data)

    def test_student_cannot_use_organizer_team_endpoint(self):
        self.login_as(self.member)

        response = self.client.get(
            reverse(
                "organizer-event-teams",
                args=[self.event.id],
            )
        )

        self.assertEqual(response.status_code, 403)

    def test_outsider_cannot_retrieve_another_students_team(self):
        self.login_as(self.outsider)

        response = self.client.get(
            reverse(
                "my-event-team",
                args=[self.event.id],
            )
        )

        self.assertEqual(response.status_code, 404)
        self.assertNotIn("team", response.data)

    def test_outsider_cannot_confirm_a_forming_team(self):
        self.team.status = "forming"
        self.team.save(update_fields=["status"])

        self.login_as(self.outsider)

        response = self.client.post(
            reverse(
                "confirm-event-team",
                args=[self.team.id],
            ),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.team.refresh_from_db()
        self.assertEqual(self.team.status, "forming")

    def test_maximum_teams_cannot_be_below_active_team_count(self):
        EventTeam.objects.create(
            event=self.event,
            name="Another Forming Team",
            leader=self.outsider,
            status="forming",
        )

        response = self.update_event({"max_teams": 1})

        self.assertEqual(response.status_code, 400)
        self.assertIn("max_teams", response.data)

        self.event.refresh_from_db()
        self.assertEqual(self.event.max_teams, 10)

    def test_maximum_size_cannot_be_below_existing_roster(self):
        registration = Registration.objects.create(
            event=self.event,
            student=self.outsider,
            status="registered",
        )

        TeamMembership.objects.create(
            team=self.team,
            registration=registration,
            role="member",
        )

        response = self.update_event({"max_team_size": 2})

        self.assertEqual(response.status_code, 400)
        self.assertIn("max_team_size", response.data)

        self.event.refresh_from_db()
        self.assertEqual(self.event.max_team_size, 6)

    def test_minimum_size_cannot_invalidate_confirmed_team(self):
        response = self.update_event({"min_team_size": 3})

        self.assertEqual(response.status_code, 400)
        self.assertIn("min_team_size", response.data)

        self.event.refresh_from_db()
        self.assertEqual(self.event.min_team_size, 2)

    def test_forming_team_can_recruit_for_new_minimum(self):
        self.team.status = "forming"
        self.team.save(update_fields=["status"])

        response = self.update_event({"min_team_size": 3})

        self.assertEqual(response.status_code, 200)

        self.event.refresh_from_db()
        self.assertEqual(self.event.min_team_size, 3)

        self.login_as(self.leader)

        confirmation = self.client.post(
            reverse(
                "confirm-event-team",
                args=[self.team.id],
            ),
            {},
            format="json",
        )

        self.assertEqual(confirmation.status_code, 400)

        self.team.refresh_from_db()
        self.assertEqual(self.team.status, "forming")

    def test_withdrawn_teams_do_not_consume_team_limit(self):
        EventTeam.objects.create(
            event=self.event,
            name="Withdrawn Test Team",
            leader=self.outsider,
            status="withdrawn",
        )

        response = self.update_event({"max_teams": 1})

        self.assertEqual(response.status_code, 200)

        self.event.refresh_from_db()
        self.assertEqual(self.event.max_teams, 1)

    def test_limits_can_match_existing_team_and_roster(self):
        response = self.update_event({
            "max_teams": 1,
            "max_team_size": 2,
            "min_team_size": 2,
        })

        self.assertEqual(response.status_code, 200)

        self.event.refresh_from_db()

        self.assertEqual(self.event.max_teams, 1)
        self.assertEqual(self.event.max_team_size, 2)
        self.assertEqual(self.event.min_team_size, 2)