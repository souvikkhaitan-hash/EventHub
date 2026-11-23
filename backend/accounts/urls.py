from django.urls import path

from .views import (
    csrf_token,
    CurrentUserView,
    LoginView,
    LogoutView,
    ProfileView,
    RegisterView,
)
from .password_views import (
    ChangePasswordView,
    ConfirmPasswordResetView,
    RequestPasswordResetView,
)
from .organizer_views import (
    AdminOrganizerApplicationDetailView,
    AdminOrganizerApplicationListView,
    MyOrganizerApplicationView,
)
urlpatterns = [
    path(
        "csrf/",
        csrf_token,
        name="csrf-token",
    ),

    path(
        "register/",
        RegisterView.as_view(),
        name="register",
    ),

    path(
        "login/",
        LoginView.as_view(),
        name="login",
    ),

    path(
        "logout/",
        LogoutView.as_view(),
        name="logout",
    ),

    path(
        "me/",
        CurrentUserView.as_view(),
        name="current-user",
    ),

    path(
        "profile/",
        ProfileView.as_view(),
        name="account-profile",
    ),
    path(
        "password/change/",
         ChangePasswordView.as_view(),
         name="password-change",
    ),

    path(
        "password/reset/",
         RequestPasswordResetView.as_view(),
         name="password-reset-request",
   ),

   path(
       "password/reset/confirm/",
        ConfirmPasswordResetView.as_view(),
        name="password-reset-confirm",
   ),
   path(
    "organizer-application/",
    MyOrganizerApplicationView.as_view(),
    name="my-organizer-application",
),

path(
    "admin/organizer-applications/",
    AdminOrganizerApplicationListView.as_view(),
    name="admin-organizer-applications",
),

path(
    "admin/organizer-applications/<int:application_id>/",
    AdminOrganizerApplicationDetailView.as_view(),
    name="admin-organizer-application-detail",
),
]