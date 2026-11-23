"""
Run public Django and private FastAPI analytics on Render.
"""

import os
from pathlib import Path
import signal
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent

children = []
stopping = False


def stop(signum, frame):
    global stopping
    stopping = True


def launch(args, directory):
    child = subprocess.Popen(
        [sys.executable, *args],
        cwd=ROOT / directory,
        start_new_session=True,
    )

    children.append(child)
    return child


def cleanup():
    for child in children:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)

    deadline = time.monotonic() + 30

    for child in children:
        try:
            child.wait(
                timeout=max(
                    0.1,
                    deadline - time.monotonic(),
                )
            )
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    try:
        migration = launch(
            ["manage.py", "migrate", "--noinput"],
            "backend",
        )

        while migration.poll() is None and not stopping:
            time.sleep(0.2)

        if stopping:
            return 0

        if migration.returncode != 0:
            return 1

        launch(
            [
                "-m",
                "uvicorn",
                "main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8001",
                "--workers",
                "1",
            ],
            "analytics_service",
        )

        launch(
            [
                "-m",
                "gunicorn",
                "config.wsgi:application",
                "--bind",
                "0.0.0.0:" + os.getenv("PORT", "10000"),
                "--workers",
                "1",
                "--threads",
                "2",
                "--timeout",
                "120",
                "--access-logfile",
                "-",
                "--error-logfile",
                "-",
            ],
            "backend",
        )

        launch(
            [
                "manage.py",
                "process_eventhub_jobs",
                "--watch",
            ],
            "backend",
        )

        while not stopping:
            if any(
                child.poll() is not None
                for child in children[1:]
            ):
                print(
                    "A server stopped; shutting down both services.",
                    flush=True,
                )
                return 1

            time.sleep(0.5)

        return 0

    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(main())