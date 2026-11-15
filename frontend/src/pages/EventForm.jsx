import { useEffect, useState } from "react";

import {
  Link,
  useNavigate,
  useParams,
} from "react-router";

import {
  createEvent,
  getOrganizerEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
} from "../services/events";

import EventArtwork from "../components/EventArtwork";

import "../styles/organizer.css";
import "../styles/organizer-v2.css";
import "../styles/eventEditor.css";


// ============================================================
// EVENTHUB — EVENT FORM INITIAL STATE
// ============================================================

const initialForm = {
  title: "",
  description: "",
  category: "technical",
  venue: "",
  start_datetime: "",
  end_datetime: "",
  registration_deadline: "",
  capacity: 50,

  // Team event configuration
  registration_mode: "individual",
  min_team_size: 2,
  max_team_size: 6,
  max_teams: 30,
};


// ============================================================
// EVENT CATEGORY LABELS
// ============================================================

const categoryLabels = {
  technical: "Tech & Build",
  cultural: "Culture & Art",
  workshop: "Workshop",
  seminar: "Seminar",
  sports: "Sports",
};


// ============================================================
// DATE HELPERS
// ============================================================

function toLocalInputValue(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 16);
}


function formatPreviewDate(value) {
  if (!value) return "Choose a date";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Choose a date";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}


// ============================================================
// API ERROR HANDLING
// ============================================================

function formatApiError(error) {
  if (!error) {
    return "Something went wrong. Please try again.";
  }

  if (
    !error.details ||
    typeof error.details !== "object"
  ) {
    return (
      error.message ||
      "Something went wrong. Please try again."
    );
  }

  const messages = Object.entries(error.details).flatMap(
    ([field, values]) => {
      const entries = Array.isArray(values)
        ? values
        : [values];

      return entries
        .filter((value) => typeof value === "string")
        .map((value) => `${field}: ${value}`);
    }
  );

  return (
    messages.join(" ") ||
    error.message ||
    "Something went wrong."
  );
}


// ============================================================
// MAIN EVENT FORM COMPONENT
// ============================================================

export default function EventForm() {
  const { id } = useParams();

  const navigate = useNavigate();

  const isEditing = Boolean(id);

  // ==========================================================
  // STATE
  // ==========================================================

  const [form, setForm] = useState(initialForm);

  const [savedForm, setSavedForm] = useState(null);

  const [eventStatus, setEventStatus] = useState("draft");

  const [loading, setLoading] = useState(isEditing);

  const [loadError, setLoadError] = useState("");

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");

  const [previewOpen, setPreviewOpen] = useState(true);


  // ==========================================================
  // LOAD EXISTING EVENT
  // ==========================================================

  useEffect(() => {
    if (!isEditing) {
      setForm({ ...initialForm });
      setSavedForm(null);
      setEventStatus("draft");
      setLoadError("");
      setError("");
      setSuccess("");
      setLoading(false);
      return;
    }

    let active = true;

    async function loadEvent() {
      setLoading(true);
      setLoadError("");

      try {
        const event = await getOrganizerEvent(id);

        if (!active) return;

        const loadedForm = {
          title: event.title,
          description: event.description,
          category: event.category,
          venue: event.venue,

          start_datetime: toLocalInputValue(
            event.start_datetime
          ),

          end_datetime: toLocalInputValue(
            event.end_datetime
          ),

          registration_deadline: toLocalInputValue(
            event.registration_deadline
          ),

          capacity: event.capacity,

          // Load existing team configuration
          registration_mode:
            event.registration_mode || "individual",

          min_team_size:
            event.min_team_size ?? 2,

          max_team_size:
            event.max_team_size ?? 6,

          max_teams:
            event.max_teams ?? 30,
        };

        setForm(loadedForm);

        setSavedForm({ ...loadedForm });

        setEventStatus(event.status);

        setError("");
        setSuccess("");
      } catch (err) {
        if (active) {
          setLoadError(formatApiError(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEvent();

    return () => {
      active = false;
    };
  }, [id, isEditing]);


  // ==========================================================
  // HANDLE INPUT CHANGES
  // ==========================================================

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  }


  // ==========================================================
  // FORM VALIDATION
  // ==========================================================

  function validateForm() {
    const start = new Date(form.start_datetime);

    const end = new Date(form.end_datetime);

    const deadline = new Date(
      form.registration_deadline
    );

    // Required information

    if (
      !form.title.trim() ||
      !form.description.trim() ||
      !form.venue.trim()
    ) {
      return "Please complete all event information.";
    }

    // Dates

    if (
      !form.start_datetime ||
      !form.end_datetime ||
      !form.registration_deadline ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      Number.isNaN(deadline.getTime())
    ) {
      return "Please enter valid event dates.";
    }

    if (end <= start) {
      return "The event must end after it starts.";
    }

    if (deadline > start) {
      return (
        "Registration must close before " +
        "the event starts."
      );
    }

    // Participant capacity

    const capacity = Number(form.capacity);

    if (
      !Number.isInteger(capacity) ||
      capacity < 1
    ) {
      return (
        "Capacity must be a whole number " +
        "of at least 1."
      );
    }

    // ========================================================
    // TEAM EVENT VALIDATION
    // ========================================================

    if (form.registration_mode === "team") {
      const minTeamSize = Number(
        form.min_team_size
      );

      const maxTeamSize = Number(
        form.max_team_size
      );

      const maxTeams = Number(
        form.max_teams
      );

      if (
        !Number.isInteger(minTeamSize) ||
        minTeamSize < 2
      ) {
        return (
          "Minimum team size must be at least 2."
        );
      }

      if (
        !Number.isInteger(maxTeamSize) ||
        maxTeamSize < minTeamSize
      ) {
        return (
          "Maximum team size must be greater " +
          "than or equal to minimum team size."
        );
      }

      if (
        !Number.isInteger(maxTeams) ||
        maxTeams < 1
      ) {
        return (
          "Maximum teams must be at least 1."
        );
      }

      if (maxTeamSize > capacity) {
        return (
          "Total participant capacity must be " +
          "at least as large as maximum team size."
        );
      }
    }

    return "";
  }


  // ==========================================================
  // BUILD BACKEND PAYLOAD
  // ==========================================================

  function buildPayload() {
    return {
      title: form.title.trim(),

      description: form.description.trim(),

      category: form.category,

      venue: form.venue.trim(),

      start_datetime: new Date(
        form.start_datetime
      ).toISOString(),

      end_datetime: new Date(
        form.end_datetime
      ).toISOString(),

      registration_deadline: new Date(
        form.registration_deadline
      ).toISOString(),

      capacity: Number(form.capacity),

      // Individual or team
      registration_mode: form.registration_mode,

      // Team configuration
      min_team_size: Number(
        form.min_team_size
      ),

      max_team_size: Number(
        form.max_team_size
      ),

      max_teams: Number(
        form.max_teams
      ),
    };
  }


  // ==========================================================
  // EVENT STATE
  // ==========================================================

  const hasUnsavedChanges =
    isEditing &&
    savedForm !== null &&
    JSON.stringify(form) !== JSON.stringify(savedForm);

  const isCancelled =
    eventStatus === "cancelled";

  const isTeamEvent =
    form.registration_mode === "team";

  const canPublish =
    isEditing &&
    eventStatus === "draft" &&
    !hasUnsavedChanges &&
    !saving;


  // ==========================================================
  // SAVE DRAFT / SAVE CHANGES
  // ==========================================================

  async function handleSubmit(event) {
    event.preventDefault();

    if (saving || isCancelled) return;

    setError("");
    setSuccess("");

    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    try {
      const payload = buildPayload();

      if (isEditing) {
        await updateEvent(id, payload);

        setSavedForm({ ...form });

        setSuccess(
          "Your event changes have been saved successfully."
        );
      } else {
        const createdEvent = await createEvent(
          payload
        );

        navigate(
          `/organizer/events/${createdEvent.id}/edit`,
          {
            replace: true,

            state: {
              created: true,
            },
          }
        );
      }
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }


  // ==========================================================
  // PUBLISH EVENT
  // ==========================================================

  async function handlePublish() {
    if (!isEditing || saving || isCancelled) {
      return;
    }

    setError("");
    setSuccess("");

    // Prevent publishing unsaved form data.

    if (hasUnsavedChanges) {
      setError(
        "You have unsaved changes. " +
        "Save your event before publishing."
      );

      return;
    }

    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    const confirmed = window.confirm(
      "Publish this event? Students will be able " +
      "to discover and register for it."
    );

    if (!confirmed) return;

    setSaving(true);

    try {
      await publishEvent(id);

      setEventStatus("published");

      setSuccess(
        "Your event is now published " +
        "and visible to students!"
      );
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }


  // ==========================================================
  // CANCEL EVENT
  // ==========================================================

  async function handleCancel() {
    if (
      !isEditing ||
      saving ||
      isCancelled
    ) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to cancel this event? " +
      "This action may affect registered participants."
    );

    if (!confirmed) return;

    setError("");
    setSuccess("");
    setSaving(true);

    try {
      await cancelEvent(id);

      setEventStatus("cancelled");

      setSuccess(
        "Event cancelled successfully."
      );
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div
        className="organizer-loading"
        role="status"
      >
        Loading event details...
      </div>
    );
  }


  // ==========================================================
  // LOAD ERROR
  // ==========================================================

  if (loadError) {
    return (
      <div
        className="organizer-error"
        role="alert"
      >
        <p>{loadError}</p>

        <Link to="/organizer">
          Return to Dashboard →
        </Link>
      </div>
    );
  }


  // ==========================================================
  // EVENT EDITOR PAGE
  // ==========================================================

  return (
    <div className="event-editor-page">

      {/* BACK LINK */}

      <Link
        to="/organizer"
        className="organizer-back-link"
      >
        ← Back to Dashboard
      </Link>


      {/* ====================================================
          PAGE HEADER
      ==================================================== */}

      <section className="event-editor-header">

        <div>
          <span className="org-eyebrow">
            {isEditing
              ? "MANAGE YOUR EXPERIENCE"
              : "CREATE SOMETHING NEW"}
          </span>

          <h1>
            {isEditing ? (
              <>
                Make it
                <br />
                <span>even better.</span>
              </>
            ) : (
              <>
                Let's make it
                <br />
                <span>unforgettable.</span>
              </>
            )}
          </h1>

          <p>
            {isEditing
              ? "Refine your event details and keep your campus community informed."
              : "Every great campus experience starts with an idea. Bring yours to life."}
          </p>
        </div>

        <div className="event-editor-header-status">

          <span className="event-editor-status-label">
            EVENT STATUS
          </span>

          <span
            className={`event-editor-status event-editor-status-${eventStatus}`}
          >
            <span className="event-editor-status-dot" />

            {isEditing
              ? eventStatus
              : "New draft"}
          </span>

        </div>

      </section>


      {/* ====================================================
          FEEDBACK
      ==================================================== */}

      {error && (
        <div
          className="organizer-error event-editor-message"
          role="alert"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          className="organizer-success event-editor-message"
          role="status"
        >
          {success}
        </div>
      )}

      {hasUnsavedChanges && !isCancelled && (
        <div
          className="event-editor-unsaved"
          role="status"
        >
          ● You have unsaved changes.
          Save your changes before publishing.
        </div>
      )}


      {/* ====================================================
          MAIN EDITOR
      ==================================================== */}

      <div className="event-editor-layout">

        {/* ==================================================
            EVENT FORM
        ================================================== */}

        <form
          id="event-editor-form"
          className="event-form event-editor-form"
          onSubmit={handleSubmit}
        >


          {/* ================================================
              SECTION 01 — EVENT BASICS
          ================================================ */}

          <section className="event-form-section">

            <div className="event-form-section-heading">

              <span>01</span>

              <div>
                <h2>Event basics</h2>

                <p>
                  Give your event a name and a story.
                </p>
              </div>

            </div>


            <div className="event-form-fields">

              {/* EVENT TITLE */}

              <div className="event-field">

                <label htmlFor="title">
                  Event title
                </label>

                <input
                  id="title"
                  name="title"
                  type="text"
                  value={form.title}
                  onChange={handleChange}
                  placeholder="e.g. CodeSprint 2026"
                  maxLength={200}
                  required
                  disabled={saving || isCancelled}
                />

                <span className="event-editor-field-hint">
                  Choose a memorable name that
                  students can easily recognize.
                </span>

              </div>


              {/* DESCRIPTION */}

              <div className="event-field">

                <label htmlFor="description">
                  Event description
                </label>

                <textarea
                  id="description"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="What's happening? What can students expect? Why should they join?"
                  rows={5}
                  required
                  disabled={saving || isCancelled}
                />

                <span className="event-editor-field-hint">
                  Explain what participants will experience.
                </span>

              </div>


              {/* CATEGORY */}

              <div className="event-field">

                <label htmlFor="category">
                  Event category
                </label>

                <select
                  id="category"
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  disabled={saving || isCancelled}
                >

                  <option value="technical">
                    Tech & Build
                  </option>

                  <option value="cultural">
                    Culture & Art
                  </option>

                  <option value="workshop">
                    Workshop
                  </option>

                  <option value="seminar">
                    Seminar
                  </option>

                  <option value="sports">
                    Sports
                  </option>

                </select>

              </div>

            </div>

          </section>


          {/* ================================================
              SECTION 02 — LOCATION & SCHEDULE
          ================================================ */}

          <section className="event-form-section">

            <div className="event-form-section-heading">

              <span>02</span>

              <div>
                <h2>Where & when</h2>

                <p>
                  Set the stage for your experience.
                </p>
              </div>

            </div>


            <div className="event-form-fields">

              {/* VENUE */}

              <div className="event-field">

                <label htmlFor="venue">
                  Venue
                </label>

                <input
                  id="venue"
                  name="venue"
                  type="text"
                  value={form.venue}
                  onChange={handleChange}
                  placeholder="e.g. Innovation Lab, Block B"
                  maxLength={200}
                  required
                  disabled={saving || isCancelled}
                />

                <span className="event-editor-field-hint">
                  Enter the location where
                  students should arrive.
                </span>

              </div>


              {/* EVENT DATES */}

              <div className="event-field-grid">

                <div className="event-field">

                  <label htmlFor="start_datetime">
                    Event starts
                  </label>

                  <input
                    id="start_datetime"
                    name="start_datetime"
                    type="datetime-local"
                    value={form.start_datetime}
                    onChange={handleChange}
                    required
                    disabled={saving || isCancelled}
                  />

                </div>


                <div className="event-field">

                  <label htmlFor="end_datetime">
                    Event ends
                  </label>

                  <input
                    id="end_datetime"
                    name="end_datetime"
                    type="datetime-local"
                    value={form.end_datetime}
                    onChange={handleChange}
                    required
                    disabled={saving || isCancelled}
                  />

                </div>

              </div>

            </div>

          </section>


          {/* ================================================
              SECTION 03 — REGISTRATION TYPE
          ================================================ */}

          <section className="event-form-section">

            <div className="event-form-section-heading">

              <span>03</span>

              <div>
                <h2>Registration type</h2>

                <p>
                  Choose how students will participate
                  in your event.
                </p>
              </div>

            </div>


            {/* INDIVIDUAL OR TEAM */}

            <div className="event-editor-registration-options">

              {/* INDIVIDUAL */}

              <label
                className={`event-editor-registration-option ${
                  form.registration_mode === "individual"
                    ? "selected"
                    : ""
                }`}
              >

                <input
                  type="radio"
                  name="registration_mode"
                  value="individual"
                  checked={
                    form.registration_mode === "individual"
                  }
                  onChange={handleChange}
                  disabled={
                    saving ||
                    isCancelled ||
                    (isEditing && eventStatus !== "draft")
                  }
                />

                <span
                  className="registration-option-icon"
                  aria-hidden="true"
                >
                  ◉
                </span>

                <strong>Individual</strong>

                <small>
                  Students register separately
                  and receive their own tickets.
                </small>

              </label>


              {/* TEAM */}

              <label
                className={`event-editor-registration-option ${
                  form.registration_mode === "team"
                    ? "selected"
                    : ""
                }`}
              >

                <input
                  type="radio"
                  name="registration_mode"
                  value="team"
                  checked={
                    form.registration_mode === "team"
                  }
                  onChange={handleChange}
                  disabled={
                    saving ||
                    isCancelled ||
                    (isEditing && eventStatus !== "draft")
                  }
                />

                <span
                  className="registration-option-icon"
                  aria-hidden="true"
                >
                  ♧
                </span>

                <strong>Team / Group</strong>

                <small>
                  Students participate together
                  in teams with configurable limits.
                </small>

              </label>

            </div>


            {/* ==============================================
                TEAM CONFIGURATION
            ============================================== */}

            {isTeamEvent && (

              <div className="event-editor-team-settings">

                <div className="event-editor-team-heading">

                  <span aria-hidden="true">✳</span>

                  <div>
                    <h3>Team configuration</h3>

                    <p>
                      Set how many students can
                      participate in each team.
                    </p>
                  </div>

                </div>


                {/* TEAM LIMITS */}

                <div className="event-field-grid">

                  {/* MINIMUM TEAM SIZE */}

                  <div className="event-field">

                    <label htmlFor="min_team_size">
                      Minimum members per team
                    </label>

                    <input
                      id="min_team_size"
                      name="min_team_size"
                      type="number"
                      min="2"
                      step="1"
                      value={form.min_team_size}
                      onChange={handleChange}
                      required
                      disabled={saving || isCancelled}
                    />

                  </div>


                  {/* MAXIMUM TEAM SIZE */}

                  <div className="event-field">

                    <label htmlFor="max_team_size">
                      Maximum members per team
                    </label>

                    <input
                      id="max_team_size"
                      name="max_team_size"
                      type="number"
                      min="2"
                      step="1"
                      value={form.max_team_size}
                      onChange={handleChange}
                      required
                      disabled={saving || isCancelled}
                    />

                  </div>


                  {/* MAXIMUM TEAMS */}

                  <div className="event-field">

                    <label htmlFor="max_teams">
                      Maximum teams
                    </label>

                    <input
                      id="max_teams"
                      name="max_teams"
                      type="number"
                      min="1"
                      step="1"
                      value={form.max_teams}
                      onChange={handleChange}
                      required
                      disabled={saving || isCancelled}
                    />

                  </div>

                </div>


                {/* ==========================================
                    TEAM SUMMARY
                ========================================== */}

                <div className="event-editor-team-summary">

                  <span>
                    EVENT CONFIGURATION
                  </span>


                  <div>
                    <strong>
                      {Number(form.max_teams) || 0}
                    </strong>

                    <span>
                      Maximum teams
                    </span>
                  </div>


                  <div>
                    <strong>
                      {Number(form.min_team_size) || 0}
                      {" – "}
                      {Number(form.max_team_size) || 0}
                    </strong>

                    <span>
                      Members per team
                    </span>
                  </div>


                  <div>
                    <strong>
                      {Number(form.capacity) || 0}
                    </strong>

                    <span>
                      Total student capacity
                    </span>
                  </div>

                </div>


                {/* ==========================================
                    TEAM FEATURE NOTICE
                ========================================== */}

                <div className="event-editor-info-note">
  <span aria-hidden="true">✳</span>

  <p>
    <strong>Team registration is enabled.</strong>
    <br />
    Students can create teams, invite classmates,
    and confirm their teams once the minimum
    number of members has joined.
  </p>
</div>

              </div>

            )}

          </section>


          {/* ================================================
              SECTION 04 — REGISTRATION SETTINGS
          ================================================ */}

          <section className="event-form-section">

            <div className="event-form-section-heading">

              <span>04</span>

              <div>
                <h2>Registration settings</h2>

                <p>
                  Decide when registrations close
                  and how many students can join.
                </p>
              </div>

            </div>


            <div className="event-form-fields">

              <div className="event-field-grid">

                {/* REGISTRATION DEADLINE */}

                <div className="event-field">

                  <label htmlFor="registration_deadline">
                    Registration deadline
                  </label>

                  <input
                    id="registration_deadline"
                    name="registration_deadline"
                    type="datetime-local"
                    value={form.registration_deadline}
                    onChange={handleChange}
                    required
                    disabled={saving || isCancelled}
                  />

                </div>


                {/* PARTICIPANT CAPACITY */}

                <div className="event-field">

                  <label htmlFor="capacity">
                    Maximum participants
                  </label>

                  <input
                    id="capacity"
                    name="capacity"
                    type="number"
                    value={form.capacity}
                    onChange={handleChange}
                    min="1"
                    step="1"
                    required
                    disabled={saving || isCancelled}
                  />

                </div>

              </div>


              {/* CAPACITY INFORMATION */}

              <div className="event-editor-info-note">

                <span aria-hidden="true">
                  ✳
                </span>

                <p>
                  {isTeamEvent
                    ? (
                      <>
                        <strong>
                          Team event capacity:
                        </strong>

                        {" "}

                        Maximum participants is the
                        total number of students,
                        not the number of teams.

                        Both team limits and student
                        capacity will be enforced
                        during team registration.
                      </>
                    )
                    : (
                      <>
                        Registration must close before
                        the event begins.

                        Once students register,
                        capacity cannot be reduced
                        below confirmed registrations.
                      </>
                    )}
                </p>

              </div>

            </div>

          </section>


          {/* ================================================
              FORM ACTIONS
          ================================================ */}

          <div className="event-editor-actions">

            {/* SAVE */}

            {!isCancelled && (

              <button
                type="submit"
                className="org-button-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : isEditing
                    ? "Save Changes"
                    : "Save as Draft"}

                {!saving && (
                  <span aria-hidden="true">
                    ↗
                  </span>
                )}
              </button>

            )}


            {/* PUBLISH */}

            {isEditing &&
              eventStatus === "draft" && (

                <button
                  type="button"
                  className="event-editor-publish-button"
                  onClick={handlePublish}
                  disabled={!canPublish}
                    title={
      hasUnsavedChanges
        ? "Save your changes before publishing"
        : "Publish this event"
    }
  >
                 Publish Event →
  </button>
)}


            {/* CANCEL EVENT */}

            {isEditing &&
              !isCancelled && (

                <button
                  type="button"
                  className="event-editor-cancel-button"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel Event
                </button>

              )}


            {/* CANCELLED NOTICE */}

            {isCancelled && (

              <div className="event-editor-cancelled-note">

                This event has been cancelled
                and can no longer be edited.

              </div>

            )}

          </div>


          {/* SAVE INFORMATION */}

          <p className="event-editor-save-hint">
  {!isEditing
    ? "Your event will be saved as a private draft. You can review it before publishing."
    : eventStatus === "draft"
      ? "Draft events are not visible to students until published."
      : eventStatus === "published"
        ? "Changes to a published event will be saved when you select Save Changes."
        : "This event is no longer accepting changes."}
</p>

        </form>


        {/* ==================================================
            LIVE PREVIEW
        ================================================== */}

        <aside className="event-editor-preview">

          {/* PREVIEW HEADING */}

          <div className="event-editor-preview-heading">

            <div>

              <span className="org-eyebrow">
                LIVE PREVIEW
              </span>

              <h2>
                See it come to life.
              </h2>

              <p>
                Your event card updates as you type.
              </p>

            </div>


            <button
              type="button"
              className="event-editor-preview-toggle"
              onClick={() =>
                setPreviewOpen((previous) => !previous)
              }
              aria-expanded={previewOpen}
            >
              {previewOpen ? "Hide" : "Show"}
            </button>

          </div>


          {/* ================================================
              PREVIEW CARD
          ================================================ */}

          {previewOpen && (

            <div className="event-editor-preview-content">

              <div className="event-editor-preview-card">

                {/* ==========================================
                    EVENT ARTWORK
                ========================================== */}

                <div
                  className={`event-editor-preview-art event-category-${form.category}`}
                >

                  <div className="event-editor-preview-art-top">

                    <span>
                      EVENTHUB / CAMPUS
                    </span>

                    <span>
                      ↗
                    </span>

                  </div>


                  <div className="event-editor-preview-symbol">

                    <EventArtwork
                      category={form.category}
                    />

                  </div>


                  <div className="event-editor-preview-art-bottom">

                    <span>
                      {categoryLabels[form.category]}
                    </span>

                    <span>
                      SHOW UP.
                    </span>

                  </div>

                </div>


                {/* ==========================================
                    PREVIEW INFORMATION
                ========================================== */}

                <div className="event-editor-preview-body">

                  {/* CATEGORY AND STATUS */}

                  <div className="event-editor-preview-meta">

                    <span>
                      {categoryLabels[form.category]}
                    </span>

                    <span
                      className={`event-editor-status event-editor-status-${eventStatus}`}
                    >
                      {isEditing
                        ? eventStatus
                        : "Draft"}
                    </span>

                  </div>


                  {/* EVENT TITLE */}

                  <h3>
                    {form.title.trim() ||
                      "Your event title"}
                  </h3>


                  {/* DESCRIPTION */}

                  <p className="event-editor-preview-description">

                    {form.description.trim() ||
                      "Your event description will appear here as you type."}

                  </p>


                  {/* EVENT DATE AND VENUE */}

                  <div className="event-editor-preview-details">

                    <div>

                      <span aria-hidden="true">
                        ◷
                      </span>

                      <span>
                        {formatPreviewDate(
                          form.start_datetime
                        )}
                      </span>

                    </div>


                    <div>

                      <span aria-hidden="true">
                        ⌖
                      </span>

                      <span>
                        {form.venue.trim() ||
                          "Event location"}
                      </span>

                    </div>

                  </div>


                  {/* ==========================================
                      REGISTRATION PREVIEW
                  ========================================== */}

                  <div className="event-editor-preview-footer">

                    <span>
                      {isTeamEvent
                        ? "Registration"
                        : "Capacity"}
                    </span>

                    <strong>
                      {isTeamEvent
                        ? "Team Event"
                        : `${form.capacity || 0} seats`}
                    </strong>

                  </div>


                  {/* ==========================================
                      TEAM PREVIEW
                  ========================================== */}

                  {isTeamEvent && (

                    <div className="event-editor-preview-team">

                      <div>

                        <span>
                          TEAM SIZE
                        </span>

                        <strong>
                          {form.min_team_size}
                          {" – "}
                          {form.max_team_size}
                          {" members"}
                        </strong>

                      </div>


                      <div>

                        <span>
                          MAXIMUM TEAMS
                        </span>

                        <strong>
                          {form.max_teams}
                        </strong>

                      </div>


                      <div>

                        <span>
                          STUDENT CAPACITY
                        </span>

                        <strong>
                          {form.capacity}
                        </strong>

                      </div>

                    </div>

                  )}

                </div>

              </div>


              {/* ==========================================
                  PREVIEW NOTICE
              ========================================== */}

              <div className="event-editor-preview-note">

                <span aria-hidden="true">
                  ✳
                </span>

                <p>
                  This is a visual preview only.
                  Your changes are saved when you
                  select the Save button.
                </p>

              </div>

            </div>

          )}

        </aside>

      </div>

    </div>
  );
}