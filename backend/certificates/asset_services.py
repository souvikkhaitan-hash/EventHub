from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from reportlab.lib.utils import ImageReader
from rest_framework.exceptions import ValidationError

from .asset_serializers import ImagePlacementSerializer
from .models import CertificateAsset
from math import cos, radians, sin

MAX_ASSET_BYTES = 5 * 1024 * 1024
MAX_ASSET_SIDE = 4000
MAX_ASSET_PIXELS = 4_000_000


def normalize_asset(upload):
    """
    Decode an uploaded image and produce a clean RGBA PNG.

    Transparency is preserved for signatures and logos.
    Original metadata is not copied.
    """
    raw = upload.read(MAX_ASSET_BYTES + 1)

    if not raw or len(raw) > MAX_ASSET_BYTES:
        raise ValidationError({
            "image": "Upload a PNG or JPG no larger than 5 MB."
        })

    try:
        with Image.open(
            BytesIO(raw),
            formats=["PNG", "JPEG"],
        ) as probe:
            width, height = probe.size

            if (
                min(width, height) < 1
                or max(width, height) > MAX_ASSET_SIDE
                or width * height > MAX_ASSET_PIXELS
            ):
                raise ValidationError({
                    "image": (
                        "Use an image with no side above 4000 pixels "
                        "and no more than 4 million pixels."
                    )
                })

            if getattr(probe, "n_frames", 1) != 1:
                raise ValidationError({
                    "image": "Animated images are not supported."
                })

            probe.verify()

        with Image.open(
            BytesIO(raw),
            formats=["PNG", "JPEG"],
        ) as original:
            original.load()

            oriented = ImageOps.exif_transpose(original)
            clean = oriented.convert("RGBA")

            if clean.getchannel("A").getbbox() is None:
                raise ValidationError({
                    "image": "The uploaded image is fully transparent."
                })

            width, height = clean.size

            # A new image prevents original metadata being carried over.
            normalized = Image.new(
                "RGBA",
                clean.size,
                (0, 0, 0, 0),
            )
            normalized.paste(clean)

            output = BytesIO()
            normalized.save(output, format="PNG")

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
    ) as exc:
        raise ValidationError({
            "image": "The file is not a valid PNG or JPG image."
        }) from exc

    return output.getvalue(), width, height


def get_template_assets(template, placements):
    """
    Resolve asset IDs only within the selected template.
    """
    asset_ids = {
        placement["asset_id"]
        for placement in placements
    }

    assets = CertificateAsset.objects.filter(
        template=template,
        id__in=asset_ids,
    ).in_bulk()

    if set(assets) != asset_ids:
        raise ValidationError({
            "images": (
                "One or more images are unavailable "
                "for this certificate template."
            )
        })

    return assets


def draw_certificate_images(
    pdf,
    version,
    placements,
    artwork_width,
    artwork_height,
    footer_height,
):
    """
    Rotate each image around its centre and fit the complete
    rotated image inside its placement box.

    Positive angles are clockwise, matching the browser.
    """
    serializer = ImagePlacementSerializer(
        data=placements,
        many=True,
        max_length=20,
        allow_empty=True,
    )
    serializer.is_valid(raise_exception=True)

    placements = serializer.validated_data
    assets = get_template_assets(version.template, placements)

    for placement in placements:
        asset = assets[placement["asset_id"]]

        box_width = placement["width"] * artwork_width
        box_height = placement["height"] * artwork_height

        centre_x = (
            placement["x"] * artwork_width
            + box_width / 2
        )

        centre_y = (
            footer_height
            + artwork_height
            - placement["y"] * artwork_height
            - box_height / 2
        )

        angle = placement["rotation"]
        angle_radians = radians(angle)

        cosine = abs(cos(angle_radians))
        sine = abs(sin(angle_radians))

        rotated_width = (
            asset.image_width * cosine
            + asset.image_height * sine
        )

        rotated_height = (
            asset.image_width * sine
            + asset.image_height * cosine
        )

        scale = min(
            box_width / rotated_width,
            box_height / rotated_height,
        )

        image_width = asset.image_width * scale
        image_height = asset.image_height * scale

        pdf.saveState()

        try:
            pdf.translate(centre_x, centre_y)
            pdf.rotate(-angle)

            with asset.image.storage.open(
                asset.image.name,
                "rb",
            ) as image_file:
                pdf.drawImage(
                    ImageReader(image_file),
                    -image_width / 2,
                    -image_height / 2,
                    width=image_width,
                    height=image_height,
                    mask="auto",
                )
        finally:
            pdf.restoreState()