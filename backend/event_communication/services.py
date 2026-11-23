import hashlib
import json
from datetime import timedelta
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from events.models import Event
from events.staff_access import has_event_capability
from eventhub_notifications.services import record
from .models import Announcement, CommunicationHistory, Question


class Conflict(APIException):
    status_code = 409
    default_detail = "This item changed. Refresh the board before trying again."
    default_code = "communication_conflict"


class RateLimit(APIException):
    status_code = 429
    default_detail = "You have posted several questions recently. Please wait before asking another."


def manager(user, event):
    return has_event_capability(user, event, "edit_event")


def board_event(user, event_id, *, lock=False, manage=False):
    qs = Event.objects.select_for_update() if lock else Event.objects.all()
    event = get_object_or_404(qs, pk=event_id)
    if manage and not manager(user, event):
        raise NotFound("Event not found.")
    if event.status == "draft" and not manager(user, event):
        raise NotFound("Event not found.")
    return event


def request_hash(data):
    return hashlib.sha256(json.dumps({k: v for k, v in data.items() if k != "request_key"}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def audit(item, user, action, reason=""):
    fields = ["title", "body", "stage", "status", "pinned"] if isinstance(item, Announcement) else ["body", "answer", "visible"]
    CommunicationHistory.objects.create(event=item.event, actor=user, resource=item._meta.model_name,
        object_id=item.pk, revision=item.revision, action=action, reason=reason,
        snapshot={name: getattr(item, name) for name in fields})


def check_revision(item, data):
    if item.revision != data["revision"]:
        raise Conflict()


def require_fields(data, names):
    missing = [name for name in names if name not in data]
    if missing:
        raise ValidationError({name: "This field is required." for name in missing})


@transaction.atomic
def create_announcement(user, event_id, data):
    event = board_event(user, event_id, lock=True, manage=True)
    hashed = request_hash(data)
    old = Announcement.objects.filter(event=event, author=user, request_key=data["request_key"]).first()
    if old:
        if old.request_hash != hashed:
            raise Conflict("This request key was already used with different details.")
        return old, False
    item = Announcement.objects.create(event=event, author=user, request_hash=hashed, **data)
    audit(item, user, "created")
    return item, True


@transaction.atomic
def change_announcement(user, event_id, item_id, data):
    event = board_event(user, event_id, lock=True, manage=True)
    item = get_object_or_404(Announcement.objects.select_for_update(), pk=item_id, event=event)
    # Retrying the same publication must not fan out a second notification.
    if data["action"] == "publish" and item.status == "published" and data["revision"] == item.revision - 1:
        return item
    check_revision(item, data)
    action = data["action"]
    if item.status == "withdrawn":
        raise ValidationError("Withdrawn announcements cannot be republished. Create a corrected announcement.")
    if action == "edit":
        require_fields(data, ["title", "body", "stage", "pinned"])
        for name in ["title", "body", "stage", "pinned"]:
            setattr(item, name, data[name])
    elif action == "publish":
        if event.status not in ["published", "cancelled"]:
            raise ValidationError("Publish the event before releasing an announcement.")
        if item.status == "published":
            return item
        item.status = "published"
        item.published_at = timezone.now()
    else:
        require_fields(data, ["reason"])
        item.status = "withdrawn"
    item.revision += 1
    item.save()
    audit(item, user, action, data.get("reason", ""))
    if action == "publish":
        record("event_announcement", f"announcement:{item.pk}", event=event, audience="registered", data={
            "announcement_id": item.pk, "title": "New event announcement", "body": f"There is a new update for {event.title}.",
            "href": f"/events/{event.pk}#event-community"})
    return item


@transaction.atomic
def create_question(user, event_id, data):
    event = board_event(user, event_id, lock=True)
    if event.status != "published":
        raise ValidationError("Questions are available for published events. Cancelled events remain readable.")
    hashed = request_hash(data)
    old = Question.objects.filter(event=event, author=user, request_key=data["request_key"]).first()
    if old:
        if old.request_hash != hashed:
            raise Conflict("This request key was already used with different details.")
        return old, False
    if Question.objects.filter(event=event, author=user, created_at__gte=timezone.now() - timedelta(hours=1)).count() >= 10:
        raise RateLimit()
    item = Question.objects.create(event=event, author=user, request_hash=hashed, **data)
    audit(item, user, "created")
    record("event_question", f"question:{item.pk}", event=event, recipient=event.organizer, data={
        "question_id": item.pk, "title": "New event question", "body": f"A participant has a question about {event.title}.",
        "href": f"/organizer/events/{event.pk}/communication"})
    return item, True


@transaction.atomic
def change_question(user, event_id, item_id, data):
    event = board_event(user, event_id, lock=True)
    item = get_object_or_404(Question.objects.select_for_update(), pk=item_id, event=event)
    manages = manager(user, event)
    owns = item.author_id == user.pk
    action = data["action"]
    if action in ["answer", "hide", "restore"] and not manages:
        raise NotFound("Question not found.")
    if action in ["edit", "withdraw"] and not owns:
        raise NotFound("Question not found.")
    check_revision(item, data)
    if action == "edit":
        require_fields(data, ["body"])
        if not item.visible or item.answer or event.status != "published":
            raise ValidationError("Only an unanswered visible question can be edited on a published event.")
        item.body = data["body"]
    elif action == "answer":
        require_fields(data, ["answer"])
        if not item.visible:
            raise ValidationError("Restore this question before answering it.")
        item.answer = data["answer"]
        item.answered_by = user
        item.answered_at = timezone.now()
    else:
        if action == "hide":
            require_fields(data, ["reason"])
        item.visible = action == "restore"
    item.revision += 1
    item.save()
    audit(item, user, action, data.get("reason", ""))
    if action == "answer" and item.author_id != user.pk:
        record("event_answer", f"question-answer:{item.pk}:{item.revision}", event=event, recipient=item.author, data={
            "question_id": item.pk, "title": "Your event question was answered", "body": f"The event team answered your question about {event.title}.",
            "href": f"/events/{event.pk}#event-community"})
    return item


def notification_is_current(intent):
    """Used by the existing outbox both during fan-out and immediately before delivery."""
    from events.models import Registration
    if intent.kind == "event_announcement":
        valid = Announcement.objects.filter(pk=intent.data.get("announcement_id"), event_id=intent.event_id,
            status="published", event__status__in=["published", "cancelled"]).exists()
        return valid and (not intent.recipient_id or Registration.objects.filter(event_id=intent.event_id,
            student_id=intent.recipient_id, status="registered").exists())
    question = Question.objects.select_related("event").filter(pk=intent.data.get("question_id"),
        event_id=intent.event_id, visible=True, event__status__in=["published", "cancelled"]).first()
    if not question:
        return False
    if intent.kind == "event_answer":
        return bool(question.answer and question.author_id == intent.recipient_id)
    return bool(intent.recipient and manager(intent.recipient, question.event))
