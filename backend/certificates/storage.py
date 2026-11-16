from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage, Storage
from django.utils.deconstruct import deconstructible


@deconstructible
class PrivateCertificateStorage(Storage):
    """
    Private certificate storage.

    Files are served through authorized Django views.
    Public storage URLs are deliberately unavailable.
    """

    @property
    def backend(self):
        if settings.CERTIFICATE_STORAGE_BACKEND == "s3":
            from storages.backends.s3 import S3Storage

            return S3Storage(
                **settings.CERTIFICATE_S3_OPTIONS
            )

        return FileSystemStorage(
            location=str(
                Path(
                    settings.CERTIFICATE_STORAGE_ROOT
                ).resolve()
            )
        )

    def _open(self, name, mode="rb"):
        return self.backend.open(name, mode)

    def _save(self, name, content):
        return self.backend.save(name, content)

    def exists(self, name):
        return self.backend.exists(name)

    def delete(self, name):
        return self.backend.delete(name)

    def size(self, name):
        return self.backend.size(name)

    def get_modified_time(self, name):
        return self.backend.get_modified_time(name)

    def url(self, name):
        raise ValueError(
            "Certificate files have no public storage URL."
        )