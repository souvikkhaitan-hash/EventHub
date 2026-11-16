from django.utils import timezone
from rest_framework import serializers
from django.db.models import Count, Q
from .models import Event, Registration,EventTicket


class EventSerializer(serializers.ModelSerializer):

    organizer_name = serializers.CharField(
        source="organizer.username",
        read_only=True
    )
    registered_count = serializers.SerializerMethodField()
    available_seats = serializers.SerializerMethodField()

    class Meta:
        model = Event

        fields = [
            "id",
            "title",
            "description",
            "category",
            "venue",
            "start_datetime",
            "end_datetime",
            "registration_deadline",
            "capacity",
            "registration_mode",
            "min_team_size",
            "max_team_size",
            "max_teams",
            "status",
            "organizer_name",
            "created_at",
            "updated_at",
            "published_at",
            "registered_count",
            "available_seats",
        ]

        read_only_fields = [
            "id",
            "organizer_name",
            "created_at",
            "updated_at",
            "published_at",
        ]

    def validate(self, attrs):
        instance = self.instance

        start = attrs.get(
            "start_datetime",
            instance.start_datetime if instance else None
        )

        end = attrs.get(
            "end_datetime",
            instance.end_datetime if instance else None
        )

        deadline = attrs.get(
            "registration_deadline",
            instance.registration_deadline if instance else None
        )

        capacity = attrs.get(
            "capacity",
            instance.capacity if instance else None
        )

        status = attrs.get(
            "status",
            instance.status if instance else "draft"
        )

        errors = {}
        # ==========================================
        # TEAM REGISTRATION VALIDATION
        # ==========================================

        registration_mode = attrs.get(
            "registration_mode",
            instance.registration_mode if instance else "individual",
        )

        min_team_size = attrs.get(
            "min_team_size",
            instance.min_team_size if instance else 2,
        )

        max_team_size = attrs.get(
            "max_team_size",
            instance.max_team_size if instance else 6,
        )

        max_teams = attrs.get(
            "max_teams",
            instance.max_teams if instance else 30,
        )

        if registration_mode == "team":
            if min_team_size < 2:
                errors["min_team_size"] = (
                    "A team must have at least 2 members."
                )

            if max_team_size < min_team_size:
                errors["max_team_size"] = (
                    "Maximum team size cannot be smaller "
                    "than minimum team size."
                )

            if max_teams < 1:
                errors["max_teams"] = (
                    "Maximum teams must be at least 1."
                )

            if capacity is not None and max_team_size > capacity:
                errors["capacity"] = (
                    "Total participant capacity must be "
                    "at least as large as the maximum team size."
                )
                # Protect existing teams when changing registration limits.
        #
        # OrganizerEventDetailView already holds the event row lock
        # while validating and saving an update. Team creation and
        # joining use the same lock, preventing competing changes.
        if instance and registration_mode == "team":
            active_teams = instance.teams.exclude(
                status="withdrawn"
            )

            changing_max_teams = (
                "max_teams" in attrs
                and max_teams != instance.max_teams
            )

            changing_max_size = (
                "max_team_size" in attrs
                and max_team_size != instance.max_team_size
            )

            changing_min_size = (
                "min_team_size" in attrs
                and min_team_size != instance.min_team_size
            )

            if changing_max_teams:
                existing_team_count = active_teams.count()

                if max_teams < existing_team_count:
                    errors["max_teams"] = (
                        "Maximum teams cannot be less than "
                        f"the {existing_team_count} existing active teams."
                    )

            if changing_max_size or changing_min_size:
                team_sizes = active_teams.annotate(
                    active_member_count=Count(
                        "memberships",
                        filter=Q(
                            memberships__registration__status="registered"
                        ),
                    )
                )

                if changing_max_size:
                    oversized_team_exists = team_sizes.filter(
                        active_member_count__gt=max_team_size
                    ).exists()

                    if oversized_team_exists:
                        errors["max_team_size"] = (
                            "Maximum team size cannot be smaller "
                            "than an existing active team's roster."
                        )

                if changing_min_size:
                    undersized_confirmed_team_exists = (
                        team_sizes.filter(
                            status="confirmed",
                            active_member_count__lt=min_team_size,
                        ).exists()
                    )

                    if undersized_confirmed_team_exists:
                        errors["min_team_size"] = (
                            "Minimum team size cannot exceed "
                            "an existing confirmed team's roster."
                        )
        # Do not allow the registration type to change after publication.
        if instance and "registration_mode" in attrs:
            if (
                attrs["registration_mode"] != instance.registration_mode
                and instance.status != "draft"
            ):
                errors["registration_mode"] = (
                    "Registration type cannot be changed "
                    "after an event has been published."
                )

            # Existing registrations must not silently change registration type.
            if (
                attrs["registration_mode"] != instance.registration_mode
                and instance.registrations.exists()
            ):
                errors["registration_mode"] = (
                    "Cannot change registration type "
                    "after students have registered."
                )

        if start and end and end <= start:
            errors["end_datetime"] = (
                "End time must be after start time."
            )

        if start and deadline and deadline > start:
            errors["registration_deadline"] = (
                "Registration must close before the event starts."
            )

        if capacity is not None and capacity < 1:
            errors["capacity"] = (
                "Capacity must be at least 1."
            )

        if status == "published":
            if start and start <= timezone.now():
                errors["start_datetime"] = (
                    "Only future events can be published."
                )

            if deadline and deadline <= timezone.now():
                errors["registration_deadline"] = (
                    "Registration must still be open when publishing."
                )

        if errors:
            raise serializers.ValidationError(errors)

        return attrs

    def create(self, validated_data):
        """
        Record publication time when an event
        is created directly as published.
        """

        if validated_data.get("status") == "published":
            validated_data["published_at"] = timezone.now()

        return super().create(validated_data)


    def update(self, instance, validated_data):
        """
        Record the first publication timestamp.

        Editing an already published event must
        not overwrite its publication date.
        """

        new_status = validated_data.get(
            "status",
            instance.status
        )

        if (
            new_status == "published"
            and instance.status != "published"
            and instance.published_at is None
        ):
            validated_data["published_at"] = timezone.now()

        return super().update(instance, validated_data)
    
    def _get_registered_count(self, obj):
        # Reuse the value when this serializer processes
        # the same event more than once.
        if not hasattr(obj, "_cached_registered_count"):
            obj._cached_registered_count = (
                obj.registrations.filter(
                    status="registered"
                ).count()
            )

        return obj._cached_registered_count

    def get_registered_count(self, obj):
        return self._get_registered_count(obj)

    def get_available_seats(self, obj):
        registered = self._get_registered_count(obj)
        return max(0, obj.capacity - registered)


