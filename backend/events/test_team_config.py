from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from .models import Event
from .serializers import EventSerializer


User = get_user_model()


class TeamEventConfigurationTests(TestCase):

    def setUp(self):
        self.organizer = User.objects.create_user(
            username="team_test_organizer",
            password="TestPassword123!",
        )

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.organizer,
            title="Campus Hackathon",
            description="A student coding competition.",
            category="technical",
            venue="Innovation Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=11),
            registration_deadline=now + timedelta(days=8),
            capacity=180,
            status="draft",
        )

    def test_existing_events_default_to_individual(self):

        self.assertEqual(
            self.event.registration_mode,
            "individual",
        )

    def test_event_can_be_configured_for_teams(self):

        serializer = EventSerializer(
            self.event,
            data={
                "registration_mode": "team",
                "min_team_size": 2,
                "max_team_size": 6,
                "max_teams": 30,
            },
            partial=True,
        )

        self.assertTrue(
            serializer.is_valid(),
            serializer.errors,
        )

        updated_event = serializer.save()

        self.assertEqual(
            updated_event.registration_mode,
            "team",
        )

        self.assertEqual(
            updated_event.max_team_size,
            6,
        )

    def test_invalid_team_size_is_rejected(self):

        serializer = EventSerializer(
            self.event,
            data={
                "registration_mode": "team",
                "min_team_size": 6,
                "max_team_size": 3,
            },
            partial=True,
        )

        self.assertFalse(serializer.is_valid())

        self.assertIn(
            "max_team_size",
            serializer.errors,
        )

    def test_team_size_cannot_exceed_event_capacity(self):

        serializer = EventSerializer(
            self.event,
            data={
                "registration_mode": "team",
                "max_team_size": 200,
            },
            partial=True,
        )

        self.assertFalse(serializer.is_valid())

        self.assertIn(
            "capacity",
            serializer.errors,
        )

    def test_published_event_cannot_change_registration_mode(self):

        self.event.status = "published"
        self.event.save(update_fields=["status"])

        serializer = EventSerializer(
            self.event,
            data={
                "registration_mode": "team",
            },
            partial=True,
        )

        self.assertFalse(serializer.is_valid())

        self.assertIn(
            "registration_mode",
            serializer.errors,
        )