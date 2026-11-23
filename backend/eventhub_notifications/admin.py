from django.contrib import admin
from django.utils import timezone
from .models import NotificationDelivery,NotificationEvent


@admin.register(NotificationDelivery)
class DeliveryAdmin(admin.ModelAdmin):
    list_display=["id","channel","status","attempts","error_code","next_attempt_at"]
    list_filter=["channel","status"]
    readonly_fields=[field.name for field in NotificationDelivery._meta.fields]
    actions=["retry_failed"]

    def has_add_permission(self,request):return False
    def has_delete_permission(self,request,obj=None):return False

    @admin.action(description="Retry selected unexpired failed notifications")
    def retry_failed(self,request,queryset):
        count=queryset.filter(status="failed",expires_at__gt=timezone.now()).update(
            status="pending",attempts=0,error_code="",next_attempt_at=timezone.now())
        self.message_user(request,f"{count} notifications queued. Current consent and access are checked again before delivery.")


@admin.register(NotificationEvent)
class EventAdmin(admin.ModelAdmin):
    list_display=["id","kind","audience","done","created_at"]
    list_filter=["kind","done"]
    readonly_fields=[field.name for field in NotificationEvent._meta.fields]
    def has_add_permission(self,request):return False
    def has_delete_permission(self,request,obj=None):return False
