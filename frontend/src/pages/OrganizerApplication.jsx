import {
  useEffect,
  useState,
} from "react";

import { Link } from "react-router";

import Navbar from "../components/Navbar";

import { useAuth } from "../context/AuthContext";

import {
  getMyOrganizerApplication,
  submitOrganizerApplication,
} from "../services/auth";

import "../styles/account-profile.css";
import "../styles/organizer-application.css";


const emptyApplication = {
  organization: "",
  position: "",
  reason: "",
};


const statusLabels = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};


const actionLabels = {
  submitted: "Application submitted",
  resubmitted: "Application resubmitted",
  approved: "Application approved",
  rejected: "Application rejected",
  changes_requested: "Changes requested",
};


function errorText(value) {
  return Array.isArray(value)
    ? value.join(" ")
    : typeof value === "string"
      ? value
      : "";
}


function formatDate(value) {
  return new Intl.DateTimeFormat(
    "en-IN",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(new Date(value));
}


export default function OrganizerApplication() {
  const {
    user,
    loading: checkingSession,
  } = useAuth();

  const userId = user?.id;

  const [data, setData] = useState(null);

  const [form, setForm] = useState(
    emptyApplication
  );

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [loadError, setLoadError] =
    useState("");

  const [errors, setErrors] =
    useState({});

  const [message, setMessage] =
    useState("");


  useEffect(() => {
    if (!userId) {
      return;
    }

    let active = true;

    async function loadApplication() {
      try {
        const result =
          await getMyOrganizerApplication();

        if (!active) {
          return;
        }

        setData(result);

        if (result.application) {
          setForm({
            organization:
              result.application.organization,
            position:
              result.application.position,
            reason:
              result.application.reason,
          });
        }
      } catch (error) {
        if (active) {
          setLoadError(
            error.message ||
            "Unable to load your application."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadApplication();

    return () => {
      active = false;
    };
  }, [userId]);


  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setErrors({});
    setMessage("");
  }


  async function handleSubmit(event) {
    event.preventDefault();

    if (
      saving ||
      !data?.can_apply ||
      !user?.profile_complete
    ) {
      return;
    }

    setSaving(true);
    setErrors({});
    setMessage("");

    try {
      const result =
        await submitOrganizerApplication({
          organization:
            form.organization.trim(),
          position:
            form.position.trim(),
          reason:
            form.reason.trim(),
          revision:
            data.application?.revision ?? 0,
        });

      setData((previous) => ({
        ...previous,
        can_apply: false,
        application: result.application,
      }));

      setMessage(result.message);
    } catch (error) {
      setErrors(
        error.details || {
          message:
            error.message ||
            "Unable to submit your application.",
        }
      );
    } finally {
      setSaving(false);
    }
  }


  const application = data?.application;

  const generalError =
    errorText(errors.message) ||
    errorText(errors.detail) ||
    errorText(errors.non_field_errors);

  const fields = [
    {
      name: "organization",
      label: "Club, department or organizing body",
      placeholder: "For example, Campus Coding Club",
      maxLength: 150,
    },
    {
      name: "position",
      label: "Your position",
      placeholder: "For example, Student coordinator",
      maxLength: 100,
    },
    {
      name: "reason",
      label: "Why do you need organizer access?",
      placeholder:
        "Describe the events you plan to organize and your responsibilities.",
      maxLength: 2000,
      multiline: true,
    },
  ];


  return (
    <>
      <Navbar />

      <main className="account-profile-page organizer-application-page">
        <Link
          to="/"
          className="account-profile-back"
        >
          ← Back to EventHub
        </Link>

        <header className="account-profile-heading">
          <p className="account-profile-eyebrow">
            ORGANIZER ACCESS
          </p>

          <h1>Bring your ideas to campus.</h1>

          <p>
            Apply to organize events, manage
            participants and coordinate your
            campus experiences.
          </p>
        </header>

        {checkingSession ? (
          <p role="status">
            Checking your account…
          </p>
        ) : !user ? (
          <section className="account-profile-card">
            <h2>Start with your EventHub account</h2>

            <p>
              Sign in to submit an organizer
              application. An admin will review
              it before organizer access is granted.
            </p>

            <div className="application-actions">
              <Link to="/login">
                Sign in
              </Link>

              <Link to="/register">
                Create an account
              </Link>
            </div>
          </section>
        ) : loading ? (
          <p role="status">
            Loading your application…
          </p>
        ) : loadError ? (
          <section className="account-profile-card">
            <p
              className="account-profile-error"
              role="alert"
            >
              {loadError}
            </p>

            <button
              type="button"
              className="account-profile-retry"
              onClick={() => {
                window.location.reload();
              }}
            >
              Try again
            </button>
          </section>
        ) : (
          <>
            <section className="account-profile-card">
              <div className="application-status-heading">
                <h2>
                  {data.is_organizer
                    ? "Your organizer access is active"
                    : application
                      ? "Your application"
                      : "Apply for organizer access"}
                </h2>

                {application && (
                  <span
                    className={
                      "application-status " +
                      `application-status-${application.status}`
                    }
                  >
                    {statusLabels[application.status]}
                  </span>
                )}
              </div>

              {message && (
                <p
                  className="account-profile-success"
                  role="status"
                >
                  {message}
                </p>
              )}

              {data.is_organizer ? (
                <>
                  <p>
                    You can create and manage
                    events through your organizer
                    workspace.
                  </p>

                  <Link
                    to="/organizer"
                    className="application-workspace-link"
                  >
                    Open organizer workspace →
                  </Link>
                </>
              ) : (
                <>
                  {application && (
                    <p className="application-description">
                      Revision {application.revision}
                      {" · "}
                      Last updated{" "}
                      {formatDate(
                        application.updated_at
                      )}
                    </p>
                  )}

                  {application?.status === "pending" && (
                    <p className="application-notice">
                      Your application is awaiting
                      admin review. You can continue
                      using your student account
                      while you wait.
                    </p>
                  )}

                  {application?.decision_note && (
                    <div className="application-decision">
                      <h3>Admin feedback</h3>

                      <p>
                        {application.decision_note}
                      </p>
                    </div>
                  )}

                  {!user.profile_complete && (
                    <p className="application-notice">
                      Complete{" "}
                      <Link to="/account/profile">
                        your profile
                      </Link>{" "}
                      before submitting an
                      organizer application.
                    </p>
                  )}

                  {generalError && (
                    <div
                      className="account-profile-error"
                      role="alert"
                    >
                      <p>{generalError}</p>

                      <button
                        type="button"
                        className="account-profile-retry"
                        onClick={() => {
                          window.location.reload();
                        }}
                      >
                        Reload latest status
                      </button>
                    </div>
                  )}

                  {data.can_apply ? (
                    <form
                      className="organizer-application-form"
                      onSubmit={handleSubmit}
                    >
                      {fields.map((field) => {
                        const error = errorText(
                          errors[field.name]
                        );

                        const inputId =
                          `application-${field.name}`;

                        const sharedProps = {
                          id: inputId,
                          name: field.name,
                          value: form[field.name],
                          onChange: handleChange,
                          placeholder:
                            field.placeholder,
                          maxLength:
                            field.maxLength,
                          required: true,
                          disabled:
                            saving ||
                            !user.profile_complete,
                          "aria-invalid":
                            Boolean(error),
                          "aria-describedby": error
                            ? `${inputId}-error`
                            : undefined,
                        };

                        return (
                          <div
                            className="form-field"
                            key={field.name}
                          >
                            <label htmlFor={inputId}>
                              {field.label}
                            </label>

                            {field.multiline ? (
                              <textarea
                                {...sharedProps}
                                rows={6}
                              />
                            ) : (
                              <input
                                {...sharedProps}
                                type="text"
                              />
                            )}

                            {error && (
                              <p
                                id={`${inputId}-error`}
                                className="field-error"
                                role="alert"
                              >
                                {error}
                              </p>
                            )}
                          </div>
                        );
                      })}

                      <p className="application-description">
                        Submitting an application
                        does not immediately grant
                        organizer access. An
                        authorized admin must
                        approve it.
                      </p>

                      <button
                        type="submit"
                        className="auth-submit-button"
                        disabled={
                          saving ||
                          !user.profile_complete
                        }
                      >
                        {saving
                          ? "Submitting…"
                          : application
                            ? "Resubmit application"
                            : "Submit application"}
                      </button>
                    </form>
                  ) : application ? (
                    <dl className="application-details">
                      <div>
                        <dt>Organizing body</dt>
                        <dd>
                          {application.organization}
                        </dd>
                      </div>

                      <div>
                        <dt>Your position</dt>
                        <dd>
                          {application.position}
                        </dd>
                      </div>

                      <div>
                        <dt>Reason for applying</dt>
                        <dd>
                          {application.reason}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  <button
                    type="button"
                    className="account-profile-retry"
                    disabled={saving}
                    onClick={() => {
                      window.location.reload();
                    }}
                  >
                    Check latest status
                  </button>
                </>
              )}
            </section>

            {application?.history?.length > 0 && (
              <section className="account-profile-card application-history-card">
                <h2>Application history</h2>

                <ol className="application-history">
                  {[...application.history]
                    .reverse()
                    .map((entry) => (
                      <li key={entry.id}>
                        <div className="application-history-heading">
                          <strong>
                            {actionLabels[entry.action]}
                          </strong>

                          <span>
                            Revision {entry.revision}
                          </span>
                        </div>

                        <time dateTime={entry.created_at}>
                          {formatDate(entry.created_at)}
                        </time>

                        {entry.note && (
                          <p>{entry.note}</p>
                        )}
                      </li>
                    ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}