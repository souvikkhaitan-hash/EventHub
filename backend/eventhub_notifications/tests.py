import base64
import hashlib
import hmac
import json
import re
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db import transaction
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from events.models import Event, Registration
from .models import Notification, NotificationDelivery, NotificationEvent, NotificationPreferences, PushSubscription, WhatsAppConnection
from .providers import ProviderFailure, digest, validate_endpoint, validate_push_keys
from .services import preferences, process_delivery_step, process_event_step, record, schedule_reminders
from .webhook import process_receipt_step

CFG={"VAPID_PUBLIC_KEY":"test-public", "VAPID_PRIVATE_KEY":"test-private", "VAPID_SUBJECT":"mailto:test@example.com",
     "WHATSAPP_ENABLED":True,"WHATSAPP_ACCESS_TOKEN":"test-token","WHATSAPP_APP_SECRET":"test-app-secret",
     "WHATSAPP_VERIFY_TOKEN":"test-verify", "WHATSAPP_API_VERSION":"v99.0","WHATSAPP_PHONE_NUMBER_ID":"12345",
     "WHATSAPP_BUSINESS_NUMBER":"919876543210", "WHATSAPP_TEMPLATES":{"registration_confirmed":"eventhub_registration_confirmed",
        "event_changed":"eventhub_event_changed","event_cancelled":"eventhub_event_cancelled","event_reminder":"eventhub_event_reminder"}}


