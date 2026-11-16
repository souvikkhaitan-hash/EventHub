from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from .models import (
    Event,
    EventTeam,
    EventTicket,
    Registration,
    TeamMembership,
    TeamMembershipHistory,
)


User = get_user_model()


class TeamMembershipHistoryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            username="history_organizer"
        )

        cls.leader = User.objects.create_user(
            username="history_leader"
        )

        cls.member = User.objects.create_user(
            username="history_member"
        )

        now = timezone.now()

        cls.event = Event.objects.create(
            organizer=cls.organizer,
            title="Membership History Test",
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
            name="History Test Team",
            leader=cls.leader,
            status="forming",
        )

        cls.leader_registration = Registration.objects.create(
            event=cls.event,
            student=cls.leader,
            status="registered",
        )

        cls.member_registration = Registration.objects.create(
            event=cls.event,
            student=cls.member,
            status="registered",
        )

        TeamMembership.objects.create(
            team=cls.team,
            registration=cls.leader_registration,
            role="leader",
        )

        cls.member_membership = TeamMembership.objects.create(
            team=cls.team,
            registration=cls.member_registration,
            role="member",
        )

        # Prepare an old token to verify invalidation on leaving.
        cls.member_ticket = EventTicket.objects.create(
            registration=cls.member_registration
        )

    def setUp(self):
        self.client = APIClient()

    def leave_as_member(self):
        self.client.force_authenticate(user=self.member)

        return self.client.post(
            reverse(
                "leave-event-team",
                args=[self.team.id],
            ),
            {},
            format="json",
        )

    def test_leaving_archives_membership_and_invalidates_ticket(self):
        original_membership_id = self.member_membership.pk
        original_token = self.member_ticket.token

        response = self.leave_as_member()

        self.assertEqual(response.status_code, 200)

        history = TeamMembershipHistory.objects.get(
            source_membership_id=original_membership_id
        )

        self.assertEqual(history.team_id, self.team.id)
        self.assertEqual(
            history.registration_id,
            self.member_registration.id,
        )
        self.assertEqual(history.role, "member")
        self.assertEqual(history.reason, "left")
        self.assertEqual(
            history.performed_by_id,
            self.member.id,
        )
        self.assertEqual(
            history.joined_at,
            self.member_membership.joined_at,
        )
        self.assertGreaterEqual(
            history.ended_at,
            history.joined_at,
        )

        self.assertFalse(
            TeamMembership.objects.filter(
                pk=original_membership_id
            ).exists()
        )

        self.member_registration.refresh_from_db()
        self.member_ticket.refresh_from_db()

        self.assertEqual(
            self.member_registration.status,
            "cancelled",
        )
        self.assertNotEqual(
            self.member_ticket.token,
            original_token,
        )

        # History does not make the cancelled ticket usable.
        ticket_response = self.client.get(
            reverse(
                "student-ticket",
                args=[self.member_registration.id],
            )
        )

        self.assertEqual(ticket_response.status_code, 400)

    def test_withdrawal_archives_every_current_member(self):
        self.client.force_authenticate(user=self.leader)

        response = self.client.post(
            reverse(
                "withdraw-event-team",
                args=[self.team.id],
            ),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        history = TeamMembershipHistory.objects.filter(
            team=self.team
        )

        self.assertEqual(history.count(), 2)

        self.assertEqual(
            set(history.values_list("role", flat=True)),
            {"leader", "member"},
        )

        self.assertEqual(
            history.filter(
                reason="withdrawn",
                performed_by=self.leader,
            ).count(),
            2,
        )

        self.assertEqual(self.team.memberships.count(), 0)

        self.assertEqual(
            Registration.objects.filter(
                event=self.event,
                status="cancelled",
            ).count(),
            2,
        )

        self.team.refresh_from_db()
        self.assertEqual(self.team.status, "withdrawn")

    def test_rejoining_keeps_previous_history_separate(self):
        old_membership_id = self.member_membership.pk

        leave_response = self.leave_as_member()
        self.assertEqual(leave_response.status_code, 200)

        join_response = self.client.post(
            reverse(
                "join-event-team",
                args=[self.event.id],
            ),
            {
                "invitation_code":
                str(self.team.invitation_code)
            },
            format="json",
        )

        self.assertEqual(join_response.status_code, 201)

        new_membership = TeamMembership.objects.get(
            registration=self.member_registration
        )

        self.assertNotEqual(
            new_membership.pk,
            old_membership_id,
        )

        self.member_registration.refresh_from_db()

        self.assertEqual(
            self.member_registration.status,
            "registered",
        )

        self.assertEqual(
            TeamMembershipHistory.objects.filter(
                registration=self.member_registration,
                source_membership_id=old_membership_id,
            ).count(),
            1,
        )

        self.assertEqual(self.team.memberships.count(), 2)

    def test_confirmed_team_cannot_leave_or_create_history(self):
        self.team.status = "confirmed"
        self.team.save(update_fields=["status"])

        response = self.leave_as_member()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            TeamMembershipHistory.objects.count(),
            0,
        )

        self.assertTrue(
            TeamMembership.objects.filter(
                pk=self.member_membership.pk
            ).exists()
        )

        self.member_registration.refresh_from_db()

        self.assertEqual(
            self.member_registration.status,
            "registered",
        )

    def test_failed_cancellation_rolls_back_history_and_removal(self):
        original_token = self.member_ticket.token

        with patch(
            "events.team_views.cancel_team_registration",
            side_effect=RuntimeError(
                "Simulated cancellation failure"
            ),
        ):
            with self.assertRaisesMessage(
                RuntimeError,
                "Simulated cancellation failure",
            ):
                self.leave_as_member()

        # The archive and deletion must both be rolled back.
        self.assertEqual(
            TeamMembershipHistory.objects.count(),
            0,
        )

        self.assertTrue(
            TeamMembership.objects.filter(
                pk=self.member_membership.pk
            ).exists()
        )

        self.member_registration.refresh_from_db()
        self.member_ticket.refresh_from_db()

        self.assertEqual(
            self.member_registration.status,
            "registered",
        )
        self.assertEqual(
            self.member_ticket.token,
            original_token,
        )