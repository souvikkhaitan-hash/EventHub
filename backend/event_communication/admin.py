from django.contrib import admin
from .models import CommunicationHistory


@admin.register(CommunicationHistory)
class HistoryAdmin(admin.ModelAdmin):
    list_display = ["id", "event", "resource", "object_id", "revision", "action", "actor", "created_at"]
    list_filter = ["resource", "action"]
    readonly_fields = [field.name for field in CommunicationHistory._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
