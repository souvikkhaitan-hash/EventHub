import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  createEvent,
  getOrganizerEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
} from "../services/events";

import EventCover from "../components/EventCover";
import "../styles/event-form-editorial.css";

const initialForm = {
  title: "",
  description: "",
  category: "technical",
  venue: "",
  start_datetime: "",
  end_datetime: "",
  registration_deadline: "",
  capacity: "50",
  registration_mode: "individual",
  min_team_size: "2",
  max_team_size: "6",
  max_teams: "30",
};

const categories = {
  technical: "Tech & Build",
  cultural: "Culture & Art",
  workshop: "Workshop",
  seminar: "Seminar",
  sports: "Sports",
};

const dateFields = [
  "start_datetime",
  "end_datetime",
  "registration_deadline",
];

const numberFields = [
  "capacity",
  "min_team_size",
  "max_team_size",
  "max_teams",
];

// Display API timestamps as IST inside datetime-local inputs.
function inputDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return "";
  }

  return new Date(
    new Date(value).getTime() + 330 * 60000
  )
    .toISOString()
    .slice(0, 16);
}

// Interpret entered dates as IST, regardless of device timezone.
function eventDate(value) {
  return new Date(`${value}:00+05:30`);
}

function previewDate(value) {
  const date = eventDate(value);

  if (!value || Number.isNaN(date.getTime())) {
    return "Choose a date";
  }

  return (
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(date) + " IST"
  );
}

function apiError(error) {
  if (
    error?.details &&
    typeof error.details === "object"
  ) {
    const lines = Object.entries(error.details).flatMap(
      ([field, values]) =>
        (Array.isArray(values) ? values : [values])
          .filter((value) => typeof value === "string")
          .map(
            (value) =>
              `${field.replaceAll("_", " ")}: ${value}`
          )
    );

    if (lines.length) return lines.join(" ");
  }

  return (
    error?.message ||
    "Something went wrong. Please try again."
  );
}

function validate(form) {
  if (
    ![form.title, form.description, form.venue].every(
      (value) => value.trim()
    )
  ) {
    return "Complete the event title, description and venue.";
  }

  if (
    dateFields.some(
      (field) =>
        !form[field] ||
        Number.isNaN(eventDate(form[field]).getTime())
    )
  ) {
    return "Enter valid start, end and registration deadline dates.";
  }

  if (
    eventDate(form.end_datetime) <=
    eventDate(form.start_datetime)
  ) {
    return "The event must end after it starts.";
  }

  if (
    eventDate(form.registration_deadline) >
    eventDate(form.start_datetime)
  ) {
    return "Registration must close before the event starts.";
  }

  if (
    !Number.isInteger(Number(form.capacity)) ||
    Number(form.capacity) < 1
  ) {
    return "Maximum participants must be a whole number of at least 1.";
  }

  if (form.registration_mode === "team") {
    const min = Number(form.min_team_size);
    const max = Number(form.max_team_size);
    const teams = Number(form.max_teams);

    if (!Number.isInteger(min) || min < 2) {
      return "Minimum team size must be at least 2.";
    }

    if (!Number.isInteger(max) || max < min) {
      return "Maximum team size must be at least the minimum team size.";
    }

    if (!Number.isInteger(teams) || teams < 1) {
      return "Maximum teams must be a whole number of at least 1.";
    }

    if (max > Number(form.capacity)) {
      return "Participant capacity must be at least the maximum team size.";
    }
  }

  return "";
}

function payload(form) {
  const result = {
    ...form,
    title: form.title.trim(),
    description: form.description.trim(),
    venue: form.venue.trim(),
  };

  dateFields.forEach((field) => {
    result[field] = eventDate(form[field]).toISOString();
  });

  numberFields.forEach((field) => {
    result[field] = Number(form[field]);
  });

  return result;
}

function Field({
  name,
  label,
  type = "text",
  form,
  onChange,
  disabled,
  ...props
}) {
  return (
    <div className="ef-field">
      <label htmlFor={`ef-${name}`}>{label}</label>

      <input
        id={`ef-${name}`}
        name={name}
        type={type}
        value={form[name]}
        onChange={onChange}
        disabled={disabled}
        required
        {...props}
      />
    </div>
  );
}

