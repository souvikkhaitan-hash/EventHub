import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useParams,
} from "react-router";

import { QRCodeSVG } from "qrcode.react";

import Navbar from "../components/Navbar";
import EventCover from "../components/EventCover";

import { useAuth } from "../context/AuthContext";

import {
  getStudentTicket,
  getMyRegistrations,
} from "../services/events";

import {
  formatEventDateTime,
  getCategoryLabel,
} from "../utils/eventFormat";

import "../styles/ticket-editorial.css";

function messageFrom(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Unable to retrieve your ticket."
  );
}

export default function StudentTicket() {
  const { registrationId } = useParams();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <>
        <Navbar />

        <main className="tp-page">
          <p role="status">
            Loading your account…
          </p>
        </main>
      </>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.is_organizer) {
    return <Navigate to="/organizer" replace />;
  }

  return (
    <>
      <Navbar />

      <TicketContent
        key={`${registrationId}:${user.id ?? user.username}`}
        registrationId={registrationId}
        user={user}
      />
    </>
  );
}

function TicketContent({
  registrationId,
  user,
}) {
  const [revision, setRevision] = useState(0);

  const [result, setResult] = useState({
    revision: -1,
    ticket: null,
    error: "",
  });

  const [registration, setRegistration] =
    useState(null);

  const [now, setNow] = useState(
    () => Date.now()
  );

  const loading = result.revision !== revision;

  // Hide an older QR while refreshing or after an API error.
  const ticket =
    loading || result.error
      ? null
      : result.ticket;

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  // Load the authenticated student's actual ticket.
  useEffect(() => {
    let active = true;

    getStudentTicket(registrationId)
      .then((response) => {
        if (
          !response?.ticket ||
          typeof response.ticket.token !== "string" ||
          !response.ticket.token.trim()
        ) {
          throw new Error(
            "This ticket has no valid entry code. Please try again."
          );
        }

        if (active) {
          setResult({
            revision,
            ticket: response.ticket,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setResult({
            revision,
            ticket: null,
            error: messageFrom(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [registrationId, revision]);

  // The existing ticket API does not include its category.
  // Reuse registration metadata to select the matching photo.
  useEffect(() => {
    let active = true;

    getMyRegistrations()
      .then((items) => {
        if (active && Array.isArray(items)) {
          const matchingRegistration = items.find(
            (item) =>
              String(item.id) ===
              String(registrationId)
          );

          setRegistration(
            matchingRegistration || null
          );
        }
      })
      .catch(() => {
        // Category metadata must not block ticket access.
        // EventCover will use the general campus photo.
      });

    return () => {
      active = false;
    };
  }, [registrationId]);

  const category =
    ticket?.event_category ||
    registration?.event_category;

  const starts = Date.parse(ticket?.event_start);
  const ends = Date.parse(ticket?.event_end);

  const ended =
    Number.isFinite(ends) && now >= ends;

  const started =
    Number.isFinite(starts) && now >= starts;

  const eventState = ended
    ? "Event has ended"
    : started
      ? "Event in progress"
      : Number.isFinite(starts)
        ? "Upcoming event"
        : "Event timing unavailable";

  const year = Number.isFinite(starts)
    ? new Intl.DateTimeFormat("en-IN", {
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(starts))
    : "CAMPUS";

  function refresh() {
    if (!loading) {
      setRevision((value) => value + 1);
    }
  }

  return (
    <main className="tp-page">
      <div className="tp-shell">
        <Link
          className="tp-back"
          to="/my-registrations"
        >
          ← Back to My Registrations
        </Link>

        <header className="tp-heading">
          <div>
            <h1>
              Your ticket.{" "}
              <span>Your moment.</span>
            </h1>

            <p>Keep your campus pass handy.</p>
          </div>

          <span
            className="tp-heading-mark"
            aria-hidden="true"
          >
            ↗
          </span>
        </header>

        {loading ? (
          <div
            className="tp-message"
            role="status"
          >
            Preparing your digital campus pass…
          </div>
        ) : result.error ? (
          <div
            className="tp-message tp-error"
            role="alert"
          >
            <h2>Ticket unavailable.</h2>

            <p>{result.error}</p>

            <button
              type="button"
              className="tp-button"
              onClick={refresh}
            >
              Try again
            </button>

            <Link to="/my-registrations">
              Return to My Registrations →
            </Link>
          </div>
        ) : ticket && (
          <>
            <article
              className="tp-pass"
              aria-label={`Digital ticket for ${ticket.event_title}`}
            >
              <div className="tp-event-side">
                <div className="tp-brand-bar">
                  <div>
                    <img
                      src="/eventhub-logo.svg"
                      alt=""
                    />

                    <strong>EventHub</strong>
                  </div>

                  <span>
                    Campus pass / {year}
                  </span>
                </div>

                <div className="tp-event-body">
                  <div className="tp-meta">
                    <span>
                      {category
                        ? getCategoryLabel(category)
                        : "Campus event"}
                    </span>

                    <span>
                      #{ticket.registration}
                    </span>
                  </div>

                  <h2>{ticket.event_title}</h2>

                  <div className="tp-cover">
                    <EventCover
                      category={category}
                      showLabel
                    />
                  </div>

                  <dl className="tp-facts">
                    <div>
                      <dt>Event date</dt>

                      <dd>
                        {formatEventDateTime(
                          ticket.event_start
                        )}
                      </dd>

                      <dd className="tp-event-state">
                        {eventState}
                      </dd>
                    </div>

                    <div>
                      <dt>Venue</dt>

                      <dd>
                        {ticket.event_venue ||
                          "To be announced"}
                      </dd>
                    </div>

                    <div>
                      <dt>Registered as</dt>

                      <dd>
                        {user.username || "Student"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <section
                className="tp-entry-side"
                aria-labelledby="tp-qr-title"
              >
                <h3 id="tp-qr-title">
                  Your entry code
                </h3>

                <div
                  className="tp-qr"
                  role="img"
                  aria-label="Your personal entry QR code"
                >
                  <QRCodeSVG
                    value={ticket.token}
                    size={256}
                    level="H"
                    marginSize={4}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                </div>

                <p className="tp-qr-caption">
                  Present this code to the organiser
                  at the entrance.
                </p>

                <div
                  className={`tp-attendance ${
                    ticket.checked_in_at
                      ? "tp-attendance--confirmed"
                      : ""
                  }`}
                  role="status"
                >
                  <span aria-hidden="true">
                    {ticket.checked_in_at
                      ? "✓"
                      : "ⓘ"}
                  </span>

                  <div>
                    <strong>
                      {ticket.checked_in_at
                        ? "Attendance confirmed"
                        : "Not checked in"}
                    </strong>

                    <p>
                      {ticket.checked_in_at
                        ? `Checked in ${formatEventDateTime(
                            ticket.checked_in_at
                          )}`
                        : "Attendance has not been recorded."}
                    </p>
                  </div>
                </div>

                <button
                  className="tp-button tp-button--outline"
                  type="button"
                  onClick={refresh}
                >
                  ↻ &nbsp; Refresh status
                </button>
              </section>
            </article>

            <section
              className="tp-instructions"
              aria-labelledby="tp-instructions-title"
            >
              <h2 id="tp-instructions-title">
                Before you arrive
              </h2>

              <ol>
                {[
                  [
                    "Keep your ticket ready",
                    "Open this page at the entrance.",
                  ],
                  [
                    "Check event timing",
                    "Check-in follows the organiser’s event schedule.",
                  ],
                  [
                    "Scan at the entrance",
                    "The organiser scans your QR to record attendance.",
                  ],
                ].map(([title, text], index) => (
                  <li key={title}>
                    <span>
                      {`0${index + 1}`}
                    </span>

                    <div>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <p className="tp-privacy">
              <span aria-hidden="true">◇</span>

              <span>
                <strong>
                  Keep your pass private.
                </strong>{" "}
                Your QR code is unique; avoid
                sharing screenshots.
              </span>
            </p>

            {ticket.event_id && (
              <Link
                className="tp-event-link"
                to={`/events/${ticket.event_id}`}
              >
                View event details →
              </Link>
            )}
          </>
        )}

        <footer className="tp-footer">
          <Link to="/">
            ← Back to EventHub
          </Link>

          <strong>
            Show up. Stand out.
          </strong>
        </footer>
      </div>
    </main>
  );
}