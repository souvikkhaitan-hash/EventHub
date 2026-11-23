import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Link, useParams } from "react-router";

import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";

import AttendanceLookup from "../components/AttendanceLookup";
import { useEventAccess } from "../components/EventAccessGate";

import {
  getOrganizerAttendance,
  checkInStudent,
  checkInRegisteredStudent,
} from "../services/events";

import "../styles/attendance-editorial.css";
import AttendanceExports from "../components/AttendanceExports";

// Release the previous camera before opening another scanner.
let cameraRelease = Promise.resolve();

function message(error) {
  const candidates = [
    error?.details?.message,
    error?.details?.detail,
    error?.message,
  ];

  return (
    candidates.find(
      (value) => typeof value === "string" && value.trim()
    ) || "Please try again."
  );
}

function dateTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function Camera({ onCapture, onError }) {
  const uniqueId = useId();

  const readerId = `attendance-reader-${uniqueId.replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  )}`;

  useEffect(() => {
    let disposed = false;
    let captured = false;
    let scanner;

    async function start() {
      await cameraRelease;

      if (disposed) return;

      try {
        scanner = new Html5QrcodeScanner(
          readerId,
          {
            fps: 10,
            qrbox: {
              width: 220,
              height: 220,
            },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.QR_CODE,
            ],
            rememberLastUsedCamera: false,
            showTorchButtonIfSupported: true,
          },
          false
        );

        scanner.render(
          (text) => {
            if (
              disposed ||
              captured ||
              typeof text !== "string" ||
              !text.trim()
            ) {
              return;
            }

            captured = true;
            onCapture(text.trim());
          },
          () => {
            // Frames without a readable QR are normal.
          }
        );
      } catch (error) {
        if (!disposed) {
          onError(message(error));
        }
      }
    }

    start();

    return () => {
      disposed = true;

      if (scanner) {
        cameraRelease = cameraRelease
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [readerId, onCapture, onError]);

  return <div id={readerId} className="at-reader" />;
}

export default function OrganizerAttendance() {
  const { id } = useParams();

  return <AttendanceWorkspace key={id} id={id} />;
}

function AttendanceWorkspace({ id }) {
  const access = useEventAccess();

  const canViewParticipants = Boolean(
    access?.capabilities?.includes("view_participants")
  );

  const canCheckIn = Boolean(
    access?.capabilities?.includes("check_in")
  );

  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");

  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [checkError, setCheckError] = useState("");

  const [filter, setFilter] = useState("all");

  const active = useRef(false);
  const request = useRef(0);
  const submitting = useRef(false);
  const tokenInput = useRef(null);

  const workspacePath = `/organizer/events/${id}/workspace`;

  const refresh = useCallback(async () => {
    const current = ++request.current;

    setRefreshing(true);
    setError("");

    try {
      const response = await getOrganizerAttendance(id);

      if (
        !response?.event ||
        !response?.statistics ||
        !Array.isArray(response.attendance)
      ) {
        throw new Error(
          "Attendance information could not be loaded."
        );
      }

      if (
        active.current &&
        current === request.current
      ) {
        setData(response);
      }
    } catch (err) {
      if (
        active.current &&
        current === request.current
      ) {
        setError(message(err));
      }
    } finally {
      if (
        active.current &&
        current === request.current
      ) {
        setRefreshing(false);
      }
    }
  }, [id]);

  useEffect(() => {
    active.current = true;
    refresh();

    return () => {
      active.current = false;
      request.current += 1;
    };
  }, [refresh]);

  const capture = useCallback((value) => {
    setToken(value);
    setResult(null);
    setCheckError("");
    setScanning(false);

    tokenInput.current?.focus();
  }, []);

  const failCamera = useCallback((value) => {
    setCameraError(value);
    setScanning(false);
  }, []);

  async function performCheckIn(sendRequest) {
    if (
      !canCheckIn ||
      submitting.current ||
      scanning ||
      refreshing
    ) {
      return false;
    }

    submitting.current = true;
    setChecking(true);
    setCheckError("");
    setResult(null);

    try {
      const response = await sendRequest();

      if (!active.current) return false;

      setResult(response);
      setToken("");

      // A refresh failure must not hide a successful check-in.
      await refresh();

      return true;
    } catch (err) {
      if (active.current) {
        setCheckError(message(err));
      }

      return false;
    } finally {
      submitting.current = false;

      if (active.current) {
        setChecking(false);
      }
    }
  }

  async function submit(event) {
    event.preventDefault();

    const value = token.trim();

    if (!value) return;

    await performCheckIn(
      () => checkInStudent(id, value)
    );
  }

  async function checkInRegistration(registrationId) {
    return performCheckIn(
      () => checkInRegisteredStudent(id, registrationId)
    );
  }

  const records = useMemo(
    () => data?.attendance || [],
    [data]
  );

  const filtered = useMemo(
    () =>
      records.filter(
        (record) =>
          filter === "all" ||
          record.attendance_status === filter
      ),
    [records, filter]
  );

  if (!data) {
    return (
      <main className="at-page">
        <Link
          className="at-back"
          to={workspacePath}
        >
          ← Event workspace
        </Link>

        <div
          className="at-panel at-state"
          role={error ? "alert" : "status"}
        >
          {error || "Loading attendance…" }

          {error && (
            <button
              type="button"
              className="at-button"
              onClick={refresh}
              disabled={refreshing}
            >
              Try again
            </button>
          )}
        </div>
      </main>
    );
  }

  const stats = data.statistics;
  const rawPercentage = Number(stats.attendance_percentage);

  const percentage = Number.isFinite(rawPercentage)
    ? Math.max(0, Math.min(100, rawPercentage))
    : 0;

  const counts = {
    all: records.length,
    present: records.filter(
      (row) => row.attendance_status === "present"
    ).length,
    pending: records.filter(
      (row) => row.attendance_status === "pending"
    ).length,
  };

  return (
    <main className="at-page">
      <Link
        className="at-back"
        to={workspacePath}
      >
        ← Event workspace
      </Link>

      <header className="at-heading">
        <div>
          <span className="at-eyebrow">
            Event check-in
          </span>

          <h1>
            Attendance<span>.</span>
          </h1>

          <p>{data.event.title}</p>
        </div>

        {canViewParticipants && (
          <Link
            className="at-button"
            to={`/organizer/events/${id}/participants`}
          >
            View participants ↗
          </Link>
        )}
      </header>

      <section
        className="at-summary at-panel"
        aria-label="Attendance summary"
      >
        <div className="at-metrics">
          <div>
            <span>Registered</span>
            <strong>{stats.registered ?? "—"}</strong>
          </div>

          <div className="at-metric-blue">
            <span>Checked in</span>
            <strong>{stats.checked_in ?? "—"}</strong>
          </div>

          <div className="at-metric-lime">
            <span>Pending</span>
            <strong>{stats.pending ?? "—"}</strong>
          </div>
        </div>

        <div className="at-progress">
          <span>
            {stats.checked_in ?? "—"} of{" "}
            {stats.registered ?? "—"} checked in
          </span>

          <div
            className="at-track"
            role="progressbar"
            aria-label="Attendance percentage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
          >
            <div style={{ width: `${percentage}%` }} />
          </div>

          <strong>{percentage}%</strong>
        </div>
      </section>

      {error && (
        <div
          className="at-notice at-error"
          role="alert"
        >
          <strong>
            Attendance could not be refreshed.
          </strong>

          <p>{error}</p>

          <span>
            Displayed totals may be out of date.
            Use Refresh below.
          </span>
        </div>
      )}

      <section
        className="at-workspace"
        aria-label="Ticket check-in"
      >
        <article className="at-panel at-camera">
          <div className="at-panel-heading">
            <h2>Scan a ticket</h2>

            <span className="at-camera-label">
              {scanning ? "Scanner open" : "Camera off"}
            </span>
          </div>

          {scanning ? (
            <Camera
              onCapture={capture}
              onError={failCamera}
            />
          ) : (
            <div className="at-camera-placeholder">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M8 5 9.5 3h5L16 5h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1Z" />
                <circle cx="12" cy="12" r="4" />
              </svg>

              <h3>Ready when you are</h3>

              <p>
                Allow camera access to scan a
                student’s QR ticket.
              </p>
            </div>
          )}

          <div className="at-camera-actions">
            <button
              type="button"
              className={`at-button ${
                scanning ? "" : "at-primary"
              }`}
              disabled={
                !canCheckIn ||
                checking ||
                refreshing
              }
              onClick={() => {
                if (submitting.current) return;

                setCameraError("");
                setScanning((value) => !value);
              }}
            >
              {scanning ? "Close scanner" : "Start camera"}
            </button>
          </div>

          {cameraError && (
            <div
              className="at-notice at-error"
              role="alert"
            >
              {cameraError} You can also enter the ticket
              UUID or search by roll/register number.
            </div>
          )}
        </article>

        <article className="at-panel at-manual">
          <h2>Enter ticket manually</h2>

          <p>
            Paste the complete ticket UUID, or review the
            code captured by the scanner.
          </p>

          <form onSubmit={submit}>
            <label htmlFor="attendance-token">
              Ticket UUID
            </label>

            <input
              ref={tokenInput}
              id="attendance-token"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setResult(null);
                setCheckError("");
              }}
              disabled={
                !canCheckIn ||
                checking ||
                scanning ||
                refreshing
              }
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={100}
              placeholder="Paste or scan ticket UUID"
              required
            />

            <button
              className="at-button at-primary"
              type="submit"
              disabled={
                !canCheckIn ||
                checking ||
                refreshing ||
                scanning ||
                !token.trim()
              }
            >
              {checking
                ? "Verifying ticket…"
                : "Verify & check in"}
            </button>

            <span className="at-form-help">
              Scanning reads the code. Press Verify &amp;
              check in to record attendance.
            </span>
          </form>

          <AttendanceLookup
            eventId={id}
            disabled={
              !canCheckIn ||
              checking ||
              scanning ||
              refreshing
            }
            onCheckIn={checkInRegistration}
          />

          {result && (
            <div
              className="at-notice at-success"
              role="status"
            >
              <strong>Attendance confirmed</strong>

              <p>
                {result.student_username} has been
                checked in successfully.
              </p>

              <span>
                {dateTime(result.checked_in_at)}
              </span>
            </div>
          )}

          {checkError && (
            <div
              className="at-notice at-error"
              role="alert"
            >
              {checkError}
            </div>
          )}
        </article>
      </section>

      <p className="at-security">
        Attendance is confirmed by the server.
        Invalid and duplicate check-ins are rejected.
      </p>
      <AttendanceExports
        eventId={id}
        disabled={checking || refreshing}
      />

      <section
        className="at-panel at-register"
        aria-labelledby="attendance-register"
      >
        <div className="at-panel-heading">
          <h2 id="attendance-register">
            Attendance register
          </h2>

          <button
            type="button"
            className="at-button"
            onClick={refresh}
            disabled={refreshing || checking}
          >
            {refreshing ? "Refreshing…" : "Refresh ↻"}
          </button>
        </div>

        <div
          className="at-filters"
          aria-label="Filter attendance"
        >
          {[
            ["all", "All"],
            ["present", "Present"],
            ["pending", "Pending"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>{counts[value]}</span>
            </button>
          ))}
        </div>

        <div
          className="at-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Attendance records"
          aria-busy={refreshing}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Registration</th>
                <th scope="col">Attendance</th>
                <th scope="col">Check-in time</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((record) => (
                <tr key={record.registration_id}>
                  <th scope="row">
                    <div className="at-student">
                      <span
                        className="at-avatar"
                        aria-hidden="true"
                      >
                        {record.student_username
                          ?.charAt(0)
                          .toUpperCase() || "?"}
                      </span>

                      {record.student_username}
                    </div>
                  </th>

                  <td>
                    #{record.registration_id}
                  </td>

                  <td>
                    <span
                      className={`at-status ${
                        record.attendance_status === "present"
                          ? "at-present"
                          : "at-pending"
                      }`}
                    >
                      {record.attendance_status === "present"
                        ? "Present"
                        : "Pending"}
                    </span>
                  </td>

                  <td>
                    {dateTime(record.checked_in_at)}
                  </td>
                </tr>
              ))}

              {!filtered.length && (
                <tr>
                  <td
                    colSpan={4}
                    className="at-empty"
                  >
                    {records.length
                      ? "No students match this attendance filter."
                      : "Registered students will appear here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="at-table-footer">
          Showing {filtered.length} of{" "}
          {records.length} registered students
        </p>
      </section>
    </main>
  );
}