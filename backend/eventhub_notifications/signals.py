"""Record intents in the SAME transaction as the domain change; no network IO here."""
import uuid
from django.apps import apps
from django.conf import settings
from django.contrib.auth.signals import user_logged_out
from django.db.models.signals import post_save, pre_save

from .models import PushSubscription
from .services import record


def before_save(sender, instance, raw=False, **kwargs):
    if raw or not instance.pk:
        instance._eh_notice_before = None
        return
    names = {"Event": ["status", "venue", "start_datetime", "end_datetime"],
             "Registration": ["status"], "GeneratedCertificate": ["is_active"],
             "CertificateWorkflow": ["status"], "EventStaffMembership": ["is_active", "role"]}.get(sender.__name__, [])
    instance._eh_notice_before = sender.objects.filter(pk=instance.pk).values(*names).first() if names else None


def after_save(sender, instance, created=False, raw=False, **kwargs):
    if raw:
        return
    old = getattr(instance, "_eh_notice_before", None) or {}
    model = sender.__name__
    transition_key = uuid.uuid4().hex
    if model == "Event":
        event = instance
        if event.status == "published" and old.get("status") != "published":
            record("new_event", f"event-published:{event.pk}:{transition_key}", event=event, audience="discovery",
                   data={"title":"New event published", "body":f"Explore {event.title} on EventHub.", "href":f"/events/{event.pk}"})
        elif event.status == "cancelled" and old.get("status") == "published":
            record("event_cancelled", f"event-cancelled:{event.pk}:{transition_key}", event=event, audience="registered",
                   data={"title":"Event cancelled", "body":f"{event.title} has been cancelled. Open the event for details.", "href":f"/events/{event.pk}"})
        elif event.status == "published" and old.get("status") == "published" and any(
            old.get(field) != getattr(event, field) for field in ["venue", "start_datetime", "end_datetime"]):
            record("event_changed", f"event-changed:{event.pk}:{transition_key}", event=event, audience="registered",
                   data={"title":"Important event update", "body":f"The schedule or venue for {event.title} changed. Check the latest details.", "href":f"/events/{event.pk}"})
    elif model == "Registration":
        if instance.status == "registered" and old.get("status") != "registered":
            record("registration_confirmed", f"registration:{instance.pk}:{transition_key}", event=instance.event,
                   recipient=instance.student, data={"title":"Registration confirmed", "body":f"You are registered for {instance.event.title}. Your ticket is in My Registrations.",
                   "href":"/my-registrations", "registration_id":instance.pk})
            record("registration_activity", f"registration-summary:{instance.event_id}", event=instance.event,
                   recipient=instance.event.organizer, coalesce=True,
                   data={"href":f"/organizer/events/{instance.event_id}/participants"})
        elif instance.status == "cancelled" and old.get("status") == "registered":
            record("registration_cancelled", f"registration-cancelled:{instance.pk}:{transition_key}", event=instance.event,
                   recipient=instance.student, data={"title":"Registration cancelled", "body":f"Your registration for {instance.event.title} was cancelled.", "href":"/my-registrations"})
    elif model == "GeneratedCertificate":
        if instance.is_active and not old.get("is_active"):
            record("certificate_ready", f"certificate-ready:{instance.pk}", event=instance.registration.event,
                   recipient=instance.registration.student,
                   data={"title":"Your certificate is ready", "body":f"Your certificate for {instance.registration.event.title} is available in My Registrations.",
                         "href":"/my-registrations", "certificate_id":str(instance.pk)})
        elif not instance.is_active and old.get("is_active"):
            record("certificate_status", f"certificate-status:{instance.pk}:{transition_key}", event=instance.registration.event,
                   recipient=instance.registration.student, data={"title":"Certificate status changed", "body":"A certificate was withdrawn or needs correction. Contact the event organiser for details.", "href":"/my-registrations"})
    elif model == "CertificateWorkflow" and instance.status != old.get("status") and instance.status in ["ready", "published", "failed"]:
        messages = {"ready":("Certificates ready for review", "The certificate drafts are ready for the event owner's review."),
                    "published":("Certificate publication complete", f"{instance.published} certificates were published to student accounts."),
                    "failed":("Certificate run needs attention", "Open the certificate workspace to review the issue and continue saved work.")}
        title, body = messages[instance.status]
        for user_id in {instance.event.organizer_id, instance.created_by_id}:
            from django.contrib.auth import get_user_model
            user = get_user_model().objects.get(pk=user_id)
            record("workflow_update", f"workflow:{instance.pk}:{instance.status}:{instance.generated}:{instance.published}:{user_id}",
                   event=instance.event, recipient=user, data={"title":title,"body":body,"href":f"/organizer/events/{instance.event_id}/certificates"})
    elif model == "EventStaffMembership" and (created or old.get("role") != instance.role or old.get("is_active") != instance.is_active):
        record("staff_access", f"staff:{instance.pk}:{transition_key}", event=instance.event, recipient=instance.user,
               data={"title":"Event team access updated", "body":"Your event team assignment changed. Open your workspace to check current access.", "href":"/organizer/workspace"})
    elif model == "OrganizerApplicationHistory" and created:
        application = instance.application
        action = str(instance.action)
        if "submit" in action:
            record("organizer_application", f"organizer-review:{instance.pk}", audience="reviewers",
                   data={"title":"Organiser application needs review", "body":"A new or updated organiser application is ready for review.",
                         "href":getattr(settings,"EVENTHUB_ADMIN_REVIEW_PATH","/admin/applications")})
        else:
            record("organizer_decision", f"organizer-decision:{instance.pk}", recipient=application.user,
                   data={"title":"Your organiser application was updated", "body":"Open your application to see its status and any feedback.", "href":"/become-organizer"})


def detach_on_logout(sender, request, user, **kwargs):
    if request is not None and user is not None and request.session.session_key:
        PushSubscription.objects.filter(user=user, session_key=request.session.session_key).delete()


for label in ["events.Event", "events.Registration", "events.EventStaffMembership", "certificates.GeneratedCertificate",
              "certificates.CertificateWorkflow", "accounts.OrganizerApplicationHistory"]:
    try:
        model = apps.get_model(label)
    except LookupError:
        continue
    pre_save.connect(before_save, sender=model, dispatch_uid=("eh-notice-before", label))
    post_save.connect(after_save, sender=model, dispatch_uid=("eh-notice-after", label))
user_logged_out.connect(detach_on_logout, dispatch_uid="eh-notice-logout")
