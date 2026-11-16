import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { Link, useParams } from "react-router";

import {
  getOrganizerParticipants,
  getOrganizerEventTeams,
} from "../services/events";

import {
  formatEventDateTime,
} from "../utils/eventFormat";

import "../styles/participants-editorial.css";

function number(value) {
  return (
    value != null &&
    value !== "" &&
    Number.isFinite(Number(value))
  )
    ? Math.max(0, Number(value))
    : null;
}

function dateLabel(value) {
  return value && Number.isFinite(Date.parse(value))
    ? formatEventDateTime(value)
    : "—";
}

function messageFrom(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Unable to load participant information."
  );
}

export default function OrganizerParticipants() {
  const { id } = useParams();

  // Clear the previous event's state when navigating.
  return (
    <ParticipantsWorkspace
      key={id}
      id={id}
    />
  );
}

function ParticipantsWorkspace({ id }) {
  const [revision, setRevision] = useState(0);

  const [result, setResult] = useState({
    revision: -1,
    data: null,
    error: "",
  });

  const [teamRevision, setTeamRevision] = useState(0);

  const [teamResult, setTeamResult] = useState({
    key: "",
    teams: [],
    error: "",
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const loading =
    result.revision !== revision;

  const data =
    loading || result.error
      ? null
      : result.data;

  const event = data?.event;

  const isTeamEvent =
    event?.registration_mode === "team";

  const teamKey = `${id}:${teamRevision}`;

  const teamsLoading =
    isTeamEvent &&
    teamResult.key !== teamKey;

  const teamError =
    isTeamEvent && !teamsLoading
      ? teamResult.error
      : "";

  useEffect(() => {
    let active = true;

    getOrganizerParticipants(id)
      .then((response) => {
        if (
          !response?.event ||
          !Array.isArray(response.participants)
        ) {
          throw new Error(
            "The server returned an incomplete participant list."
          );
        }

        if (active) {
          setResult({
            revision,
            data: response,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setResult({
            revision,
            data: null,
            error: messageFrom(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id, revision]);

  // Team metadata loads independently of participant records.
  useEffect(() => {
    if (!isTeamEvent) return;

    let active = true;

    getOrganizerEventTeams(id)
      .then((response) => {
        if (!Array.isArray(response?.teams)) {
          throw new Error(
            "Unable to read team information."
          );
        }

        if (active) {
          setTeamResult({
            key: teamKey,
            teams: response.teams,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setTeamResult({
            key: teamKey,
            teams: [],
            error: messageFrom(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id, isTeamEvent, teamKey]);

  const participants = data?.participants || [];

  const teamLookup = useMemo(() => {
    const lookup = new Map();

    if (teamsLoading || teamError) {
      return lookup;
    }

    for (const team of teamResult.teams) {
      if (team.status === "withdrawn") {
        continue;
      }

      for (const member of team.members || []) {
        lookup.set(member.username, {
          name: team.name,
          role: member.role,
        });
      }
    }

    return lookup;
  }, [
    teamResult.teams,
    teamsLoading,
    teamError,
  ]);

  const visible = participants.filter(
    (participant) => {
      const username =
        participant.student_username || "";

      // Current team membership is not historical
      // team information for cancelled registrations.
      const team =
        participant.status === "registered"
          ? teamLookup.get(username)
          : null;

      const query = search.trim().toLowerCase();

      const matchesStatus =
        filter === "all" ||
        participant.status === filter;

      const matchesSearch =
        !query ||
        `${username} ${team?.name || ""}`
          .toLowerCase()
          .includes(query);

      return matchesStatus && matchesSearch;
    }
  );

  const capacity = number(event?.capacity);

  const registered = number(
    data?.statistics?.registered
  );

  const available = number(
    data?.statistics?.available_seats
  );

  const occupancy =
    capacity > 0 && registered !== null
      ? (registered / capacity) * 100
      : null;

  const hasFilters =
    search.trim() !== "" ||
    filter !== "all";

  function clearFilters() {
    setSearch("");
    setFilter("all");
  }

  return (
    <div className="pp-page">
      <Link
        className="pp-back"
        to="/organizer"
      >
        ← Back to Dashboard
      </Link>

      {loading ? (
        <div
          className="pp-panel pp-message"
          role="status"
        >
          Loading participants…
        </div>
      ) : result.error ? (
        <div
          className="pp-panel pp-message"
          role="alert"
        >
          <h1>Unable to load participants.</h1>

          <p>{result.error}</p>

          <button
            className="pp-button"
            onClick={() =>
              setRevision((value) => value + 1)
            }
          >
            Try again
          </button>
        </div>
      ) : data && (
        <>
          <header className="pp-heading">
            <div>
              <h1>Participants.</h1>

              <div className="pp-event-title">
                <p>{event.title}</p>

                <span>
                  {isTeamEvent
                    ? "Team event"
                    : "Individual event"}
                </span>
              </div>
            </div>

            <div className="pp-actions">
              <Link
                className="pp-button"
                to={`/organizer/events/${id}/attendance`}
              >
                ▣ Attendance scanner ↗
              </Link>

              {isTeamEvent && (
                <Link
                  className="pp-button pp-button--outline"
                  to={`/organizer/events/${id}/teams`}
                >
                  View teams →
                </Link>
              )}

              <Link
                className="pp-button pp-button--outline"
                to={`/organizer/events/${id}/edit`}
              >
                Manage event →
              </Link>

              <Link
                className="pp-button pp-button--outline"
                to={`/organizer/events/${id}/certificates`}
              >
                Certificates →
              </Link>
            </div>
          </header>

          <section
            className="pp-panel pp-capacity"
            aria-label="Registration statistics"
          >
            <dl className="pp-metrics">
              {[
                [
                  "Event capacity",
                  capacity,
                  "blue",
                ],
                [
                  "Registered",
                  registered,
                  "lavender",
                ],
                [
                  "Seats remaining",
                  available,
                  "lime",
                ],
              ].map(
                ([label, value, accent], index) => (
                  <div
                    className={`pp-metric pp-metric--${accent}`}
                    key={label}
                    style={{
                      "--pp-index": index,
                    }}
                  >
                    <dt>{label}</dt>
                    <dd>{value ?? "—"}</dd>
                  </div>
                )
              )}
            </dl>

            <p>
              {registered ?? "—"} of{" "}
              {capacity ?? "—"} seats reserved

              {occupancy !== null && (
                <>
                  {" · "}
                  <strong>
                    {occupancy.toFixed(1)}% occupied
                  </strong>
                </>
              )}
            </p>

            {occupancy !== null && (
              <progress
                value={Math.min(
                  capacity,
                  registered
                )}
                max={capacity}
                aria-label="Reserved event seats"
              />
            )}
          </section>

          {isTeamEvent && (
            <div className="pp-team-note">
              <span aria-hidden="true">ⓘ</span>

              <p>
                <strong>Team-based event.</strong>{" "}
                Each participant is listed
                individually. Open{" "}
                <Link
                  to={`/organizer/events/${id}/teams`}
                >
                  View teams
                </Link>{" "}
                to review complete rosters.
              </p>
            </div>
          )}

          {teamsLoading && (
            <p
              className="pp-team-loading"
              role="status"
            >
              Loading team names and roles…
            </p>
          )}

          {teamError && (
            <div
              className="pp-team-error"
              role="alert"
            >
              <p>
                Participant records loaded, but
                team information is unavailable.{" "}
                {teamError}
              </p>

              <button
                className="pp-button pp-button--outline"
                type="button"
                onClick={() =>
                  setTeamRevision(
                    (value) => value + 1
                  )
                }
              >
                Retry team information
              </button>
            </div>
          )}

          <section
            className="pp-panel pp-roster"
            aria-labelledby="pp-roster-title"
          >
            <div className="pp-section-heading">
              <h2 id="pp-roster-title">
                Who’s joining?
              </h2>

              <span>
                {participants.length}{" "}
                {participants.length === 1
                  ? "record"
                  : "records"}
              </span>
            </div>

            <div className="pp-toolbar">
              <label className="pp-search">
                <span className="pp-sr-only">
                  Search participants
                </span>

                <span aria-hidden="true">⌕</span>

                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder={
                    isTeamEvent
                      ? "Search student or team…"
                      : "Search student username…"
                  }
                />
              </label>

              <div
                className="pp-filters"
                role="group"
                aria-label="Filter participants by registration status"
              >
                {[
                  ["all", "All"],
                  ["registered", "Registered"],
                  ["cancelled", "Cancelled"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {!visible.length ? (
              <div className="pp-message">
                <h3>
                  {participants.length
                    ? "No matching participants."
                    : "No participants yet."}
                </h3>

                <p>
                  {participants.length
                    ? "Try another username, team name or status filter."
                    : "Students will appear here when they register for this event."}
                </p>

                {hasFilters && (
                  <button
                    className="pp-button pp-button--outline"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div
                className="pp-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Participant registration table"
              >
                <table
                  className={
                    isTeamEvent
                      ? "pp-table pp-table--teams"
                      : "pp-table"
                  }
                >
                  <caption className="pp-sr-only">
                    Registration records for{" "}
                    {event.title}
                  </caption>

                  <thead>
                    <tr>
                      <th scope="col">Student</th>

                      {isTeamEvent && (
                        <>
                          <th scope="col">Team</th>
                          <th scope="col">Team role</th>
                        </>
                      )}

                      <th scope="col">
                        Registered at
                      </th>

                      <th scope="col">Status</th>

                      <th scope="col">
                        Cancelled at
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {visible.map((participant) => {
                      const username =
                        participant.student_username ||
                        "Unknown student";

                      const active =
                        participant.status ===
                        "registered";

                      const team = active
                        ? teamLookup.get(username)
                        : null;

                      const missingTeam = !active
                        ? "—"
                        : teamsLoading
                          ? "Loading…"
                          : teamError
                            ? "Unavailable"
                            : "—";

                      return (
                        <tr key={participant.id}>
                          <th scope="row">
                            <div className="pp-student">
                              <span aria-hidden="true">
                                {username
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>

                              <strong>
                                {username}
                              </strong>
                            </div>
                          </th>

                          {isTeamEvent && (
                            <>
                              <td>
                                {team ? (
                                  <Link
                                    className="pp-team-link"
                                    to={`/organizer/events/${id}/teams`}
                                  >
                                    {team.name}
                                  </Link>
                                ) : (
                                  <span className="pp-muted">
                                    {missingTeam}
                                  </span>
                                )}
                              </td>

                              <td>
                                {team ? (
                                  <span
                                    className={`pp-role ${
                                      team.role === "leader"
                                        ? "pp-role--leader"
                                        : ""
                                    }`}
                                  >
                                    {team.role === "leader"
                                      ? "Leader"
                                      : team.role === "member"
                                        ? "Member"
                                        : "—"}
                                  </span>
                                ) : (
                                  <span className="pp-muted">
                                    {missingTeam}
                                  </span>
                                )}
                              </td>
                            </>
                          )}

                          <td>
                            {dateLabel(
                              participant.registered_at
                            )}
                          </td>

                          <td>
                            <span
                              className={`pp-status ${
                                active
                                  ? "pp-status--registered"
                                  : ""
                              }`}
                            >
                              {active
                                ? "Registered"
                                : participant.status ===
                                    "cancelled"
                                  ? "Cancelled"
                                  : participant.status}
                            </span>
                          </td>

                          <td>
                            {dateLabel(
                              participant.cancelled_at
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div
              className="pp-roster-footer"
              aria-live="polite"
            >
              <span>
                Showing {visible.length} of{" "}
                {participants.length}{" "}
                {participants.length === 1
                  ? "registration"
                  : "registrations"}.
              </span>

              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          </section>
        </>
      )}

      <footer className="pp-footer">
        Show up. Stand out.
      </footer>
    </div>
  );
}