from django.utils import timezone
from rest_framework.exceptions import ValidationError

from events.models import Registration

from .services import sample_values


def certificate_registrations(event):
    """
    Load related data together to avoid one query per participant.
    """
    return (
        Registration.objects
        .filter(event=event)
        .select_related(
            "student",
            "event",
            "ticket",
            "team_membership__team",
        )
        .order_by("student__username", "id")
    )


def participant_name(registration):
    """
    Usernames identify accounts but are not silently used as
    participant names on real-recipient previews.
    """
    return registration.student.get_full_name().strip()


def participation_eligibility(registration, event, now=None):
    now = now or timezone.now()
    reasons = []

    def reject(code, message):
        reasons.append({
            "code": code,
            "message": message,
        })

    if event.status != "published":
        reject(
            "event_not_published",
            "The event is not published.",
        )

    if event.end_datetime > now:
        reject(
            "event_not_finished",
            "The event has not finished.",
        )

    if registration.status != "registered":
        reject(
            "registration_cancelled",
            "The registration is cancelled.",
        )

    ticket = getattr(registration, "ticket", None)

    if (
        ticket is None
        or ticket.checked_in_at is None
        or ticket.checked_in_at > now
    ):
        reject(
            "attendance_missing",
            "Attendance has not been recorded.",
        )

    membership = getattr(
        registration,
        "team_membership",
        None,
    )

    if event.registration_mode == "team":
        if (
            membership is None
            or membership.team.event_id != event.id
            or membership.team.status != "confirmed"
        ):
            reject(
                "team_not_confirmed",
                "The participant must belong to a confirmed team.",
            )

    return {
        "eligible": not reasons,
        "reasons": reasons,
    }


def recipient_details(registration, event, now=None):
    name = participant_name(registration)
    ticket = getattr(registration, "ticket", None)

    membership = getattr(
        registration,
        "team_membership",
        None,
    )

    # Do not expose a mismatched association if invalid legacy
    # data exists outside the normal registration workflow.
    team = (
        membership.team
        if membership and membership.team.event_id == event.id
        else None
    )

    return {
        "registration_id": registration.id,
        "username": registration.student.username,
        "participant_name": name,
        "needs_name": not bool(name),
        "registration_status": registration.status,
        "checked_in_at": (
            ticket.checked_in_at if ticket else None
        ),
        "team_name": team.name if team else "",
        "team_status": team.status if team else None,
        **participation_eligibility(
            registration,
            event,
            now,
        ),
    }


def real_participation_values(
    version,
    registration,
    name_override=None,
):
    name = (
        name_override
        if name_override is not None
        else participant_name(registration)
    ).strip()

    if not name:
        raise ValidationError({
            "participant_name": (
                "Enter the participant's full name for this preview. "
                "Their account currently has no full name."
            )
        })

    values = sample_values(version, name)

    membership = getattr(
        registration,
        "team_membership",
        None,
    )

    values.update({
        "participant_name": name,
        "team_name": (
            membership.team.name
            if (
                version.template.event.registration_mode == "team"
                and membership
                and membership.team.event_id
                == version.template.event_id
            )
            else ""
        ),
        "position": "",
        "certificate_type": "Participation",
        "certificate_id": "PREVIEW-ONLY",
    })

    return values


def validate_participation_fields(fields):
    """
    Results are not stored yet. Do not silently render an empty
    award position or substitute a fictional winner.
    """
    for field in fields:
        text = field.get("text", "")

        uses_position = (
            "{position}" in text
            or (
                not text.strip()
                and field["placeholder"] == "position"
            )
        )

        if uses_position:
            raise ValidationError({
                "fields": (
                    "This template uses an award position. "
                    "Choose a participation layout for now. "
                    "Award results will be added separately."
                )
            })