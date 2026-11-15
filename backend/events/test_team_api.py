from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from .models import (
    Event,
    EventTeam,
    Registration,
    TeamMembership,
    EventTicket,
)


User = get_user_model()


class TeamAPITests(TestCase):

    # ========================================================
    # SETUP
    # ========================================================

    def setUp(self):

        self.client = APIClient()

        self.organizer = User.objects.create_user(
            username="api_organizer",
            password="TestPassword123!",
        )

        self.leader = User.objects.create_user(
            username="api_leader",
            password="TestPassword123!",
        )

        self.student2 = User.objects.create_user(
            username="api_student2",
            password="TestPassword123!",
        )

        self.student3 = User.objects.create_user(
            username="api_student3",
            password="TestPassword123!",
        )

        # IsStudent and IsOrganizer depend on
        # the existing Django group-based roles.

        from django.contrib.auth.models import Group

        student_group, _ = Group.objects.get_or_create(
            name="Student"
        )

        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        for student in [
            self.leader,
            self.student2,
            self.student3,
        ]:
            student.groups.add(student_group)

        self.organizer.groups.add(
            organizer_group
        )

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.organizer,
            title="Campus Innovation Challenge 2026",
            description="Team innovation competition.",
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
            status="published",
        )

    # ========================================================
    # HELPERS
    # ========================================================

    def login_as(self, user):

        self.client.force_authenticate(
            user=user
        )

    def create_team(self, name="Code Warriors"):

        self.login_as(self.leader)

        return self.client.post(
            reverse(
                "create-event-team",
                args=[self.event.id],
            ),
            {
                "name": name,
            },
            format="json",
        )

    def join_team(self, code, student=None):

        self.login_as(
            student or self.student2
        )

        return self.client.post(
            reverse(
                "join-event-team",
                args=[self.event.id],
            ),
            {
                "invitation_code": str(code),
            },
            format="json",
        )

    # ========================================================
    # TEST 1 — CREATE TEAM
    # ========================================================

    def test_student_can_create_team(self):

        response = self.create_team()

        self.assertEqual(
            response.status_code,
            201,
            response.data,
        )

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.assertEqual(
            team.leader,
            self.leader,
        )

        self.assertEqual(
            team.status,
            "forming",
        )

        self.assertEqual(
            team.memberships.count(),
            1,
        )

    # ========================================================
    # TEST 2 — LEADER GETS REGISTRATION
    # ========================================================

    def test_team_leader_receives_registration(self):

        self.create_team()

        registration = Registration.objects.get(
            event=self.event,
            student=self.leader,
        )

        self.assertEqual(
            registration.status,
            "registered",
        )

        membership = TeamMembership.objects.get(
            registration=registration
        )

        self.assertEqual(
            membership.role,
            "leader",
        )

    # ========================================================
    # TEST 3 — JOIN TEAM
    # ========================================================

    def test_student_can_join_team(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        response = self.join_team(
            team.invitation_code
        )

        self.assertEqual(
            response.status_code,
            201,
            response.data,
        )

        self.assertEqual(
            team.memberships.count(),
            2,
        )

        self.assertTrue(
            Registration.objects.filter(
                event=self.event,
                student=self.student2,
                status="registered",
            ).exists()
        )

    # ========================================================
    # TEST 4 — INVALID INVITATION
    # ========================================================

    def test_invalid_invitation_is_rejected(self):

        self.create_team()

        import uuid

        response = self.join_team(
            uuid.uuid4()
        )

        self.assertEqual(
            response.status_code,
            404,
        )

    # ========================================================
    # TEST 5 — DUPLICATE REGISTRATION
    # ========================================================

    def test_student_cannot_join_twice(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        first = self.join_team(
            team.invitation_code
        )

        self.assertEqual(
            first.status_code,
            201,
        )

        second = self.join_team(
            team.invitation_code
        )

        self.assertEqual(
            second.status_code,
            409,
        )

    # ========================================================
    # TEST 6 — CONFIRM TEAM
    # ========================================================

    def test_leader_can_confirm_complete_team(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        self.login_as(self.leader)

        response = self.client.post(
            reverse(
                "confirm-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            response.status_code,
            200,
            response.data,
        )

        team.refresh_from_db()

        self.assertEqual(
            team.status,
            "confirmed",
        )

    # ========================================================
    # TEST 7 — INCOMPLETE TEAM
    # ========================================================

    def test_incomplete_team_cannot_confirm(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.login_as(self.leader)

        response = self.client.post(
            reverse(
                "confirm-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            response.status_code,
            400,
        )

    # ========================================================
    # TEST 8 — ONLY LEADER CONFIRMS
    # ========================================================

    def test_member_cannot_confirm_team(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        self.login_as(self.student2)

        response = self.client.post(
            reverse(
                "confirm-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            response.status_code,
            403,
        )

    # ========================================================
    # TEST 9 — CONFIRMED TEAMS ARE LOCKED
    # ========================================================

    def test_confirmed_team_rejects_new_members(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        self.login_as(self.leader)

        self.client.post(
            reverse(
                "confirm-event-team",
                args=[team.id],
            )
        )

        response = self.join_team(
            team.invitation_code,
            self.student3,
        )

        self.assertEqual(
            response.status_code,
            409,
        )

    # ========================================================
    # TEST 10 — MEMBER LEAVES
    # ========================================================

    def test_student_can_leave_forming_team(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        self.login_as(self.student2)

        response = self.client.post(
            reverse(
                "leave-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            response.status_code,
            200,
            response.data,
        )

        self.assertFalse(
            TeamMembership.objects.filter(
                team=team,
                registration__student=self.student2,
            ).exists()
        )

        registration = Registration.objects.get(
            event=self.event,
            student=self.student2,
        )

        self.assertEqual(
            registration.status,
            "cancelled",
        )

    # ========================================================
    # TEST 11 — TEAM WITHDRAWAL
    # ========================================================

    def test_leader_can_withdraw_forming_team(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.login_as(self.leader)

        response = self.client.post(
            reverse(
                "withdraw-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            response.status_code,
            200,
            response.data,
        )

        team.refresh_from_db()

        self.assertEqual(
            team.status,
            "withdrawn",
        )

        registration = Registration.objects.get(
            event=self.event,
            student=self.leader,
        )

        self.assertEqual(
            registration.status,
            "cancelled",
        )

    # ========================================================
    # TEST 12 — TEAM CAPACITY
    # ========================================================

    def test_maximum_team_size_is_enforced(self):

        self.event.max_team_size = 2

        self.event.save(
            update_fields=[
                "max_team_size"
            ]
        )

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        response = self.join_team(
            team.invitation_code,
            self.student3,
        )

        self.assertEqual(
            response.status_code,
            409,
        )

    # ========================================================
    # TEST 13 — MAXIMUM NUMBER OF TEAMS
    # ========================================================

    def test_maximum_team_count_is_enforced(self):

        self.event.max_teams = 1

        self.event.save(
            update_fields=["max_teams"]
        )

        self.create_team()

        self.login_as(self.student2)

        response = self.client.post(
            reverse(
                "create-event-team",
                args=[self.event.id],
            ),
            {
                "name": "Byte Builders"
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            409,
        )

    # ========================================================
    # TEST 14 — CLOSED REGISTRATION
    # ========================================================

    def test_student_cannot_create_team_after_deadline(self):

        self.event.registration_deadline = (
            timezone.now()
            - timedelta(minutes=1)
        )

        self.event.save(
            update_fields=[
                "registration_deadline"
            ]
        )

        response = self.create_team()

        self.assertEqual(
            response.status_code,
            400,
        )
    # ============================================================
# TEST 15 — FORMING TEAM CANNOT ACCESS TICKET
# ============================================================

    def test_forming_team_cannot_access_ticket(self):

        self.create_team()

        registration = Registration.objects.get(
            event=self.event,
            student=self.leader,
        )

        self.login_as(self.leader)

        response = self.client.get(
            f"/api/registrations/{registration.id}/ticket/"
        )

        self.assertEqual(
            response.status_code,
            403,
        )

        self.assertFalse(
            EventTicket.objects.filter(
                registration=registration
            ).exists()
        )


    # ============================================================
    # TEST 16 — CONFIRMED TEAM CAN ACCESS TICKET
    # ============================================================

    def test_confirmed_team_can_access_ticket(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        self.login_as(self.leader)

        confirmation = self.client.post(
            reverse(
                "confirm-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            confirmation.status_code,
            200,
        )

        registration = Registration.objects.get(
            event=self.event,
            student=self.leader,
        )

        response = self.client.get(
            f"/api/registrations/{registration.id}/ticket/"
        )

        self.assertEqual(
            response.status_code,
            200,
            response.data,
        )

        self.assertTrue(
            EventTicket.objects.filter(
                registration=registration
            ).exists()
        )


    # ============================================================
    # TEST 17 — FORMING TEAM CANNOT CHECK IN
    # ============================================================

    def test_forming_team_cannot_check_in(self):

        self.create_team()

        registration = Registration.objects.get(
            event=self.event,
            student=self.leader,
        )

        # Create an old ticket to verify that having a
        # QR token does not bypass team confirmation.

        ticket = EventTicket.objects.create(
            registration=registration
        )

        # Move the event into its permitted check-in window.
        # The deadline remains before the event starts,
        # satisfying the database date constraints.

        now = timezone.now()

        self.event.start_datetime = (
            now + timedelta(minutes=15)
        )

        self.event.end_datetime = (
            now + timedelta(hours=3)
        )

        self.event.registration_deadline = (
            now - timedelta(minutes=1)
        )

        self.event.save(
            update_fields=[
                "start_datetime",
                "end_datetime",
                "registration_deadline",
            ]
        )

        self.login_as(self.organizer)

        response = self.client.post(
            f"/api/events/manage/{self.event.id}/check-in/",
            {
                "token": str(ticket.token)
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            403,
            response.data,
        )

        ticket.refresh_from_db()

        self.assertIsNone(
            ticket.checked_in_at
        )


    # ============================================================
    # TEST 18 — CONFIRMED TEAM MEMBER CAN CHECK IN
    # ============================================================

    def test_confirmed_team_member_can_check_in(self):

        self.create_team()

        team = EventTeam.objects.get(
            name="Code Warriors"
        )

        self.join_team(
            team.invitation_code
        )

        self.login_as(self.leader)

        confirmation = self.client.post(
            reverse(
                "confirm-event-team",
                args=[team.id],
            )
        )

        self.assertEqual(
            confirmation.status_code,
            200,
            confirmation.data,
        )

        registration = Registration.objects.get(
            event=self.event,
            student=self.student2,
        )

        ticket = EventTicket.objects.create(
            registration=registration
        )

        now = timezone.now()

        self.event.start_datetime = (
            now + timedelta(minutes=15)
        )

        self.event.end_datetime = (
            now + timedelta(hours=3)
        )

        self.event.registration_deadline = (
            now - timedelta(minutes=1)
        )

        self.event.save(
            update_fields=[
                "start_datetime",
                "end_datetime",
                "registration_deadline",
            ]
        )

        self.login_as(self.organizer)

        response = self.client.post(
            f"/api/events/manage/{self.event.id}/check-in/",
            {
                "token": str(ticket.token)
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            200,
            response.data,
        )

        ticket.refresh_from_db()

        self.assertIsNotNone(
            ticket.checked_in_at
        )

        # Check-in is individual, not team-wide.

        leader_registration = Registration.objects.get(
            event=self.event,
            student=self.leader,
        )

        self.assertFalse(
            EventTicket.objects.filter(
                registration=leader_registration,
                checked_in_at__isnull=False,
            ).exists()
        )