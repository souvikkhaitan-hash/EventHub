"""Provider adapters. No credentials or raw responses enter user-facing errors."""
import base64
import hashlib
import json
import re
from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core.exceptions import ValidationError


def config():
    return getattr(settings, "EVENTHUB_NOTIFICATIONS", {})


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def safe_href(value):
    return isinstance(value, str) and value.startswith("/") and not value.startswith("//") and "\\" not in value and not any(ord(c) < 32 for c in value)


def validate_endpoint(endpoint):
    parsed = urlsplit(endpoint)
    allowed = config().get("PUSH_ALLOWED_HOSTS", [
        "fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "notify.windows.com",
    ])
    host = (parsed.hostname or "").lower()
    try:
        port = parsed.port
    except ValueError:
        raise ValidationError("Invalid push endpoint.") from None
    if (parsed.scheme != "https" or parsed.username or parsed.password or port not in [None, 443]
        or parsed.fragment or not any(host == value or host.endswith("." + value) for value in allowed)):
        raise ValidationError("This push service is not supported.")
    return endpoint


def validate_push_keys(keys):
    if not isinstance(keys, dict) or set(keys) != {"p256dh", "auth"}:
        raise ValidationError("Invalid push encryption keys.")
    try:
        public = base64.urlsafe_b64decode(keys["p256dh"] + "=" * (-len(keys["p256dh"]) % 4))
        auth = base64.urlsafe_b64decode(keys["auth"] + "=" * (-len(keys["auth"]) % 4))
        if len(public) != 65 or public[0] != 4 or len(auth) != 16:
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise ValidationError("Invalid push encryption keys.") from None
    return keys


def push_ready():
    return bool(config().get("VAPID_PUBLIC_KEY") and config().get("VAPID_PRIVATE_KEY") and config().get("VAPID_SUBJECT"))


def whatsapp_ready():
    c = config()
    return bool(c.get("WHATSAPP_ENABLED") and c.get("WHATSAPP_ACCESS_TOKEN") and c.get("WHATSAPP_APP_SECRET") and c.get("WHATSAPP_VERIFY_TOKEN")
                and re.fullmatch(r"v\d+\.\d+", c.get("WHATSAPP_API_VERSION", ""))
                and re.fullmatch(r"\d+", c.get("WHATSAPP_PHONE_NUMBER_ID", ""))
                and re.fullmatch(r"\d{8,15}", c.get("WHATSAPP_BUSINESS_NUMBER", "")))


class ProviderFailure(Exception):
    def __init__(self, code, retryable=True):
        self.code = code
        self.retryable = retryable
        super().__init__(code)


class NoRedirectSession(requests.Session):
    def request(self, *args, **kwargs):
        kwargs["allow_redirects"] = False
        return super().request(*args, **kwargs)


def send_push(subscription, notification):
    from pywebpush import WebPushException, webpush
    validate_endpoint(subscription.endpoint)
    payload = {"title": "EventHub", "body": {
        "certificate_ready": "Your certificate is ready. Open EventHub to view it.",
        "event_cancelled": "An event you registered for was cancelled. Check EventHub for details.",
        "event_changed": "An event you registered for has an important update.",
    }.get(notification.kind, "You have a new EventHub notification."),
        "url": notification.href if safe_href(notification.href) else "/", "tag": str(notification.pk)}
    try:
        with NoRedirectSession() as session:
            webpush(subscription_info={"endpoint": subscription.endpoint, "keys": subscription.keys},
                    data=json.dumps(payload), vapid_private_key=config()["VAPID_PRIVATE_KEY"],
                    vapid_claims={"sub": config()["VAPID_SUBJECT"]}, timeout=20, ttl=3600,
                    requests_session=session)
    except WebPushException as error:
        code = getattr(error.response, "status_code", 0)
        raise ProviderFailure(f"push_{code}", retryable=code not in [400, 401, 403, 404, 410]) from None
    except requests.RequestException:
        raise ProviderFailure("push_network") from None


def send_whatsapp(phone, notification):
    c = config()
    template = c.get("WHATSAPP_TEMPLATES", {}).get(notification.kind)
    if not template:
        raise ProviderFailure("template_not_configured", False)
    payload = {"messaging_product": "whatsapp", "to": phone.lstrip("+"), "type": "template",
        "template": {"name": template, "language": {"code": c.get("WHATSAPP_LANGUAGE", "en_US")},
                     "components": [
                         {"type": "body", "parameters": [
                             {"type":"text", "text": notification.data.get("first_name") or "participant"},
                             {"type":"text", "text": notification.data.get("event_title") or "your event"},
                         ]},
                         {"type":"button", "sub_type":"url", "index":"0", "parameters":[
                             {"type":"text", "text": notification.href.lstrip("/") or "events"},
                         ]},
                     ]}}
    try:
        response = requests.post(
            f"https://graph.facebook.com/{c['WHATSAPP_API_VERSION']}/{c['WHATSAPP_PHONE_NUMBER_ID']}/messages",
            headers={"Authorization": "Bearer " + c["WHATSAPP_ACCESS_TOKEN"]}, json=payload,
            timeout=20, allow_redirects=False,
        )
        if response.status_code not in [200, 201]:
            raise ProviderFailure(f"whatsapp_{response.status_code}", response.status_code == 429 or response.status_code >= 500)
        identifier = response.json().get("messages", [{}])[0].get("id", "")
        if not identifier:
            raise ProviderFailure("whatsapp_no_receipt")
        return identifier[:200]
    except requests.RequestException:
        raise ProviderFailure("whatsapp_network") from None
