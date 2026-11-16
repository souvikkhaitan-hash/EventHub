from django.test import SimpleTestCase

from reportlab.pdfbase import pdfmetrics

from .services import register_certificate_fonts
from .text_layout import (
    expand_template_text,
    fit_layout,
    validate_template_text,
)


class CertificateTextLayoutTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fonts = register_certificate_fonts()

    def field(self, **changes):
        return {
            "font_size": 28,
            "min_font_size": 8,
            "line_spacing": 1.25,
            **changes,
        }

    def test_approved_values_are_substituted(self):
        result = expand_template_text(
            "{participant_name} attended {event_name}.",
            {
                "participant_name": "Souvik Khaitan",
                "event_name": "Campus Workshop",
            },
        )

        self.assertEqual(
            result,
            "Souvik Khaitan attended Campus Workshop.",
        )

    def test_unknown_and_expression_placeholders_are_rejected(self):
        for text in [
            "{unknown_value}",
            "{participant_name.__class__}",
            "{participant_name",
            "{{participant_name}}",
        ]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    validate_template_text(text)

    def test_paragraph_wraps_without_losing_text(self):
        text = (
            "Souvik Khaitan successfully participated in the "
            "Campus Innovation Challenge and demonstrated "
            "creativity, teamwork and enthusiasm."
        )

        font_name = self.fonts["sans"]

        layout = fit_layout(
            text,
            self.field(),
            font_name,
            230,
            160,
            multiline=True,
        )

        self.assertGreater(len(layout["lines"]), 1)
        self.assertLessEqual(layout["height"], 160.001)

        for line in layout["lines"]:
            self.assertLessEqual(
                pdfmetrics.stringWidth(
                    line,
                    font_name,
                    layout["size"],
                ),
                230.001,
            )

        self.assertEqual(
            "".join(layout["lines"]).replace(" ", ""),
            text.replace(" ", ""),
        )

    def test_explicit_line_breaks_are_preserved(self):
        layout = fit_layout(
            "First line.\nSecond line.",
            self.field(font_size=18),
            self.fonts["sans-italic"],
            400,
            200,
            multiline=True,
        )

        self.assertEqual(
            layout["lines"],
            ["First line.", "Second line."],
        )

    def test_text_that_cannot_fit_is_rejected(self):
        with self.assertRaises(ValueError):
            fit_layout(
                "This paragraph cannot fit in this tiny box.",
                self.field(),
                self.fonts["sans"],
                10,
                2,
                multiline=True,
            )

    def test_single_placeholder_stays_on_one_line(self):
        name = "Alexandra Catherine Morgan"

        layout = fit_layout(
            name,
            self.field(font_size=48),
            self.fonts["sans-bold"],
            300,
            60,
            multiline=False,
        )

        self.assertEqual(layout["lines"], [name])
        self.assertLess(layout["size"], 48)
        self.assertGreaterEqual(layout["size"], 8)