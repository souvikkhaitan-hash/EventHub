from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import Event, EventTeam, Registration
from events.permissions import IsOrganizer

from .models import AwardResult, AwardResultRecipient
from .recipient_services import (
    certificate_registrations,
    recipient_details,
)


class ResultConflict(APIException):
    status_code = 409
    default_detail = (
        "The result has changed. Reload before continuing."
    )


class ResultCreateSerializer(serializers.Serializer):
    request_key = serializers.UUIDField()

    registration_id = serializers.IntegerField(
        min_value=1,
        required=False,
    )

    team_id = serializers.IntegerField(
        min_value=1,
        required=False,
    )

    position = serializers.CharField(max_length=80)

    def validate(self, data):
        if (
            ("registration_id" in data)
            == ("team_id" in data)
        ):
            raise ValidationError(
                "Choose exactly one participant or team."
            )

        if any(
            ord(character) < 32
            for character in data["position"]
        ):
            raise ValidationError({
                "position": "Use a single line of text."
            })

        return data


class ResultWithdrawSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
    confirm = serializers.BooleanField()

    def validate_confirm(self, value):
        if not value:
            raise ValidationError(
                "Confirm withdrawal of this result."
            )

        return value


class ResultSerializer(serializers.ModelSerializer):
    registration_id = serializers.IntegerField(
        read_only=True,
        allow_null=True,
    )

    team_id = serializers.IntegerField(
        read_only=True,
        allow_null=True,
    )

    recipient_registration_ids = (
        serializers.SerializerMethodField()
    )

    class Meta:
        model = AwardResult

        fields = [
            "id",
            "event_id",
            "registration_id",
            "team_id",
            "position",
            "target_name",
            "request_key",
            "created_at",
            "is_active",
            "withdrawn_at",
            "withdrawal_reason",
            "recipient_registration_ids",
        ]

        read_only_fields = fields

    def get_recipient_registration_ids(self, obj):
        return [
            row.registration_id
            for row in obj.recipients.all()
        ]


