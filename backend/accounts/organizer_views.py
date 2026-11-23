from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import (
    BasePermission,
    IsAuthenticated,
)
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    OrganizerApplication,
    OrganizerApplicationHistory,
)

from .organizer_serializers import (
    OrganizerApplicationInput,
    OrganizerDecisionInput,
    application_data,
    application_snapshot,
)

from .serializers import user_data
from .organizer_notifications import (
    queue_organizer_notifications,
)


def can_review_organizers(user):
    return bool(
        user.is_authenticated
        and user.is_active
        and user.is_staff
        and user.has_perm(
            "accounts.review_organizerapplication"
        )
    )


class CanReviewOrganizers(BasePermission):
    message = (
        "You do not have permission to review "
        "organizer applications."
    )

    def has_permission(self, request, view):
        return can_review_organizers(
            request.user
        )


class ApplicationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


# ============================================================
# APPLICANT: STATUS AND SUBMISSION
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class MyOrganizerApplicationView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        application = (
            OrganizerApplication.objects
            .filter(user=request.user)
            .first()
        )

        is_organizer = request.user.groups.filter(
            name="Organizer"
        ).exists()

        can_apply = (
            not is_organizer
            and (
                application is None
                or application.status in {
                    OrganizerApplication.Status.REJECTED,
                    OrganizerApplication.Status.CHANGES_REQUESTED,
                }
            )
        )

        return Response({
            "is_organizer": is_organizer,
            "can_apply": can_apply,
            "application": (
                application_data(application)
                if application
                else None
            ),
        })

    def post(self, request):
        serializer = OrganizerApplicationInput(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        details = serializer.validated_data

        with transaction.atomic():
            # Lock the account first. This also serializes
            # simultaneous first-time submissions.
            user = (
                get_user_model().objects
                .select_for_update()
                .get(pk=request.user.pk)
            )

            if user.groups.filter(
                name="Organizer"
            ).exists():
                return Response(
                    {
                        "message": (
                            "You already have organizer access."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if not user_data(user)["profile_complete"]:
                return Response(
                    {
                        "message": (
                            "Complete your profile before "
                            "applying for organizer access."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            application = (
                OrganizerApplication.objects
                .select_for_update()
                .filter(user=user)
                .first()
            )

            is_new = application is None

            if is_new:
                if details["revision"] != 0:
                    return Response(
                        {
                            "message": (
                                "Reload the application page "
                                "and try again."
                            )
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                application = OrganizerApplication(
                    user=user
                )

                action = (
                    OrganizerApplicationHistory.Action.SUBMITTED
                )

            else:
                if (
                    application.revision
                    != details["revision"]
                ):
                    return Response(
                        {
                            "message": (
                                "This application has changed. "
                                "Reload before submitting."
                            )
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                if application.status not in {
                    OrganizerApplication.Status.REJECTED,
                    OrganizerApplication.Status.CHANGES_REQUESTED,
                }:
                    return Response(
                        {
                            "message": (
                                "This application cannot "
                                "be resubmitted in its "
                                "current state."
                            )
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                application.revision += 1

                action = (
                    OrganizerApplicationHistory.Action.RESUBMITTED
                )

            application.organization = (
                details["organization"]
            )

            application.position = details["position"]
            application.reason = details["reason"]

            application.status = (
                OrganizerApplication.Status.PENDING
            )

            application.decision_note = ""
            application.reviewed_by = None
            application.reviewed_at = None

            application.save()

            history=OrganizerApplicationHistory.objects.create(
                application=application,
                actor=user,
                action=action,
                revision=application.revision,
                application_data=application_snapshot(
                    application
                ),
            )
            queue_organizer_notifications(history)
            

            result = application_data(application)

        return Response(
            {
                "message": (
                    "Your application has been submitted "
                    "for admin review."
                ),
                "application": result,
            },
            status=(
                status.HTTP_201_CREATED
                if is_new
                else status.HTTP_200_OK
            ),
        )


# ============================================================
# ADMIN: APPLICATION LIST
# ============================================================

class AdminOrganizerApplicationListView(APIView):
    permission_classes = [
        IsAuthenticated,
        CanReviewOrganizers,
    ]

    def get(self, request):
        selected_status = request.query_params.get(
            "status",
            OrganizerApplication.Status.PENDING,
        )

        allowed = {
            "all",
            *OrganizerApplication.Status.values,
        }

        if selected_status not in allowed:
            return Response(
                {"message": "Invalid application status."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        applications = (
            OrganizerApplication.objects
            .select_related("user")
            .order_by("-created_at", "-pk")
        )

        if selected_status != "all":
            applications = applications.filter(
                status=selected_status
            )

        search = request.query_params.get(
            "search", ""
        ).strip()[:100]

        if search:
            applications = applications.filter(
                Q(user__username__icontains=search)
                | Q(user__email__icontains=search)
                | Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(organization__icontains=search)
            )

        pagination = ApplicationPagination()

        page = pagination.paginate_queryset(
            applications,
            request,
            view=self,
        )

        # Keep list responses small. Full history is
        # available from the detail endpoint.
        results = [
            {
                "id": application.pk,
                "organization": application.organization,
                "position": application.position,
                "status": application.status,
                "revision": application.revision,
                "created_at": application.created_at,
                "applicant": {
                    "id": application.user_id,
                    "username": application.user.username,
                    "full_name": (
                        application.user.get_full_name()
                    ),
                    "email": application.user.email,
                    "is_active": (
                        application.user.is_active
                    ),
                },
            }
            for application in page
        ]

        return pagination.get_paginated_response(
            results
        )


# ============================================================
# ADMIN: DETAIL AND DECISION
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class AdminOrganizerApplicationDetailView(APIView):
    permission_classes = [
        IsAuthenticated,
        CanReviewOrganizers,
    ]

    def get(self, request, application_id):
        application = get_object_or_404(
            OrganizerApplication.objects.select_related(
                "user"
            ),
            pk=application_id,
        )

        return Response(
            application_data(
                application,
                admin=True,
            )
        )

    def post(self, request, application_id):
        serializer = OrganizerDecisionInput(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        details = serializer.validated_data

        initial_application = get_object_or_404(
            OrganizerApplication,
            pk=application_id,
        )

        if (
            initial_application.user_id
            == request.user.pk
        ):
            return Response(
                {
                    "message": (
                        "You cannot review your own "
                        "organizer application."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            # Consistent user-lock order avoids conflicting
            # review transactions locking users differently.
            users = list(
                get_user_model().objects
                .select_for_update()
                .filter(
                    pk__in=[
                        request.user.pk,
                        initial_application.user_id,
                    ]
                )
                .order_by("pk")
            )

            users_by_id = {
                user.pk: user
                for user in users
            }

            reviewer = users_by_id.get(
                request.user.pk
            )

            applicant = users_by_id.get(
                initial_application.user_id
            )

            # Recheck using a freshly loaded reviewer.
            if (
                reviewer is None
                or not can_review_organizers(reviewer)
            ):
                return Response(
                    {
                        "message": (
                            "Your review access is "
                            "no longer available."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            if (
                applicant is None
                or not applicant.is_active
            ):
                return Response(
                    {
                        "message": (
                            "This applicant's account "
                            "is not active."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            application = (
                OrganizerApplication.objects
                .select_for_update()
                .get(pk=application_id)
            )

            if (
                application.revision
                != details["revision"]
                or application.status
                != OrganizerApplication.Status.PENDING
            ):
                return Response(
                    {
                        "message": (
                            "This application has changed "
                            "or has already been reviewed. "
                            "Reload before continuing."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            application.status = details["decision"]

            application.decision_note = (
                details["decision_note"]
            )

            application.reviewed_by = reviewer
            application.reviewed_at = timezone.now()

            application.save()

            if (
                application.status
                == OrganizerApplication.Status.APPROVED
            ):
                group, _ = Group.objects.get_or_create(
                    name="Organizer"
                )

                applicant.groups.add(group)

            history=OrganizerApplicationHistory.objects.create(
                application=application,
                actor=reviewer,
                action=application.status,
                revision=application.revision,
                note=application.decision_note,
                application_data=application_snapshot(
                    application
                ),
            )
            queue_organizer_notifications(history)

            result = application_data(
                application,
                admin=True,
            )

        return Response({
            "message": "Application decision saved.",
            "application": result,
        })