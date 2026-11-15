import uuid

from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Event,
    EventTeam,
    Registration,
    TeamMembership,
    EventTicket,
)

from .permissions import IsOrganizer, IsStudent


# ============================================================
# SERIALIZERS
# ============================================================

class CreateTeamSerializer(serializers.Serializer):

    name = serializers.CharField(
        max_length=100,
        allow_blank=False,
        trim_whitespace=True,
    )


class JoinTeamSerializer(serializers.Serializer):

    invitation_code = serializers.UUIDField()


class TeamMemberSerializer(serializers.ModelSerializer):

    username = serializers.CharField(
        source="registration.student.username",
        read_only=True,
    )

    student_id = serializers.IntegerField(
        source="registration.student_id",
        read_only=True,
    )

    class Meta:
        model = TeamMembership

        fields = [
            "id",
            "username",
            "student_id",
            "role",
            "joined_at",
        ]


class TeamSerializer(serializers.ModelSerializer):

    members = TeamMemberSerializer(
        source="memberships",
        many=True,
        read_only=True,
    )

    member_count = serializers.SerializerMethodField()

    leader_username = serializers.CharField(
        source="leader.username",
        read_only=True,
    )

    class Meta:
        model = EventTeam

        fields = [
            "id",
            "event",
            "name",
            "leader_username",
            "invitation_code",
            "status",
            "member_count",
            "members",
            "created_at",
        ]

    def get_member_count(self, obj):
        return obj.memberships.count()


# ============================================================
# COMMON HELPERS
# ============================================================

def event_registration_open(event):

    now = timezone.now()

    return (
        event.status == "published"
        and event.registration_mode == "team"
        and event.start_datetime > now
        and event.registration_deadline > now
    )


def registration_error(event):

    if event.registration_mode != "team":
        return "This event does not support team registration."

    if event.status != "published":
        return "Registration is not available for this event."

    if event.start_datetime <= timezone.now():
        return "This event has already started."

    if event.registration_deadline <= timezone.now():
        return "Registration has closed."

    return None


def activate_student_registration(event, student):

    """
    Creates or reactivates a student's registration.

    IMPORTANT:
    Call only while holding the event row lock
    inside transaction.atomic().
    """

    registration = (
        Registration.objects
        .select_for_update()
        .filter(
            event=event,
            student=student,
        )
        .first()
    )

    if registration is not None:

        if registration.status == "registered":

            return None

        # Reactivate a previously cancelled registration.

        registration.status = "registered"
        registration.registered_at = timezone.now()
        registration.cancelled_at = None

        registration.save(
            update_fields=[
                "status",
                "registered_at",
                "cancelled_at",
            ]
        )

        # Invalidate the old ticket token.
        # A new ticket can be retrieved through the
        # existing StudentTicketView.

        EventTicket.objects.filter(
            registration=registration
        ).update(
            token=uuid.uuid4(),
            checked_in_at=None,
            checked_in_by=None,
        )

        return registration

    return Registration.objects.create(
        event=event,
        student=student,
        status="registered",
    )


def active_registration_count(event):

    return Registration.objects.filter(
        event=event,
        status="registered",
    ).count()


def cancel_team_registration(registration):

    """
    Cancels a team member's registration.

    Call inside the same transaction used
    for the team-membership change.
    """

    registration.status = "cancelled"
    registration.cancelled_at = timezone.now()

    registration.save(
        update_fields=[
            "status",
            "cancelled_at",
        ]
    )

    # Old tickets must not become usable again
    # if this registration is reactivated later.

    EventTicket.objects.filter(
        registration=registration
    ).update(
        token=uuid.uuid4(),
        checked_in_at=None,
        checked_in_by=None,
    )


