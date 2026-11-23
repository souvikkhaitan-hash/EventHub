from rest_framework import serializers

from .models import OrganizerApplication


class StrictInputSerializer(serializers.Serializer):
    """
    Reject fields that this endpoint does not allow.
    """

    def validate(self, attrs):
        unexpected = (
            set(self.initial_data) - set(self.fields)
        )

        if unexpected:
            raise serializers.ValidationError(
                "Unexpected fields: "
                + ", ".join(sorted(unexpected))
            )

        return attrs


class OrganizerApplicationInput(StrictInputSerializer):
    organization = serializers.CharField(
        max_length=150
    )

    position = serializers.CharField(
        max_length=100
    )

    reason = serializers.CharField(
        max_length=2000
    )

    # New application: 0.
    # Resubmission: revision returned by the status endpoint.
    revision = serializers.IntegerField(
        min_value=0
    )


class OrganizerDecisionInput(StrictInputSerializer):
    decision = serializers.ChoiceField(
        choices=[
            OrganizerApplication.Status.APPROVED,
            OrganizerApplication.Status.REJECTED,
            OrganizerApplication.Status.CHANGES_REQUESTED,
        ]
    )

    revision = serializers.IntegerField(
        min_value=1
    )

    decision_note = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        default="",
    )

    def validate(self, attrs):
        attrs = super().validate(attrs)

        if (
            attrs["decision"]
            != OrganizerApplication.Status.APPROVED
            and not attrs["decision_note"].strip()
        ):
            raise serializers.ValidationError({
                "decision_note": (
                    "Explain the rejection or requested changes."
                )
            })

        return attrs


def application_snapshot(application):
    return {
        "organization": application.organization,
        "position": application.position,
        "reason": application.reason,
    }


def application_data(application, *, admin=False):
    """
    Applicants see their own application and history.
    Admin responses additionally identify the applicant
    and the actors who performed review actions.
    """

    history = []

    for entry in application.history.select_related(
        "actor"
    ).all():
        item = {
            "id": entry.pk,
            "action": entry.action,
            "revision": entry.revision,
            "note": entry.note,
            "application_data": entry.application_data,
            "created_at": entry.created_at,
        }

        if admin:
            item["actor"] = (
                {
                    "id": entry.actor_id,
                    "username": entry.actor.username,
                }
                if entry.actor_id
                else None
            )

        history.append(item)

    data = {
        "id": application.pk,
        **application_snapshot(application),
        "status": application.status,
        "revision": application.revision,
        "decision_note": application.decision_note,
        "reviewed_at": application.reviewed_at,
        "created_at": application.created_at,
        "updated_at": application.updated_at,
        "history": history,
    }

    if admin:
        user = application.user

        data["applicant"] = {
            "id": user.pk,
            "username": user.username,
            "email": user.email,
            "full_name": user.get_full_name(),
            "is_active": user.is_active,
        }

    return data