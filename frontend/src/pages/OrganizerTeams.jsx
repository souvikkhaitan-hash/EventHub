import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import {
  getOrganizerEventTeams,
  getOrganizerAttendance,
} from "../services/events";

import "../styles/teams-editorial.css";

const labels = {
  confirmed: "Confirmed",
  forming: "Forming",
  withdrawn: "Withdrawn",
};

const emptyTeams = [];

function errorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Please try again."
  );
}

function Progress({ label, value }) {
  return (
    <div
      className="tm-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div style={{ width: `${value}%` }} />
    </div>
  );
}

function TeamCard({ team, event, attendance }) {
  const [expanded, setExpanded] = useState(false);

  const members = team.members || [];
  const withdrawn = team.status === "withdrawn";

  const maximum = Number(event.max_team_size);
  const minimum = Number(event.min_team_size);

  const sizePercent =
    maximum > 0
      ? Math.min(100, (members.length / maximum) * 100)
      : 0;

  const minimumMet =
    minimum > 0 && members.length >= minimum;

  const recordFor = (member) =>
    attendance?.get(member.username);

  const allKnown =
    attendance !== null &&
    members.every((member) =>
      ["present", "pending"].includes(
        recordFor(member)?.attendance_status
      )
    );

  const present = members.filter(
    (member) =>
      recordFor(member)?.attendance_status === "present"
  ).length;

  const attendancePercent = members.length
    ? Math.round((present / members.length) * 100)
    : 0;

  const rosterId = `tm-roster-${team.id}`;

  return (
    <article className="tm-card">
      <div className="tm-card-heading">
        <span
          className="tm-avatar tm-team-avatar"
          aria-hidden="true"
        >
          {team.name?.charAt(0).toUpperCase() || "?"}
        </span>

        <div className="tm-team-title">
          <div>
            <h3>{team.name}</h3>

            <span
              className={`tm-pill tm-${team.status}`}
            >
              {labels[team.status] || team.status}
            </span>
          </div>

          <p>
            Led by{" "}
            <strong>
              {team.leader_username || "—"}
            </strong>
          </p>
        </div>

        <button
          type="button"
          className="tm-button tm-toggle"
          aria-expanded={expanded}
          aria-controls={rosterId}
          onClick={() =>
            setExpanded((value) => !value)
          }
        >
          {expanded
            ? "Hide members ↑"
            : "View members ↓"}
        </button>
      </div>

      <div className="tm-card-metrics">
        <div>
          <span className="tm-label">Team size</span>

          <strong>
            {members.length} of{" "}
            {event.max_team_size ?? "—"} members
          </strong>

          <Progress
            label={`${team.name} team size`}
            value={sizePercent}
          />

          <small>
            {withdrawn
              ? "Withdrawn team"
              : minimumMet
                ? "✓ Minimum requirement met"
                : `Minimum ${
                    event.min_team_size ?? "—"
                  } members required`}
          </small>
        </div>

        <div>
          <span className="tm-label">Attendance</span>

          {withdrawn ? (
            <>
              <strong>Not applicable</strong>
              <small>
                Withdrawn teams are excluded from
                active totals.
              </small>
            </>
          ) : allKnown ? (
            <>
              <strong>
                {present} of {members.length} checked
                in
              </strong>

              <Progress
                label={`${team.name} attendance`}
                value={attendancePercent}
              />

              <small>
                {attendancePercent}% attendance
              </small>
            </>
          ) : (
            <>
              <strong>Unavailable</strong>
              <small>
                {attendance === null
                  ? "Refresh to retrieve attendance."
                  : "Some members have no matching attendance record."}
              </small>
            </>
          )}
        </div>
      </div>

      <div
        id={rosterId}
        hidden={!expanded}
        className="tm-roster"
      >
        <div
          className="tm-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${team.name} members`}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col">Attendance</th>
              </tr>
            </thead>

            <tbody>
              {members.map((member) => {
                const record = recordFor(member);
                const attendanceStatus =
                  record?.attendance_status;

                const attendanceLabel = withdrawn
                  ? "Not applicable"
                  : attendance === null
                    ? "Unavailable"
                    : attendanceStatus === "present"
                      ? "Present"
                      : attendanceStatus === "pending"
                        ? "Pending"
                        : "No record";

                const attendanceClass =
                  !withdrawn &&
                  attendance !== null &&
                  attendanceStatus === "present"
                    ? "tm-present"
                    : !withdrawn &&
                        attendance !== null &&
                        attendanceStatus === "pending"
                      ? "tm-pending"
                      : "tm-neutral";

                return (
                  <tr
                    key={member.id ?? member.username}
                  >
                    <th scope="row">
                      <span className="tm-member">
                        <span
                          className="tm-avatar"
                          aria-hidden="true"
                        >
                          {member.username
                            ?.charAt(0)
                            .toUpperCase() || "?"}
                        </span>

                        {member.username}
                      </span>
                    </th>

                    <td>
                      <span
                        className={`tm-pill ${
                          member.role === "leader"
                            ? "tm-leader"
                            : "tm-neutral"
                        }`}
                      >
                        {member.role === "leader"
                          ? "Leader"
                          : "Member"}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`tm-pill ${attendanceClass}`}
                      >
                        {attendanceLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {!members.length && (
                <tr>
                  <td
                    colSpan={3}
                    className="tm-empty-row"
                  >
                    No members in this roster.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

export default function OrganizerTeams() {
  const { id } = useParams();

  return <TeamsWorkspace key={id} id={id} />;
}

function TeamsWorkspace({ id }) {
  const [data, setData] = useState(null);
  const [attendance, setAttendance] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attendanceError, setAttendanceError] =
    useState("");

  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");
    setAttendanceError("");

    async function load() {
      try {
        const [teamResult, attendanceResult] =
          await Promise.allSettled([
            getOrganizerEventTeams(id),
            getOrganizerAttendance(id),
          ]);

        if (!active) return;

        if (teamResult.status === "rejected") {
          throw teamResult.reason;
        }

        const response = teamResult.value;

        if (
          !response?.event ||
          !Array.isArray(response.teams)
        ) {
          throw new Error(
            "Team information could not be loaded."
          );
        }

        setData(response);

        if (
          attendanceResult.status === "fulfilled" &&
          Array.isArray(
            attendanceResult.value?.attendance
          )
        ) {
          setAttendance(
            new Map(
              attendanceResult.value.attendance.map(
                (record) => [
                  record.student_username,
                  record,
                ]
              )
            )
          );
        } else {
          setAttendance(null);

          setAttendanceError(
            attendanceResult.status === "rejected"
              ? errorMessage(attendanceResult.reason)
              : "Attendance information could not be loaded."
          );
        }
      } catch (err) {
        if (active) setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [id, revision]);

  const teams = data?.teams || emptyTeams;

  const activeTeams = useMemo(
    () =>
      teams.filter(
        (team) => team.status !== "withdrawn"
      ),
    [teams]
  );

  const activeMembers = activeTeams.flatMap(
    (team) => team.members || []
  );

  const confirmed = activeTeams.filter(
    (team) => team.status === "confirmed"
  ).length;

  const forming = activeTeams.filter(
    (team) => team.status === "forming"
  ).length;

  const knownAttendance =
    attendance !== null &&
    activeMembers.every((member) =>
      ["present", "pending"].includes(
        attendance.get(member.username)
          ?.attendance_status
      )
    );

  const present = activeMembers.filter(
    (member) =>
      attendance?.get(member.username)
        ?.attendance_status === "present"
  ).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return teams.filter((team) => {
      const matchesStatus =
        filter === "all" || team.status === filter;

      const matchesSearch =
        !query ||
        [
          team.name,
          team.leader_username,
          ...(team.members || []).map(
            (member) => member.username
          ),
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query)
        );

      return matchesStatus && matchesSearch;
    });
  }, [teams, search, filter]);

  const refresh = () =>
    setRevision((value) => value + 1);

  return (
    <main className="tm-page">
      <Link
        className="tm-back"
        to={`/organizer/events/${id}/participants`}
      >
        ← Back to participants
      </Link>

      <header className="tm-heading">
        <div>
          <span className="tm-eyebrow">
            Team management
          </span>

          <h1>
            Teams<span>.</span>
          </h1>

          <p>
            {data?.event.title ||
              "Review teams and their members."}
          </p>
        </div>

        <div className="tm-actions">
          <button
            type="button"
            className="tm-button"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>

          <Link
            className="tm-button tm-primary"
            to={`/organizer/events/${id}/attendance`}
          >
            Attendance scanner ↗
          </Link>
        </div>
      </header>

      {error && (
        <div className="tm-error" role="alert">
          <strong>
            Team information could not be refreshed.
          </strong>

          <p>{error}</p>

          {data && (
            <p>
              Displayed teams and attendance may be
              out of date.
            </p>
          )}

          <button
            className="tm-button"
            onClick={refresh}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      {loading && !data && (
        <div
          className="tm-panel tm-state"
          role="status"
        >
          Loading teams…
        </div>
      )}

      {data && (
        <>
          <section
            className="tm-stats"
            aria-label="Team statistics"
          >
            <div>
              <span>Active teams</span>
              <strong>{activeTeams.length}</strong>
              <small>
                of {data.event.max_teams ?? "—"} allowed
              </small>
            </div>

            <div className="tm-stat-blue">
              <span>Confirmed</span>
              <strong>{confirmed}</strong>
              <small>Teams with locked rosters</small>
            </div>

            <div className="tm-stat-lime">
              <span>Forming</span>
              <strong>{forming}</strong>
              <small>Teams still recruiting</small>
            </div>

            <div>
              <span>Team members</span>
              <strong>{activeMembers.length}</strong>
              <small>Students in active teams</small>
            </div>
          </section>

          <div className="tm-info">
            <span>
              <strong>
                {data.event.min_team_size ?? "—"}–
                {data.event.max_team_size ?? "—"}{" "}
                members
              </strong>{" "}
              per team
            </span>

            <span>Confirmed rosters are locked</span>

            <span>
              {knownAttendance ? (
                <>
                  <strong>
                    {present} of {activeMembers.length}
                  </strong>{" "}
                  members checked in
                </>
              ) : (
                "Attendance unavailable for some or all members"
              )}
            </span>
          </div>

          {attendanceError && (
            <div className="tm-error" role="alert">
              Team information is available, but
              attendance could not be loaded.{" "}
              {attendanceError} Use Refresh to retry.
            </div>
          )}

          <section
            className="tm-panel tm-list"
            aria-labelledby="tm-list-heading"
            aria-busy={loading}
          >
            <div className="tm-list-heading">
              <h2 id="tm-list-heading">
                Participating teams
              </h2>

              <span>
                {teams.length}{" "}
                {teams.length === 1 ? "team" : "teams"}
              </span>
            </div>

            <div className="tm-controls">
              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search team or student…"
                aria-label="Search team or student"
              />

              <div
                className="tm-filters"
                aria-label="Filter team status"
              >
                {[
                  ["all", "All"],
                  ["confirmed", "Confirmed"],
                  ["forming", "Forming"],
                  ["withdrawn", "Withdrawn"],
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

            <div className="tm-cards">
              {filtered.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  event={data.event}
                  attendance={attendance}
                />
              ))}
            </div>

            {!filtered.length && (
              <div className="tm-state">
                <h3>No teams found.</h3>

                <p>
                  {teams.length
                    ? "Try another search or status filter."
                    : "Teams will appear here when students create them for this event."}
                </p>

                {(search || filter !== "all") && (
                  <button
                    className="tm-button"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            <p className="tm-footer">
              Showing {filtered.length} of{" "}
              {teams.length}{" "}
              {teams.length === 1 ? "team" : "teams"}
            </p>
          </section>
        </>
      )}
    </main>
  );
}