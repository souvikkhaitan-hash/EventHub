from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PrivateCertificateStorage(FileSystemStorage):
    """
    Store certificate artwork outside public static/media routes.

    Authorization is enforced by the API that serves each file.
    """

    @property
    def location(self):
        return str(
            Path(settings.CERTIFICATE_STORAGE_ROOT).resolve()
        )

    def url(self, name):
        raise ValueError(
            "Certificate artwork has no public storage URL."
        )