import { useEffect, useState } from "react";

import {
  Link,
  Navigate,
  useParams,
} from "react-router";

import { QRCodeSVG } from "qrcode.react";

import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";

import { getStudentTicket } from "../services/events";

import "../styles/studentTicket.css";

// ============================================================
// EVENTHUB 2.0 — DIGITAL CAMPUS PASS
// ============================================================

function formatTicketDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  }).format(date);
}

function getErrorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Unable to retrieve your ticket."
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function StudentTicket() {
  const { registrationId } = useParams();

  const { user, loading: authLoading } = useAuth();

  const [ticket, setTicket] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // ==========================================================
  // LOAD TICKET
  // ==========================================================

  useEffect(() => {
    if (authLoading) return;

    if (!user || user.is_organizer) {
      setLoading(false);
      return;
    }

    let active = true;

    async function loadTicket() {
      setLoading(true);
      setError("");
      setTicket(null);

      try {
        const response = await getStudentTicket(
          registrationId
        );

        if (active) {
          setTicket(response.ticket);
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

    loadTicket();

    return () => {
      active = false;
    };
  }, [registrationId, user, authLoading]);

  // ==========================================================
  // ROLE PROTECTION
  // ==========================================================

  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  if (!authLoading && user?.is_organizer) {
    return <Navigate to="/organizer" replace />;
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <>
      <Navbar />

      <main className="student-ticket-page student-ticket-v2">

        <div className="container">

          {/* BACK NAVIGATION */}

          <Link
            to="/my-registrations"
            className="ticket-back-link"
          >
            ← Back to My Registrations
          </Link>

          {/* ================================================
              PAGE HEADING
          ================================================ */}

          <header className="ticket-page-heading ticket-v2-heading">

            <div>

              <span className="ticket-v2-eyebrow">
                <span aria-hidden="true">✳</span>

                YOUR DIGITAL CAMPUS PASS
              </span>

              <h1>
                Your ticket.
                <br />
                <span>Your moment.</span>
              </h1>

              <p>
                One ticket. One experience.
                Everything you need to show up
                and make it count.
              </p>

            </div>

            <div
              className="ticket-v2-heading-art"
              aria-hidden="true"
            >
              <span>↗</span>
            </div>

          </header>

          {/* LOADING */}

          {(loading || authLoading) && (
            <div
              className="ticket-message"
              role="status"
            >
              Preparing your digital campus pass...
            </div>
          )}

          {/* ERROR */}

          {!loading && !authLoading && error && (
            <div
              className="ticket-message ticket-error"
              role="alert"
            >
              <h2>Ticket unavailable.</h2>

              <p>{error}</p>

              <Link to="/my-registrations">
                Return to My Registrations →
              </Link>
            </div>
          )}

          {/* ================================================
              DIGITAL TICKET
          ================================================ */}

          {!loading && !authLoading && ticket && (

            <div className="ticket-wrapper ticket-v2-wrapper">

              {/* TICKET */}

              <article className="digital-ticket ticket-v2-pass">

                {/* HEADER */}

                <div className="digital-ticket-header ticket-v2-pass-header">

                  <div className="ticket-brand">

                    <img
                      src="/eventhub-logo.svg"
                      alt=""
                      className="ticket-v2-brand-logo"
                    />

                    <strong>EventHub</strong>

                  </div>

                  <span className="ticket-edition">
                    CAMPUS PASS / {new Date().getFullYear()}
                  </span>

                </div>

                {/* EVENT INFORMATION */}

                <div className="digital-ticket-event ticket-v2-event">

                  <div className="ticket-v2-event-top">

                    <span className="ticket-eyebrow">
                      YOUR EVENT ACCESS
                    </span>

                    <span className="ticket-v2-ticket-number">
                      #{ticket.registration}
                    </span>

                  </div>

                  <h2>
                    {ticket.event_title}
                  </h2>

                  <div className="ticket-v2-info-grid">

                    <div className="ticket-v2-info-item">

                      <span className="ticket-v2-info-icon">
                        ◷
                      </span>

                      <div>
                        <span>EVENT DATE</span>

                        <strong>
                          {formatTicketDate(
                            ticket.event_start
                          )}
                        </strong>
                      </div>

                    </div>

                    <div className="ticket-v2-info-item">

                      <span className="ticket-v2-info-icon">
                        ⌖
                      </span>

                      <div>
                        <span>VENUE</span>

                        <strong>
                          {ticket.event_venue}
                        </strong>
                      </div>

                    </div>

                    <div className="ticket-v2-info-item">

                      <span className="ticket-v2-info-icon">
                        ✳
                      </span>

                      <div>
                        <span>REGISTERED AS</span>

                        <strong>
                          {user?.username || "Student"}
                        </strong>
                      </div>

                    </div>

                  </div>

                </div>

                {/* PERFORATED DIVIDER */}

                <div
                  className="ticket-perforation"
                  aria-hidden="true"
                />

                {/* ============================================
                    QR CODE
                ============================================ */}

                <div className="digital-ticket-qr-section ticket-v2-qr-section">

                  <span className="ticket-eyebrow">
                    SCAN TO CHECK IN
                  </span>

                  <h3>
                    Your entry code.
                  </h3>

                  <p className="ticket-v2-qr-intro">
                    Present this QR code at
                    the event entrance.
                  </p>

                  <div
                    className="ticket-qr-container ticket-v2-qr-container"
                    role="img"
                    aria-label="Your personal digital entry QR code"
                  >
                    <QRCodeSVG
                      value={ticket.token}
                      size={220}
                      level="H"
                      marginSize={2}
                      bgColor="#ffffff"
                      fgColor="#18191d"
                    />
                  </div>

                  {/* CHECK-IN STATUS */}

                  {ticket.checked_in_at ? (

                    <div className="ticket-v2-checkin ticket-v2-checked-in">

                      <span className="ticket-v2-checkin-icon">
                        ✓
                      </span>

                      <div>
                        <strong>
                          Attendance confirmed
                        </strong>

                        <span>
                          Checked in on{" "}
                          {formatTicketDate(
                            ticket.checked_in_at
                          )}
                        </span>
                      </div>

                    </div>

                  ) : (

                    <div className="ticket-v2-checkin ticket-v2-pending">

                      <span className="ticket-v2-checkin-icon">
                        ◷
                      </span>

                      <div>
                        <strong>
                          Ready for check-in
                        </strong>

                        <span>
                          Your attendance will be
                          recorded when the organizer
                          scans this ticket.
                        </span>
                      </div>

                    </div>

                  )}

                </div>

                {/* FOOTER */}

                <div className="digital-ticket-footer ticket-v2-footer">

                  <span>
                    ONE TICKET. ONE EXPERIENCE.
                  </span>

                  <strong>
                    SHOW UP. STAND OUT.
                  </strong>

                </div>

              </article>

              {/* ================================================
                  INSTRUCTIONS PANEL
              ================================================ */}

              <aside className="ticket-instructions ticket-v2-instructions">

                <span className="ticket-v2-instructions-eyebrow">
                  BEFORE THE BIG DAY
                </span>

                <h3>
                  Ready to
                  <br />
                  <span>show up?</span>
                </h3>

                <p className="ticket-v2-instructions-intro">
                  A few things to remember before
                  your campus experience begins.
                </p>

                <div className="ticket-v2-steps">

                  <div className="ticket-v2-step">

                    <span className="ticket-v2-step-number">
                      01
                    </span>

                    <div>
                      <strong>Keep your ticket ready</strong>

                      <p>
                        Open this digital pass on
                        your phone when you reach
                        the event entrance.
                      </p>
                    </div>

                  </div>

                  <div className="ticket-v2-step">

                    <span className="ticket-v2-step-number">
                      02
                    </span>

                    <div>
                      <strong>Arrive on time</strong>

                      <p>
                        Check-in opens 30 minutes
                        before the event begins and
                        closes when it ends.
                      </p>
                    </div>

                  </div>

                  <div className="ticket-v2-step">

                    <span className="ticket-v2-step-number">
                      03
                    </span>

                    <div>
                      <strong>Scan and you're in</strong>

                      <p>
                        The organizer scans your
                        personal QR code to
                        verify your attendance.
                      </p>
                    </div>

                  </div>

                </div>

                {/* SECURITY NOTE */}

                <div className="ticket-v2-security-note">

                  <span aria-hidden="true">
                    ◈
                  </span>

                  <p>
                    <strong>Keep your pass private.</strong>
                    <br />
                    Your QR code is unique.
                    Avoid sharing screenshots
                    or forwarding your ticket.
                  </p>

                </div>

                {/* EVENT LINK */}

                <Link
                  to={`/events/${ticket.event_id}`}
                  className="ticket-v2-event-link"
                >
                  View Event Details

                  <span aria-hidden="true">
                    ↗
                  </span>
                </Link>

              </aside>

            </div>
          )}

        </div>
      </main>
    </>
  );
}