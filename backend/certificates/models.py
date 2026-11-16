import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from .storage import PrivateCertificateStorage


def background_upload_path(instance, filename):
    # Never use an uploaded filename as a storage path.
    return f"backgrounds/{uuid.uuid4().hex}.png"


class CertificateTemplate(models.Model):
    event = models.ForeignKey(
        "events.Event",
        on_delete=models.PROTECT,
        related_name="certificate_templates",
    )

    name = models.CharField(max_length=120)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_certificate_templates",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.name


class CertificateTemplateVersion(models.Model):
    """
    API changes create a new version instead of updating an old one.
    """

    template = models.ForeignKey(
        CertificateTemplate,
        on_delete=models.PROTECT,
        related_name="versions",
    )

    number = models.PositiveIntegerField()

    background = models.FileField(
        storage=PrivateCertificateStorage(),
        upload_to=background_upload_path,
    )

    image_width = models.PositiveIntegerField()
    image_height = models.PositiveIntegerField()

    # Positions and styles of approved dynamic placeholders.
    fields = models.JSONField(default=list)
    images = models.JSONField(default=list, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_certificate_template_versions",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-number"]

        constraints = [
            models.UniqueConstraint(
                fields=["template", "number"],
                name="unique_certificate_template_version",
            ),
            models.CheckConstraint(
                condition=Q(number__gte=1),
                name="certificate_version_positive",
            ),
            models.CheckConstraint(
                condition=Q(
                    image_width__gte=1,
                    image_height__gte=1,
                ),
                name="certificate_image_dimensions_positive",
            ),
        ]

    def __str__(self):
        return f"{self.template.name} — version {self.number}"
    
def certificate_asset_upload_path(instance, filename):
    return f"assets/{uuid.uuid4().hex}.png"


class CertificateAsset(models.Model):
    """
    An approved image belonging to one certificate template.

    The API does not replace or delete assets, so saved template
    versions retain their original artwork.
    """

    template = models.ForeignKey(
        CertificateTemplate,
        on_delete=models.PROTECT,
        related_name="assets",
    )

    name = models.CharField(max_length=120)

    image = models.FileField(
        storage=PrivateCertificateStorage(),
        upload_to=certificate_asset_upload_path,
    )

    image_width = models.PositiveIntegerField()
    image_height = models.PositiveIntegerField()

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_certificate_assets",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

        constraints = [
            models.CheckConstraint(
                condition=Q(
                    image_width__gte=1,
                    image_height__gte=1,
                ),
                name="certificate_asset_dimensions_positive",
            ),
        ]

    def __str__(self):
        return self.name

def generated_certificate_upload_path(instance, filename):
    return (
        f"generated/{instance.batch_id}/"
        f"{instance.id}.pdf"
    )


def issued_certificate_upload_path(instance, filename):
    return (
        f"issued/{instance.batch_id}/"
        f"{uuid.uuid4().hex}.pdf"
    )


class CertificateBatch(models.Model):
    award_result = models.ForeignKey(
        "AwardResult",
        on_delete=models.PROTECT,
        related_name="batches",
        null=True,
        blank=True,
    )

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("published", "Published"),
    ]

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    event = models.ForeignKey(
        "events.Event",
        on_delete=models.PROTECT,
        related_name="certificate_batches",
    )

    template_version = models.ForeignKey(
        CertificateTemplateVersion,
        on_delete=models.PROTECT,
        related_name="batches",
    )

    request_key = models.UUIDField()
    request_hash = models.CharField(max_length=64)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="draft",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_certificate_batches",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    published_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="published_certificate_batches",
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-created_at", "-id"]

        constraints = [
            models.UniqueConstraint(
                fields=["event", "request_key"],
                name="unique_event_certificate_request",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        status="draft",
                        published_at__isnull=True,
                        published_by__isnull=True,
                    )
                    | Q(
                        status="published",
                        published_at__isnull=False,
                        published_by__isnull=False,
                    )
                ),
                name="certificate_batch_publication_state",
            ),
        ]

    def __str__(self):
        return f"{self.event.title} — {self.id}"

