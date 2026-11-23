import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from .models import Notification, NotificationDelivery, NotificationEvent, NotificationPreferences, PushSubscription
from .providers import ProviderFailure, config, digest, push_ready, safe_href, send_push, send_whatsapp, whatsapp_ready

WHATSAPP_UTILITY = {"registration_confirmed", "event_changed", "event_cancelled", "event_reminder", "payment_confirmed", "refund_updated"}
SILENT = {"registration_activity", "registration_cancelled"}


def preferences(user):
    return NotificationPreferences.objects.get_or_create(user=user)[0]


def record(kind, key, *, event=None, recipient=None, audience="direct", data=None, coalesce=False):
    values = {"kind":kind, "event":event, "recipient":recipient, "audience":audience, "data":data or {}}
    if coalesce:
        return NotificationEvent.objects.update_or_create(key=key, defaults={**values, "done":False, "cursor":0})[0]
    return NotificationEvent.objects.get_or_create(key=key, defaults=values)[0]


def make_notification(intent, user):
    event = intent.event
    title = intent.data.get("title", "EventHub update")
    body = intent.data.get("body", "Open EventHub to see the update.")
    href = intent.data.get("href", "/")
    if intent.kind == "registration_activity":
        count = event.registrations.filter(status="registered").count()
        title = "Registration activity"
        body = f"{event.title} now has {count} active registration(s)."
        key = f"registration-summary:{event.pk}"
        notification, _ = Notification.objects.update_or_create(user=user, key=key, defaults={
            "kind":intent.kind, "title":title, "body":body[:500], "href":href, "is_read":False})
        return notification
    data = {**intent.data, "event_id":event.pk if event else None,
            "event_title":event.title if event else "", "first_name":user.first_name.strip() or user.username}
    notification, _ = Notification.objects.get_or_create(user=user, key=intent.key, defaults={
        "kind":intent.kind, "title":title[:180], "body":body[:500],
        "href":href if safe_href(href) else "/", "data":data})
    pref = preferences(user)
    if intent.kind in SILENT or (intent.kind == "event_reminder" and not pref.reminders):
        return notification
    if intent.kind == "promotion" and not pref.whatsapp_marketing:
        return notification
    whatsapp = (pref.preferred_channel == "whatsapp" and pref.whatsapp_enabled and pref.whatsapp_verified
        and whatsapp_ready() and config().get("WHATSAPP_TEMPLATES", {}).get(intent.kind)
        and (intent.kind in WHATSAPP_UTILITY or (intent.kind == "promotion" and pref.whatsapp_marketing
                                               and config().get("WHATSAPP_MARKETING_ENABLED"))))
    expires = timezone.now() + timedelta(days=2)
    if intent.kind == "event_reminder" and event:
        expires = event.start_datetime
    if whatsapp:
        NotificationDelivery.objects.get_or_create(notification=notification, channel="whatsapp",
            target_key=digest(pref.whatsapp_phone), defaults={"expires_at":expires})
    elif pref.push_enabled and push_ready():
        NotificationDelivery.objects.bulk_create([
            NotificationDelivery(notification=notification, channel="push", target_key=sub.endpoint_hash,
                subscription=sub, expires_at=expires)
            for sub in PushSubscription.objects.filter(user=user)
        ], ignore_conflicts=True)
    return notification


def recipients_for(intent):
    users = get_user_model().objects.filter(is_active=True)
    if intent.audience == "direct":
        return users.filter(pk=intent.recipient_id)
    if intent.audience == "registered":
        return users.filter(event_registrations__event_id=intent.event_id,
                            event_registrations__status="registered").distinct()
    if intent.audience == "discovery":
        return users.filter(notification_preferences__isnull=False).exclude(notification_preferences__event_categories=[])
    if intent.audience == "reviewers":
        return users.filter(is_staff=True)
    return users.none()


def intent_is_current(intent):
    if intent.kind in {"event_announcement", "event_question", "event_answer"}:
        from event_communication.services import notification_is_current
        return notification_is_current(intent)

    from events.models import Registration
    if (intent.audience in ["registered","discovery"] or intent.kind in ["event_reminder","registration_activity"]) and not intent.event_id:
        return False
    if intent.kind in ["event_changed", "event_cancelled", "event_reminder"] and intent.recipient_id:
        if not Registration.objects.filter(event_id=intent.event_id, student_id=intent.recipient_id, status="registered").exists():
            return False
    if intent.kind == "event_reminder":
        return (intent.event.status == "published" and intent.event.start_datetime > timezone.now()
                and intent.data.get("start") == intent.event.start_datetime.isoformat())
    if intent.kind == "registration_confirmed":
        return Registration.objects.filter(pk=intent.data.get("registration_id"), student_id=intent.recipient_id,
                                            status="registered").exists()
    if intent.kind == "certificate_ready":
        from certificates.models import GeneratedCertificate
        return GeneratedCertificate.objects.filter(pk=intent.data.get("certificate_id"), is_active=True,
            batch__status="published", registration__student_id=intent.recipient_id).exists()
    return True


