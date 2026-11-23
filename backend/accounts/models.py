from django.conf import settings
from django.db import models
from django.utils import timezone

class StudentProfile(models.Model):
    """
    Store academic details separately from Django's user account.

    First name, last name, email and password remain in Django's
    existing User model.
    """

    YEAR_CHOICES = [
        ("1", "Year 1"),
        ("2", "Year 2"),
        ("3", "Year 3"),
        ("4", "Year 4"),
        ("5", "Year 5"),
        ("6", "Year 6"),
        ("postgraduate", "Postgraduate"),
        ("other", "Other"),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="student_profile",
    )

    roll_number = models.CharField(
        max_length=50,
    )

    department = models.CharField(
        max_length=120,
    )

    academic_year = models.CharField(
        max_length=20,
        choices=YEAR_CHOICES,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def __str__(self):
        return (
            f"{self.user.username} — "
            f"{self.roll_number}"
        )
class OrganizerApplication(models.Model):
    """
    An account's application for organizer access.

    Application status alone does not grant permissions.
    The approval service will update the Organizer group
    only after an authorized admin decision.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CHANGES_REQUESTED = (
            "changes_requested",
            "Changes requested",
        )

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="organizer_application",
    )

    organization = models.CharField(
        max_length=150,
        help_text="Club, department or organizing body.",
    )

    position = models.CharField(
        max_length=100,
        help_text="Your position in the organizing body.",
    )

    reason = models.TextField(
        max_length=2000,
        help_text="Explain why you need organizer access.",
    )

    status = models.CharField(
        max_length=25,
        choices=Status.choices,
        default=Status.PENDING,
    )

    revision = models.PositiveIntegerField(
        default=1,
    )

    # This note is visible to the applicant.
    decision_note = models.TextField(
        max_length=1000,
        blank=True,
    )

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_organizer_applications",
        null=True,
        blank=True,
    )

    reviewed_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["-created_at"]

        permissions = [
            (
                "review_organizerapplication",
                "Can review organizer applications",
            ),
        ]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    status__in=[
                        "pending",
                        "approved",
                        "rejected",
                        "changes_requested",
                    ]
                ),
                name="organizer_application_valid_status",
            ),

            models.CheckConstraint(
                condition=models.Q(
                    revision__gte=1
                ),
                name="organizer_application_valid_revision",
            ),
        ]

    def __str__(self):
        return (
            f"{self.user.username} — "
            f"{self.get_status_display()}"
        )


class OrganizerApplicationHistory(models.Model):
    """
    Preserve submissions and admin decisions.

    Resubmitting an application will not erase the
    previous application details or decision history.
    """

    class Action(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        RESUBMITTED = "resubmitted", "Resubmitted"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CHANGES_REQUESTED = (
            "changes_requested",
            "Changes requested",
        )

    application = models.ForeignKey(
        OrganizerApplication,
        on_delete=models.PROTECT,
        related_name="history",
    )

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="organizer_application_actions",
        null=True,
        blank=True,
    )

    action = models.CharField(
        max_length=25,
        choices=Action.choices,
    )

    revision = models.PositiveIntegerField()

    note = models.TextField(
        max_length=1000,
        blank=True,
    )

    # Snapshot of the application at the time of the action.
    application_data = models.JSONField(
        default=dict,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return (
            f"Application {self.application_id} — "
            f"{self.get_action_display()}"
        )

class OrganizerEmailNotification(models.Model):
    """
    Durable email queue for organizer application events.

    'Accepted' means the email backend accepted the message,
    not that the recipient has received or opened it.
    """

    class Audience(models.TextChoices):
        APPLICANT = "applicant", "Applicant"
        REVIEWER = "reviewer", "Reviewer"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted by email backend"
        FAILED = "failed", "Retries exhausted"
        CANCELLED = "cancelled", "Recipient no longer eligible"

    history = models.ForeignKey(
        OrganizerApplicationHistory,
        on_delete=models.PROTECT,
        related_name="email_notifications",
    )

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="organizer_email_notifications",
    )

    audience = models.CharField(
        max_length=20,
        choices=Audience.choices,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )

    attempts = models.PositiveIntegerField(default=0)

    next_attempt_at = models.DateTimeField(
        default=timezone.now,
    )

    accepted_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    # Store an exception type only: never provider responses or secrets.
    last_error_code = models.CharField(
        max_length=100,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

        constraints = [
            models.UniqueConstraint(
                fields=["history", "recipient", "audience"],
                name="unique_organizer_event_email",
            ),
        ]

        indexes = [
            models.Index(
                fields=["status", "next_attempt_at"],
                name="org_email_due_idx",
            ),
        ]

    def __str__(self):
        return f"Organizer email {self.pk}: {self.status}"