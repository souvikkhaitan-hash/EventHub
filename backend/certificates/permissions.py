from django.db.models import Q

from rest_framework.permissions import BasePermission

from events.models import Event, EventStaffMembership
from events.staff_access import (
    get_staff_event,
    is_platform_organizer,
)


def certificate_event_ids(user):
    """
    Events whose certificate preparation tools this user can access.

    Used to scope template, asset, version, batch and document lookups.
    """
    if not user.is_authenticated or not user.is_active:
        return Event.objects.none().values_list("pk", flat=True)

    allowed = Q(
        staff_memberships__user=user,
        staff_memberships__is_active=True,
        staff_memberships__role=(
            EventStaffMembership.Role.CERTIFICATES
        ),
    )

    if is_platform_organizer(user):
        allowed |= Q(organizer=user)

    return (
        Event.objects
        .filter(allowed)
        .values_list("pk", flat=True)
        .distinct()
    )


def certificate_event(user, event_id, *, lock=False):
    """
    For writes, lock the event first and then check current access.

    Staff removal uses the same event lock.
    """
    return get_staff_event(
        user,
        event_id,
        "manage_certificates",
        lock=lock,
    )


class CanManageCertificates(BasePermission):
    message = "Certificate workspace access is required."

    def has_permission(self, request, view):
        user = request.user

        if not user.is_authenticated or not user.is_active:
            return False

        return (
            is_platform_organizer(user)
            or EventStaffMembership.objects.filter(
                user=user,
                is_active=True,
                role=EventStaffMembership.Role.CERTIFICATES,
            ).exists()
        )