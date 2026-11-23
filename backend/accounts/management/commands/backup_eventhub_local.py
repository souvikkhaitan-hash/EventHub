import hashlib
import json
import os
import shutil
import subprocess
import uuid
import zipfile

from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


def sha256_file(path):
    digest = hashlib.sha256()

    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def run_tool(arguments, environment):
    try:
        result = subprocess.run(
            arguments,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=1800,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise CommandError(
            "Backup tool timed out. No completed backup was created."
        ) from None
    except OSError:
        raise CommandError(
            "Unable to start the PostgreSQL backup tool."
        ) from None

    if result.returncode:
        # Avoid printing connection details or credentials.
        raise CommandError(
            "PostgreSQL backup validation failed. "
            "Check database connectivity, permissions and tool versions."
        )

    if result.stderr.strip():
        raise CommandError(
            "PostgreSQL reported a warning. "
            "The backup was not marked complete; investigate before retrying."
        )


class Command(BaseCommand):
    help = "Back up local EventHub PostgreSQL and private certificate files."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            required=True,
            help="Private backup directory outside the repository.",
        )
        parser.add_argument(
            "--writers-paused",
            action="store_true",
            help="Confirm the local backend and workers have been stopped.",
        )

    def handle(self, *args, **options):
        if not options["writers_paused"]:
            raise CommandError(
                "Stop the local backend and workers first, then use "
                "--writers-paused."
            )

        database = settings.DATABASES["default"]

        if "postgresql" not in database.get("ENGINE", ""):
            raise CommandError("This command requires PostgreSQL.")

        if database.get("HOST") not in {
            "127.0.0.1",
            "localhost",
            "::1",
        }:
            raise CommandError(
                "This command is restricted to a local database."
            )

        if getattr(settings, "CERTIFICATE_STORAGE_BACKEND", None) == "s3":
            raise CommandError(
                "Certificates use S3. This local command cannot back them up."
            )

        root_setting = getattr(
            settings,
            "CERTIFICATE_STORAGE_ROOT",
            None,
        )

        if not root_setting:
            raise CommandError("CERTIFICATE_STORAGE_ROOT is not configured.")

        certificate_root = Path(root_setting).resolve()

        if not certificate_root.is_dir():
            raise CommandError(
                "The private certificate directory does not exist. "
                "Check CERTIFICATE_STORAGE_ROOT before continuing."
            )

        if settings.MEDIA_ROOT:
            raise CommandError(
                "MEDIA_ROOT is configured. Review its files and add them "
                "to the backup before using this command."
            )

        pg_dump = shutil.which("pg_dump")
        pg_restore = shutil.which("pg_restore")

        if not pg_dump or not pg_restore:
            raise CommandError(
                "Both pg_dump and pg_restore must be available on PATH."
            )

        output_root = Path(options["output"]).expanduser().resolve()
        repository_root = Path(settings.BASE_DIR).resolve().parent

        for excluded_root in (repository_root, certificate_root):
            if (
                output_root == excluded_root
                or excluded_root in output_root.parents
            ):
                raise CommandError(
                    "Choose a backup directory outside the repository "
                    "and certificate storage."
                )

        output_root.mkdir(parents=True, exist_ok=True)

        started_at = datetime.now(timezone.utc)
        backup_name = (
            f"eventhub-{started_at:%Y%m%dT%H%M%SZ}-"
            f"{uuid.uuid4().hex[:8]}"
        )

        pending = output_root / f".{backup_name}.partial"
        completed = output_root / backup_name
        pending.mkdir(mode=0o700)

        try:
            environment = os.environ.copy()

            # Override inherited connection settings with Django's database.
            for key in (
                "PGSERVICE",
                "PGSERVICEFILE",
                "PGOPTIONS",
                "PGDATABASE",
                "PGHOSTADDR",
            ):
                environment.pop(key, None)

            environment.update({
                "PGHOST": str(database["HOST"]),
                "PGPORT": str(database.get("PORT") or "5432"),
                "PGDATABASE": str(database["NAME"]),
                "PGUSER": str(database["USER"]),
                "PGPASSWORD": str(database.get("PASSWORD") or ""),
                "PGCONNECT_TIMEOUT": "15",
                "PGAPPNAME": "eventhub_local_backup",
            })

            sslmode = database.get("OPTIONS", {}).get("sslmode")
            if sslmode:
                environment["PGSSLMODE"] = str(sslmode)

            dump_path = pending / "database.dump"

            self.stdout.write("Backing up local PostgreSQL...")

            run_tool(
                [
                    pg_dump,
                    "--format=custom",
                    "--no-password",
                    "--file",
                    str(dump_path),
                ],
                environment,
            )

            # Validate that pg_restore can read the archive catalogue.
            # A real restore test is still required afterward.
            run_tool(
                [pg_restore, "--list", str(dump_path)],
                environment,
            )

            self.stdout.write("Backing up private certificate files...")

            archive_path = pending / "private-certificates.zip"
            file_count = 0

            with zipfile.ZipFile(
                archive_path,
                mode="x",
                compression=zipfile.ZIP_DEFLATED,
                allowZip64=True,
            ) as archive:
                for directory, directories, files in os.walk(
                    certificate_root,
                    followlinks=False,
                ):
                    directory_path = Path(directory)

                    for name in directories + files:
                        item = directory_path / name

                        if item.is_symlink() or (
                            hasattr(item, "is_junction")
                            and item.is_junction()
                        ):
                            raise CommandError(
                                "Linked certificate paths need manual review."
                            )

                    for name in files:
                        source = directory_path / name

                        if not source.is_file():
                            raise CommandError(
                                "An unsupported certificate storage item "
                                "was found."
                            )

                        archive.write(
                            source,
                            arcname=source.relative_to(
                                certificate_root
                            ).as_posix(),
                        )
                        file_count += 1

            with zipfile.ZipFile(archive_path) as archive:
                if archive.testzip() is not None:
                    raise CommandError(
                        "Certificate archive integrity check failed."
                    )

            manifest = {
                "schema": "eventhub.local_backup.v1",
                "started_at": started_at.isoformat(),
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "database_name": str(database["NAME"]),
                "certificate_file_count": file_count,
                "writers_paused_by_operator": True,
                "restore_tested": False,
                "files": {},
                "exclusions": [
                    "Database server roles and passwords",
                    "Application source code and environment secrets",
                    "Hosted or external object storage",
                ],
            }

            for path in (dump_path, archive_path):
                manifest["files"][path.name] = {
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }

            (pending / "manifest.json").write_text(
                json.dumps(manifest, indent=2),
                encoding="utf-8",
            )

            # Only a fully created and checked bundle receives its final name.
            pending.rename(completed)

        except Exception:
            shutil.rmtree(pending, ignore_errors=True)
            raise

        self.stdout.write(
            self.style.SUCCESS(
                f"Backup created: {completed}\n"
                f"Private certificate files: {file_count}\n"
                "Archive checks passed. Restore testing is still required."
            )
        )