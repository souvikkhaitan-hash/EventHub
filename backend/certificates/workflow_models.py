"""Imported at the bottom of certificates/models.py; migrations stay in that app."""
import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


class CertificateWorkflow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT,
                              related_name="certificate_workflows")
    template_version = models.ForeignKey("certificates.CertificateTemplateVersion",
                                         on_delete=models.PROTECT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                   related_name="requested_certificate_workflows")
    generation_actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                         related_name="processing_certificate_workflows")
    publisher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                  null=True, blank=True,
                                  related_name="publishing_certificate_workflows")
    request_key = models.UUIDField()
    request_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=20, default="queued", choices=[
        (value, value.title()) for value in (
            "queued", "generating", "ready", "publishing", "published", "failed", "cancelled"
        )
    ])
    phase = models.CharField(max_length=20, default="generation",
                             choices=[("generation", "Generation"), ("publication", "Publication")])
    total = models.PositiveIntegerField()
    generated = models.PositiveIntegerField(default=0)
    published = models.PositiveIntegerField(default=0)
    # Batch IDs and exact draft review hashes approved by the owner.
    approval_manifest = models.JSONField(default=list, blank=True)
    approval_hash = models.CharField(max_length=64, blank=True, default="")
    error_message = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status", "updated_at"], name="cert_flow_queue_idx")]
        constraints = [
            models.UniqueConstraint(fields=["event", "request_key"], name="cert_flow_request_unique"),
            models.UniqueConstraint(fields=["event"], condition=Q(status__in=[
                "queued", "generating", "ready", "publishing", "failed"
            ]), name="cert_flow_unfinished_unique"),
            models.CheckConstraint(condition=Q(total__gte=1, generated__lte=F("total"),
                                               published__lte=F("generated")),
                                   name="cert_flow_counts_valid"),
            models.CheckConstraint(condition=Q(status__in=[
                "queued", "generating", "ready", "publishing", "published", "failed", "cancelled"
            ]), name="cert_flow_status_valid"),
            models.CheckConstraint(condition=Q(phase__in=["generation", "publication"]),
                                   name="cert_flow_phase_valid"),
        ]


class CertificateWorkflowBatch(models.Model):
    workflow = models.ForeignKey(CertificateWorkflow, on_delete=models.PROTECT, related_name="parts")
    number = models.PositiveIntegerField()
    batch = models.OneToOneField("certificates.CertificateBatch", on_delete=models.PROTECT)

    class Meta:
        ordering = ["number"]
        constraints = [models.UniqueConstraint(fields=["workflow", "number"],
                                                name="cert_flow_part_unique")]


class CertificateWorkflowRecipient(models.Model):
    workflow = models.ForeignKey(CertificateWorkflow, on_delete=models.PROTECT, related_name="recipients")
    registration = models.ForeignKey("events.Registration", on_delete=models.PROTECT)
    participant_name = models.CharField(max_length=200)
    certificate = models.OneToOneField("certificates.GeneratedCertificate", on_delete=models.PROTECT,
                                      null=True, blank=True)
    class Meta:
        ordering = ["registration_id"]
        constraints = [models.UniqueConstraint(fields=["workflow", "registration"],
                                               name="cert_flow_recipient_unique")]
