from io import BytesIO
from pathlib import Path

import reportlab
from PIL import Image, ImageOps, UnidentifiedImageError

from django.utils import timezone

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from .asset_services import draw_certificate_images
from rest_framework.exceptions import ValidationError
from .text_layout import expand_template_text, fit_layout

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_SIDE = 6000


def normalize_background(upload):
    """
    Decode PNG/JPEG input and save a fresh PNG.

    This avoids trusting filenames or content-type headers,
    applies EXIF orientation, and excludes original metadata.
    """
    raw = upload.read(MAX_UPLOAD_BYTES + 1)

    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise ValidationError({
            "background": "Upload a PNG or JPG no larger than 10 MB."
        })

    try:
        with Image.open(
            BytesIO(raw),
            formats=["PNG", "JPEG"],
        ) as probe:
            width, height = probe.size

            if (
                width < 400
                or height < 400
                or max(width, height) > MAX_IMAGE_SIDE
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise ValidationError({
                    "background": (
                        "Use an image at least 400 × 400 pixels, "
                        "with no side above 6000 pixels and "
                        "no more than 16 million pixels."
                    )
                })

            if getattr(probe, "n_frames", 1) != 1:
                raise ValidationError({
                    "background": "Animated images are not supported."
                })

            probe.verify()

        with Image.open(
            BytesIO(raw),
            formats=["PNG", "JPEG"],
        ) as original:
            original.load()
            oriented = ImageOps.exif_transpose(original)

            width, height = oriented.size
            ratio = width / height

            if not 0.5 <= ratio <= 2:
                raise ValidationError({
                    "background": (
                        "Use a portrait or landscape certificate "
                        "with an aspect ratio between 1:2 and 2:1."
                    )
                })

            rgba = oriented.convert("RGBA")

            # Flatten transparency onto white.
            clean_image = Image.new(
                "RGB",
                rgba.size,
                "white",
            )
            clean_image.paste(
                rgba,
                mask=rgba.getchannel("A"),
            )

            output = BytesIO()
            clean_image.save(output, format="PNG")

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
    ) as exc:
        raise ValidationError({
            "background": "The file is not a valid supported image."
        }) from exc

    return output.getvalue(), width, height


def register_certificate_fonts():
    """
    Register approved, locally bundled fonts.

    Existing font identifiers remain unchanged so saved layouts
    continue to render with their original fonts.
    """
    bundled_directory = (
        Path(reportlab.__file__).resolve().parent / "fonts"
    )

    fonts = {
        "sans": (
            "EventHubSans",
            bundled_directory / "Vera.ttf",
        ),
        "sans-bold": (
            "EventHubSansBold",
            bundled_directory / "VeraBd.ttf",
        ),
        "sans-italic": (
            "EventHubSansItalic",
            bundled_directory / "VeraIt.ttf",
        ),
        "sans-bold-italic": (
            "EventHubSansBoldItalic",
            bundled_directory / "VeraBI.ttf",
        ),
    }

    script_path = (
        Path(__file__).resolve().parent
        / "fonts"
        / "Allura-Regular.ttf"
    )

    # A missing optional font must not break existing templates.
    if script_path.is_file():
        fonts["script-allura-v1"] = (
            "EventHubAlluraV1",
            script_path,
        )

    for pdf_name, path in fonts.values():
        if pdf_name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(
                TTFont(pdf_name, str(path))
            )

    return {
        key: pdf_name
        for key, (pdf_name, _) in fonts.items()
    }

def sample_values(version, sample_name):
    event = version.template.event
    organizer = event.organizer

    return {
        "participant_name": sample_name,
        "event_name": event.title,
        "event_date": timezone.localtime(
            event.start_datetime
        ).strftime("%d %B %Y"),
        "team_name": "Sample Team",
        "position": "Winner (sample)",
        "certificate_type": "Participation",
        "organizer_name": (
            organizer.get_full_name()
            or organizer.username
        ),
        "certificate_id": "PREVIEW-ONLY",
        "issue_date": timezone.localdate().strftime(
            "%d %B %Y"
        ),
    }


def render_sample_pdf(version, fields, sample_name, *, images=None, resolved_values=None,preview_label="SAMPLE PREVIEW - NOT AN ISSUED CERTIFICATE",):
    font_names = register_certificate_fonts()
    values = (sample_values(version, sample_name)if resolved_values is None else resolved_values)

    artwork_width = (
        841.89
        if version.image_width > version.image_height
        else 595.28
    )

    artwork_height = (
        artwork_width
        * version.image_height
        / version.image_width
    )

    # A separate sample-only footer avoids covering the artwork.
    footer_height = 24  if preview_label else 0

    output = BytesIO()

    pdf = canvas.Canvas(
        output,
        pagesize=(
            artwork_width,
            artwork_height + footer_height,
        ),
        pageCompression=1,
    )

    pdf.setTitle(
        "EventHub certificate"
        if preview_label is None
        else "EventHub certificate preview"
    )

    with version.background.storage.open(
        version.background.name,
        "rb",
    ) as background:
        pdf.drawImage(
            ImageReader(background),
            0,
            footer_height,
            width=artwork_width,
            height=artwork_height,
        )
    draw_certificate_images(
        pdf,
        version,
        version.images if images is None else images,
        artwork_width,
        artwork_height,
        footer_height,
    )

    for field in fields:
        template_text = field.get("text", "")
        multiline = bool(template_text.strip())

        try:
            text = (
                expand_template_text(template_text, values)
                if multiline
                else values[field["placeholder"]]
            )

            font_name = font_names.get(field["font"])

            if font_name is None:
                raise ValueError(
                    "The selected font is unavailable on the server. "
                    "Install the approved certificate font or select "
                    "another font."
                )

            box_x = field["x"] * artwork_width
            box_top = field["y"] * artwork_height
            box_width = field["width"] * artwork_width
            box_height = field["height"] * artwork_height

            layout = fit_layout(
                text,
                field,
                font_name,
                box_width,
                box_height,
                multiline=multiline,
            )

        except ValueError as exc:
            label = (
                "Text block"
                if multiline
                else field["placeholder"]
            )

            raise ValidationError({
                "fields": f"{label}: {exc}"
            }) from exc

        valign = field.get("valign", "middle")

        if valign == "top":
            vertical_offset = 0
        elif valign == "bottom":
            vertical_offset = box_height - layout["height"]
        else:
            vertical_offset = (
                box_height - layout["height"]
            ) / 2

        first_baseline = (
            footer_height
            + artwork_height
            - box_top
            - vertical_offset
            - layout["ascent"]
        )

        pdf.setFont(font_name, layout["size"])
        pdf.setFillColor(HexColor(field["color"]))

        for line_number, line in enumerate(layout["lines"]):
            baseline = (
                first_baseline
                - line_number * layout["leading"]
            )

            if field["align"] == "center":
                pdf.drawCentredString(
                    box_x + box_width / 2,
                    baseline,
                    line,
                )
            elif field["align"] == "right":
                pdf.drawRightString(
                    box_x + box_width,
                    baseline,
                    line,
                )
            else:
                pdf.drawString(
                    box_x,
                    baseline,
                    line,
                )

        if preview_label:
            pdf.setFont(font_names["sans"], 8)
            pdf.setFillColor(HexColor("#666666"))

            pdf.drawCentredString(
                artwork_width / 2,
                8,
                preview_label,
            )

    pdf.showPage()
    pdf.save()

    output.seek(0)
    return output