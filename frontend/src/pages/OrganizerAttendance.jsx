import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";

import {
  getOrganizerAttendance,
  checkInStudent,
} from "../services/events";

import "../styles/organizer.css";
import "../styles/attendance.css";
import "../styles/attendance-v2.css";

function formatDateTime(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}


function getErrorMessage(error) {
  return (
    error.details?.message ||
    error.details?.detail ||
    error.message ||
    "Something went wrong. Please try again."
  );
}


export default function OrganizerAttendance() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [token, setToken] = useState("");
  const [scanningEnabled, setScanningEnabled] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  const [checkInResult, setCheckInResult] = useState(null);
  const [checkInError, setCheckInError] = useState("");

  const [filter, setFilter] = useState("all");

  const scannerRef = useRef(null);
  const scanCapturedRef = useRef(false);
  const submittingRef = useRef(false);


  // ==========================================================
  // LOAD ATTENDANCE INFORMATION
  // ==========================================================

  const loadAttendance = useCallback(async () => {
    const response = await getOrganizerAttendance(id);

    setData(response);

    return response;
  }, [id]);


  useEffect(() => {
    let active = true;

    async function initializeAttendance() {
      setLoading(true);
      setError("");

      try {
        const response = await getOrganizerAttendance(id);

        if (active) {
          setData(response);
        }
      } catch (err) {
        if (active) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    initializeAttendance();

    return () => {
      active = false;
    };
  }, [id]);


  // ==========================================================
  // CAMERA QR SCANNER
  // ==========================================================

  useEffect(() => {
    if (!scanningEnabled || !data) {
      return;
    }

    let disposed = false;

    scanCapturedRef.current = false;

    const scanner = new Html5QrcodeScanner(
      "eventhub-qr-reader",
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

    scannerRef.current = scanner;

    scanner.render(
      (decodedText) => {
        if (disposed || scanCapturedRef.current) {
          return;
        }

        scanCapturedRef.current = true;

        // The scanner only reads the QR.
        // The organizer confirms before submitting attendance.
        setToken(decodedText.trim());

        setCheckInResult(null);
        setCheckInError("");

        setScanningEnabled(false);
      },
      () => {
        // Individual frames often fail to contain a QR code.
        // This is normal and should not show an error.
      }
    );

    return () => {
      disposed = true;

      scannerRef.current = null;

      // Stop and release the camera when closing the scanner
      // or leaving this page.
      Promise.resolve(scanner.clear()).catch(() => {});
    };
  }, [scanningEnabled, data]);


  // ==========================================================
  // SUBMIT ATTENDANCE
  // ==========================================================

  async function handleCheckIn(event) {
    event.preventDefault();

    const cleanedToken = token.trim();

    if (!cleanedToken || submittingRef.current) {
      return;
    }

    submittingRef.current = true;

    setCheckingIn(true);
    setCheckInError("");
    setCheckInResult(null);

    try {
      const response = await checkInStudent(
        id,
        cleanedToken
      );

      setCheckInResult(response);
      setToken("");

      // Get the latest attendance statistics.
      try {
        await loadAttendance();
      } catch {
        setError(
          "Check-in succeeded, but attendance statistics could not be refreshed."
        );
      }
    } catch (err) {
      setCheckInError(getErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setCheckingIn(false);
    }
  }


  // ==========================================================
  // FILTER ATTENDANCE RECORDS
  // ==========================================================

  const filteredAttendance = useMemo(() => {
    if (!data) return [];

    if (filter === "all") {
      return data.attendance;
    }

    return data.attendance.filter(
      (record) => record.attendance_status === filter
    );
  }, [data, filter]);


  // ==========================================================
  // RENDER
  // ==========================================================

  if (loading) {
    return (
      <div className="organizer-loading" role="status">
        Loading attendance dashboard...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="organizer-error" role="alert">
        {error || "Attendance information is unavailable."}

        <div>
          <Link to="/organizer">
            Return to Dashboard →
          </Link>
        </div>
      </div>
    );
  }

  const stats = data.statistics;

  return (
    <div className="organizer-attendance-page">

      {/* Navigation */}

      <Link
        to={`/organizer/events/${id}/participants`}
        className="organizer-back-link"
      >
        ← Back to Participants
      </Link>


      {/* Heading */}

      <div className="organizer-page-heading">

        <div>
          <span className="organizer-eyebrow">
            EVENT CHECK-IN
          </span>

          <h1>
            Show up.
            <br />
            <span>Check in.</span>
          </h1>

          <p>{data.event.title}</p>
        </div>

        <Link
          to="/organizer"
          className="organizer-primary-button"
        >
          Dashboard →
        </Link>

      </div>


      {/* Statistics */}

      <section
        className="organizer-stats"
        aria-label="Attendance statistics"
      >

        <article className="organizer-stat-card">
          <span>REGISTERED</span>

          <strong>{stats.registered}</strong>

          <p>Active event registrations</p>
        </article>


        <article className="organizer-stat-card organizer-stat-blue">
          <span>CHECKED IN</span>

          <strong>{stats.checked_in}</strong>

          <p>Students marked present</p>
        </article>


        <article className="organizer-stat-card organizer-stat-lime">
          <span>PENDING</span>

          <strong>{stats.pending}</strong>

          <p>Students awaiting check-in</p>
        </article>

      </section>


      {/* Attendance percentage */}

      <section className="attendance-progress-section">

        <div className="attendance-progress-heading">
          <strong>Attendance progress</strong>

          <span>
            {stats.attendance_percentage}% checked in
          </span>
        </div>

        <div className="attendance-progress-track">
          <div
            className="attendance-progress-fill"
            style={{
              width: `${Math.min(
                100,
                stats.attendance_percentage
              )}%`,
            }}
          />
        </div>

      </section>


      {/* Scanner */}

      <section className="attendance-scanner-section">

        <div className="attendance-section-heading">

          <div>
            <span className="organizer-eyebrow">
              SCAN & VERIFY
            </span>

            <h2>Ticket scanner</h2>

            <p>
              Scan a student's QR ticket or enter its
              token manually to record attendance.
            </p>
          </div>

        </div>


        <div className="attendance-scanner-grid">

          {/* Camera */}

          <div className="attendance-camera-card">

            <div className="attendance-camera-heading">
              <span>01 / CAMERA SCANNER</span>
            </div>

            {!scanningEnabled ? (

              <div className="attendance-camera-placeholder">

                <div className="attendance-scan-icon">
                  ▣
                </div>

                <h3>Ready to scan.</h3>

                <p>
                  Enable your camera to scan a student's
                  EventHub QR ticket.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setCheckInError("");
                    setCheckInResult(null);
                    setScanningEnabled(true);
                  }}
                  disabled={checkingIn}
                >
                  Start Camera →
                </button>

              </div>

            ) : (

              <div className="attendance-camera-active">

                <div id="eventhub-qr-reader" />

                <button
                  type="button"
                  className="attendance-stop-camera"
                  onClick={() => setScanningEnabled(false)}
                >
                  Stop Scanner
                </button>

              </div>

            )}

          </div>


          {/* Manual check-in */}

          <div className="attendance-manual-card">

            <span className="attendance-card-eyebrow">
              02 / VERIFY ENTRY
            </span>

            <h3>Check in a student.</h3>

            <p>
              After scanning a QR code, verify the ticket
              and confirm attendance.
            </p>

            <form onSubmit={handleCheckIn}>

              <label htmlFor="attendance-token">
                TICKET TOKEN
              </label>

              <input
                id="attendance-token"
                type="text"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setCheckInResult(null);
                  setCheckInError("");
                }}
                placeholder="Paste or scan ticket UUID"
                autoComplete="off"
                spellCheck={false}
                required
              />

              <button
                type="submit"
                disabled={
                  checkingIn ||
                  !token.trim() ||
                  scanningEnabled
                }
              >
                {checkingIn
                  ? "Verifying ticket..."
                  : "Verify & Check In →"}
              </button>

            </form>

            {checkInResult && (
              <div
                className="attendance-success"
                role="status"
              >
                <strong>✓ Attendance confirmed</strong>

                <p>
                  {checkInResult.student_username}
                  {" "}has been checked in successfully.
                </p>

                <span>
                  {formatDateTime(
                    checkInResult.checked_in_at
                  )}
                </span>
              </div>
            )}

            {checkInError && (
              <div
                className="attendance-error"
                role="alert"
              >
                {checkInError}
              </div>
            )}

          </div>

        </div>

        <p className="attendance-security-note">
          Only registered students with valid tickets
          can be checked in. Duplicate and invalid
          tickets are rejected by the server.
        </p>

      </section>


      {/* Attendance records */}

      <section className="organizer-events-section">

        <div className="organizer-section-heading">

          <div>
            <span className="organizer-eyebrow">
              LIVE ATTENDANCE
            </span>

            <h2>Attendance Register</h2>
          </div>

          <button
            type="button"
            className="attendance-refresh-button"
            onClick={async () => {
              setError("");

              try {
                await loadAttendance();
              } catch (err) {
                setError(getErrorMessage(err));
              }
            }}
          >
            Refresh ↻
          </button>

        </div>


        {error && (
          <div
            className="attendance-error"
            role="alert"
          >
            {error}
          </div>
        )}


        {/* Filters */}

        <div className="participant-filters">

          {[
            ["all", "All"],
            ["present", "Present"],
            ["pending", "Pending"],
          ].map(([value, label]) => (

            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={
                filter === value
                  ? "participant-filter-active"
                  : ""
              }
              aria-pressed={filter === value}
            >
              {label}
            </button>

          ))}

        </div>


        {/* Table */}

        {filteredAttendance.length === 0 ? (

          <div className="organizer-empty-state">

            <h3>No attendance records found.</h3>

            <p>
              Registered students will appear here.
              Check-ins will update their attendance status.
            </p>

          </div>

        ) : (

          <div className="organizer-table-wrapper">

            <table className="organizer-events-table">

              <thead>
                <tr>
                  <th>STUDENT</th>
                  <th>REGISTRATION</th>
                  <th>ATTENDANCE</th>
                  <th>CHECK-IN TIME</th>
                </tr>
              </thead>

              <tbody>

                {filteredAttendance.map((record) => (

                  <tr key={record.registration_id}>

                    <td>
                      <strong>
                        {record.student_username}
                      </strong>
                    </td>

                    <td>
                      #{record.registration_id}
                    </td>

                    <td>
                      <span
                        className={`attendance-status attendance-status-${
                          record.attendance_status
                        }`}
                      >
                        {record.attendance_status === "present"
                          ? "Present"
                          : "Pending"}
                      </span>
                    </td>

                    <td>
                      {formatDateTime(
                        record.checked_in_at
                      )}
                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </section>

    </div>
  );
}