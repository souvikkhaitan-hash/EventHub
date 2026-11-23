from django.contrib import admin
from django.urls import include, path


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("events.urls")),
    path("api/auth/", include("accounts.urls")),
    path(
        "api/certificates/",
        include("certificates.urls"),
    ),
    path(
        "api/notifications/",
        include("eventhub_notifications.urls"),
    ),
    path("api/communication/", include("event_communication.urls")),
]