class RegistrationSerializer(serializers.ModelSerializer):

    event_title = serializers.CharField(
        source="event.title",
        read_only=True
    )

    event_category = serializers.CharField(
        source="event.category",
        read_only=True
    )

    event_start = serializers.DateTimeField(
        source="event.start_datetime",
        read_only=True
    )

    event_venue = serializers.CharField(
        source="event.venue",
        read_only=True
    )
    

    class Meta:
        model = Registration

        fields = [
            "id",
            "event",
            "event_title",
            "event_category",
            "event_start",
            "event_venue",
            "status",
            "registered_at",
            "cancelled_at",
        ]

        read_only_fields = fields
        
class OrganizerParticipantSerializer(serializers.ModelSerializer):
    student_username = serializers.CharField(
        source="student.username",
        read_only=True
    )

    class Meta:
        model = Registration

        fields = [
            "id",
            "student_username",
            "status",
            "registered_at",
            "cancelled_at",
        ]

        read_only_fields = fields

# ============================================================
# FEATURE 4 — STUDENT TICKET SERIALIZER
# ============================================================

class EventTicketSerializer(serializers.ModelSerializer):

    event_id = serializers.IntegerField(
        source="registration.event.id",
        read_only=True
    )

    event_title = serializers.CharField(
        source="registration.event.title",
        read_only=True
    )

    event_venue = serializers.CharField(
        source="registration.event.venue",
        read_only=True
    )

    event_start = serializers.DateTimeField(
        source="registration.event.start_datetime",
        read_only=True
    )

    event_end = serializers.DateTimeField(
        source="registration.event.end_datetime",
        read_only=True
    )

    class Meta:
        model = EventTicket

        fields = [
            "id",
            "token",
            "registration",
            "event_id",
            "event_title",
            "event_venue",
            "event_start",
            "event_end",
            "checked_in_at",
            "created_at",
        ]

        read_only_fields = fields