class GeneratedCertificate(models.Model):
    award_result = models.ForeignKey(
        "AwardResult",
        on_delete=models.PROTECT,
        related_name="certificates",
        null=True,
        blank=True,
    )
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    batch = models.ForeignKey(
        CertificateBatch,
        on_delete=models.PROTECT,
        related_name="certificates",
    )

    registration = models.ForeignKey(
        "events.Registration",
        on_delete=models.PROTECT,
        related_name="generated_certificates",
    )

    participant_name = models.CharField(max_length=200)

    # Exact values used to produce this PDF.
    values = models.JSONField(default=dict)

    document = models.FileField(
        storage=PrivateCertificateStorage(),
        upload_to=generated_certificate_upload_path,
    )

    sha256 = models.CharField(max_length=64)
    issued_document = models.FileField(
        storage=PrivateCertificateStorage(),
        upload_to=issued_certificate_upload_path,
        blank=True,
    )

    issued_sha256 = models.CharField(
        max_length=64,
        blank=True,
        default="",
    )

    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["registration_id"]

        constraints = [
            models.UniqueConstraint(
                fields=["batch", "registration"],
                name="unique_batch_certificate_registration",
            ),
                        models.UniqueConstraint(
                fields=["registration"],
                condition=Q(
                    is_active=True,
                    award_result__isnull=True,
                ),
                name="unique_active_participation_certificate",
            ),
            models.UniqueConstraint(
                fields=["registration", "award_result"],
                condition=Q(
                    is_active=True,
                    award_result__isnull=False,
                ),
                name="unique_active_award_certificate",
            ),
            models.CheckConstraint(
                condition=(
                    Q(is_active=False)
                    | (
                        ~Q(issued_document="")
                        & ~Q(issued_sha256="")
                    )
                ),
                name="active_certificate_has_issued_file",
            ),
            ]

    def __str__(self):
        return f"{self.participant_name} — {self.id}"


class CertificateRevocation(models.Model):
    certificate = models.OneToOneField(
        "GeneratedCertificate",
        on_delete=models.PROTECT,
        related_name="revocation",
    )

    reason = models.CharField(max_length=500)

    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="certificate_revocations",
    )

    revoked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-revoked_at", "-id"]

class AwardResult(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    event = models.ForeignKey(
        "events.Event",
        on_delete=models.PROTECT,
        related_name="award_results",
    )

    registration = models.ForeignKey(
        "events.Registration",
        on_delete=models.PROTECT,
        related_name="individual_award_results",
        null=True,
        blank=True,
    )

    team = models.ForeignKey(
        "events.EventTeam",
        on_delete=models.PROTECT,
        related_name="award_results",
        null=True,
        blank=True,
    )

    position = models.CharField(max_length=80)
    target_name = models.CharField(max_length=200)
    request_key = models.UUIDField()

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="recorded_award_results",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    withdrawn_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    withdrawn_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="withdrawn_award_results",
        null=True,
        blank=True,
    )

    withdrawal_reason = models.CharField(
        max_length=500,
        blank=True,
        default="",
    )

    class Meta:
        ordering = ["-created_at", "-id"]

        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(
                        registration__isnull=False,
                        team__isnull=True,
                    )
                    | Q(
                        registration__isnull=True,
                        team__isnull=False,
                    )
                ),
                name="award_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["event", "request_key"],
                name="unique_award_request",
            ),
            models.UniqueConstraint(
                fields=["event", "registration"],
                condition=Q(
                    is_active=True,
                    registration__isnull=False,
                ),
                name="unique_active_student_result",
            ),
            models.UniqueConstraint(
                fields=["event", "team"],
                condition=Q(
                    is_active=True,
                    team__isnull=False,
                ),
                name="unique_active_team_result",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        is_active=True,
                        withdrawn_at__isnull=True,
                        withdrawn_by__isnull=True,
                        withdrawal_reason="",
                    )
                    | (
                        Q(
                            is_active=False,
                            withdrawn_at__isnull=False,
                            withdrawn_by__isnull=False,
                        )
                        & ~Q(withdrawal_reason="")
                    )
                ),
                name="award_withdrawal_state",
            ),
            models.CheckConstraint(
                condition=~Q(position=""),
                name="award_position_not_empty",
            ),
        ]


class AwardResultRecipient(models.Model):
    result = models.ForeignKey(
        AwardResult,
        on_delete=models.PROTECT,
        related_name="recipients",
    )

    registration = models.ForeignKey(
        "events.Registration",
        on_delete=models.PROTECT,
        related_name="award_result_rosters",
    )

    class Meta:
        ordering = ["registration_id"]

        constraints = [
            models.UniqueConstraint(
                fields=["result", "registration"],
                name="unique_award_result_recipient",
            ),
        ]