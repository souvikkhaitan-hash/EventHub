import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q


class Announcement(models.Model):
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT, related_name="announcements")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_key = models.UUIDField(default=uuid.uuid4)
    request_hash = models.CharField(max_length=64)
    title = models.CharField(max_length=160)
    body = models.TextField(max_length=5000)
    stage = models.CharField(max_length=12, default="general", choices=[(x, x.title()) for x in ["general", "before", "during", "after"]])
    status = models.CharField(max_length=12, default="draft", choices=[(x, x.title()) for x in ["draft", "published", "withdrawn"]])
    pinned = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=1)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "author", "request_key"], name="ec_announcement_request"),
            models.CheckConstraint(condition=Q(revision__gte=1), name="ec_announcement_revision"),
            models.CheckConstraint(condition=Q(status__in=["draft", "published", "withdrawn"]), name="ec_announcement_status"),
            models.CheckConstraint(condition=Q(stage__in=["general", "before", "during", "after"]), name="ec_announcement_stage"),
        ]
        indexes = [models.Index(fields=["event", "status", "-published_at"], name="ec_announcement_feed")]


class Question(models.Model):
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT, related_name="questions")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="event_questions")
    request_key = models.UUIDField(default=uuid.uuid4)
    request_hash = models.CharField(max_length=64)
    body = models.TextField(max_length=1500)
    answer = models.TextField(max_length=5000, blank=True, default="")
    answered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="event_answers")
    answered_at = models.DateTimeField(null=True, blank=True)
    visible = models.BooleanField(default=True)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "author", "request_key"], name="ec_question_request"),
            models.CheckConstraint(condition=Q(revision__gte=1), name="ec_question_revision"),
        ]
        indexes = [models.Index(fields=["event", "visible", "-created_at"], name="ec_question_feed")]


class CommunicationHistory(models.Model):
    """Private audit history; never exposed in the public board API."""
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    resource = models.CharField(max_length=20)
    object_id = models.PositiveBigIntegerField()
    revision = models.PositiveIntegerField()
    action = models.CharField(max_length=30)
    reason = models.CharField(max_length=300, blank=True, default="")
    snapshot = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["resource", "object_id", "revision"], name="ec_history_revision")]
