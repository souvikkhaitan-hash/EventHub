from datetime import timedelta
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient
from .models import CertificateAsset
from events.models import Event

from .models import (
    CertificateTemplate,
    CertificateTemplateVersion,
)


User = get_user_model()


@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class CertificateTemplateTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        organizer_group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        cls.owner = User.objects.create_user(
            username="certificate_owner"
        )
        cls.other = User.objects.create_user(
            username="certificate_other"
        )
        cls.student = User.objects.create_user(
            username="certificate_student"
        )

        cls.owner.groups.add(organizer_group)
        cls.other.groups.add(organizer_group)

        now = timezone.now()

        cls.event = Event.objects.create(
            organizer=cls.owner,
            title="Certificate Test Workshop",
            description="Isolated certificate test event.",
            category="workshop",
            venue="Test Lab",
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=11),
            registration_deadline=now + timedelta(days=8),
            capacity=30,
            status="published",
        )

    def setUp(self):
        directory = TemporaryDirectory()
        self.storage_directory = directory.name

        self.addCleanup(directory.cleanup)

        settings_override = override_settings(
            CERTIFICATE_STORAGE_ROOT=directory.name
        )
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

        self.upload_url = reverse(
            "event-certificate-templates",
            args=[self.event.id],
        )

    def image_upload(self, size=(1200, 800)):
        image = Image.new("RGB", size, "white")
        output = BytesIO()
        image.save(output, format="PNG")

        return SimpleUploadedFile(
            "certificate.png",
            output.getvalue(),
            content_type="image/png",
        )

    def upload_template(self, size=(1200, 800)):
        return self.client.post(
            self.upload_url,
            {
                "name": "Workshop participation",
                "background": self.image_upload(size),
            },
            format="multipart",
        )

    def get_version(self):
        response = self.upload_template()
        self.assertEqual(response.status_code, 201)
        return response.data["versions"][0]

    def test_owner_can_upload_private_template(self):
        version = self.get_version()

        self.assertEqual(version["image_width"], 1200)
        self.assertEqual(version["image_height"], 800)
        self.assertNotIn("background", version)

        response = self.client.get(version["background_url"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "image/png",
        )
        self.assertEqual(
            response["Cache-Control"],
            "private, no-store",
        )

        # Consuming the stream lets Django's test client
        # close the response without closing the test connection.
        content = b"".join(response.streaming_content)

        self.assertTrue(
            content.startswith(b"\x89PNG\r\n\x1a\n")
        )

    def test_other_organizer_cannot_read_background_or_preview(self):
        version = self.get_version()

        self.client.force_authenticate(user=self.other)

        background = self.client.get(
            version["background_url"]
        )

        preview = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[version["id"]],
            ),
            {},
            format="json",
        )

        self.assertEqual(background.status_code, 404)
        self.assertEqual(preview.status_code, 404)

    def test_student_cannot_upload_template(self):
        self.client.force_authenticate(user=self.student)

        response = self.upload_template()

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            CertificateTemplate.objects.count(),
            0,
        )

    def test_disguised_non_image_upload_is_rejected(self):
        response = self.client.post(
            self.upload_url,
            {
                "name": "Invalid background",
                "background": SimpleUploadedFile(
                    "looks-valid.png",
                    b"This is not a PNG file.",
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            CertificateTemplate.objects.count(),
            0,
        )

    def test_new_version_preserves_old_layout_and_rejects_stale_save(self):
        original = self.get_version()

        changed_fields = [
            {
                **original["fields"][0],
                "x": 0.2,
                "width": 0.6,
            }
        ]

        template = CertificateTemplate.objects.get()

        url = reverse(
            "certificate-template-versions",
            args=[template.id],
        )

        response = self.client.post(
            url,
            {
                "base_version": 1,
                "fields": changed_fields,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["number"], 2)

        old_version = CertificateTemplateVersion.objects.get(
            id=original["id"]
        )

        self.assertEqual(
            old_version.fields,
            original["fields"],
        )

        stale = self.client.post(
            url,
            {
                "base_version": 1,
                "fields": changed_fields,
            },
            format="json",
        )

        self.assertEqual(stale.status_code, 409)
        self.assertEqual(template.versions.count(), 2)

    def test_invalid_placeholder_and_off_page_box_are_rejected(self):
        version = self.get_version()

        url = reverse(
            "certificate-version-preview",
            args=[version["id"]],
        )

        for changes in [
            {"placeholder": "__class__"},
            {"x": 0.95, "width": 0.8},
        ]:
            with self.subTest(changes=changes):
                field = {
                    **version["fields"][0],
                    **changes,
                }

                response = self.client.post(
                    url,
                    {"fields": [field]},
                    format="json",
                )

                self.assertEqual(response.status_code, 400)

    def test_portrait_and_landscape_generate_sample_pdfs(self):
        for size in [(1200, 800), (800, 1200)]:
            with self.subTest(size=size):
                response = self.upload_template(size)

                self.assertEqual(response.status_code, 201)

                version = response.data["versions"][0]

                preview = self.client.post(
                    reverse(
                        "certificate-version-preview",
                        args=[version["id"]],
                    ),
                    {
                        "sample_name": (
                            "Alexandra Catherine Morgan"
                        )
                    },
                    format="json",
                )

                self.assertEqual(preview.status_code, 200)
                self.assertEqual(
                    preview["Content-Type"],
                    "application/pdf",
                )

                # Django performs safe cleanup when the
                # streaming iterator is fully consumed.
                content = b"".join(
                    preview.streaming_content
                )

                self.assertTrue(
                    content.startswith(b"%PDF-")
                )
                self.assertGreater(len(content), 1000)

    def test_upload_requires_csrf_for_session_authentication(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        response = client.post(
            self.upload_url,
            {
                "name": "Missing CSRF",
                "background": self.image_upload(),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 403)

    def test_database_failure_removes_uploaded_file(self):
        with patch(
            "certificates.views.CertificateTemplateVersion.save",
            side_effect=RuntimeError("Simulated save failure"),
        ):
            with self.assertRaisesMessage(
                RuntimeError,
                "Simulated save failure",
            ):
                self.upload_template()

        self.assertEqual(
            CertificateTemplate.objects.count(),
            0,
        )

        stored_files = [
            path
            for path in Path(
                self.storage_directory
            ).rglob("*")
            if path.is_file()
        ]

        self.assertEqual(stored_files, [])
    
    def test_paragraph_layout_is_saved_and_renders(self):
        original = self.get_version()

        paragraph = {
            **original["fields"][0],
            "text": (
                "{participant_name} has participated in "
                "{event_name}, held on {event_date}.\n\n"
                "We appreciate their enthusiasm and contribution."
            ),
            "y": 0.60,
            "height": 0.18,
            "font_size": 18,
            "font": "sans-italic",
            "valign": "top",
            "line_spacing": 1.25,
        }

        template = CertificateTemplate.objects.get()

        saved = self.client.post(
            reverse(
                "certificate-template-versions",
                args=[template.id],
            ),
            {
                "base_version": 1,
                "fields": [paragraph],
            },
            format="json",
        )

        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.data["number"], 2)
        self.assertEqual(
            saved.data["fields"][0]["text"],
            paragraph["text"],
        )

        preview = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[saved.data["id"]],
            ),
            {"sample_name": "Souvik Khaitan"},
            format="json",
        )

        self.assertEqual(preview.status_code, 200)

        content = b"".join(preview.streaming_content)
        self.assertTrue(content.startswith(b"%PDF-"))

        old_version = CertificateTemplateVersion.objects.get(
            id=original["id"]
        )

        self.assertEqual(
            old_version.fields,
            original["fields"],
        )

    def test_unknown_placeholder_in_paragraph_is_rejected(self):
        version = self.get_version()

        response = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[version["id"]],
            ),
            {
                "fields": [{
                    **version["fields"][0],
                    "text": "Awarded to {unapproved_value}.",
                }]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_script_font_layout_saves_and_generates_pdf(self):
        original = self.get_version()

        name_field = {
            **original["fields"][0],
            "placeholder": "participant_name",
            "text": "",
            "font": "script-allura-v1",
            "font_size": 36,
            "min_font_size": 12,
            "x": 0.1,
            "y": 0.4,
            "width": 0.8,
            "height": 0.2,
        }

        template = CertificateTemplate.objects.get()

        saved = self.client.post(
            reverse(
                "certificate-template-versions",
                args=[template.id],
            ),
            {
                "base_version": 1,
                "fields": [name_field],
            },
            format="json",
        )

        self.assertEqual(saved.status_code, 201)
        self.assertEqual(
            saved.data["fields"][0]["font"],
            "script-allura-v1",
        )

        preview = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[saved.data["id"]],
            ),
            {"sample_name": "Souvik Khaitan"},
            format="json",
        )

        self.assertEqual(preview.status_code, 200)

        content = b"".join(preview.streaming_content)
        self.assertTrue(content.startswith(b"%PDF-"))

        old_version = CertificateTemplateVersion.objects.get(
            id=original["id"]
        )

        self.assertEqual(
            old_version.fields,
            original["fields"],
        )

    def upload_signature_asset(self, template_id):
        output = BytesIO()

        image = Image.new(
            "RGBA",
            (300, 100),
            (0, 0, 0, 0),
        )

        # Visible ink with transparent pixels around it.
        image.paste(
            (20, 30, 70, 255),
            (50, 40, 250, 60),
        )
        image.save(output, format="PNG")

        return self.client.post(
            reverse(
                "certificate-template-assets",
                args=[template_id],
            ),
            {
                "name": "Coordinator signature",
                "image": SimpleUploadedFile(
                    "signature.png",
                    output.getvalue(),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

    def image_placement(self, asset_id):
        return {
            "asset_id": asset_id,
            "x": 0.15,
            "y": 0.75,
            "width": 0.25,
            "height": 0.1,
            "rotation": 0,
        }

    def test_asset_upload_preserves_transparency_and_is_private(self):
        self.get_version()
        template = CertificateTemplate.objects.get()

        uploaded = self.upload_signature_asset(template.id)

        self.assertEqual(uploaded.status_code, 201)
        self.assertNotIn("image", uploaded.data)

        response = self.client.get(uploaded.data["image_url"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Cache-Control"],
            "private, no-store",
        )

        content = b"".join(response.streaming_content)

        with Image.open(BytesIO(content)) as image:
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.getpixel((0, 0))[3], 0)
            self.assertEqual(image.getpixel((100, 50))[3], 255)

        self.client.force_authenticate(user=self.other)

        denied = self.client.get(uploaded.data["image_url"])
        self.assertEqual(denied.status_code, 404)

    def test_asset_upload_rejects_student_and_other_organizer(self):
        self.get_version()
        template = CertificateTemplate.objects.get()

        self.client.force_authenticate(user=self.student)
        response = self.upload_signature_asset(template.id)
        self.assertEqual(response.status_code, 403)

        self.client.force_authenticate(user=self.other)
        response = self.upload_signature_asset(template.id)
        self.assertEqual(response.status_code, 404)

        self.assertEqual(CertificateAsset.objects.count(), 0)

    def test_asset_upload_rejects_disguised_file(self):
        self.get_version()
        template = CertificateTemplate.objects.get()

        response = self.client.post(
            reverse(
                "certificate-template-assets",
                args=[template.id],
            ),
            {
                "name": "Invalid signature",
                "image": SimpleUploadedFile(
                    "signature.png",
                    b"This is not an image.",
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(CertificateAsset.objects.count(), 0)

    def test_asset_upload_requires_csrf(self):
        self.get_version()
        template = CertificateTemplate.objects.get()

        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)

        response = client.post(
            reverse(
                "certificate-template-assets",
                args=[template.id],
            ),
            {
                "name": "Missing CSRF",
                "image": self.image_upload(),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 403)

    def test_asset_database_failure_removes_uploaded_file(self):
        self.get_version()
        template = CertificateTemplate.objects.get()

        before = {
            path
            for path in Path(self.storage_directory).rglob("*")
            if path.is_file()
        }

        with patch(
            "certificates.asset_views.CertificateAsset.save",
            side_effect=RuntimeError("Simulated asset failure"),
        ):
            with self.assertRaisesMessage(
                RuntimeError,
                "Simulated asset failure",
            ):
                self.upload_signature_asset(template.id)

        after = {
            path
            for path in Path(self.storage_directory).rglob("*")
            if path.is_file()
        }

        self.assertEqual(before, after)
        self.assertEqual(CertificateAsset.objects.count(), 0)

    def test_asset_from_another_template_cannot_be_placed(self):
        first = self.get_version()
        first_template = CertificateTemplate.objects.get()

        uploaded = self.upload_signature_asset(first_template.id)
        self.assertEqual(uploaded.status_code, 201)

        second_response = self.upload_template()
        self.assertEqual(second_response.status_code, 201)

        second = second_response.data["versions"][0]

        placement = self.image_placement(uploaded.data["id"])

        saved = self.client.post(
            reverse(
                "certificate-template-versions",
                args=[second_response.data["id"]],
            ),
            {
                "base_version": second["number"],
                "fields": second["fields"],
                "images": [placement],
            },
            format="json",
        )

        self.assertEqual(saved.status_code, 400)

        preview = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[second["id"]],
            ),
            {
                "sample_name": "Souvik Khaitan",
                "images": [placement],
            },
            format="json",
        )

        self.assertEqual(preview.status_code, 400)

    def test_image_layout_versions_preserve_previous_placements(self):
        original = self.get_version()
        template = CertificateTemplate.objects.get()

        uploaded = self.upload_signature_asset(template.id)
        self.assertEqual(uploaded.status_code, 201)

        placement = self.image_placement(uploaded.data["id"])

        url = reverse(
            "certificate-template-versions",
            args=[template.id],
        )

        saved = self.client.post(
            url,
            {
                "base_version": 1,
                "fields": original["fields"],
                "images": [placement],
            },
            format="json",
        )

        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.data["images"], [placement])

        # Existing frontend requests omit images.
        # Their saves must retain the current image placements.
        preserved = self.client.post(
            url,
            {
                "base_version": 2,
                "fields": original["fields"],
            },
            format="json",
        )

        self.assertEqual(preserved.status_code, 201)
        self.assertEqual(preserved.data["images"], [placement])

        removed = self.client.post(
            url,
            {
                "base_version": 3,
                "fields": original["fields"],
                "images": [],
            },
            format="json",
        )

        self.assertEqual(removed.status_code, 201)
        self.assertEqual(removed.data["images"], [])

        earlier = CertificateTemplateVersion.objects.get(
            id=saved.data["id"]
        )
        self.assertEqual(earlier.images, [placement])

        preview = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[earlier.id],
            ),
            {"sample_name": "Souvik Khaitan"},
            format="json",
        )

        self.assertEqual(preview.status_code, 200)
        content = b"".join(preview.streaming_content)

        self.assertTrue(content.startswith(b"%PDF-"))
        self.assertIn(b"/SMask", content)

    def test_off_page_image_placement_is_rejected(self):
        version = self.get_version()
        template = CertificateTemplate.objects.get()

        uploaded = self.upload_signature_asset(template.id)
        self.assertEqual(uploaded.status_code, 201)

        placement = {
            **self.image_placement(uploaded.data["id"]),
            "x": 0.95,
            "width": 0.25,
        }

        response = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[version["id"]],
            ),
            {
                "sample_name": "Souvik Khaitan",
                "images": [placement],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_image_rotation_is_saved_and_renders(self):
        original = self.get_version()
        template = CertificateTemplate.objects.get()

        uploaded = self.upload_signature_asset(template.id)
        self.assertEqual(uploaded.status_code, 201)

        placement = {
            **self.image_placement(uploaded.data["id"]),
            "rotation": 45,
        }

        saved = self.client.post(
            reverse(
                "certificate-template-versions",
                args=[template.id],
            ),
            {
                "base_version": 1,
                "fields": original["fields"],
                "images": [placement],
            },
            format="json",
        )

        self.assertEqual(saved.status_code, 201)
        self.assertEqual(
            saved.data["images"][0]["rotation"],
            45,
        )

        from unittest.mock import MagicMock
        from .asset_services import draw_certificate_images

        version = CertificateTemplateVersion.objects.get(
            id=saved.data["id"]
        )
        pdf = MagicMock()

        draw_certificate_images(
            pdf,
            version,
            version.images,
            841.89,
            595.28,
            24,
        )

        pdf.rotate.assert_called_once_with(-45)
        pdf.saveState.assert_called_once()
        pdf.restoreState.assert_called_once()
        pdf.drawImage.assert_called_once()

        preview = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[version.id],
            ),
            {"sample_name": "Souvik Khaitan"},
            format="json",
        )

        self.assertEqual(preview.status_code, 200)
        self.assertTrue(
            b"".join(preview.streaming_content).startswith(b"%PDF-")
        )

    def test_invalid_image_rotation_is_rejected(self):
        version = self.get_version()
        template = CertificateTemplate.objects.get()

        uploaded = self.upload_signature_asset(template.id)
        self.assertEqual(uploaded.status_code, 201)

        response = self.client.post(
            reverse(
                "certificate-version-preview",
                args=[version["id"]],
            ),
            {
                "images": [{
                    **self.image_placement(uploaded.data["id"]),
                    "rotation": 181,
                }],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)