function SectionHeading({ number, title, children }) {
  return (
    <div className="ef-section-heading">
      <span>{number}</span>

      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}

export default function EventForm() {
  const { id } = useParams();

  return <EventEditor key={id || "new"} id={id} />;
}

function EventEditor({ id }) {
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState({ ...initialForm });
  const [saved, setSaved] = useState(null);
  const [status, setStatus] = useState("draft");

  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);

  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [previewOpen, setPreviewOpen] = useState(true);

  const busy = useRef(false);
  const active = useRef(false);
  const feedback = useRef(null);

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editing) return;

    let current = true;

    setLoading(true);
    setLoadError("");

    getOrganizerEvent(id)
      .then((event) => {
        if (!current) return;

        const loaded = { ...initialForm };

        Object.keys(loaded).forEach((field) => {
          if (event[field] != null) {
            loaded[field] = String(event[field]);
          }
        });

        dateFields.forEach((field) => {
          loaded[field] = inputDate(event[field]);
        });

        setForm(loaded);
        setSaved({ ...loaded });
        setStatus(event.status);
      })
      .catch((err) => {
        if (current) setLoadError(apiError(err));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [id, editing, revision]);

  useEffect(() => {
    if (error || success) {
      feedback.current?.focus();
    }
  }, [error, success]);

  const cancelled = status === "cancelled";
  const saving = Boolean(operation);

  const dirty =
    saved !== null &&
    JSON.stringify(form) !== JSON.stringify(saved);

  const team = form.registration_mode === "team";
  const disabled = saving || cancelled;
  const statusLabel = editing ? status : "New draft";

  function change(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  }

  const fieldProps = {
    form,
    onChange: change,
    disabled,
  };

  async function perform(action) {
    if (busy.current || cancelled) return;
    if (action !== "save" && !editing) return;

    setError("");
    setSuccess("");

    if (
      action === "publish" &&
      (dirty || status !== "draft")
    ) {
      setError(
        "Save your changes before publishing the draft."
      );
      return;
    }

    if (action !== "cancel") {
      const problem = validate(form);

      if (problem) {
        setError(problem);
        return;
      }
    }

    if (
      action === "publish" &&
      !window.confirm(
        "Publish this event? Students will be able to discover and register for it."
      )
    ) {
      return;
    }

    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel this event? This may affect registered participants."
      )
    ) {
      return;
    }

    busy.current = true;
    setOperation(action);

    try {
      if (action === "save") {
        if (editing) {
          await updateEvent(id, payload(form));

          if (!active.current) return;

          setSaved({ ...form });
          setSuccess(
            "Your event changes have been saved."
          );
        } else {
          const created = await createEvent(
            payload(form)
          );

          if (!active.current) return;

          navigate(
            `/organizer/events/${created.id}/edit`,
            {
              replace: true,
              state: { created: true },
            }
          );
        }
      } else if (action === "publish") {
        await publishEvent(id);

        if (!active.current) return;

        setStatus("published");
        setSuccess("Event published successfully.");
      } else {
        await cancelEvent(id);

        if (!active.current) return;

        setStatus("cancelled");
        setSuccess("Event cancelled successfully.");
      }
    } catch (err) {
      if (active.current) setError(apiError(err));
    } finally {
      busy.current = false;

      if (active.current) setOperation("");
    }
  }

  if (loading || loadError) {
    return (
      <main className="ef-page">
        <Link className="ef-back" to="/organizer">
          ← Back to dashboard
        </Link>

        <div
          className="ef-panel ef-load"
          role={loadError ? "alert" : "status"}
        >
          {loadError || "Loading event details…"}

          {loadError && (
            <button
              className="ef-button"
              onClick={() =>
                setRevision((value) => value + 1)
              }
            >
              Try again
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="ef-page">
      <Link className="ef-back" to="/organizer">
        ← Back to dashboard
      </Link>

      <header className="ef-header">
        <div>
          <span className="ef-eyebrow">
            Event setup
          </span>

          <h1>
            {editing
              ? "Manage your event"
              : "Create an event"}
            <span>.</span>
          </h1>

          <p>
            {editing
              ? "Keep your event details and registration settings up to date."
              : "Start with the details. Save a draft, then review before publishing."}
          </p>
        </div>

        <span
          className={`ef-status ef-status-${status}`}
        >
          ● {statusLabel}
        </span>
      </header>

      <nav
        className="ef-nav"
        aria-label="Event form sections"
      >
        <a href="#ef-details">
          <span>01</span> Details
        </a>

        <a href="#ef-schedule">
          <span>02</span> Schedule
        </a>

        <a href="#ef-registration">
          <span>03</span> Registration
        </a>
      </nav>

      {(error || success) && (
        <div
          ref={feedback}
          tabIndex={-1}
          className={`ef-message ${
            error ? "ef-error" : "ef-success"
          }`}
          role={error ? "alert" : "status"}
        >
          {error || success}
        </div>
      )}

      {dirty && !cancelled && (
        <p className="ef-unsaved" role="status">
          Unsaved changes. Save before publishing.
        </p>
      )}

      {cancelled && (
        <p className="ef-message ef-info">
          This event has been cancelled and can no
          longer be edited.
        </p>
      )}

      <div className="ef-layout">
        <form
          id="ef-form"
          className="ef-form"
          onSubmit={(event) => {
            event.preventDefault();
            perform("save");
          }}
        >
          <section
            className="ef-panel ef-section"
            id="ef-details"
          >
            <SectionHeading
              number="01"
              title="Event details"
            >
              Give your event a name and a description.
            </SectionHeading>

            <Field
              name="title"
              label="Event title"
              maxLength={200}
              placeholder="e.g. CodeSprint 2026"
              {...fieldProps}
            />

            <div className="ef-field">
              <label htmlFor="ef-description">
                Description
              </label>

              <textarea
                id="ef-description"
                name="description"
                rows={4}
                value={form.description}
                onChange={change}
                disabled={disabled}
                required
                placeholder="What will students experience?"
              />
            </div>

            <div className="ef-field">
              <label htmlFor="ef-category">
                Category
              </label>

              <select
                id="ef-category"
                name="category"
                value={form.category}
                onChange={change}
                disabled={disabled}
              >
                {Object.entries(categories).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>
          </section>

          <section
            className="ef-panel ef-section"
            id="ef-schedule"
          >
            <SectionHeading
              number="02"
              title="Schedule & location"
            >
              Set the time and place for your event.
            </SectionHeading>

            <Field
              name="venue"
              label="Venue"
              maxLength={200}
              placeholder="e.g. Innovation Lab, Block B"
              {...fieldProps}
            />

            <div className="ef-field-grid">
              <Field
                name="start_datetime"
                label="Event starts"
                type="datetime-local"
                {...fieldProps}
              />

              <Field
                name="end_datetime"
                label="Event ends"
                type="datetime-local"
                {...fieldProps}
              />
            </div>

            <p className="ef-help">
              All dates and times are in IST
              (UTC+05:30).
            </p>
          </section>

          <section
            className="ef-panel ef-section"
            id="ef-registration"
          >
            <SectionHeading
              number="03"
              title="Registration"
            >
              Choose how students will participate and
              set registration limits.
            </SectionHeading>

            <fieldset
              className="ef-modes"
              disabled={
                disabled ||
                (editing && status !== "draft")
              }
            >
              <legend>Registration type</legend>

              <div className="ef-mode-grid">
                {[
                  [
                    "individual",
                    "Individual",
                    "Students register separately and receive their own tickets.",
                  ],
                  [
                    "team",
                    "Team / Group",
                    "Students participate together in teams with configurable limits.",
                  ],
                ].map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={`ef-mode ${
                      form.registration_mode === value
                        ? "ef-mode-selected"
                        : ""
                    }`}
                  >
                    <span>
                      <input
                        type="radio"
                        name="registration_mode"
                        value={value}
                        checked={
                          form.registration_mode ===
                          value
                        }
                        onChange={change}
                      />

                      {label}
                    </span>

                    <small>{hint}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            {editing && status !== "draft" && (
              <p className="ef-help">
                Registration type cannot change after
                publication.
              </p>
            )}

            {team && (
              <div className="ef-team-settings">
                <h3>Team configuration</h3>

                <div className="ef-field-grid">
                  <Field
                    name="min_team_size"
                    label="Minimum members per team"
                    type="number"
                    min={2}
                    step={1}
                    {...fieldProps}
                  />

                  <Field
                    name="max_team_size"
                    label="Maximum members per team"
                    type="number"
                    min={2}
                    step={1}
                    {...fieldProps}
                  />

                  <Field
                    name="max_teams"
                    label="Maximum teams"
                    type="number"
                    min={1}
                    step={1}
                    {...fieldProps}
                  />
                </div>

                <p className="ef-help">
                  Students create teams, invite
                  classmates and confirm once the
                  minimum team size is reached.
                </p>
              </div>
            )}

            <div className="ef-field-grid">
              <Field
                name="registration_deadline"
                label="Registration deadline"
                type="datetime-local"
                {...fieldProps}
              />

              <Field
                name="capacity"
                label="Maximum participants"
                type="number"
                min={1}
                step={1}
                {...fieldProps}
              />
            </div>

            <p className="ef-help">
              Registrations must close before the
              event starts. Capacity cannot be reduced
              below active registrations.
            </p>

            {team && (
              <p className="ef-info">
                Maximum participants counts students,
                not teams. Both student capacity and
                team limits apply.
              </p>
            )}
          </section>
        </form>

        <aside
          className="ef-panel ef-preview"
          aria-label="Event preview"
        >
          <div className="ef-preview-heading">
            <div>
              <h2>Event preview</h2>
              <p>Updates as you type.</p>
            </div>

            <button
              type="button"
              className="ef-toggle"
              aria-expanded={previewOpen}
              aria-controls="ef-preview-content"
              onClick={() =>
                setPreviewOpen((value) => !value)
              }
            >
              {previewOpen ? "Hide" : "Show"}
            </button>
          </div>

          {previewOpen && (
            <div id="ef-preview-content">
              <div className="ef-cover">
                <EventCover
                  category={form.category}
                  showLabel
                />
              </div>

              <div className="ef-preview-meta">
                <span>
                  {categories[form.category]}
                </span>

                <span
                  className={`ef-status ef-status-${status}`}
                >
                  {status}
                </span>
              </div>

              <h3 className="ef-preview-title">
                {form.title.trim() ||
                  "Your event title"}
              </h3>

              <p className="ef-preview-description">
                {form.description.trim() ||
                  "Your event description will appear here as you type."}
              </p>

              <div className="ef-preview-details">
                <p>
                  <span aria-hidden="true">◷</span>
                  {previewDate(form.start_datetime)}
                </p>

                <p>
                  <span aria-hidden="true">⌖</span>
                  {form.venue.trim() ||
                    "Event location"}
                </p>
              </div>

              <dl className="ef-preview-facts">
                <div>
                  <dt>Capacity</dt>
                  <dd>
                    {form.capacity || "—"} seats
                  </dd>
                </div>

                {team && (
                  <>
                    <div>
                      <dt>Team size</dt>
                      <dd>
                        {form.min_team_size || "—"}–
                        {form.max_team_size || "—"}{" "}
                        members
                      </dd>
                    </div>

                    <div>
                      <dt>Maximum teams</dt>
                      <dd>
                        {form.max_teams || "—"}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              <p className="ef-info">
                Preview only. Select Save to keep your
                changes.
              </p>
            </div>
          )}
        </aside>
      </div>

      <footer className="ef-panel ef-actions">
        <div>
          <strong>
            {cancelled
              ? "Cancelled event"
              : status === "published"
                ? "Published event"
                : "Private draft"}
          </strong>

          <p>
            {cancelled
              ? "This event is no longer accepting changes."
              : status === "published"
                ? "Save changes to update the published event."
                : "You can review it before publishing."}
          </p>
        </div>

        <div className="ef-action-buttons">
          {!cancelled && (
            <button
              type="submit"
              form="ef-form"
              className="ef-button ef-primary"
              disabled={saving}
            >
              {operation === "save"
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Save as draft"}
            </button>
          )}

          {editing && status === "draft" && (
            <button
              type="button"
              className="ef-button"
              disabled={saving || dirty}
              onClick={() => perform("publish")}
              title={
                dirty
                  ? "Save changes before publishing"
                  : "Publish event"
              }
            >
              {operation === "publish"
                ? "Publishing…"
                : "Publish event"}
            </button>
          )}

          {editing && !cancelled && (
            <button
              type="button"
              className="ef-button ef-danger"
              disabled={saving}
              onClick={() => perform("cancel")}
            >
              {operation === "cancel"
                ? "Cancelling…"
                : "Cancel event"}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}