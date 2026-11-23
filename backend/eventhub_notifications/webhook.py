import hashlib
import hmac
import json
import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import NotificationDelivery, WhatsAppConnection, WhatsAppReceipt
from .providers import config, digest
from .services import preferences, record


@csrf_exempt
def whatsapp_webhook(request):
    c=config()
    if request.method=="GET":
        expected=c.get("WHATSAPP_VERIFY_TOKEN", "")
        if expected and request.GET.get("hub.mode")=="subscribe" and hmac.compare_digest(request.GET.get("hub.verify_token", ""),expected):
            return HttpResponse(request.GET.get("hub.challenge", ""),content_type="text/plain")
        return HttpResponse(status=403)
    if request.method!="POST": return HttpResponse(status=405)
    try:
        if int(request.META.get("CONTENT_LENGTH") or 0)>1024*1024: return HttpResponse(status=413)
    except ValueError:return HttpResponse(status=400)
    raw=request.body
    if len(raw)>1024*1024: return HttpResponse(status=413)
    secret=c.get("WHATSAPP_APP_SECRET", "")
    expected="sha256="+hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest()
    if not secret or not hmac.compare_digest(request.headers.get("X-Hub-Signature-256", ""),expected):
        return HttpResponse(status=403)
    try:
        payload=json.loads(raw)
        if not isinstance(payload,dict) or payload.get("object")!="whatsapp_business_account": return HttpResponse(status=400)
        for entry in payload.get("entry",[]):
            for change in entry.get("changes",[]):
                value=change.get("value",{})
                if str(value.get("metadata",{}).get("phone_number_id", ""))!=c.get("WHATSAPP_PHONE_NUMBER_ID", ""):
                    continue
                for message in value.get("messages",[]): process_message(message)
                for status in value.get("statuses",[]): process_status(status)
    except (ValueError,TypeError,AttributeError,KeyError):
        return HttpResponse(status=400)
    return JsonResponse({"received":True})


def process_message(message):
    if message.get("type")!="text": return
    match=re.fullmatch(r"CONNECT ([A-Z2-9]{12})",message.get("text",{}).get("body", "").strip())
    sender=str(message.get("from", ""))
    identifier=message.get("id")
    if not match or not identifier or not re.fullmatch(r"[1-9]\d{7,14}",sender): return
    candidate=WhatsAppConnection.objects.filter(token_hash=digest(match[1])).values("user_id").first()
    if not candidate:return
    with transaction.atomic():
        user=get_user_model().objects.select_for_update().get(pk=candidate["user_id"])
        link=WhatsAppConnection.objects.select_for_update().get(token_hash=digest(match[1]))
        if link.used_at or link.expires_at<=timezone.now() or not user.is_active or link.phone!="+"+sender:return
        pref=preferences(user)
        if pref.whatsapp_phone!=link.phone:return
        _,created=WhatsAppReceipt.objects.get_or_create(key=digest("message:"+identifier),defaults={"processed":True})
        if not created:return
        link.used_at=timezone.now();link.save(update_fields=["used_at"])
        pref.whatsapp_verified=True;pref.whatsapp_enabled=True;pref.whatsapp_consent_at=timezone.now()
        pref.preferred_channel="whatsapp";pref.save()
        record("whatsapp_connected",f"whatsapp-connected:{link.pk}",recipient=user,
               data={"title":"WhatsApp connected", "body":"Your verified number can receive registration and important event updates. You can turn this off in notification settings.","href":"/account/profile"})


def process_status(status):
    identifier=status.get("id", ""); state=status.get("status", "")
    if not identifier or state not in ["sent","delivered","read","failed"]:return
    key=digest(f"status:{identifier}:{state}:{status.get('timestamp','')}")
    WhatsAppReceipt.objects.get_or_create(key=key,defaults={"data":{
        "id":identifier,"status":state}})


def process_receipt_step():
    with transaction.atomic():
        receipt=WhatsAppReceipt.objects.select_for_update(skip_locked=True).filter(processed=False,
            next_attempt_at__lte=timezone.now()).order_by("pk").first()
        if receipt is None:return False
        identifier=receipt.data.get("id", "");state=receipt.data.get("status", "")
        delivery=NotificationDelivery.objects.select_for_update().filter(channel="whatsapp",provider_id=identifier).first()
        if delivery is None:
            receipt.processed=receipt.created_at<timezone.now()-timedelta(days=1)
            receipt.next_attempt_at=timezone.now()+timedelta(seconds=30)
            receipt.save(update_fields=["processed","next_attempt_at"])
            return True
        rank={"pending":0,"accepted":1,"failed":1,"delivered":2,"read":3}
        mapped={"sent":"accepted","delivered":"delivered","read":"read","failed":"failed"}[state]
        if rank[mapped]>=rank.get(delivery.status,0):
            delivery.status=mapped
            delivery.error_code="provider_delivery_failed" if state=="failed" else ""
            delivery.save(update_fields=["status","error_code"])
        receipt.processed=True;receipt.save(update_fields=["processed"])
        return True
