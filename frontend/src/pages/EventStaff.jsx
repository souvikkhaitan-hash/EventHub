import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import {
  addEventStaff,
  getEventStaff,
  updateEventStaff,
} from "../services/events";

const ROLES = [
  { value: "manager", label: "Event manager" },
  { value: "attendance", label: "Attendance volunteer" },
  { value: "certificates", label: "Certificate coordinator" },
];

function StaffMemberRow({ member, disabled, onUpdate }) {
  const [role, setRole] = useState(member.role);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  return (
    <article className="staff-member">
      <div>
        <h3>
          {member.user.full_name || member.user.username}
        </h3>
        <p>@{member.user.username}</p>
        <span className="staff-badge">
          {member.is_active ? "Active" : "Access removed"}
        </span>
      </div>

      <div className="staff-member-controls">
        <label htmlFor={`staff-role-${member.id}`}>
          Event role
        </label>

        <select
          id={`staff-role-${member.id}`}
          value={role}
          disabled={disabled}
          onChange={(event) => setRole(event.target.value)}
        >
          {ROLES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <div className="staff-inline-actions">
          <button
            type="button"
            className="staff-button"
            disabled={disabled || role === member.role}
            onClick={() => onUpdate(member, { role })}
          >
            Save role
          </button>

          {member.is_active ? (
            <button
              type="button"
              className="staff-button staff-button-danger"
              disabled={disabled}
              onClick={() => setConfirmRemoval(true)}
            >
              Remove access
            </button>
          ) : (
            <button
              type="button"
              className="staff-button"
              disabled={disabled}
              onClick={() => onUpdate(member, { is_active: true })}
            >
              Restore access
            </button>
          )}
        </div>

        {confirmRemoval && (
          <div className="staff-confirm">
            <p>
              Remove this person’s staff access to this event?
              Their previous actions remain recorded.
            </p>

            <div className="staff-inline-actions">
              <button
                type="button"
                className="staff-button staff-button-danger"
                disabled={disabled}
                onClick={() => {
                  setConfirmRemoval(false);
                  onUpdate(member, { is_active: false });
                }}
              >
                Confirm removal
              </button>

              <button
                type="button"
                className="staff-button"
                disabled={disabled}
                onClick={() => setConfirmRemoval(false)}
              >
                Keep access
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export default function EventStaff() {
  const { id } = useParams();

  const [members, setMembers] = useState([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("attendance");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    getEventStaff(id)
      .then((data) => {
        if (!Array.isArray(data.members)) {
          throw new Error("Unexpected staff list response.");
        }

        if (active) {
          setMembers(data.members);
          setBlocked(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Unable to load event staff.");
          setBlocked(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, reload]);

  async function saveChange(operation, successMessage, afterSuccess) {
    if (saving.current || blocked || loading) return;

    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await operation();
      afterSuccess?.();
      setMessage(successMessage);
      setReload((value) => value + 1);
    } catch (err) {
      // After a conflict or uncertain network result, reload before
      // allowing another write. Do not automatically retry a mutation.
      if (err.status !== 400) {
        setBlocked(true);
      }

      setError(
        err.status === 409
          ? `${err.message} Reload staff before continuing.`
          : err.message || "Unable to save this change."
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function handleAdd(event) {
    event.preventDefault();

    return saveChange(
      () => addEventStaff(id, {
        username: username.trim(),
        role,
      }),
      "Staff member added.",
      () => setUsername("")
    );
  }

  function handleUpdate(member, changes) {
    return saveChange(
      () => updateEventStaff(id, member.id, {
        revision: member.revision,
        ...changes,
      }),
      "Staff access updated."
    );
  }

  const disabled = loading || busy || blocked;

  return (
    <section className="event-staff-page">
      <Link to={`/organizer/events/${id}/workspace`}>
        ← Event workspace
      </Link>

      <header className="staff-heading">
        <p className="staff-eyebrow">EVENT OWNER CONTROLS</p>
        <h1>Your event team.</h1>
        <p>
          Assign existing EventHub accounts to help run this event.
          Their access applies only to this event.
        </p>
      </header>

      {error && (
        <p className="staff-error" role="alert">{error}</p>
      )}

      {message && (
        <p className="staff-success" role="status">{message}</p>
      )}

      <section className="staff-panel">
        <h2>Add a staff member</h2>

        <form onSubmit={handleAdd}>
          <fieldset className="staff-add-form" disabled={disabled}>
            <div>
              <label htmlFor="staff-username">
                EventHub username
              </label>
              <input
                id="staff-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter their exact username"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={150}
                required
              />
            </div>

            <div>
              <label htmlFor="staff-new-role">Event role</label>
              <select
                id="staff-new-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {ROLES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="staff-button staff-button-primary"
            >
              {busy ? "Saving..." : "Add staff"}
            </button>
          </fieldset>
        </form>

        <ul className="staff-role-help">
          <li>
            <strong>Manager:</strong> edit event details, view
            participants and manage attendance.
          </li>
          <li>
            <strong>Attendance volunteer:</strong> view attendance
            and check in participants.
          </li>
        <li>
            <strong>Certificate coordinator:</strong> manage
            certificate templates, previews and participation
            drafts. Publication, revocation and award decisions
            remain with the event owner.
          </li>
        </ul>
      </section>

      <section className="staff-panel" aria-busy={loading || busy}>
        <div className="staff-section-heading">
          <h2>Staff members ({members.length})</h2>

          <button
            type="button"
            className="staff-button"
            disabled={loading || busy}
            onClick={() => {
              setMessage("");
              setReload((value) => value + 1);
            }}
          >
            Reload staff
          </button>
        </div>

        <p>
          The event owner keeps full access and is not included
          in this staff list.
        </p>

        {loading ? (
          <p role="status">Loading staff...</p>
        ) : members.length === 0 ? (
          <p>No staff members have been added yet.</p>
        ) : (
          members.map((member) => (
            <StaffMemberRow
              key={`${member.id}-${member.revision}`}
              member={member}
              disabled={disabled}
              onUpdate={handleUpdate}
            />
          ))
        )}
      </section>
    </section>
  );
}