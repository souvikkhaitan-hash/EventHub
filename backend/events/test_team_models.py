from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from .models import (
    Event,
    EventTeam,
    Registration,
    TeamMembership,
)


User = get_user_model()


class TeamModelTests(TestCase):

    def setUp(self):

        self.organizer = User.objects.create_user(
            username="team_model_organizer",
            password="TestPassword123!",
        )

        self.student1 = User.objects.create_user(
            username="team_model_student1",
            password="TestPassword123!",
        )

        self.student2 = User.objects.create_user(
            username="team_model_student2",
            password="TestPassword123!",
        )

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.organizer,
            title="Campus Hackathon",
            description="A team coding competition.",
            category="technical",
            venue="Innovation Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=11),
            registration_deadline=now + timedelta(days=8),
            capacity=180,
            registration_mode="team",
            min_team_size=2,
            max_team_size=6,
            max_teams=30,
            status="draft",
        )

        self.team = EventTeam.objects.create(
            event=self.event,
            name="Code Warriors",
            leader=self.student1,
        )

    # --------------------------------------------------------
    # TEST 1
    # --------------------------------------------------------

    def test_team_is_created(self):

        self.assertEqual(
            self.team.name,
            "Code Warriors",
        )

        self.assertEqual(
            self.team.event,
            self.event,
        )

        self.assertEqual(
            self.team.status,
            "forming",
        )

    # --------------------------------------------------------
    # TEST 2
    # --------------------------------------------------------

    def test_team_receives_invitation_code(self):

        self.assertIsNotNone(
            self.team.invitation_code
        )

    # --------------------------------------------------------
    # TEST 3
    # --------------------------------------------------------

    def test_duplicate_team_names_are_rejected(self):

        with self.assertRaises(IntegrityError):

            with transaction.atomic():

                EventTeam.objects.create(
                    event=self.event,
                    name="code warriors",
                    leader=self.student2,
                )

    # --------------------------------------------------------
    # TEST 4
    # --------------------------------------------------------

    def test_student_can_be_linked_to_team(self):

        registration = Registration.objects.create(
            event=self.event,
            student=self.student1,
        )

        membership = TeamMembership.objects.create(
            team=self.team,
            registration=registration,
            role="leader",
        )

        self.assertEqual(
            membership.team,
            self.team,
        )

        self.assertEqual(
            membership.registration.student,
            self.student1,
        )

    # --------------------------------------------------------
    # TEST 5
    # --------------------------------------------------------

    def test_registration_cannot_join_two_teams(self):

        registration = Registration.objects.create(
            event=self.event,
            student=self.student1,
        )

        TeamMembership.objects.create(
            team=self.team,
            registration=registration,
            role="leader",
        )

        second_team = EventTeam.objects.create(
            event=self.event,
            name="Byte Builders",
            leader=self.student2,
        )

        with self.assertRaises(IntegrityError):

            with transaction.atomic():

                TeamMembership.objects.create(
                    team=second_team,
                    registration=registration,
                    role="member",
                )

    # --------------------------------------------------------
    # TEST 6
    # --------------------------------------------------------

    def test_membership_rejects_different_event(self):

        second_event = Event.objects.create(
            organizer=self.organizer,
            title="Second Hackathon",
            description="Another competition.",
            category="technical",
            venue="Lab B",
            start_datetime=(
                timezone.now() + timedelta(days=20)
            ),
            end_datetime=(
                timezone.now() + timedelta(days=21)
            ),
            registration_deadline=(
                timezone.now() + timedelta(days=18)
            ),
            capacity=100,
            registration_mode="team",
            status="draft",
        )

        registration = Registration.objects.create(
            event=second_event,
            student=self.student2,
        )

        membership = TeamMembership(
            team=self.team,
            registration=registration,
        )

        with self.assertRaises(ValidationError):
            membership.full_clean()

    # --------------------------------------------------------
    # TEST 7
    # --------------------------------------------------------

    def test_team_rejected_for_individual_event(self):

        self.event.registration_mode = "individual"

        self.event.save(
            update_fields=["registration_mode"]
        )

        second_team = EventTeam(
            event=self.event,
            name="Invalid Team",
            leader=self.student2,
        )

        with self.assertRaises(ValidationError):
            second_team.full_clean()