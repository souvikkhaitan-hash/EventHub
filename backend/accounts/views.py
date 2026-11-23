from django.contrib.auth import (
    authenticate,
    get_user_model,
    login,
    logout,
)

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import StudentProfile

from .serializers import (
    ProfileSerializer,
    RegisterSerializer,
    user_data,
)
from .login_throttles import (
    LoginIPThrottle,
    LoginUsernameThrottle,
)

# ============================================================
# CSRF INITIALIZATION
# ============================================================

@require_GET
def csrf_token(request):
    return JsonResponse({
        "csrfToken": get_token(request)
    })


# ============================================================
# REGISTRATION
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(
            data=request.data
        )

        if not serializer.is_valid():
            return Response(
                serializer.errors,
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Both records succeed together, or neither is saved.
            with transaction.atomic():
                user = serializer.save()

        except IntegrityError:
            return Response(
                {
                    "message": (
                        "An account with these details "
                        "already exists."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "message": "Registration successful.",
                "user": user_data(user),
            },
            status=status.HTTP_201_CREATED,
        )


# ============================================================
# LOGIN
# ============================================================
@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]

    throttle_classes = [
        LoginIPThrottle,
        LoginUsernameThrottle,
    ]

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response(
                {"message": "Invalid login details."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        username = request.data.get(
            "username", ""
        )

        password = request.data.get(
            "password", ""
        )

        portal = request.data.get(
            "portal", "account"
        )

        if (
            not isinstance(username, str)
            or not isinstance(password, str)
            or not isinstance(portal, str)
            or portal not in {"account", "admin"}
        ):
            return Response(
                {"message": "Invalid login details."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(
            request,
            username=username.strip(),
            password=password,
        )

        if user is None:
            return Response(
                {
                    "message": (
                        "Invalid username or password."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if portal == "admin":
            allowed = (
                user.is_active
                and user.is_staff
                and user.has_perm(
                    "accounts.review_organizerapplication"
                )
            )

            if not allowed:
                return Response(
                    {
                        "message": (
                            "This account does not have "
                            "administrator review access."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Create the session only after checking
        # access to the requested portal.
        login(request, user)

        return Response({
            "message": "Login successful.",
            "user": user_data(user),
        })
# ============================================================
# LOGOUT
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)

        return Response({
            "message": "Logout successful."
        })


# ============================================================
# CURRENT SESSION
# ============================================================

class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            user_data(request.user)
        )


# ============================================================
# OWN ACCOUNT PROFILE
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            user_data(request.user)
        )

    def put(self, request):
        serializer = ProfileSerializer(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        data = serializer.validated_data

        with transaction.atomic():
            # Use the authenticated account, never a supplied user ID.
            user = (
                get_user_model()
                .objects
                .select_for_update()
                .get(pk=request.user.pk)
            )

            user.first_name = data["first_name"]

            user.last_name = data.get(
                "last_name", ""
            )

            user.save(
                update_fields=[
                    "first_name",
                    "last_name",
                ]
            )

            StudentProfile.objects.update_or_create(
                user=user,
                defaults={
                    "roll_number": data["roll_number"],
                    "department": data["department"],
                    "academic_year": data["academic_year"],
                },
            )

        return Response(
            user_data(user)
        )