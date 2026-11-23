from django.urls import path
from .views import InboxView, PreferencesView, PublicConfigurationView, ReadNotificationView, SubscriptionView, WhatsAppConnectView
from .webhook import whatsapp_webhook

urlpatterns=[
    path("",InboxView.as_view(),name="eventhub-notifications"),
    path("config/",PublicConfigurationView.as_view(),name="eventhub-notification-config"),
    path("preferences/",PreferencesView.as_view(),name="eventhub-notification-preferences"),
    path("subscriptions/",SubscriptionView.as_view(),name="eventhub-push-subscriptions"),
    path("whatsapp/connect/",WhatsAppConnectView.as_view(),name="eventhub-whatsapp-connect"),
    path("whatsapp/webhook/",whatsapp_webhook,name="eventhub-whatsapp-webhook"),
    path("<uuid:notification_id>/read/",ReadNotificationView.as_view(),name="eventhub-notification-read"),
]