def private_response(data, status=200):
    response = Response(data, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


def owned_results(user):
    return (
        AwardResult.objects
        .filter(event__organizer=user)
        .prefetch_related("recipients")
    )


def create_result(user, event_id, data):
    with transaction.atomic():
        # All result writes lock the event first.
        event = get_object_or_404(
            Event.objects.select_for_update(),
            pk=event_id,
            organizer=user,
        )

        existing = AwardResult.objects.filter(
            event=event,
            request_key=data["request_key"],
        ).first()

        if existing:
            if (
                existing.registration_id
                != data.get("registration_id")
                or existing.team_id != data.get("team_id")
                or existing.position != data["position"]
            ):
                raise ResultConflict(
                    "This request key was already used "
                    "with different details."
                )

            return existing.id, False

        if (
            event.status != "published"
            or event.end_datetime > timezone.now()
        ):
            raise ValidationError(
                "Results require a finished, published event."
            )

        registration = None
        team = None

        if event.registration_mode == "individual":
            if "registration_id" not in data:
                raise ValidationError(
                    "Choose a participant for this event."
                )

            registration = get_object_or_404(
                Registration.objects
                .select_for_update()
                .select_related("student"),
                pk=data["registration_id"],
                event=event,
            )

            if registration.status != "registered":
                raise ValidationError(
                    "The participant's registration is cancelled."
                )

            registrations = [registration]

            # This is a result-list label.
            # Certificate names still require explicit review.
            target_name = (
                registration.student.get_full_name().strip()
                or registration.student.username
            )

        else:
            if "team_id" not in data:
                raise ValidationError(
                    "Choose a team for this event."
                )

            team = get_object_or_404(
                EventTeam.objects.select_for_update(),
                pk=data["team_id"],
                event=event,
            )

            if team.status != "confirmed":
                raise ValidationError(
                    "Only confirmed teams can receive results."
                )

            registrations = list(
                Registration.objects
                .select_for_update()
                .filter(team_membership__team=team)
                .order_by("id")
            )

            if (
                not (
                    event.min_team_size
                    <= len(registrations)
                    <= event.max_team_size
                )
                or any(
                    row.event_id != event.id
                    or row.status != "registered"
                    for row in registrations
                )
            ):
                raise ValidationError(
                    "The team does not have a valid active roster."
                )

            target_name = team.name

        if AwardResult.objects.filter(
            event=event,
            registration=registration,
            team=team,
            is_active=True,
        ).exists():
            raise ResultConflict(
                "An active result already exists for this "
                "participant or team. Withdraw it before "
                "recording a correction."
            )

        result = AwardResult.objects.create(
            event=event,
            registration=registration,
            team=team,
            position=data["position"],
            target_name=target_name[:200],
            request_key=data["request_key"],
            created_by=user,
        )

        # Freeze the roster at result creation time.
        AwardResultRecipient.objects.bulk_create([
            AwardResultRecipient(
                result=result,
                registration=row,
            )
            for row in registrations
        ])

        return result.id, True


def withdraw_result(user, result_id, data):
    reference = get_object_or_404(
        AwardResult.objects.filter(
            event__organizer=user
        ).values("event_id"),
        pk=result_id,
    )

    with transaction.atomic():
        get_object_or_404(
            Event.objects.select_for_update(),
            pk=reference["event_id"],
            organizer=user,
        )

        result = get_object_or_404(
            AwardResult.objects.select_for_update(),
            pk=result_id,
        )

        if not result.is_active:
            if result.withdrawal_reason != data["reason"]:
                raise ResultConflict(
                    "The original withdrawal reason is preserved."
                )

            return result.id

        if result.certificates.filter(is_active=True).exists():
            raise ResultConflict(
                "Revoke this result's active award certificates "
                "before withdrawing the result."
            )

        result.is_active = False
        result.withdrawn_at = timezone.now()
        result.withdrawn_by = user
        result.withdrawal_reason = data["reason"]

        result.save(update_fields=[
            "is_active",
            "withdrawn_at",
            "withdrawn_by",
            "withdrawal_reason",
        ])

        return result.id


class ResultPagination(PageNumberPagination):
    page_size = 50


@method_decorator(csrf_protect, name="dispatch")
class EventAwardResultsView(APIView):
    permission_classes = [IsOrganizer]
    parser_classes = [JSONParser]

    def get(self, request, event_id):
        event = get_object_or_404(
            Event,
            pk=event_id,
            organizer=request.user,
        )

        paginator = ResultPagination()

        page = paginator.paginate_queryset(
            owned_results(request.user).filter(event=event),
            request,
            view=self,
        )

        response = paginator.get_paginated_response(
            ResultSerializer(page, many=True).data
        )

        response["Cache-Control"] = "private, no-store"
        return response

    def post(self, request, event_id):
        serializer = ResultCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result_id, created = create_result(
            request.user,
            event_id,
            serializer.validated_data,
        )

        result = get_object_or_404(
            owned_results(request.user),
            pk=result_id,
        )

        return private_response(
            ResultSerializer(result).data,
            status=201 if created else 200,
        )


@method_decorator(csrf_protect, name="dispatch")
class WithdrawAwardResultView(APIView):
    permission_classes = [IsOrganizer]
    parser_classes = [JSONParser]

    def post(self, request, result_id):
        serializer = ResultWithdrawSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        result_id = withdraw_result(
            request.user,
            result_id,
            serializer.validated_data,
        )

        result = get_object_or_404(
            owned_results(request.user),
            pk=result_id,
        )

        return private_response(
            ResultSerializer(result).data
        )


class AwardResultRecipientsView(APIView):
    permission_classes = [IsOrganizer]

    def get(self, request, result_id):
        result = get_object_or_404(
            owned_results(request.user).select_related("event"),
            pk=result_id,
        )

        ids = [
            row.registration_id
            for row in result.recipients.all()
        ]

        now = timezone.now()
        rows = []

        registrations = (
            certificate_registrations(result.event)
            .filter(id__in=ids)
        )

        for registration in registrations:
            details = recipient_details(
                registration,
                result.event,
                now,
            )

            if not result.is_active:
                details["reasons"].append({
                    "code": "result_withdrawn",
                    "message": "The result was withdrawn.",
                })

            membership = getattr(
                registration,
                "team_membership",
                None,
            )

            if result.team_id and (
                membership is None
                or membership.team_id != result.team_id
            ):
                details["reasons"].append({
                    "code": "award_roster_changed",
                    "message": (
                        "The participant no longer belongs "
                        "to the awarded team."
                    ),
                })

            details["eligible"] = not details["reasons"]
            rows.append(details)

        return private_response({
            "result": ResultSerializer(result).data,
            "recipients": rows,
        })