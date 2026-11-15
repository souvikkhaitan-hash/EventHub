from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q
from django.utils import timezone
import uuid


class Event(models.Model):

    CATEGORY_CHOICES = [
        ("technical", "Technical"),
        ("cultural", "Cultural"),
        ("workshop", "Workshop"),
        ("seminar", "Seminar"),
        ("sports", "Sports"),
    ]

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("published", "Published"),
        ("cancelled", "Cancelled"),
    ]

    title = models.CharField(max_length=200)

    description = models.TextField()

    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES
    )

    venue = models.CharField(max_length=200)

    start_datetime = models.DateTimeField()

    end_datetime = models.DateTimeField()

    registration_deadline = models.DateTimeField()

    capacity = models.PositiveIntegerField()

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="draft"
    )

    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="organized_events"
    )

    created_at = models.DateTimeField(
        default=timezone.now
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )
    published_at = models.DateTimeField(
    null=True,
    blank=True,
    editable=False
   )
       # ==========================================
    # TEAM EVENT CONFIGURATION
    # ==========================================

    REGISTRATION_MODES = [
        ("individual", "Individual"),
        ("team", "Team"),
    ]

    registration_mode = models.CharField(
        max_length=20,
        choices=REGISTRATION_MODES,
        default="individual",
    )

    min_team_size = models.PositiveSmallIntegerField(
        default=2,
    )

    max_team_size = models.PositiveSmallIntegerField(
        default=6,
    )

    max_teams = models.PositiveIntegerField(
        default=30,
    )

    class Meta:
        ordering = ["start_datetime"]

        constraints = [
            models.CheckConstraint(
                condition=Q(capacity__gte=1),
                name="event_capacity_positive"
            ),
            models.CheckConstraint(
                condition=Q(end_datetime__gt=F("start_datetime")),
                name="event_end_after_start"
            ),
            models.CheckConstraint(
                condition=Q(
                    registration_deadline__lte=F("start_datetime")
                ),
                name="event_deadline_before_start"
            ),
        ]

    def clean(self):
        errors = {}

        if (
            self.start_datetime
            and self.end_datetime
            and self.end_datetime <= self.start_datetime
        ):
            errors["end_datetime"] = (
                "End time must be after start time."
            )

        if (
            self.start_datetime
            and self.registration_deadline
            and self.registration_deadline > self.start_datetime
        ):
            errors["registration_deadline"] = (
                "Registration deadline cannot be after the event starts."
            )

        if self.capacity is not None and self.capacity < 1:
            errors["capacity"] = (
                "Capacity must be at least 1."
            )

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return self.title
class Registration(models.Model):

    STATUS_CHOICES = [
        ("registered", "Registered"),
        ("cancelled", "Cancelled"),
    ]

    event = models.ForeignKey(
        Event,
        on_delete=models.PROTECT,
        related_name="registrations"
    )

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="event_registrations"
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="registered"
    )

    registered_at = models.DateTimeField(
        default=timezone.now
    )

    cancelled_at = models.DateTimeField(
        null=True,
        blank=True
    )

    class Meta:
        ordering = ["-registered_at"]

        constraints = [
            models.UniqueConstraint(
                fields=["event", "student"],
                name="unique_event_student_registration"
            ),
        ]

    def __str__(self):
        return (
            f"{self.student.username} - "
            f"{self.event.title} ({self.status})"
        )
        
# ============================================================
# FEATURE 4 — EVENT TICKET AND ATTENDANCE
# ============================================================

class EventTicket(models.Model):

    # Every registration can have only one ticket.
    registration = models.OneToOneField(
        "Registration",
        on_delete=models.PROTECT,
        related_name="ticket"
    )

    # Random, unguessable public ticket identifier.
    token = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False
    )

    # Attendance information.
    checked_in_at = models.DateTimeField(
        null=True,
        blank=True
    )

    checked_in_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="verified_event_tickets"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Ticket {self.registration_id} "
            f"- {self.registration.event.title}"
        )
# ============================================================
# FEATURE 6A — TEAM EVENTS
# ============================================================

class EventTeam(models.Model):

    STATUS_CHOICES = [
        ("forming", "Forming"),
        ("confirmed", "Confirmed"),
        ("withdrawn", "Withdrawn"),
    ]

    # Each team belongs to one event.
    event = models.ForeignKey(
        Event,
        on_delete=models.PROTECT,
        related_name="teams",
    )

    # Team name, for example "Code Warriors".
    name = models.CharField(
        max_length=100,
    )

    # The student who created and manages the team.
    leader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="led_event_teams",
    )

    # Private invitation code.
    # This is generated automatically for every team.
    invitation_code = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
    )

    # Teams start in the "forming" state.
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="forming",
    )

    created_at = models.DateTimeField(
        default=timezone.now,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:

        ordering = ["created_at"]

        constraints = [

            # Prevent duplicate team names within an event.
            # The comparison is case-insensitive.
            models.UniqueConstraint(
                models.functions.Lower("name"),
                "event",
                name="unique_event_team_name_ci",
            ),

            # Only recognized team statuses are allowed.
            models.CheckConstraint(
                condition=Q(
                    status__in=[
                        "forming",
                        "confirmed",
                        "withdrawn",
                    ]
                ),
                name="valid_event_team_status",
            ),
        ]

    def clean(self):

        errors = {}

        # Team registration must be enabled.
        if self.event_id and self.event.registration_mode != "team":
            errors["event"] = (
                "Teams can only be created for team events."
            )

        # Require a meaningful team name.
        if not self.name or not self.name.strip():
            errors["name"] = (
                "Team name cannot be empty."
            )

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.name} - {self.event.title}"

# ============================================================
# FEATURE 6B — TEAM MEMBERSHIP
# ============================================================

class TeamMembership(models.Model):

    ROLE_CHOICES = [
        ("leader", "Leader"),
        ("member", "Member"),
    ]

    # The team this student belongs to.
    team = models.ForeignKey(
        EventTeam,
        on_delete=models.PROTECT,
        related_name="memberships",
    )

    # Reuse the student's existing event registration.
    #
    # OneToOneField ensures that one registration
    # cannot belong to multiple teams simultaneously.
    registration = models.OneToOneField(
        Registration,
        on_delete=models.PROTECT,
        related_name="team_membership",
    )

    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default="member",
    )

    joined_at = models.DateTimeField(
        default=timezone.now,
    )

    class Meta:

        ordering = ["joined_at"]

        constraints = [

            models.CheckConstraint(
                condition=Q(
                    role__in=[
                        "leader",
                        "member",
                    ]
                ),
                name="valid_team_membership_role",
            ),
        ]

    def clean(self):

        errors = {}

        if not self.team_id or not self.registration_id:
            return

        # Registration and team must belong to
        # exactly the same event.
        if self.registration.event_id != self.team.event_id:
            errors["registration"] = (
                "The registration must belong "
                "to the same event as the team."
            )

        # Only active registrations can join teams.
        if self.registration.status != "registered":
            errors["registration"] = (
                "Cancelled registrations cannot join teams."
            )

        # The specified team leader must match
        # the student linked to the registration.
        if (
            self.role == "leader"
            and self.registration.student_id != self.team.leader_id
        ):
            errors["role"] = (
                "The team leader role can only be "
                "assigned to the designated team leader."
            )

        if errors:
            raise ValidationError(errors)

    def __str__(self):

        return (
            f"{self.registration.student.username} "
            f"- {self.team.name} ({self.role})"
        )
