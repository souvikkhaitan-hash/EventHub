from django.contrib import admin

from .models import Event
from .models import Registration
from .models import EventTicket


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):

    list_display = [
        "title",
        "category",
        "organizer",
        "start_datetime",
        "capacity",
        "status",
    ]

    list_filter = [
        "category",
        "status",
    ]

    search_fields = [
        "title",
        "venue",
        "organizer__username",
    ]

    readonly_fields = [
        "created_at",
        "updated_at",
    ]
    
@admin.register(Registration)
class RegistrationAdmin(admin.ModelAdmin):

    list_display = [
        "id",
        "event",
        "student",
        "status",
        "registered_at",
    ]

    list_filter = [
        "status",
        "event",
    ]

    search_fields = [
        "student__username",
        "student__email",
        "event__title",
    ]

    readonly_fields = [
        "event",
        "student",
        "status",
        "registered_at",
        "cancelled_at",
    ]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

@admin.register(EventTicket)
class EventTicketAdmin(admin.ModelAdmin):

    list_display = [
        "id",
        "registration",
        "checked_in_at",
        "checked_in_by",
        "created_at",
    ]

    list_filter = [
        "checked_in_at",
    ]

    search_fields = [
        "registration__student__username",
        "registration__event__title",
    ]

    readonly_fields = [
        "registration",
        "token",
        "checked_in_at",
        "checked_in_by",
        "created_at",
    ]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False