# ============================================================
# CREATE TEAM
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class CreateTeamView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, event_id):

        serializer = CreateTeamSerializer(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        team_name = serializer.validated_data["name"]

        with transaction.atomic():

            # Lock the event first.
            # This serializes competing team registrations.

            event = (
                Event.objects
                .select_for_update()
                .filter(id=event_id)
                .first()
            )

            if event is None:
                return Response(
                    {"message": "Event not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            error = registration_error(event)

            if error:
                return Response(
                    {"message": error},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if event.organizer_id == request.user.id:
                return Response(
                    {
                        "message": (
                            "You cannot register for "
                            "your own event."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            # A student may have only one active
            # registration per event.

            already_registered = Registration.objects.filter(
                event=event,
                student=request.user,
                status="registered",
            ).exists()

            if already_registered:
                return Response(
                    {
                        "message": (
                            "You are already registered "
                            "for this event."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Maximum number of active teams.

            team_count = EventTeam.objects.filter(
                event=event
            ).exclude(
                status="withdrawn"
            ).count()

            if team_count >= event.max_teams:
                return Response(
                    {
                        "message": (
                            "The maximum number of "
                            "teams has been reached."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Total student capacity.

            if active_registration_count(event) >= event.capacity:
                return Response(
                    {"message": "This event is fully booked."},
                    status=status.HTTP_409_CONFLICT,
                )

            # Explicitly check for duplicate names.
            # PostgreSQL also enforces the unique constraint.

            duplicate_name = EventTeam.objects.filter(
                event=event,
                name__iexact=team_name,
            ).exists()

            if duplicate_name:
                return Response(
                    {
                        "message": (
                            "A team with this name "
                            "already exists for this event."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Create team.

            team = EventTeam(
                event=event,
                name=team_name,
                leader=request.user,
            )

            team.full_clean()
            team.save()

            # Create an individual registration
            # for the leader.

            registration = activate_student_registration(
                event,
                request.user,
            )

            if registration is None:
                return Response(
                    {"message": "You are already registered."},
                    status=status.HTTP_409_CONFLICT,
                )

            # Connect registration to the team.

            membership = TeamMembership(
                team=team,
                registration=registration,
                role="leader",
            )

            membership.full_clean()
            membership.save()

            return Response(
                {
                    "message": "Team created successfully.",
                    "team": TeamSerializer(team).data,
                },
                status=status.HTTP_201_CREATED,
            )


# ============================================================
# JOIN TEAM
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class JoinTeamView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, event_id):

        serializer = JoinTeamSerializer(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        invitation_code = serializer.validated_data[
            "invitation_code"
        ]

        with transaction.atomic():

            # Always lock the event first.

            event = (
                Event.objects
                .select_for_update()
                .filter(id=event_id)
                .first()
            )

            if event is None:
                return Response(
                    {"message": "Event not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            error = registration_error(event)

            if error:
                return Response(
                    {"message": error},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            team = (
                EventTeam.objects
                .select_for_update()
                .filter(
                    event=event,
                    invitation_code=invitation_code,
                )
                .first()
            )

            if team is None:
                return Response(
                    {
                        "message": (
                            "Invalid invitation code "
                            "for this event."
                        )
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            if team.status != "forming":
                return Response(
                    {
                        "message": (
                            "This team is no longer "
                            "accepting new members."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            already_registered = Registration.objects.filter(
                event=event,
                student=request.user,
                status="registered",
            ).exists()

            if already_registered:
                return Response(
                    {
                        "message": (
                            "You are already registered "
                            "for this event."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            member_count = team.memberships.count()

            if member_count >= event.max_team_size:
                return Response(
                    {
                        "message": "This team is full."
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if active_registration_count(event) >= event.capacity:
                return Response(
                    {"message": "This event is fully booked."},
                    status=status.HTTP_409_CONFLICT,
                )

            registration = activate_student_registration(
                event,
                request.user,
            )

            if registration is None:
                return Response(
                    {"message": "Already registered."},
                    status=status.HTTP_409_CONFLICT,
                )

            membership = TeamMembership(
                team=team,
                registration=registration,
                role="member",
            )

            membership.full_clean()
            membership.save()

            return Response(
                {
                    "message": "Joined team successfully.",
                    "team": TeamSerializer(team).data,
                },
                status=status.HTTP_201_CREATED,
            )


# ============================================================
# MY TEAM
# ============================================================

class MyEventTeamView(APIView):

    permission_classes = [IsStudent]

    def get(self, request, event_id):

        membership = (
            TeamMembership.objects
            .select_related(
                "team",
                "registration",
            )
            .filter(
                team__event_id=event_id,
                registration__student=request.user,
                registration__status="registered",
            )
            .first()
        )

        if membership is None:
            return Response(
                {"message": "You are not in a team."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "team": TeamSerializer(
                membership.team
            ).data,
            "my_role": membership.role,
        })


# ============================================================
# CONFIRM TEAM
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class ConfirmTeamView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, team_id):

        with transaction.atomic():

            # Find the event ID first, then lock the event.

            team_lookup = EventTeam.objects.filter(
                id=team_id
            ).values("event_id").first()

            if team_lookup is None:
                return Response(
                    {"message": "Team not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            event = (
                Event.objects
                .select_for_update()
                .get(id=team_lookup["event_id"])
            )

            team = (
                EventTeam.objects
                .select_for_update()
                .get(id=team_id)
            )

            if team.leader_id != request.user.id:
                return Response(
                    {
                        "message": (
                            "Only the team leader "
                            "can confirm this team."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            if team.status != "forming":
                return Response(
                    {
                        "message": (
                            "Only forming teams "
                            "can be confirmed."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if event.status != "published":
                return Response(
                    {"message": "Event is not active."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Team confirmation must happen before
            # the registration deadline.
            if event.registration_deadline <= timezone.now():
                return Response(
                    {
                        "message": (
                            "Team confirmation is unavailable "
                            "after the registration deadline."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if event.start_datetime <= timezone.now():
                return Response(
                    {"message": "The event has already started."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            count = team.memberships.count()

            if count < event.min_team_size:
                return Response(
                    {
                        "message": (
                            f"Your team needs at least "
                            f"{event.min_team_size} members."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if count > event.max_team_size:
                return Response(
                    {
                        "message": "Team size exceeds the limit."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            team.status = "confirmed"

            team.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            return Response({
                "message": "Team confirmed successfully.",
                "team": TeamSerializer(team).data,
            })


# ============================================================
# LEAVE TEAM
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class LeaveTeamView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, team_id):

        with transaction.atomic():

            lookup = EventTeam.objects.filter(
                id=team_id
            ).values("event_id").first()

            if lookup is None:
                return Response(
                    {"message": "Team not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            event = (
                Event.objects
                .select_for_update()
                .get(id=lookup["event_id"])
            )

            team = (
                EventTeam.objects
                .select_for_update()
                .get(id=team_id)
            )

            if not event_registration_open(event):
                return Response(
                    {
                        "message": (
                            "Team changes are unavailable "
                            "after registration closes."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if team.status != "forming":
                return Response(
                    {
                        "message": (
                            "Confirmed teams cannot "
                            "change their members."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if team.leader_id == request.user.id:
                return Response(
                    {
                        "message": (
                            "Team leaders must withdraw "
                            "the team instead of leaving."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            membership = (
                TeamMembership.objects
                .select_related("registration")
                .filter(
                    team=team,
                    registration__student=request.user,
                    registration__status="registered",
                )
                .first()
            )

            if membership is None:
                return Response(
                    {"message": "You are not in this team."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            registration = membership.registration

            # Prevent alterations to recorded attendance.

            if EventTicket.objects.filter(
                registration=registration,
                checked_in_at__isnull=False,
            ).exists():
                return Response(
                    {
                        "message": (
                            "You cannot leave after "
                            "attendance is recorded."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            membership.delete()

            cancel_team_registration(registration)

            return Response({
                "message": "You have left the team."
            })


# ============================================================
# WITHDRAW TEAM
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class WithdrawTeamView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, team_id):

        with transaction.atomic():

            lookup = EventTeam.objects.filter(
                id=team_id
            ).values("event_id").first()

            if lookup is None:
                return Response(
                    {"message": "Team not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            event = (
                Event.objects
                .select_for_update()
                .get(id=lookup["event_id"])
            )

            team = (
                EventTeam.objects
                .select_for_update()
                .get(id=team_id)
            )

            if team.leader_id != request.user.id:
                return Response(
                    {
                        "message": (
                            "Only the team leader "
                            "can withdraw the team."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            if not event_registration_open(event):
                return Response(
                    {
                        "message": (
                            "Teams cannot be withdrawn "
                            "after registration closes."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if team.status != "forming":
                return Response(
                    {
                        "message": (
                            "Only forming teams "
                            "can be withdrawn."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            memberships = list(
                team.memberships.select_related(
                    "registration"
                )
            )

            # Never erase existing attendance.

            registration_ids = [
                membership.registration_id
                for membership in memberships
            ]

            has_attendance = EventTicket.objects.filter(
                registration_id__in=registration_ids,
                checked_in_at__isnull=False,
            ).exists()

            if has_attendance:
                return Response(
                    {
                        "message": (
                            "This team cannot be withdrawn "
                            "after attendance is recorded."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Remove memberships and cancel registrations.

            for membership in memberships:

                registration = membership.registration

                membership.delete()

                cancel_team_registration(registration)

            team.status = "withdrawn"

            team.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            return Response({
                "message": "Team withdrawn successfully."
            })


# ============================================================
# ORGANIZER TEAM LIST
# ============================================================

class OrganizerEventTeamsView(APIView):

    permission_classes = [IsOrganizer]

    def get(self, request, event_id):

        event = get_object_or_404(
            Event,
            id=event_id,
            organizer=request.user,
        )

        teams = (
            EventTeam.objects
            .filter(event=event)
            .prefetch_related(
                "memberships__registration__student"
            )
            .order_by("created_at")
        )

        return Response({
            "event": {
                "id": event.id,
                "title": event.title,
                "registration_mode": event.registration_mode,
                "min_team_size": event.min_team_size,
                "max_team_size": event.max_team_size,
                "max_teams": event.max_teams,
                "capacity": event.capacity,
            },
            "teams": TeamSerializer(
                teams,
                many=True,
            ).data,
        })