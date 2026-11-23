import uuid

from django.db.models import Q

from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .models import Registration
from .staff_access import (
    HasEventWorkspaceAccess,
    get_staff_event,
)


class AttendanceLookupThrottle(UserRateThrottle):
    rate = "60/min"
    scope = "attendance_lookup"


class AttendanceLookupInput(serializers.Serializer):
    kind = serializers.ChoiceField(
        choices=["roll", "ticket"]
    )
    query = serializers.CharField(
        max_length=100,
        trim_whitespace=True,
        allow_blank=False,
    )


class AttendanceLookupView(APIView):
    permission_classes = [HasEventWorkspaceAccess]
    throttle_classes = [AttendanceLookupThrottle]

    def get(self, request, event_id):
        event = get_staff_event(
            request.user,
            event_id,
            "check_in",
        )

        if event.status != "published":
            return Response(
                {
                    "message": (
                        "Attendance lookup is unavailable "
                        "for this event."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AttendanceLookupInput(
            data=request.query_params
        )
        serializer.is_valid(raise_exception=True)
        details = serializer.validated_data

        registrations = (
            Registration.objects
            .filter(
                event=event,
                status="registered",
            )
            .select_related(
                "student",
                "student__student_profile",
                "ticket",
            )
        )

        if event.registration_mode == "team":
            registrations = registrations.filter(
                team_membership__team__event=event,
                team_membership__team__status="confirmed",
            )

        if details["kind"] == "ticket":
            try:
                token = uuid.UUID(details["query"])
            except ValueError:
                raise serializers.ValidationError({
                    "query": [
                        "Enter the complete ticket UUID."
                    ]
                })

            registrations = registrations.filter(
                ticket__token=token
            )
        else:
            registrations = registrations.filter(
                student__student_profile__roll_number__iexact=(
                    details["query"]
                )
            )

        matches = list(
            registrations.order_by("student__username", "pk")[:11]
        )

        if len(matches) > 10:
            return Response(
                {
                    "message": (
                        "Too many accounts share this roll number. "
                        "Use the participant's ticket UUID."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        results = []

        for registration in matches:
            profile = getattr(
                registration.student,
                "student_profile",
                None,
            )
            ticket = getattr(registration, "ticket", None)

            checked_in_at = (
                ticket.checked_in_at if ticket else None
            )

            results.append({
                "registration_id": registration.pk,
                "username": registration.student.username,
                "full_name": (
                    registration.student.get_full_name()
                    or registration.student.username
                ),
                "roll_number": (
                    profile.roll_number if profile else ""
                ),
                "department": (
                    profile.department if profile else ""
                ),
                "checked_in_at": checked_in_at,
                "is_self": (
                    registration.student_id == request.user.pk
                ),
            })

        response = Response({
            "results": results,
            "count": len(results),
        })
        response["Cache-Control"] = "private, no-store"
        return response