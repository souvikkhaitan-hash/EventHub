from types import SimpleNamespace

from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from .batch_names import resolve_batch_names
from .batch_serializers import BatchRecipientSerializer
from .batch_services import batch_request_hash


def registration(name):
    return SimpleNamespace(
        id=1,
        student=SimpleNamespace(
            get_full_name=lambda: name,
        ),
    )


class BatchNameTests(SimpleTestCase):
    def test_request_can_omit_name(self):
        serializer = BatchRecipientSerializer(
            data={"registration_id": 1}
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertNotIn(
            "participant_name",
            serializer.validated_data,
        )

    def test_explicit_blank_name_is_rejected(self):
        serializer = BatchRecipientSerializer(
            data={
                "registration_id": 1,
                "participant_name": "   ",
            }
        )

        self.assertFalse(serializer.is_valid())

    def test_saved_full_name_is_used(self):
        names = resolve_batch_names(
            [registration("  Aarav Sharma  ")],
            [{"registration_id": 1}],
        )

        self.assertEqual(names, {1: "Aarav Sharma"})

    def test_explicit_correction_is_used(self):
        names = resolve_batch_names(
            [registration("Aarav")],
            [{
                "registration_id": 1,
                "participant_name": "  Aarav Sharma  ",
            }],
        )

        self.assertEqual(names, {1: "Aarav Sharma"})

    def test_missing_profile_name_is_rejected(self):
        with self.assertRaises(ValidationError):
            resolve_batch_names(
                [registration("")],
                [{"registration_id": 1}],
            )

    def test_overlong_profile_name_is_rejected(self):
        with self.assertRaises(ValidationError):
            resolve_batch_names(
                [registration("A" * 201)],
                [{"registration_id": 1}],
            )

    def test_automatic_request_hash_does_not_read_profile(self):
        data = {
            "template_version_id": 1,
            "recipients": [{"registration_id": 1}],
        }

        first_hash = batch_request_hash(data)

        self.assertEqual(
            first_hash,
            batch_request_hash(data),
        )

        corrected_hash = batch_request_hash({
            **data,
            "recipients": [{
                "registration_id": 1,
                "participant_name": "Aarav Sharma",
            }],
        })

        self.assertNotEqual(first_hash, corrected_hash)