from django.apps import AppConfig


class EventHubNotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "eventhub_notifications"
    verbose_name = "EventHub notifications"

    def ready(self):
        from . import signals  # noqa: F401
