from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission

from .models import Event, EventStaffMembership


ROLE_CAPABILITIES = {
    "owner": {
        "view_event",
        "edit_event",
        "view_participants",
        "view_attendance",
        "check_in",
        "manage_staff",
        "manage_certificates",
        "export_attendance",
    },
    "manager": {
        "view_event",
        "edit_event",
        "view_participants",
        "view_attendance",
        "check_in",
        "export_attendance",
    },
    "attendance": {
        "view_event",
        "view_attendance",
        "check_in",
    },
    "certificates": {
        "view_event",
        "manage_certificates",
    },
}


def is_platform_organizer(user):
    return bool(
        user.is_authenticated
        and user.is_active
        and user.groups.filter(name="Organizer").exists()
    )


def event_role(user, event):
    if not user.is_authenticated or not user.is_active:
        return None

    if event.organizer_id == user.pk:
        return "owner" if is_platform_organizer(user) else None

    return (
        EventStaffMembership.objects
        .filter(
            event=event,
            user=user,
            is_active=True,
        )
        .values_list("role", flat=True)
        .first()
    )


def has_event_capability(user, event, capability):
    role = event_role(user, event)
    return capability in ROLE_CAPABILITIES.get(role, set())


def require_event_capability(user, event, capability):
    if not has_event_capability(user, event, capability):
        # Do not reveal another event's private existence.
        raise NotFound("Event not found.")


def get_staff_event(user, event_id, capability, *, lock=False):
    queryset = Event.objects.all()

    if lock:
        # Caller must already be inside transaction.atomic().
        queryset = queryset.select_for_update()

    event = get_object_or_404(queryset, pk=event_id)
    require_event_capability(user, event, capability)
    return event


def accessible_events(user):
    if not user.is_authenticated or not user.is_active:
        return Event.objects.none()

    access = Q(
        staff_memberships__user=user,
        staff_memberships__is_active=True,
    )

    if is_platform_organizer(user):
        access |= Q(organizer=user)

    return Event.objects.filter(access).distinct()


class HasEventWorkspaceAccess(BasePermission):
    message = "You do not have event workspace access."

    def has_permission(self, request, view):
        user = request.user

        if not user.is_authenticated or not user.is_active:
            return False

        return (
            is_platform_organizer(user)
            or EventStaffMembership.objects.filter(
                user=user,
                is_active=True,
            ).exists()
        )