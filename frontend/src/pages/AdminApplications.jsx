import {
  useEffect,
  useState,
} from "react";

import { Link } from "react-router";

import Navbar from "../components/Navbar";

import { useAuth } from "../context/AuthContext";

import {
  getOrganizerApplication,
  getOrganizerApplications,
  reviewOrganizerApplication,
} from "../services/auth";

import "../styles/organizer-application.css";
import "../styles/admin-applications.css";


const statusLabels = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};


const actionLabels = {
  submitted: "Submitted",
  resubmitted: "Resubmitted",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};


function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-IN",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(new Date(value));
}


function errorText(value) {
  return Array.isArray(value)
    ? value.join(" ")
    : typeof value === "string"
      ? value
      : "";
}


// ============================================================
// APPLICATION DETAIL AND REVIEW
// ============================================================

function ApplicationReview({
  applicationId,
  currentUserId,
  onDecision,
  onBusyChange,
}) {
  const [application, setApplication] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [loadError, setLoadError] =
    useState("");

  const [note, setNote] = useState("");

  const [saving, setSaving] =
    useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [stale, setStale] = useState(false);
  const [reload, setReload] = useState(0);


  useEffect(() => {
    let active = true;

    async function loadApplication() {
      try {
        const result =
          await getOrganizerApplication(
            applicationId
          );

        if (!active) {
          return;
        }

        setApplication(result);
        setNote(result.decision_note || "");
        setStale(false);
      } catch (requestError) {
        if (active) {
          setLoadError(
            requestError.message ||
            "Unable to load this application."
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
  }, [applicationId, reload]);


  function reloadApplication() {
    setLoading(true);
    setLoadError("");
    setError("");
    setMessage("");

    setReload((previous) => previous + 1);
  }


  async function decide(decision) {
    if (
      saving ||
      stale ||
      !application ||
      application.status !== "pending"
    ) {
      return;
    }

    if (
      decision !== "approved" &&
      !note.trim()
    ) {
      setError(
        "Add an explanation before rejecting or requesting changes."
      );

      return;
    }

    setSaving(true);
    onBusyChange(true);

    setError("");
    setMessage("");

    try {
      const result =
        await reviewOrganizerApplication(
          application.id,
          {
            decision,
            revision: application.revision,
            decision_note: note.trim(),
          }
        );

      setApplication(result.application);
      setNote(
        result.application.decision_note || ""
      );

      setMessage(result.message);
      onDecision();
    } catch (requestError) {
      const noteError = errorText(
        requestError.details?.decision_note
      );

      setError(
        noteError ||
        requestError.message ||
        "Unable to save this decision."
      );

      // Reload after conflicts or an uncertain request
      // outcome before allowing another decision.
      if (requestError.status !== 400) {
        setStale(true);
      }
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }


  if (loading) {
    return (
      <section className="admin-card">
        <p role="status">
          Loading application details…
        </p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="admin-card">
        <p
          className="admin-alert admin-alert-error"
          role="alert"
        >
          {loadError}
        </p>

        <button
          type="button"
          className="admin-button"
          onClick={reloadApplication}
        >
          Try again
        </button>
      </section>
    );
  }

  if (!application) {
    return null;
  }

  const isSelf = (
    application.applicant.id === currentUserId
  );

  const canDecide = (
    application.status === "pending" &&
    application.applicant.is_active &&
    !isSelf &&
    !stale
  );


  return (
    <section className="admin-card admin-review">
      <div className="admin-card-heading">
        <div>
          <p className="admin-eyebrow">
            APPLICATION #{application.id}
          </p>

          <h2>
            {application.applicant.full_name ||
              application.applicant.username}
          </h2>
        </div>

        <span
          className={
            "application-status " +
            `application-status-${application.status}`
          }
        >
          {statusLabels[application.status]}
        </span>
      </div>

      <p className="admin-muted">
        @{application.applicant.username}
        {" · "}
        Revision {application.revision}
      </p>

      <dl className="admin-detail-list">
        <div>
          <dt>Account email</dt>
          <dd>
            {application.applicant.email}
          </dd>
        </div>

        <div>
          <dt>Organizing body</dt>
          <dd>
            {application.organization}
          </dd>
        </div>

        <div>
          <dt>Position</dt>
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

        <div>
          <dt>Last updated</dt>
          <dd>
            {formatDate(application.updated_at)}
          </dd>
        </div>
      </dl>

      {message && (
        <p
          className="admin-alert admin-alert-success"
          role="status"
        >
          {message}
        </p>
      )}

      {error && (
        <p
          className="admin-alert admin-alert-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {isSelf && (
        <p className="admin-alert admin-alert-info">
          Another authorized administrator must
          review your own application.
        </p>
      )}

      {!application.applicant.is_active && (
        <p className="admin-alert admin-alert-info">
          This applicant’s account is inactive.
          A decision cannot be made here.
        </p>
      )}

      {canDecide ? (
        <div className="admin-decision-panel">
          <label htmlFor="admin-decision-note">
            Feedback for the applicant
          </label>

          <textarea
            id="admin-decision-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError("");
            }}
            maxLength={1000}
            rows={4}
            disabled={saving}
            placeholder="Required for rejection or requested changes."
          />

          <p className="admin-muted">
            The applicant can read this feedback.
            Do not include private internal notes.
          </p>

          <div className="admin-decision-actions">
            <button
              type="button"
              className="admin-button admin-button-primary"
              disabled={saving}
              onClick={() => {
                decide("approved");
              }}
            >
              {saving ? "Saving…" : "Approve"}
            </button>

            <button
              type="button"
              className="admin-button"
              disabled={saving}
              onClick={() => {
                decide("changes_requested");
              }}
            >
              Request changes
            </button>

            <button
              type="button"
              className="admin-button admin-button-danger"
              disabled={saving}
              onClick={() => {
                decide("rejected");
              }}
            >
              Reject
            </button>
          </div>
        </div>
      ) : application.decision_note ? (
        <div className="application-decision">
          <h3>Saved feedback</h3>
          <p>{application.decision_note}</p>
        </div>
      ) : null}

      <button
        type="button"
        className="admin-button"
        disabled={saving}
        onClick={reloadApplication}
      >
        Reload application
      </button>

      <div className="admin-history">
        <h3>Application history</h3>

        <ol>
          {[...application.history]
            .reverse()
            .map((entry) => (
              <li key={entry.id}>
                <strong>
                  {actionLabels[entry.action]}
                </strong>

                <p className="admin-muted">
                  Revision {entry.revision}
                  {" · "}
                  {formatDate(entry.created_at)}
                  {entry.actor && (
                    <>
                      {" · "}
                      @{entry.actor.username}
                    </>
                  )}
                </p>

                {entry.note && (
                  <p>{entry.note}</p>
                )}
              </li>
            ))}
        </ol>
      </div>
    </section>
  );
}


// ============================================================
// ADMIN APPLICATION WORKSPACE
// ============================================================

export default function AdminApplications() {
  const {
    user,
    loading: checkingSession,
  } = useAuth();

  const canReview = Boolean(
    user?.can_review_organizers
  );

  const [filters, setFilters] = useState({
    status: "pending",
    search: "",
    page: 1,
  });

  const [searchInput, setSearchInput] =
    useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedId, setSelectedId] =
    useState(null);

  const [decisionBusy, setDecisionBusy] =
    useState(false);

  const [refresh, setRefresh] = useState(0);


  useEffect(() => {
    if (!canReview) {
      return;
    }

    let active = true;

    async function loadApplications() {
      try {
        const result =
          await getOrganizerApplications({
            status: filters.status,
            search: filters.search,
            page: filters.page,
          });

        if (active) {
          setData(result);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError.message ||
            "Unable to load applications."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadApplications();

    return () => {
      active = false;
    };
  }, [
    canReview,
    filters.status,
    filters.search,
    filters.page,
    refresh,
  ]);


  function reloadList() {
    setLoading(true);
    setError("");
    setRefresh((previous) => previous + 1);
  }


  function changeStatus(event) {
    setLoading(true);
    setError("");
    setSelectedId(null);

    setFilters((previous) => ({
      ...previous,
      status: event.target.value,
      page: 1,
    }));
  }


  function search(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setSelectedId(null);

    setFilters((previous) => ({
      ...previous,
      search: searchInput.trim(),
      page: 1,
    }));

    setRefresh((previous) => previous + 1);
  }


  function changePage(direction) {
    setLoading(true);
    setError("");

    setFilters((previous) => ({
      ...previous,
      page: previous.page + direction,
    }));
  }


  function decisionSaved() {
    setLoading(true);
    setError("");

    // Return to page 1 if the reviewed item disappears
    // from the current status filter.
    setFilters((previous) => ({
      ...previous,
      page: 1,
    }));

    setRefresh((previous) => previous + 1);
  }


  return (
    <>
      <Navbar />

      <main className="admin-applications-page">
        <Link to="/" className="admin-back">
          ← Back to EventHub
        </Link>

        <header className="admin-page-heading">
          <p className="admin-eyebrow">
            PLATFORM ADMINISTRATION
          </p>

          <h1>Organizer applications.</h1>

          <p>
            Review applicants, request
            clarification and grant organizer
            access.
          </p>
        </header>

        {checkingSession ? (
          <p role="status">
            Checking administrator access…
          </p>
        ) : !user ? (
          <section className="admin-card">
            <h2>Administrator sign-in required</h2>

            <Link to="/admin/login">
              Sign in to the admin workspace
            </Link>
          </section>
        ) : !canReview ? (
          <section className="admin-card">
            <h2>Access restricted</h2>

            <p>
              Your account does not have permission
              to review organizer applications.
            </p>

            <Link to="/admin/login">
              Sign in with an authorized account
            </Link>
          </section>
        ) : (
          <>
            <section className="admin-card admin-toolbar">
              <form onSubmit={search}>
                <label htmlFor="admin-application-search">
                  Find an applicant or organization
                </label>

                <div className="admin-search-row">
                  <input
                    id="admin-application-search"
                    type="search"
                    value={searchInput}
                    onChange={(event) => {
                      setSearchInput(
                        event.target.value
                      );
                    }}
                    maxLength={100}
                    disabled={decisionBusy}
                    placeholder="Name, username, email or organization"
                  />

                  <button
                    type="submit"
                    className="admin-button"
                    disabled={
                      loading || decisionBusy
                    }
                  >
                    Search
                  </button>
                </div>
              </form>

              <div>
                <label htmlFor="admin-status-filter">
                  Application status
                </label>

                <select
                  id="admin-status-filter"
                  value={filters.status}
                  onChange={changeStatus}
                  disabled={decisionBusy}
                >
                  <option value="pending">
                    Pending review
                  </option>

                  <option value="approved">
                    Approved
                  </option>

                  <option value="changes_requested">
                    Changes requested
                  </option>

                  <option value="rejected">
                    Rejected
                  </option>

                  <option value="all">
                    All applications
                  </option>
                </select>
              </div>
            </section>

            <div className="admin-workspace-grid">
              <section className="admin-card admin-application-list">
                <div className="admin-card-heading">
                  <h2>
                    Applications
                    {data && ` (${data.count})`}
                  </h2>

                  <button
                    type="button"
                    className="admin-button"
                    onClick={reloadList}
                    disabled={
                      loading || decisionBusy
                    }
                  >
                    Refresh
                  </button>
                </div>

                {loading ? (
                  <p role="status">
                    Loading applications…
                  </p>
                ) : error ? (
                  <p
                    className="admin-alert admin-alert-error"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : data?.results.length === 0 ? (
                  <p className="admin-muted">
                    No applications match these
                    filters.
                  </p>
                ) : (
                  <ul className="admin-applicant-list">
                    {data?.results.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="admin-applicant-button"
                          aria-pressed={
                            selectedId === item.id
                          }
                          disabled={decisionBusy}
                          onClick={() => {
                            setSelectedId(item.id);
                          }}
                        >
                          <strong>
                            {item.applicant.full_name ||
                              item.applicant.username}
                          </strong>

                          <span>
                            {item.organization}
                          </span>

                          <span className="admin-muted">
                            {statusLabels[item.status]}
                            {" · "}
                            Revision {item.revision}
                          </span>

                          <span className="admin-muted">
                            {formatDate(
                              item.created_at
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="admin-pagination">
                  <button
                    type="button"
                    className="admin-button"
                    disabled={
                      loading ||
                      decisionBusy ||
                      filters.page === 1
                    }
                    onClick={() => {
                      changePage(-1);
                    }}
                  >
                    Previous
                  </button>

                  <span>
                    Page {filters.page}
                  </span>

                  <button
                    type="button"
                    className="admin-button"
                    disabled={
                      loading ||
                      decisionBusy ||
                      Boolean(error) ||
                      !data?.next
                    }
                    onClick={() => {
                      changePage(1);
                    }}
                  >
                    Next
                  </button>
                </div>
              </section>

              {selectedId ? (
                <ApplicationReview
                  key={selectedId}
                  applicationId={selectedId}
                  currentUserId={user.id}
                  onDecision={decisionSaved}
                  onBusyChange={setDecisionBusy}
                />
              ) : (
                <section className="admin-card admin-empty-selection">
                  <h2>Select an application</h2>

                  <p className="admin-muted">
                    Choose an applicant to read
                    their submission and review
                    history.
                  </p>
                </section>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}