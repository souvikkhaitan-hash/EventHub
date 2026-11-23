from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EventStaffHistory, EventStaffMembership
from .staff_access import (
    ROLE_CAPABILITIES,
    event_role,
    get_staff_event,
)


class StrictInputSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError(
                "Expected a JSON object."
            )

        unknown = set(data) - set(self.fields)

        if unknown:
            raise serializers.ValidationError({
                field: ["Unexpected field."]
                for field in unknown
            })

        return super().to_internal_value(data)


class StaffAssignmentInput(StrictInputSerializer):
    username = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(
        choices=EventStaffMembership.Role.choices
    )


class StaffUpdateInput(StrictInputSerializer):
    revision = serializers.IntegerField(min_value=1)

    role = serializers.ChoiceField(
        choices=EventStaffMembership.Role.choices,
        required=False,
    )

    is_active = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if "role" not in attrs and "is_active" not in attrs:
            raise serializers.ValidationError(
                "Provide a role or an access status."
            )

        return attrs


def membership_data(membership):
    return {
        "id": membership.pk,
        "user": {
            "id": membership.user_id,
            "username": membership.user.username,
            "full_name": membership.user.get_full_name(),
        },
        "role": membership.role,
        "role_label": membership.get_role_display(),
        "is_active": membership.is_active,
        "revision": membership.revision,
        "created_at": membership.created_at,
        "updated_at": membership.updated_at,
    }


def record_staff_change(membership, actor, action, previous_role=""):
    EventStaffHistory.objects.create(
        membership=membership,
        actor=actor,
        action=action,
        revision=membership.revision,
        previous_role=previous_role,
        role=membership.role,
        is_active=membership.is_active,
    )


class MyEventAccessView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, event_id):
        event = get_staff_event(
            request.user,
            event_id,
            "view_event",
        )
        role = event_role(request.user, event)

        return Response({
            "event_id": event.pk,
            "role": role,
            "capabilities": sorted(
                ROLE_CAPABILITIES.get(role, set())
            ),
        })


@method_decorator(csrf_protect, name="dispatch")
class EventStaffListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, event_id):
        event = get_staff_event(
            request.user,
            event_id,
            "manage_staff",
        )

        memberships = (
            EventStaffMembership.objects
            .filter(event=event)
            .select_related("user")
            .order_by("created_at", "pk")
        )

        return Response({
            "event_id": event.pk,
            "owner_id": event.organizer_id,
            "members": [
                membership_data(item)
                for item in memberships
            ],
        })

    def post(self, request, event_id):
        serializer = StaffAssignmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        details = serializer.validated_data

        with transaction.atomic():
            event = get_staff_event(
                request.user,
                event_id,
                "manage_staff",
                lock=True,
            )

            # Exact username lookup avoids exposing an account directory.
            user = (
                get_user_model().objects
                .filter(
                    username=details["username"],
                    is_active=True,
                )
                .first()
            )

            if user is None:
                return Response(
                    {"message": "Active account not found."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if user.pk == event.organizer_id:
                return Response(
                    {
                        "message": (
                            "The event owner already has full access."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if EventStaffMembership.objects.filter(
                event=event,
                user=user,
            ).exists():
                return Response(
                    {
                        "message": (
                            "This account already has a staff record. "
                            "Update or reactivate that record."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            membership = EventStaffMembership.objects.create(
                event=event,
                user=user,
                role=details["role"],
                assigned_by=request.user,
            )

            record_staff_change(
                membership,
                request.user,
                EventStaffHistory.Action.ASSIGNED,
            )

            return Response(
                membership_data(membership),
                status=status.HTTP_201_CREATED,
            )


@method_decorator(csrf_protect, name="dispatch")
class EventStaffDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, event_id, membership_id):
        serializer = StaffUpdateInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        details = serializer.validated_data

        with transaction.atomic():
            # Staff changes and protected event writes share this lock.
            event = get_staff_event(
                request.user,
                event_id,
                "manage_staff",
                lock=True,
            )

            membership = (
                EventStaffMembership.objects
                .select_for_update()
                .filter(
                    pk=membership_id,
                    event=event,
                )
                .first()
            )

            if membership is None:
                return Response(
                    {"message": "Staff member not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if membership.revision != details["revision"]:
                return Response(
                    {
                        "message": (
                            "This staff record has changed. "
                            "Reload before continuing."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            new_role = details.get("role", membership.role)
            new_active = details.get(
                "is_active",
                membership.is_active,
            )

            if new_active and not membership.user.is_active:
                return Response(
                    {"message": "This account is inactive."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if (
                new_role == membership.role
                and new_active == membership.is_active
            ):
                return Response(membership_data(membership))

            previous_role = membership.role
            was_active = membership.is_active

            membership.role = new_role
            membership.is_active = new_active
            membership.revision += 1

            membership.save(
                update_fields=[
                    "role",
                    "is_active",
                    "revision",
                    "updated_at",
                ]
            )

            if was_active and not new_active:
                action = EventStaffHistory.Action.REVOKED
            elif not was_active and new_active:
                action = EventStaffHistory.Action.REACTIVATED
            else:
                action = EventStaffHistory.Action.UPDATED

            record_staff_change(
                membership,
                request.user,
                action,
                previous_role,
            )

            return Response(membership_data(membership))