from django.shortcuts import get_object_or_404

from rest_framework.exceptions import ValidationError

from .models import AwardResult
from .recipient_services import (
    participation_eligibility,
    real_participation_values,
    validate_participation_fields,
)


def batch_award(event, result_id):
    if result_id is None:
        return None

    return get_object_or_404(
        AwardResult.objects.select_for_update(),
        pk=result_id,
        event=event,
    )


def validate_certificate_fields(fields, award=None):
    if award is None:
        validate_participation_fields(fields)
        return

    uses_position = any(
        "{position}" in field.get("text", "")
        or (
            not field.get("text", "").strip()
            and field["placeholder"] == "position"
        )
        for field in fields
    )

    if not uses_position:
        raise ValidationError({
            "fields": (
                "Add a position field or {position} to your "
                "award template. The saved result must appear "
                "on the certificate."
            )
        })


def certificate_eligibility(
    registration,
    event,
    award=None,
    now=None,
):
    eligibility = participation_eligibility(
        registration,
        event,
        now,
    )

    if award is None:
        return eligibility

    reasons = eligibility["reasons"]

    if award.event_id != event.id or not award.is_active:
        reasons.append({
            "code": "result_unavailable",
            "message": (
                "The award result is unavailable or withdrawn."
            ),
        })

    if not award.recipients.filter(
        registration=registration
    ).exists():
        reasons.append({
            "code": "not_awarded",
            "message": (
                "The participant is not in this result's "
                "saved roster."
            ),
        })

    membership = getattr(
        registration,
        "team_membership",
        None,
    )

    if award.team_id and (
        event.registration_mode != "team"
        or membership is None
        or membership.team_id != award.team_id
    ):
        reasons.append({
            "code": "award_roster_changed",
            "message": (
                "The participant no longer belongs "
                "to the awarded team."
            ),
        })

    if award.registration_id and (
        event.registration_mode != "individual"
        or award.registration_id != registration.id
    ):
        reasons.append({
            "code": "award_target_changed",
            "message": (
                "The result does not match this "
                "individual participant."
            ),
        })

    return {
        "eligible": not reasons,
        "reasons": reasons,
    }


def certificate_values(
    version,
    registration,
    name,
    award=None,
):
    values = real_participation_values(
        version,
        registration,
        name,
    )

    if award is not None:
        values.update({
            "position": award.position,
            "certificate_type": "Achievement",
            "award_result_id": str(award.id),
        })

    return values