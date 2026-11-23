"""
Run Django, private FastAPI analytics and background jobs on Render.
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


def signal_child(child, signal_number):
    if child.poll() is not None:
        return

    try:
        os.killpg(child.pid, signal_number)
    except ProcessLookupError:
        pass


def cleanup():
    for child in children:
        signal_child(child, signal.SIGTERM)

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
            signal_child(child, signal.SIGKILL)
            child.wait()


def run_setup(args):
    child = launch(args, "backend")

    while child.poll() is None and not stopping:
        time.sleep(0.2)

    if stopping:
        return False

    if child.returncode != 0:
        raise RuntimeError(
            f"Setup command failed: {' '.join(args)}"
        )

    return True


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    try:
        if not run_setup(
            ["manage.py", "migrate", "--noinput"]
        ):
            return 0

        # Database cache tables are created separately from migrations.
        # This command skips tables that already exist.
        if not run_setup(
            ["manage.py", "createcachetable"]
        ):
            return 0

        services = [
            (
                "FastAPI analytics",
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
                ),
            ),
            (
                "Django API",
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
                ),
            ),
            (
                "Background jobs",
                launch(
                    [
                        "manage.py",
                        "process_eventhub_jobs",
                        "--watch",
                    ],
                    "backend",
                ),
            ),
        ]

        for name, child in services:
            print(
                f"Started {name} with PID {child.pid}.",
                flush=True,
            )

        while not stopping:
            for name, child in services:
                if child.poll() is not None:
                    print(
                        f"{name} exited with code "
                        f"{child.returncode}; stopping all services.",
                        flush=True,
                    )
                    return 1

            time.sleep(0.5)

        return 0

    except Exception as error:
        print(
            f"Startup failed: {error}",
            file=sys.stderr,
            flush=True,
        )
        return 1

    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(main())