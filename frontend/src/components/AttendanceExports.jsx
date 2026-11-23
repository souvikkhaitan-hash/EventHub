import { useRef, useState } from "react";

import { useEventAccess } from "./EventAccessGate";
import {
  downloadAttendanceExport,
  downloadEventReference,
} from "../services/events";

export default function AttendanceExports({
  eventId,
  disabled = false,
}) {
  const access = useEventAccess();

  const isEventOwner = access?.role === "owner";

  const canExportAttendance = Boolean(
    access?.capabilities?.includes("export_attendance")
  );

  const [report, setReport] = useState("attendance");
  const [busyType, setBusyType] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const downloading = useRef(false);
  const busy = Boolean(busyType);

  async function download(fileType) {
    const supported = ["xlsx", "csv", "json"].includes(fileType);

    const permitted =
      fileType === "json"
        ? isEventOwner
        : canExportAttendance;

    if (
      !supported ||
      !permitted ||
      disabled ||
      downloading.current
    ) {
      return;
    }

    downloading.current = true;
    setBusyType(fileType);
    setError("");
    setNotice("");

    try {
      const blob =
        fileType === "json"
          ? await downloadEventReference(eventId)
          : await downloadAttendanceExport(
              eventId,
              report,
              fileType
            );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download =
        fileType === "json"
          ? `event-${eventId}-private-reference.json`
          : `event-${eventId}-${report}.${fileType}`;

      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();

        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 30000);
      }

      setNotice(
        "Download requested. Check your browser’s downloads."
      );
    } catch (err) {
      setError(
        err?.message || "Unable to download this report."
      );
    } finally {
      downloading.current = false;
      setBusyType("");
    }
  }

  if (!canExportAttendance && !isEventOwner) {
    return null;
  }

  return (
    <section
      className="at-panel at-exports"
      aria-labelledby="attendance-exports-title"
      aria-busy={busy}
    >
      <h2 id="attendance-exports-title">
        Download attendance
      </h2>

      {canExportAttendance && (
        <>
          <p>
            Excel and CSV exports use the latest server
            records and include active registrations only.
            They are independent of the table’s current filter.
          </p>

          <label htmlFor="attendance-export-report">
            Report
          </label>

          <select
            id="attendance-export-report"
            value={report}
            disabled={disabled || busy}
            onChange={(event) => {
              setReport(event.target.value);
              setError("");
              setNotice("");
            }}
          >
            <option value="attendance">
              Full attendance register
            </option>

            <option value="od">
              OD attendance list — present only
            </option>
          </select>

          <p className="at-form-help">
            The OD list records verified attendance.
            College OD approval follows your institution’s
            process.
          </p>

          <div className="at-export-actions">
            <button
              type="button"
              className="at-button at-primary"
              disabled={disabled || busy}
              onClick={() => download("xlsx")}
            >
              {busyType === "xlsx"
                ? "Preparing Excel..."
                : "Download Excel"}
            </button>

            <button
              type="button"
              className="at-button"
              disabled={disabled || busy}
              onClick={() => download("csv")}
            >
              {busyType === "csv"
                ? "Preparing CSV..."
                : "Download CSV"}
            </button>
          </div>
        </>
      )}

      {isEventOwner && (
        <div className="at-reference-download">
          <h3>Private event reference</h3>

          <p>
            Download participant details, registration
            statuses and existing ticket UUIDs as JSON.
            This includes cancelled registrations with their
            status clearly recorded. Keep this file private.
            It is a reference file, not a database backup,
            and cannot be imported to restore the event.
          </p>

          <button
            type="button"
            className="at-button"
            disabled={disabled || busy}
            onClick={() => download("json")}
          >
            {busyType === "json"
              ? "Preparing JSON..."
              : "Download private JSON"}
          </button>
        </div>
      )}

      {error && (
        <p className="at-notice at-error" role="alert">
          {error}
        </p>
      )}

      {notice && (
        <p className="at-export-status" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}