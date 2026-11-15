from rest_framework.permissions import BasePermission


class IsOrganizer(BasePermission):

    message = "Only authorized organizers can manage events."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.groups.filter(
                name="Organizer"
            ).exists()
        )

class IsStudent(BasePermission):
    message = "Only students can access this feature."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and not request.user.groups.filter(
                name="Organizer"
            ).exists()
        )