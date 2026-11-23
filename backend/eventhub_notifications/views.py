import hmac
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .models import Notification, NotificationPreferences, PushSubscription, WhatsAppConnection
from .providers import config, digest, push_ready, validate_endpoint, validate_push_keys, whatsapp_ready
from .services import preferences

CATEGORIES = ["technical", "cultural", "workshop", "seminar", "sports"]


class ActiveAccount(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and request.user.is_active)


class LinkRate(UserRateThrottle):
    rate = "5/hour"
    scope = "eventhub_whatsapp_link"


def private(data, status=200):
    response = Response(data, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


class StrictInput(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors":["Unsupported notification settings."]})
        return super().to_internal_value(data)


class PreferenceInput(StrictInput):
    push_enabled = serializers.BooleanField(required=False)
    reminders = serializers.BooleanField(required=False)
    event_categories = serializers.ListField(child=serializers.ChoiceField(choices=CATEGORIES), max_length=5, required=False)
    preferred_channel = serializers.ChoiceField(choices=["push","whatsapp"], required=False)
    whatsapp_enabled = serializers.BooleanField(required=False)
    whatsapp_marketing = serializers.BooleanField(required=False)


def preference_data(pref):
    return {name:getattr(pref,name) for name in ["push_enabled","reminders","event_categories","preferred_channel",
        "whatsapp_phone","whatsapp_verified","whatsapp_enabled","whatsapp_marketing"]}


@method_decorator(csrf_protect, name="dispatch")
class PreferencesView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def get(self, request):
        return private(preference_data(preferences(request.user)))

    def patch(self, request):
        serializer = PreferenceInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        preferences(request.user)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            pref = preferences(request.user)
            data = serializer.validated_data
            if (data.get("whatsapp_enabled") or data.get("whatsapp_marketing") or data.get("preferred_channel") == "whatsapp") and not pref.whatsapp_verified:
                return private({"message":"Link and verify your WhatsApp number first."},400)
            for name,value in data.items(): setattr(pref,name,value)
            pref.save()
        return private(preference_data(pref))


class PublicConfigurationView(APIView):
    permission_classes = [ActiveAccount]

    def get(self, request):
        return private({"push_configured":push_ready(),"vapid_public_key":config().get("VAPID_PUBLIC_KEY", ""),
                        "whatsapp_configured":whatsapp_ready(),"whatsapp_marketing_available":bool(config().get("WHATSAPP_MARKETING_ENABLED"))})


class InboxPagination(PageNumberPagination):
    page_size = 20


@method_decorator(csrf_protect, name="dispatch")
class InboxView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def get(self, request):
        query = Notification.objects.filter(user=request.user).order_by("-updated_at","-id")
        paginator = InboxPagination()
        rows = paginator.paginate_queryset(query,request,view=self)
        response = paginator.get_paginated_response([
            {"id":str(row.pk),"kind":row.kind,"title":row.title,"body":row.body,"href":row.href,
             "is_read":row.is_read,"created_at":row.created_at,"updated_at":row.updated_at} for row in rows])
        response.data["unread_count"] = query.filter(is_read=False).count()
        response["Cache-Control"] = "private, no-store"
        return response

    def post(self, request):
        if request.data != {"action":"read_all"}:
            return private({"message":"Unsupported action."},400)
        Notification.objects.filter(user=request.user,is_read=False).update(is_read=True)
        return private({"unread_count":0})


@method_decorator(csrf_protect, name="dispatch")
class ReadNotificationView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def post(self,request,notification_id):
        notification = get_object_or_404(Notification,pk=notification_id,user=request.user)
        Notification.objects.filter(pk=notification.pk).update(is_read=True)
        return private({"id":str(notification.pk),"is_read":True})


class SubscriptionInput(StrictInput):
    endpoint = serializers.CharField(max_length=3000)
    keys = serializers.JSONField(required=False)


@method_decorator(csrf_protect,name="dispatch")
class SubscriptionView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def get(self,request):
        endpoint_hash=request.query_params.get("endpoint_hash", "")
        if not re.fullmatch(r"[a-f0-9]{64}",endpoint_hash):return private({"enabled":False})
        return private({"enabled":PushSubscription.objects.filter(user=request.user,
            session_key=request.session.session_key,endpoint_hash=endpoint_hash).exists()})

    def post(self,request):
        serializer = SubscriptionInput(data=request.data); serializer.is_valid(raise_exception=True)
        if not push_ready(): return private({"message":"Device notifications are not configured yet."},503)
        data = serializer.validated_data
        try:
            validate_endpoint(data["endpoint"])
            validate_push_keys(data.get("keys"))
        except DjangoValidationError as error:
            return private({"message":error.messages[0]},400)
        try:
            with transaction.atomic():
                existing = PushSubscription.objects.select_for_update().filter(endpoint_hash=digest(data["endpoint"])).first()
                if existing and existing.user_id != request.user.pk:
                    return private({"message":"This browser is linked to another account. Sign out there or reset this site's notification permission."},409)
                if not request.session.session_key: request.session.save()
                sub, _ = PushSubscription.objects.update_or_create(endpoint_hash=digest(data["endpoint"]), defaults={
                    "user":request.user,"session_key":request.session.session_key,"endpoint":data["endpoint"],"keys":data["keys"]})
                preferences(request.user)
        except IntegrityError:
            return private({"message":"The device subscription changed. Try again."},409)
        return private({"enabled":True})

    def delete(self,request):
        serializer=SubscriptionInput(data=request.data); serializer.is_valid(raise_exception=True)
        PushSubscription.objects.filter(user=request.user,endpoint_hash=digest(serializer.validated_data["endpoint"])).delete()
        return private({"enabled":False})


@method_decorator(csrf_protect,name="dispatch")
class WhatsAppConnectView(APIView):
    permission_classes=[ActiveAccount]
    parser_classes=[JSONParser]
    throttle_classes=[LinkRate]

    def delete(self,request):
        preferences(request.user)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            pref=preferences(request.user)
            pref.whatsapp_phone="";pref.whatsapp_verified=False;pref.whatsapp_enabled=False
            pref.whatsapp_marketing=False;pref.preferred_channel="push";pref.save()
            WhatsAppConnection.objects.filter(user=request.user,used_at__isnull=True).update(expires_at=timezone.now())
        return private(preference_data(pref))

    def post(self,request):
        if not isinstance(request.data,dict) or set(request.data) != {"phone","consent"} or request.data.get("consent") is not True:
            return private({"message":"Confirm that you want EventHub registration and important event updates on WhatsApp."},400)
        phone=request.data.get("phone", "")
        if not isinstance(phone,str) or not re.fullmatch(r"\+[1-9]\d{7,14}",phone):
            return private({"message":"Use an international number, for example +919876543210."},400)
        if not whatsapp_ready(): return private({"message":"WhatsApp is not configured yet. Website notifications remain available."},503)
        preferences(request.user)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            pref=preferences(request.user)
            pref.whatsapp_phone=phone;pref.whatsapp_verified=False;pref.whatsapp_enabled=False;pref.whatsapp_marketing=False
            pref.save()
            WhatsAppConnection.objects.filter(user=request.user,used_at__isnull=True).update(expires_at=timezone.now())
            token="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(12))
            WhatsAppConnection.objects.create(user=request.user,phone=phone,token_hash=digest(token),expires_at=timezone.now()+timedelta(minutes=10))
        text=f"CONNECT {token}"
        return private({"url":"https://wa.me/"+config()["WHATSAPP_BUSINESS_NUMBER"]+"?"+urlencode({"text":text}),
                        "message":"Open WhatsApp and send the prefilled CONNECT message from this number. Then check the connection here.","expires_in_seconds":600})