def process_event_step():
    with transaction.atomic():
        intent = NotificationEvent.objects.select_for_update(skip_locked=True).filter(done=False).order_by("created_at", "pk").first()
        if intent is None:
            return False
        if not intent_is_current(intent):
            intent.done = True
            intent.save(update_fields=["done"])
            return True
        users = list(recipients_for(intent).filter(pk__gt=intent.cursor).order_by("pk")[:50])
        for user in users:
            if intent.kind == "event_reminder" and not preferences(user).reminders:
                continue
            if intent.kind == "registration_activity" and not user.groups.filter(name="Organizer").exists():
                continue
            if intent.kind == "workflow_update":
                from certificates.permissions import certificate_event_ids
                if not certificate_event_ids(user).filter(pk=intent.event_id).exists():
                    continue
            if intent.audience == "discovery" and intent.event.category not in preferences(user).event_categories:
                continue
            if intent.audience == "reviewers" and not user.has_perm("accounts.review_organizerapplication"):
                continue
            make_notification(intent, user)
        if users:
            intent.cursor = users[-1].pk
        intent.done = len(users) < 50
        intent.save(update_fields=["cursor", "done"])
        return True


def active_session(subscription):
    session = Session.objects.filter(session_key=subscription.session_key, expire_date__gt=timezone.now()).first()
    if not session:return False
    data=session.get_decoded()
    return (str(data.get("_auth_user_id")) == str(subscription.user_id)
            and hmac.compare_digest(data.get("_auth_user_hash", ""), subscription.user.get_session_auth_hash()))


def process_delivery_step():
    with transaction.atomic():
        delivery = NotificationDelivery.objects.select_for_update(skip_locked=True).filter(
            status="pending", next_attempt_at__lte=timezone.now()).order_by("next_attempt_at", "pk").first()
        if delivery is None:
            return False
        notification = delivery.notification
        pref = preferences(notification.user)
        if delivery.expires_at <= timezone.now() or not notification.user.is_active or notification.is_read:
            delivery.status, delivery.error_code = "skipped", "expired_or_inactive"
        elif notification.kind == "event_reminder" and not pref.reminders:
            delivery.status, delivery.error_code = "skipped", "opted_out"
        else:
            # Recheck business state as well as channel consent immediately before sending.
            intent = NotificationEvent(kind=notification.kind, recipient=notification.user, data=notification.data,
                event_id=notification.data.get("event_id"))
            if not intent_is_current(intent):
                delivery.status, delivery.error_code = "skipped", "no_longer_current"
            else:
                try:
                    delivery.attempts += 1
                    if delivery.channel == "push":
                        sub = delivery.subscription
                        if not sub or not pref.push_enabled or not active_session(sub) or not push_ready():
                            raise ProviderFailure("push_disabled_or_signed_out", False)
                        send_push(sub, notification)
                    else:
                        if (not pref.whatsapp_enabled or not pref.whatsapp_verified or not whatsapp_ready()
                            or not hmac.compare_digest(delivery.target_key, digest(pref.whatsapp_phone))):
                            raise ProviderFailure("whatsapp_disabled_or_changed", False)
                        if notification.kind == "promotion" and not (pref.whatsapp_marketing and config().get("WHATSAPP_MARKETING_ENABLED")):
                            raise ProviderFailure("marketing_not_authorized", False)
                        delivery.provider_id = send_whatsapp(pref.whatsapp_phone, notification)
                    delivery.status, delivery.error_code = "accepted", ""
                except ProviderFailure as error:
                    delivery.error_code = error.code[:80]
                    delivery.status = "pending" if error.retryable and delivery.attempts < 5 else "failed"
                    delivery.next_attempt_at = timezone.now() + timedelta(minutes=min(2 ** delivery.attempts, 60))
                    if error.code in ["push_404", "push_410"] and delivery.subscription_id:
                        delivery.subscription.delete()
                        delivery.subscription_id = None
                        delivery.status = "skipped"
                except Exception as error:
                    delivery.error_code = type(error).__name__[:80]
                    delivery.status = "failed"
        delivery.save()
        return True


def schedule_reminders():
    from events.models import Event
    now = timezone.now()
    for event in Event.objects.filter(status="published", start_datetime__gt=now,
                                       start_datetime__lte=now + timedelta(hours=24)).iterator(chunk_size=100):
        record("event_reminder", f"reminder:{event.pk}:{event.start_datetime.isoformat()}", event=event, audience="registered",
               data={"title":"Your event is coming up", "body":f"{event.title} starts within 24 hours. Check the venue and your ticket.",
                     "href":f"/events/{event.pk}", "start":event.start_datetime.isoformat()})


def enqueue_promotion(actor, event_id):
    """Integration hook for the later promotion editor; no public bulk-send API."""
    from events.models import Event
    from rest_framework.exceptions import PermissionDenied
    event = Event.objects.get(pk=event_id)
    if not actor.is_active or event.organizer_id != actor.pk or not actor.groups.filter(name="Organizer").exists():
        raise PermissionDenied("Only the event owner can promote the event.")
    if event.status != "published":
        raise PermissionDenied("Publish the event before promoting it.")
    return record("promotion", f"promotion:{event.pk}:{secrets.token_hex(12)}", event=event, audience="discovery",
                  data={"title":"An event you may like", "body":f"Explore {event.title} on EventHub.", "href":f"/events/{event.pk}"})
