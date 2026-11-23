import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class NotificationPreferences(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                               related_name="notification_preferences")
    push_enabled = models.BooleanField(default=True)
    reminders = models.BooleanField(default=True)
    event_categories = models.JSONField(default=list, blank=True)
    preferred_channel = models.CharField(max_length=12, default="push", choices=[("push", "Push"), ("whatsapp", "WhatsApp")])
    whatsapp_phone = models.CharField(max_length=16, blank=True, default="")
    whatsapp_verified = models.BooleanField(default=False)
    whatsapp_enabled = models.BooleanField(default=False)
    whatsapp_consent_at = models.DateTimeField(null=True, blank=True)
    whatsapp_marketing = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)


class PushSubscription(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    session_key = models.CharField(max_length=40)
    endpoint = models.TextField()
    endpoint_hash = models.CharField(max_length=64, unique=True)
    keys = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)


class NotificationEvent(models.Model):
    """Durable fan-out intent, written inside the business transaction."""
    key = models.CharField(max_length=160, unique=True)
    kind = models.CharField(max_length=50)
    event = models.ForeignKey("events.Event", on_delete=models.SET_NULL, null=True, blank=True)
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True)
    audience = models.CharField(max_length=20, default="direct")
    data = models.JSONField(default=dict)
    cursor = models.PositiveBigIntegerField(default=0)
    done = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["done", "created_at"], name="eh_notice_event_idx")]


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="eventhub_notifications")
    key = models.CharField(max_length=160)
    kind = models.CharField(max_length=50)
    title = models.CharField(max_length=180)
    body = models.CharField(max_length=500)
    href = models.CharField(max_length=500, default="/")
    data = models.JSONField(default=dict)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="eh_notice_user_key")]
        indexes = [models.Index(fields=["user", "is_read", "updated_at"], name="eh_notice_inbox_idx")]


class NotificationDelivery(models.Model):
    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name="deliveries")
    channel = models.CharField(max_length=12, choices=[("push", "Push"), ("whatsapp", "WhatsApp")])
    target_key = models.CharField(max_length=64)
    subscription = models.ForeignKey(PushSubscription, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=16, default="pending", choices=[(value, value.title()) for value in
        ["pending", "accepted", "delivered", "read", "failed", "skipped"]])
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    provider_id = models.CharField(max_length=200, blank=True, default="", db_index=True)
    error_code = models.CharField(max_length=80, blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["notification", "channel", "target_key"], name="eh_notice_delivery_unique")]
        indexes = [models.Index(fields=["status", "next_attempt_at"], name="eh_notice_delivery_idx")]


class WhatsAppConnection(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    phone = models.CharField(max_length=16)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class WhatsAppReceipt(models.Model):
    key = models.CharField(max_length=64, unique=True)
    data = models.JSONField(default=dict)
    processed = models.BooleanField(default=False)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
