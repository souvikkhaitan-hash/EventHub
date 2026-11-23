import { useEffect, useState } from "react";
import {
  Link,
  useOutletContext,
  useParams,
} from "react-router";

import OrganizerDashboard from "./OrganizerDashboard";
import { useEventAccess } from "../components/EventAccessGate";
import {
  getOrganizerEvent,
  getOrganizerEvents,
} from "../services/events";

const ROLE_LABELS = {
  owner: "Event owner",
  manager: "Event manager",
  attendance: "Attendance volunteer",
  certificates: "Certificate coordinator",
};

export function WorkspaceHome() {
  const { user } = useOutletContext();

  return user.is_organizer
    ? <OrganizerDashboard />
    : <EventWorkspace />;
}

export default function EventWorkspace() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    getOrganizerEvents()
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error("Unexpected event list response.");
        }

        if (active) setEvents(data);
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Unable to load events.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retry]);

  return (
    <section className="event-staff-page">
      <header className="staff-heading">
        <p className="staff-eyebrow">YOUR EVENT WORKSPACE</p>
        <h1>Events you can manage.</h1>
        <p>
          Open an event to see the actions available to your role.
        </p>
      </header>

      <button
        type="button"
        className="staff-button"
        disabled={loading}
        onClick={() => setRetry((value) => value + 1)}
      >
        Refresh events
      </button>

      {loading ? (
        <p role="status">Loading events...</p>
      ) : error ? (
        <p className="staff-error" role="alert">{error}</p>
      ) : events.length === 0 ? (
        <div className="staff-panel">
          <h2>No events available</h2>
          <p>
            Ask an event owner to assign your username to their staff.
          </p>
        </div>
      ) : (
        <div className="staff-event-grid">
          {events.map((event) => (
            <article className="staff-panel" key={event.id}>
              <span className="staff-badge">{event.status}</span>
              <h2>{event.title}</h2>
              <p>{event.venue}</p>
              <p>
                {new Date(event.start_datetime).toLocaleString()}
              </p>
              <Link
                className="staff-button staff-button-primary"
                to={`/organizer/events/${event.id}/workspace`}
              >
                Open workspace ↗
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function EventWorkspaceDetail() {
  const { id } = useParams();
  const access = useEventAccess();

  const [event, setEvent] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    getOrganizerEvent(id)
      .then((data) => {
        if (active) setEvent(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Unable to load event.");
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (error) {
    return <p className="staff-error" role="alert">{error}</p>;
  }

  if (!event) {
    return <p role="status">Loading event...</p>;
  }

  const base = `/organizer/events/${id}`;
  const can = (permission) =>
    access.capabilities.includes(permission);

  const actions = [
    {
      label: "Edit event",
      path: `${base}/edit`,
      allowed: can("edit_event"),
    },
    {
      label: "Participants",
      path: `${base}/participants`,
      allowed: can("view_participants"),
    },
    {
      label: "Attendance & check-in",
      path: `${base}/attendance`,
      allowed: can("view_attendance"),
    },
    {
      label: "Manage staff",
      path: `${base}/staff`,
      allowed: can("manage_staff"),
    },
    {
      label: "Student teams",
      path: `${base}/teams`,
      allowed:
        access.role === "owner" &&
        event.registration_mode === "team",
    },
        {
      label: "Certificates",
      path: `${base}/certificates`,
      allowed: can("manage_certificates"),
    },
  ];

  return (
    <section className="event-staff-page">
      <Link to="/organizer/workspace">← All my events</Link>

      <header className="staff-heading">
        <p className="staff-eyebrow">
          {ROLE_LABELS[access.role] || "Event staff"}
        </p>
        <h1>{event.title}</h1>
        <p>{event.venue}</p>
      </header>

      <div className="staff-action-grid">
        {actions.filter((action) => action.allowed).map((action) => (
          <Link
            key={action.path}
            className="staff-panel staff-action-card"
            to={action.path}
          >
            <strong>{action.label}</strong>
            <span aria-hidden="true">↗</span>
          </Link>
        ))}
      </div>

    {access.role === "certificates" && (
        <p className="staff-notice">
          Open Certificates to prepare layouts and participation
          drafts. The event owner reviews and publishes the
          completed batches.
        </p>
      )}
    </section>
  );
}