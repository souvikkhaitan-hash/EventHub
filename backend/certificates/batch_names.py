from rest_framework.exceptions import ValidationError

from .recipient_services import participant_name


def resolve_batch_names(registrations, recipients):
    """
    Use an explicit correction when supplied.
    Otherwise use the student's saved full name.

    Never substitute a username for a missing full name.
    """
    requested = {
        item["registration_id"]: item
        for item in recipients
    }

    names = {}
    errors = {}

    for registration in registrations:
        item = requested[registration.id]

        name = (
            item["participant_name"]
            if "participant_name" in item
            else participant_name(registration)
        )

        if not isinstance(name, str):
            errors[str(registration.id)] = [
                "A valid participant full name is required."
            ]
            continue

        name = name.strip()

        if not name or len(name) > 200:
            errors[str(registration.id)] = [
                "Add a full name containing 1–200 characters "
                "to the student's profile, or provide a "
                "certificate name correction."
            ]
            continue

        names[registration.id] = name

    if errors:
        raise ValidationError({"recipients": errors})

    return names