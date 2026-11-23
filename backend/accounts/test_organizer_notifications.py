from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.db import transaction
from django.test import TestCase, override_settings

from .models import (
    OrganizerApplication,
    OrganizerApplicationHistory,
    OrganizerEmailNotification,
)
from .organizer_notifications import (
    process_next_notification,
    queue_organizer_notifications,
)


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="EventHub <noreply@example.com>",
    FRONTEND_URL="https://eventhub.example",
)
class OrganizerNotificationTests(TestCase):
    def setUp(self):
        User = get_user_model()

        self.applicant = User.objects.create_user(
            username="notification_student",
            email="student@example.com",
            password="Test-password-739!",
        )

        self.admin = User.objects.create_superuser(
            username="notification_admin",
            email="admin@example.com",
            password="Test-password-739!",
        )

        self.application = OrganizerApplication.objects.create(
            user=self.applicant,
            organization="Campus Club",
            position="Coordinator",
            reason="Organize campus workshops.",
        )

        self.history = OrganizerApplicationHistory.objects.create(
            application=self.application,
            actor=self.applicant,
            action=OrganizerApplicationHistory.Action.SUBMITTED,
            revision=1,
            application_data={},
        )

    def queue(self):
        with transaction.atomic():
            queue_organizer_notifications(self.history)

    def test_submission_queues_applicant_and_authorized_reviewer(self):
        User = get_user_model()
        User.objects.create_user(
            username="ordinary_staff",
            email="staff@example.com",
            password="Test-password-739!",
            is_staff=True,
        )

        self.queue()

        recipients = set(
            OrganizerEmailNotification.objects.values_list(
                "recipient_id", flat=True
            )
        )

        self.assertEqual(
            recipients,
            {self.applicant.pk, self.admin.pk},
        )

    def test_same_event_is_not_queued_twice(self):
        self.queue()
        self.queue()

        self.assertEqual(
            OrganizerEmailNotification.objects.count(),
            2,
        )

    def test_queue_rolls_back_with_application_transaction(self):
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                queue_organizer_notifications(self.history)
                raise RuntimeError("Simulated transaction failure")

        self.assertEqual(
            OrganizerEmailNotification.objects.count(),
            0,
        )

    def test_accepted_message_is_not_sent_again(self):
        self.queue()

        # Keep this test focused on the applicant message.
        OrganizerEmailNotification.objects.filter(
            audience="reviewer"
        ).delete()

        self.assertEqual(
            process_next_notification(),
            "accepted",
        )
        self.assertIsNone(process_next_notification())
        self.assertEqual(len(mail.outbox), 1)

    def test_transport_failure_keeps_notification_for_retry(self):
        self.queue()
        OrganizerEmailNotification.objects.filter(
            audience="reviewer"
        ).delete()

        with patch(
            "accounts.organizer_notifications.send_mail",
            side_effect=OSError("Sensitive provider response"),
        ):
            self.assertEqual(
                process_next_notification(),
                "pending",
            )

        notification = OrganizerEmailNotification.objects.get()

        self.assertEqual(notification.attempts, 1)
        self.assertEqual(notification.last_error_code, "OSError")
        self.assertIsNone(notification.accepted_at)

        # It is scheduled for later, so it cannot retry immediately.
        self.assertIsNone(process_next_notification())

    def test_exhausted_retries_mark_failed(self):
        self.queue()
        OrganizerEmailNotification.objects.filter(
            audience="reviewer"
        ).delete()

        OrganizerEmailNotification.objects.update(attempts=4)

        with patch(
            "accounts.organizer_notifications.send_mail",
            side_effect=OSError("Unavailable"),
        ):
            self.assertEqual(
                process_next_notification(),
                "failed",
            )

        self.assertEqual(
            OrganizerEmailNotification.objects.get().attempts,
            5,
        )

    def test_reviewer_access_is_rechecked_before_sending(self):
        self.queue()

        OrganizerEmailNotification.objects.filter(
            audience="applicant"
        ).delete()

        self.admin.is_staff = False
        self.admin.save(update_fields=["is_staff"])

        self.assertEqual(
            process_next_notification(),
            "cancelled",
        )
        self.assertEqual(len(mail.outbox), 0)

    def test_decision_only_queues_applicant(self):
        history = OrganizerApplicationHistory.objects.create(
            application=self.application,
            actor=self.admin,
            action=OrganizerApplicationHistory.Action.APPROVED,
            revision=1,
            application_data={},
        )

        with transaction.atomic():
            queue_organizer_notifications(history)

        notification = OrganizerEmailNotification.objects.get()

        self.assertEqual(
            notification.recipient_id,
            self.applicant.pk,
        )
        self.assertEqual(notification.audience, "applicant")