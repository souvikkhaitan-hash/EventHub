from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import connection, transaction
from django.utils import timezone

from .models import (
    OrganizerApplicationHistory,
    OrganizerEmailNotification,
)


REVIEW_PERMISSION = "accounts.review_organizerapplication"
MAX_ATTEMPTS = 5


def eligible_reviewer(user):
    return bool(
        user
        and user.is_active
        and user.is_staff
        and user.has_perm(REVIEW_PERMISSION)
    )


def queue_organizer_notifications(history):
    """
    Call inside the application's transaction.

    Queue rows roll back if the application/history change rolls back.
    Calling this twice for the same history does not create extra rows.
    """
    if not connection.in_atomic_block:
        raise RuntimeError(
            "Organizer notifications must be queued inside a transaction."
        )

    application = history.application
    applicant = application.user

    if applicant.is_active and applicant.email.strip():
        OrganizerEmailNotification.objects.get_or_create(
            history=history,
            recipient=applicant,
            audience=OrganizerEmailNotification.Audience.APPLICANT,
        )

    submission_actions = {
        OrganizerApplicationHistory.Action.SUBMITTED,
        OrganizerApplicationHistory.Action.RESUBMITTED,
    }

    if history.action not in submission_actions:
        return

    # Only authorized reviewers receive review notifications.
    # Each receives a separate message.
    reviewers = (
        get_user_model().objects
        .filter(is_active=True, is_staff=True)
        .exclude(pk=applicant.pk)
        .exclude(email="")
    )

    for reviewer in reviewers.iterator():
        if eligible_reviewer(reviewer):
            OrganizerEmailNotification.objects.get_or_create(
                history=history,
                recipient=reviewer,
                audience=OrganizerEmailNotification.Audience.REVIEWER,
            )


def frontend_base_url():
    value = getattr(settings, "FRONTEND_URL", "").strip()
    parsed = urlsplit(value)

    invalid = (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or bool(parsed.query)
        or bool(parsed.fragment)
    )

    if invalid or (
        not settings.DEBUG and parsed.scheme != "https"
    ):
        raise ImproperlyConfigured(
            "FRONTEND_URL must be a frontend origin; "
            "production requires HTTPS."
        )

    return value.rstrip("/")


def build_message(notification):
    history = notification.history
    base_url = frontend_base_url()

    if (
        notification.audience
        == OrganizerEmailNotification.Audience.REVIEWER
    ):
        subject = "EventHub: organizer application awaiting review"
        body = (
            "An organizer application has been submitted "
            "or resubmitted.\n\n"
            f"Application reference: #{history.application_id}\n"
            f"Revision: {history.revision}\n\n"
            "Sign in to the Admin Workspace to review it:\n"
            f"{base_url}/admin/applications\n\n"
            "EventHub"
        )
        return subject, body

    messages = {
        OrganizerApplicationHistory.Action.SUBMITTED: (
            "Organizer application received",
            "Your organizer application has been submitted "
            "for admin review.",
        ),
        OrganizerApplicationHistory.Action.RESUBMITTED: (
            "Organizer application resubmitted",
            "Your updated organizer application has been "
            "submitted for admin review.",
        ),
        OrganizerApplicationHistory.Action.APPROVED: (
            "Organizer application approved",
            "Your organizer application was approved. "
            "Sign in through the organizer portal to continue.",
        ),
        OrganizerApplicationHistory.Action.REJECTED: (
            "Organizer application decision",
            "Your organizer application was rejected. "
            "Open your application to read the feedback.",
        ),
        OrganizerApplicationHistory.Action.CHANGES_REQUESTED: (
            "Changes requested for your organizer application",
            "An admin requested changes to your organizer "
            "application. Open it to read the feedback "
            "and submit an updated application.",
        ),
    }

    title, description = messages[history.action]

    path = (
        "/organizer/login"
        if history.action
        == OrganizerApplicationHistory.Action.APPROVED
        else "/become-organizer"
    )

    body = (
        f"{description}\n\n"
        f"Application reference: #{history.application_id}\n"
        f"Revision: {history.revision}\n"
        f"Recorded: {history.created_at.isoformat()}\n\n"
        f"Continue: {base_url}{path}\n\n"
        "This email records an application update. "
        "Your application page shows the latest status.\n\n"
        "EventHub"
    )

    return f"EventHub: {title}", body


def process_next_notification():
    """
    Process one due notification.

    PostgreSQL locks only the queue row during the send.
    Another worker skips that locked row.
    """
    with transaction.atomic():
        notification = (
            OrganizerEmailNotification.objects
            .select_for_update(skip_locked=True)
            .filter(
                status=OrganizerEmailNotification.Status.PENDING,
                next_attempt_at__lte=timezone.now(),
            )
            .order_by("next_attempt_at", "pk")
            .first()
        )

        if notification is None:
            return None

        recipient = notification.recipient

        allowed = bool(
            recipient
            and recipient.is_active
            and recipient.email.strip()
        )

        if (
            allowed
            and notification.audience
            == OrganizerEmailNotification.Audience.REVIEWER
        ):
            # Recheck permission immediately before sending.
            allowed = eligible_reviewer(recipient)

        if not allowed:
            notification.status = (
                OrganizerEmailNotification.Status.CANCELLED
            )
            notification.save(update_fields=["status"])
            return notification.status

        notification.attempts += 1

        try:
            validate_email(recipient.email.strip())
            subject, body = build_message(notification)

            accepted = send_mail(
                subject=subject,
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient.email.strip()],
                fail_silently=False,
            )

            if accepted != 1:
                raise RuntimeError("Email backend did not accept message.")

        except Exception as error:
            notification.last_error_code = (
                type(error).__name__[:100]
            )

            if notification.attempts >= MAX_ATTEMPTS:
                notification.status = (
                    OrganizerEmailNotification.Status.FAILED
                )
            else:
                # 1, 2, 4, then 8 minutes between attempts.
                delay_seconds = 60 * (
                    2 ** (notification.attempts - 1)
                )
                notification.next_attempt_at = (
                    timezone.now()
                    + timedelta(seconds=delay_seconds)
                )

        else:
            notification.status = (
                OrganizerEmailNotification.Status.ACCEPTED
            )
            notification.accepted_at = timezone.now()
            notification.last_error_code = ""

        notification.save(
            update_fields=[
                "status",
                "attempts",
                "next_attempt_at",
                "accepted_at",
                "last_error_code",
            ]
        )

        return notification.status