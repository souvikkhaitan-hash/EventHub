import time
from collections import Counter

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from accounts.organizer_notifications import (
    process_next_notification,
)


class Command(BaseCommand):
    help = "Send queued organizer application emails."

    def add_arguments(self, parser):
        parser.add_argument(
            "--watch",
            action="store_true",
            help="Keep checking for new notifications.",
        )

        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum notifications per batch.",
        )

    def handle(self, *args, **options):
        limit = options["limit"]

        if limit < 1:
            self.stderr.write("--limit must be at least 1.")
            return

        self.stdout.write(
            "Organizer email worker started. "
            "Use Ctrl+C to stop."
        )

        try:
            while True:
                close_old_connections()
                counts = Counter()

                for _ in range(limit):
                    result = process_next_notification()

                    if result is None:
                        break

                    counts[result] += 1

                if counts:
                    self.stdout.write(
                        "Batch: "
                        + ", ".join(
                            f"{key}={value}"
                            for key, value in sorted(counts.items())
                        )
                    )

                if not options["watch"]:
                    break

                time.sleep(5)

        except KeyboardInterrupt:
            self.stdout.write("Organizer email worker stopped.")

        finally:
            close_old_connections()