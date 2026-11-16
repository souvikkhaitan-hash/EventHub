import re

from reportlab.pdfbase import pdfmetrics


PLACEHOLDERS = [
    "participant_name",
    "event_name",
    "event_date",
    "team_name",
    "position",
    "certificate_type",
    "organizer_name",
    "certificate_id",
    "issue_date",
]

TOKEN_PATTERN = re.compile(r"\{([a-z_]+)\}")


def validate_template_text(text):
    """
    Accept literal text and explicitly approved placeholders.

    No Python expressions, attribute access or format expressions
    are evaluated.
    """
    text = (
        text.replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\t", "    ")
    )

    if any(
        ord(character) < 32 and character != "\n"
        for character in text
    ):
        raise ValueError(
            "Text contains unsupported control characters."
        )

    for match in TOKEN_PATTERN.finditer(text):
        if match.group(1) not in PLACEHOLDERS:
            raise ValueError(
                f"Unknown placeholder: {match.group(0)}"
            )

    remainder = TOKEN_PATTERN.sub("", text)

    if "{" in remainder or "}" in remainder:
        raise ValueError(
            "Use placeholders such as {participant_name}. "
            "Expressions and unmatched braces are not supported."
        )

    return text


def expand_template_text(text, values):
    text = validate_template_text(text)

    def substitute(match):
        key = match.group(1)

        if key not in values:
            raise ValueError(
                f"No approved value is available for {{{key}}}."
            )

        return str(values[key])

    expanded = TOKEN_PATTERN.sub(substitute, text)

    if len(expanded) > 10000:
        raise ValueError(
            "The expanded text is too long for one certificate box."
        )

    return expanded


def wrap_lines(text, font_name, font_size, box_width):
    """
    Wrap words using the same font measurements used in the PDF.

    Explicit newlines and blank paragraphs are preserved.
    Long words are split when necessary.
    """
    lines = []

    def fits(value):
        return (
            pdfmetrics.stringWidth(
                value,
                font_name,
                font_size,
            )
            <= box_width + 0.001
        )

    for paragraph in text.split("\n"):
        current = ""

        for word in paragraph.split():
            candidate = f"{current} {word}" if current else word

            if fits(candidate):
                current = candidate
                continue

            if current:
                lines.append(current)
                current = ""

            if fits(word):
                current = word
                continue

            # Handle a single word longer than the box.
            for character in word:
                candidate = current + character

                if current and not fits(candidate):
                    lines.append(current)
                    current = character
                else:
                    current = candidate

        lines.append(current)

    return lines or [""]


def fit_layout(
    text,
    field,
    font_name,
    box_width,
    box_height,
    *,
    multiline,
):
    """
    Return lines and font metrics that fit inside the box.

    Single placeholders stay on one line.
    Paragraph boxes wrap and shrink within the configured limits.
    """
    font = pdfmetrics.getFont(font_name)

    for character in text:
        if character == "\n" and multiline:
            continue

        if (
            ord(character) < 32
            or ord(character) not in font.face.charToGlyph
        ):
            raise ValueError(
                "The selected font cannot render every character "
                "in this text. An appropriate font is required."
            )

    line_spacing = field.get("line_spacing", 1.25)

    def measure(size):
        lines = (
            wrap_lines(text, font_name, size, box_width)
            if multiline
            else [text]
        )

        ascent, descent = pdfmetrics.getAscentDescent(
            font_name,
            size,
        )

        leading = size * line_spacing

        total_height = (
            ascent - descent
            + max(0, len(lines) - 1) * leading
        )

        maximum_width = max(
            pdfmetrics.stringWidth(line, font_name, size)
            for line in lines
        )

        fits = (
            maximum_width <= box_width + 0.001
            and total_height <= box_height + 0.001
        )

        return {
            "lines": lines,
            "size": size,
            "ascent": ascent,
            "descent": descent,
            "leading": leading,
            "height": total_height,
            "fits": fits,
        }

    maximum = field["font_size"]
    minimum = field["min_font_size"]

    result = measure(maximum)

    if result["fits"]:
        return result

    result = measure(minimum)

    if not result["fits"]:
        raise ValueError(
            "Text does not fit at the minimum font size. "
            "Enlarge the box, shorten the wording or lower "
            "the minimum font size."
        )

    # Find a suitable size without a long per-point loop.
    low = minimum
    high = maximum

    for _ in range(14):
        middle = (low + high) / 2
        candidate = measure(middle)

        if candidate["fits"]:
            low = middle
            result = candidate
        else:
            high = middle

    return result