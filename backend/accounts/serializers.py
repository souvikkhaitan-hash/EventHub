from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password

from rest_framework import serializers

from .models import StudentProfile


# ============================================================
# CONSISTENT ACCOUNT RESPONSE
# ============================================================

def user_data(user):
    """
    Return the same account structure after login,
    session checks and profile updates.

    Existing accounts without a profile receive empty
    academic details. Reading an account does not create
    or overwrite database records.
    """

    profile = StudentProfile.objects.filter(
        user=user
    ).first()

    return {
        "id": user.pk,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.get_full_name(),

        "is_organizer": user.groups.filter(
            name="Organizer"
        ).exists(),

        "profile": {
            "roll_number": (
                profile.roll_number if profile else ""
            ),
            "department": (
                profile.department if profile else ""
            ),
            "academic_year": (
                profile.academic_year if profile else ""
            ),
        },

        "profile_complete": bool(
            user.first_name.strip()
            and profile
            and profile.roll_number.strip()
            and profile.department.strip()
            and profile.academic_year
        ),
        "can_review_organizers": bool(
    user.is_active
    and user.is_staff
    and user.has_perm(
        "accounts.review_organizerapplication"
    )
),
    }


# ============================================================
# STUDENT REGISTRATION
# ============================================================

class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(
        required=True
    )

    first_name = serializers.CharField(
        max_length=150
    )

    last_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
        default="",
    )

    roll_number = serializers.CharField(
        max_length=50,
        write_only=True,
    )

    department = serializers.CharField(
        max_length=120,
        write_only=True,
    )

    academic_year = serializers.ChoiceField(
        choices=StudentProfile.YEAR_CHOICES,
        write_only=True,
    )

    password = serializers.CharField(
        write_only=True,
        validators=[validate_password],
    )

    class Meta:
        model = User

        fields = [
            "id",
            "username",
            "email",
            "password",
            "first_name",
            "last_name",
            "roll_number",
            "department",
            "academic_year",
        ]

        read_only_fields = ["id"]

    def validate_email(self, value):
        email = value.strip().lower()

        if User.objects.filter(
            email__iexact=email
        ).exists():
            raise serializers.ValidationError(
                "An account with this email already exists."
            )

        return email

    def create(self, validated_data):
        profile_data = {
            key: validated_data.pop(key)
            for key in (
                "roll_number",
                "department",
                "academic_year",
            )
        }

        # create_user hashes the password.
        user = User.objects.create_user(
            **validated_data
        )

        StudentProfile.objects.create(
            user=user,
            **profile_data,
        )

        return user


# ============================================================
# PROFILE UPDATES
# ============================================================

class ProfileSerializer(serializers.Serializer):
    first_name = serializers.CharField(
        max_length=150
    )

    last_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
        default="",
    )

    roll_number = serializers.CharField(
        max_length=50
    )

    department = serializers.CharField(
        max_length=120
    )

    academic_year = serializers.ChoiceField(
        choices=StudentProfile.YEAR_CHOICES
    )

    def validate(self, attrs):
        """
        This endpoint accepts only editable profile fields.

        Account identity, passwords and permissions cannot
        be changed through the profile API.
        """

        unexpected = (
            set(self.initial_data) - set(self.fields)
        )

        if unexpected:
            raise serializers.ValidationError(
                "Only profile fields can be updated here."
            )

        return attrs