@override_settings(EVENTHUB_NOTIFICATIONS=CFG)
class NotificationTests(TestCase):
    def setUp(self):
        cache=override_settings(CACHES={"default":{"BACKEND":"django.core.cache.backends.locmem.LocMemCache", "LOCATION":uuid.uuid4().hex}})
        cache.enable();self.addCleanup(cache.disable)
        User=get_user_model()
        self.user=User.objects.create_user(username="notice_student",email="student@example.com",first_name="Student")
        self.other=User.objects.create_user(username="notice_other",email="other@example.com")
        self.owner=User.objects.create_user(username="notice_owner",email="owner@example.com")
        group,_=Group.objects.get_or_create(name="Organizer");self.owner.groups.add(group)
        self.event=Event.objects.create(title="Notice Workshop",description="Test",category="workshop",venue="Lab",
            start_datetime=timezone.now()+timedelta(hours=2),end_datetime=timezone.now()+timedelta(hours=3),
            registration_deadline=timezone.now()+timedelta(hours=1),capacity=100,status="published",organizer=self.owner)
        self.client=APIClient();self.client.force_login(self.user)
        NotificationEvent.objects.all().delete()

    def drain(self):
        for _ in range(100):
            if not process_event_step():return
        self.fail("Notification queue did not drain.")

    def registration(self):return Registration.objects.create(event=self.event,student=self.user)

    def sub(self,user=None):
        return PushSubscription.objects.create(user=user or self.user,session_key=self.client.session.session_key,
            endpoint="https://fcm.googleapis.com/test-endpoint",endpoint_hash=digest("https://fcm.googleapis.com/test-endpoint"),keys={})

    def connect(self):
        response=self.client.post(reverse("eventhub-whatsapp-connect"),{"phone":"+919999999999","consent":True},format="json")
        self.assertEqual(response.status_code,200,response.data)
        from urllib.parse import parse_qs,urlsplit
        text=parse_qs(urlsplit(response.data["url"]).query)["text"][0]
        return text

    def webhook(self,*,text=None,phone="919999999999",status=None,identifier="inbound-one",signed=True):
        value={"metadata":{"phone_number_id":"12345"}}
        if text:value["messages"]=[{"id":identifier,"from":phone,"type":"text","text":{"body":text}}]
        if status:value["statuses"]=[status]
        body=json.dumps({"object":"whatsapp_business_account","entry":[{"changes":[{"value":value}]}]}).encode()
        signature="sha256="+hmac.new(CFG["WHATSAPP_APP_SECRET"].encode(),body,hashlib.sha256).hexdigest() if signed else "sha256=bad"
        return self.client.post(reverse("eventhub-whatsapp-webhook"),body,content_type="application/json",HTTP_X_HUB_SIGNATURE_256=signature)

    def test_registration_creates_inbox_and_one_owner_summary(self):
        self.registration();self.drain()
        self.assertTrue(Notification.objects.filter(user=self.user,kind="registration_confirmed").exists())
        self.assertEqual(Notification.objects.filter(user=self.owner,kind="registration_activity").count(),1)
        self.assertFalse(NotificationDelivery.objects.filter(notification__user=self.owner).exists())

    def test_registration_summary_coalesces(self):
        self.registration();self.drain()
        Registration.objects.create(event=self.event,student=self.other);self.drain()
        self.assertEqual(Notification.objects.filter(user=self.owner,kind="registration_activity").count(),1)
        self.assertIn("2 active",Notification.objects.get(user=self.owner,kind="registration_activity").body)

    def test_rollback_does_not_leave_notification_intent(self):
        try:
            with transaction.atomic():self.registration();raise RuntimeError("rollback")
        except RuntimeError:pass
        self.assertFalse(NotificationEvent.objects.exists())

    def test_inbox_is_private_and_cross_user_read_is_denied(self):
        self.registration();self.drain()
        result=self.client.get(reverse("eventhub-notifications"))
        self.assertEqual(result.status_code,200);self.assertIn("no-store",result["Cache-Control"])
        own_ids={row["id"] for row in result.data["results"]}
        other=Notification.objects.get(user=self.owner,kind="registration_activity")
        self.assertNotIn(str(other.pk),own_ids)
        self.assertEqual(self.client.post(reverse("eventhub-notification-read",args=[other.pk]),{},format="json").status_code,404)

    def test_read_all_does_not_mark_other_users_notifications(self):
        self.registration();self.drain()
        response=self.client.post(reverse("eventhub-notifications"),{"action":"read_all"},format="json")
        self.assertEqual(response.status_code,200)
        self.assertFalse(Notification.objects.filter(user=self.user,is_read=False).exists())
        self.assertTrue(Notification.objects.filter(user=self.owner,is_read=False).exists())

    def test_session_mutation_requires_csrf(self):
        client=APIClient(enforce_csrf_checks=True);client.force_login(self.user)
        result=client.patch(reverse("eventhub-notification-preferences"),{"reminders":False},format="json")
        self.assertEqual(result.status_code,403)

    def test_no_credentials_does_not_break_website_inbox(self):
        with override_settings(EVENTHUB_NOTIFICATIONS={}):
            self.registration();self.drain()
        self.assertTrue(Notification.objects.filter(user=self.user).exists())
        self.assertFalse(NotificationDelivery.objects.exists())

    def test_new_event_only_notifies_followed_categories(self):
        pref=preferences(self.user);pref.event_categories=["workshop"];pref.save()
        self.event.status="draft";self.event.save()
        self.event.status="published";self.event.save();self.drain()
        self.assertEqual(Notification.objects.filter(kind="new_event",user=self.user).count(),1)
        self.assertFalse(Notification.objects.filter(kind="new_event",user=self.other).exists())

    def test_changed_event_targets_registered_participants(self):
        self.registration();self.event.venue="Another lab";self.event.save();self.drain()
        self.assertTrue(Notification.objects.filter(kind="event_changed",user=self.user).exists())
        self.assertFalse(Notification.objects.filter(kind="event_changed",user=self.other).exists())

    def test_reminders_are_idempotent_and_respect_opt_out(self):
        self.registration();pref=preferences(self.user);pref.reminders=False;pref.save()
        schedule_reminders();schedule_reminders();self.drain()
        self.assertEqual(NotificationEvent.objects.filter(kind="event_reminder").count(),1)
        self.assertFalse(Notification.objects.filter(kind="event_reminder",user=self.user).exists())

    def test_push_endpoint_rejects_ssrf_targets(self):
        for endpoint in ["http://fcm.googleapis.com/a","https://127.0.0.1/a","https://fcm.googleapis.com.evil.example/a","https://user@fcm.googleapis.com/a"]:
            with self.assertRaises(ValidationError):validate_endpoint(endpoint)
        self.assertEqual(validate_endpoint("https://web.push.apple.com/a"),"https://web.push.apple.com/a")

    def test_push_keys_are_checked(self):
        with self.assertRaises(ValidationError):validate_push_keys({"p256dh":"bad","auth":"bad"})

    def test_push_send_uses_queued_delivery(self):
        self.sub();self.registration();self.drain()
        with patch("eventhub_notifications.services.send_push") as send:
            self.assertTrue(process_delivery_step())
        send.assert_called_once()
        self.assertEqual(NotificationDelivery.objects.get(channel="push").status,"accepted")

    def test_logout_detaches_only_this_sessions_device(self):
        self.sub();self.client.logout()
        self.assertFalse(PushSubscription.objects.filter(user=self.user).exists())

    def test_password_change_invalidates_old_push_session(self):
        self.sub();self.registration();self.drain()
        self.user.set_password("new-test-password");self.user.save()
        with patch("eventhub_notifications.services.send_push") as send:process_delivery_step()
        send.assert_not_called()

    def test_expired_push_subscription_is_removed(self):
        self.sub();self.registration();self.drain()
        with patch("eventhub_notifications.services.send_push",side_effect=ProviderFailure("push_410",False)):process_delivery_step()
        self.assertFalse(PushSubscription.objects.exists())

    def test_whatsapp_cannot_be_enabled_by_forging_verified_field(self):
        response=self.client.patch(reverse("eventhub-notification-preferences"),{"whatsapp_verified":True},format="json")
        self.assertEqual(response.status_code,400)
        response=self.client.patch(reverse("eventhub-notification-preferences"),{"whatsapp_enabled":True},format="json")
        self.assertEqual(response.status_code,400)

    def test_signed_incoming_message_verifies_ownership_and_opt_in(self):
        text=self.connect();self.assertEqual(self.webhook(text=text).status_code,200)
        pref=preferences(self.user);pref.refresh_from_db()
        self.assertTrue(pref.whatsapp_verified);self.assertTrue(pref.whatsapp_enabled)
        self.assertFalse(pref.whatsapp_marketing)
        self.assertIsNotNone(pref.whatsapp_consent_at)

    def test_unsigned_message_cannot_connect_number(self):
        text=self.connect();self.assertEqual(self.webhook(text=text,signed=False).status_code,403)
        self.assertFalse(preferences(self.user).whatsapp_verified)

    def test_different_sender_cannot_use_connect_code(self):
        text=self.connect();self.webhook(text=text,phone="918888888888")
        self.assertFalse(preferences(self.user).whatsapp_verified)

    def test_expired_connect_code_cannot_verify(self):
        text=self.connect();WhatsAppConnection.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
        self.webhook(text=text);self.assertFalse(preferences(self.user).whatsapp_verified)

    def test_validated_whatsapp_is_preferred_without_duplicate_push(self):
        self.webhook(text=self.connect());self.sub();self.registration();self.drain()
        deliveries=NotificationDelivery.objects.filter(notification__kind="registration_confirmed")
        self.assertEqual(list(deliveries.values_list("channel",flat=True)),["whatsapp"])
        with patch("eventhub_notifications.services.send_whatsapp",return_value="wamid.test") as send:
            while process_delivery_step():pass
        send.assert_called_once()

    def test_certificate_notifications_do_not_use_whatsapp(self):
        self.webhook(text=self.connect());self.sub()
        record("certificate_status","status:test",recipient=self.user,data={"title":"Certificate status changed","href":"/my-registrations"})
        self.drain()
        self.assertFalse(NotificationDelivery.objects.filter(channel="whatsapp").exists())
        self.assertTrue(NotificationDelivery.objects.filter(channel="push").exists())

    def test_whatsapp_opt_out_is_rechecked_before_sending(self):
        self.webhook(text=self.connect());self.registration();self.drain()
        NotificationPreferences.objects.filter(user=self.user).update(whatsapp_enabled=False)
        with patch("eventhub_notifications.services.send_whatsapp") as send:process_delivery_step()
        send.assert_not_called()

    def test_signed_webhook_replay_does_not_duplicate_connection(self):
        text=self.connect();self.webhook(text=text);self.webhook(text=text)
        self.assertEqual(NotificationEvent.objects.filter(kind="whatsapp_connected").count(),1)

    def test_early_delivery_receipt_is_persisted_until_send_commit(self):
        self.webhook(status={"id":"wamid.early","status":"delivered","timestamp":"1"})
        process_receipt_step()
        notification=Notification.objects.create(user=self.user,key="early",kind="event_changed",title="Update",body="",href="/")
        delivery=NotificationDelivery.objects.create(notification=notification,channel="whatsapp",target_key="x",provider_id="wamid.early",status="accepted",expires_at=timezone.now()+timedelta(days=1))
        from .models import WhatsAppReceipt
        WhatsAppReceipt.objects.update(next_attempt_at=timezone.now())
        process_receipt_step();delivery.refresh_from_db();self.assertEqual(delivery.status,"delivered")

    def test_status_receipts_never_downgrade_read_to_delivered(self):
        notification=Notification.objects.create(user=self.user,key="read",kind="event_changed",title="Update",body="",href="/")
        delivery=NotificationDelivery.objects.create(notification=notification,channel="whatsapp",target_key="x",provider_id="wamid.read",status="accepted",expires_at=timezone.now()+timedelta(days=1))
        self.webhook(status={"id":"wamid.read","status":"read","timestamp":"2"});process_receipt_step()
        self.webhook(status={"id":"wamid.read","status":"delivered","timestamp":"1"});process_receipt_step()
        delivery.refresh_from_db();self.assertEqual(delivery.status,"read")

    def test_provider_failure_does_not_remove_website_notification(self):
        self.webhook(text=self.connect());self.registration();self.drain()
        with patch("eventhub_notifications.services.send_whatsapp",side_effect=ProviderFailure("whatsapp_429",True)):process_delivery_step()
        self.assertTrue(Notification.objects.filter(user=self.user,kind="registration_confirmed").exists())
        self.assertEqual(NotificationDelivery.objects.filter(status="pending",attempts=1).count(),1)

    def test_outdated_registration_confirmation_is_not_sent(self):
        registration=self.registration();registration.status="cancelled";registration.save();self.drain()
        self.assertFalse(Notification.objects.filter(kind="registration_confirmed",user=self.user).exists())

    def test_configuration_never_returns_provider_secrets(self):
        result=self.client.get(reverse("eventhub-notification-config"))
        text=json.dumps(result.data)
        self.assertNotIn(CFG["WHATSAPP_ACCESS_TOKEN"],text)
        self.assertNotIn(CFG["WHATSAPP_APP_SECRET"],text)
        self.assertNotIn(CFG["VAPID_PRIVATE_KEY"],text)

    def test_real_webpush_encryption_with_generated_der_key(self):
        from types import SimpleNamespace
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from requests import Response
        from .providers import NoRedirectSession,send_push
        encode=lambda value:base64.urlsafe_b64encode(value).decode().rstrip("=")
        vapid=ec.generate_private_key(ec.SECP256R1())
        private=vapid.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
        browser=ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
        subscription=SimpleNamespace(endpoint="https://fcm.googleapis.com/test-endpoint",keys={"p256dh":encode(browser),"auth":encode(b"a"*16)})
        notification=SimpleNamespace(kind="event_changed",href="/events/1",pk=uuid.uuid4())
        response=Response();response.status_code=201;response._content=b""
        with override_settings(EVENTHUB_NOTIFICATIONS={**CFG,"VAPID_PRIVATE_KEY":encode(private)}),patch.object(NoRedirectSession,"post",return_value=response) as post:
            send_push(subscription,notification)
        self.assertTrue(post.called)
        self.assertIn("Authorization",post.call_args.kwargs["headers"])

    def test_whatsapp_payload_uses_approved_template_not_free_text(self):
        from types import SimpleNamespace
        from .providers import send_whatsapp
        notification=SimpleNamespace(kind="registration_confirmed",href="/my-registrations",data={"first_name":"Student","event_title":"Workshop"})
        with patch("eventhub_notifications.providers.requests.post") as post:
            post.return_value.status_code=200;post.return_value.json.return_value={"messages":[{"id":"wamid.accepted"}]}
            self.assertEqual(send_whatsapp("+919999999999",notification),"wamid.accepted")
        data=post.call_args.kwargs["json"]
        self.assertEqual(data["type"],"template")
        self.assertEqual(data["template"]["name"],"eventhub_registration_confirmed")
        self.assertEqual(data["template"]["components"][1]["parameters"][0]["text"],"my-registrations")
        self.assertFalse(post.call_args.kwargs["allow_redirects"])

    def test_disconnect_prevents_pending_whatsapp_delivery(self):
        self.webhook(text=self.connect());self.registration();self.drain()
        self.assertEqual(self.client.delete(reverse("eventhub-whatsapp-connect"),{},format="json").status_code,200)
        with patch("eventhub_notifications.services.send_whatsapp") as send:process_delivery_step()
        send.assert_not_called()

    def test_promotional_whatsapp_is_off_without_separate_opt_in(self):
        self.webhook(text=self.connect())
        pref=preferences(self.user);pref.event_categories=["workshop"];pref.save()
        from .services import enqueue_promotion
        with override_settings(EVENTHUB_NOTIFICATIONS={**CFG,"WHATSAPP_MARKETING_ENABLED":True,"WHATSAPP_TEMPLATES":{**CFG["WHATSAPP_TEMPLATES"],"promotion":"eventhub_promotion"}}):
            enqueue_promotion(self.owner,self.event.pk);self.drain()
        self.assertFalse(NotificationDelivery.objects.filter(channel="whatsapp",notification__kind="promotion").exists())

    def test_read_inbox_item_suppresses_queued_external_alert(self):
        self.webhook(text=self.connect());self.registration();self.drain()
        Notification.objects.filter(user=self.user,kind="registration_confirmed").update(is_read=True)
        with patch("eventhub_notifications.services.send_whatsapp") as send:
            process_delivery_step()
        send.assert_not_called()
        self.assertEqual(NotificationDelivery.objects.get(channel="whatsapp").status,"skipped")

    def test_cancelled_registration_suppresses_queued_event_update(self):
        registration=self.registration();self.drain()
        NotificationDelivery.objects.all().delete()
        self.webhook(text=self.connect())
        self.event.venue="New Lab";self.event.save();self.drain()
        Registration.objects.filter(pk=registration.pk).update(status="cancelled")
        with patch("eventhub_notifications.services.send_whatsapp") as send:
            process_delivery_step()
        send.assert_not_called()
        self.assertEqual(NotificationDelivery.objects.get(channel="whatsapp",notification__kind="event_changed").status,"skipped")
