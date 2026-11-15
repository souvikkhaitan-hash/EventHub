import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  createEventTeam,
  joinEventTeam,
  getMyEventTeam,
  confirmEventTeam,
  leaveEventTeam,
  withdrawEventTeam,
} from "../services/events";
import "../styles/team-registration.css";

function messageFrom(error) {
  const details = error?.details;
  if (details?.message) return details.message;
  if (details?.detail) return details.detail;
  if (details && typeof details === "object") {
    const messages = Object.entries(details).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map((item) => `${key}: ${item}`)
    );
    if (messages.length) return messages.join(" ");
  }
  return error?.message || "Something went wrong. Please try again.";
}

export default function TeamRegistrationPanel({ event, user, authLoading, onChanged }) {
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [mode, setMode] = useState("create");
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const eventId = event.id;
  const isStudent = Boolean(user && !user.is_organizer);
  const registrationOpen = event.status === "published" &&
    Date.now() < new Date(event.registration_deadline).getTime() &&
    Date.now() < new Date(event.start_datetime).getTime();

  const refresh = useCallback(async () => {
    if (!isStudent) {
      setRecord(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getMyEventTeam(eventId);
      setRecord(result);
    } catch (err) {
      if (err.status === 404) setRecord(null);
      else setError(messageFrom(err));
    } finally {
      setLoading(false);
    }
  }, [eventId, isStudent]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  async function perform(action, success) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!teamName.trim() || !registrationOpen) return;
    await perform(() => createEventTeam(eventId, teamName.trim()), "Team created. Share the invitation code with your classmates.");
  }

  async function submitJoin(e) {
    e.preventDefault();
    if (!inviteCode.trim() || !registrationOpen) return;
    await perform(() => joinEventTeam(eventId, inviteCode.trim()), "You joined the team successfully.");
  }

  function askThen(action, prompt, success) {
    if (!window.confirm(prompt)) return;
    void perform(action, success);
  }

  const team = record?.team;
  const leader = record?.my_role === "leader";
  const count = team?.member_count ?? team?.members?.length ?? 0;
  const min = Number(event.min_team_size ?? 2);
  const max = Number(event.max_team_size ?? 6);

  return (
    <section className="team-reg" aria-label="Team registration">
      <div className="team-reg__header">
        <span className="team-reg__eyebrow">TEAM REGISTRATION</span>
        <h3>Better together.</h3>
        <p>Form a team of {min}–{max} students for this event. Each member receives their own ticket.</p>
      </div>

      {error && <p className="team-reg__error" role="alert">{error}</p>}
      {notice && <p className="team-reg__notice" role="status">{notice}</p>}

      {authLoading || loading ? (
        <p className="team-reg__muted" role="status">Checking your team...</p>
      ) : !user ? (
        <div className="team-reg__empty">
          <p>Sign in with your student account to create or join a team.</p>
          <Link className="team-reg__button" to="/login">Log in to continue →</Link>
        </div>
      ) : user.is_organizer ? (
        <p className="team-reg__muted">Organizer accounts cannot join student teams.</p>
      ) : team ? (
        <div className="team-reg__details">
          <div className="team-reg__identity">
            <span className="team-reg__eyebrow">YOUR TEAM · {record.my_role.toUpperCase()}</span>
            <h4>{team.name}</h4>
            <span className={`team-reg__badge team-reg__badge--${team.status}`}>{team.status}</span>
          </div>
          <div className="team-reg__count">
            <strong>{count} / {max}</strong><span>team members</span>
          </div>
          <div className="team-reg__track" role="progressbar" aria-label="Team size" aria-valuemin={0} aria-valuemax={max} aria-valuenow={count}>
            <div style={{ width: `${Math.min(100, max ? count / max * 100 : 0)}%` }} />
          </div>
          <p className="team-reg__muted">{team.status === "confirmed" ? "Your roster is confirmed and locked." : count < min ? `${min - count} more member(s) needed before confirmation.` : "Minimum size reached. The leader can confirm the roster."}</p>
          <div className="team-reg__members">
            <strong>Team roster</strong>
            <ul>{team.members?.map((member) => <li key={member.id}><span>{member.username}</span><small>{member.role}</small></li>)}</ul>
          </div>
          {team.status === "forming" && leader && registrationOpen && (
            <div className="team-reg__invite">
              <label htmlFor="eventhub-invite">Private invitation code</label>
              <input id="eventhub-invite" value={team.invitation_code || ""} readOnly onFocus={(e) => e.target.select()} />
              <button type="button" className="team-reg__button team-reg__button--light" disabled={!team.invitation_code || busy} onClick={async () => {
                try { await navigator.clipboard.writeText(team.invitation_code); setNotice("Invitation code copied."); }
                catch { setNotice("Select and copy the code above to share it privately."); }
              }}>Copy invitation code</button>
            </div>
          )}
          {team.status === "forming" && registrationOpen && (
            <div className="team-reg__actions">
              {leader ? (
                <>
                  <button type="button" className="team-reg__button" disabled={busy || count < min} onClick={() => askThen(() => confirmEventTeam(team.id), "Confirm this team? Members will no longer be able to join or leave.", "Team confirmed successfully.")}>Confirm team →</button>
                  <button type="button" className="team-reg__link-danger" disabled={busy} onClick={() => askThen(() => withdrawEventTeam(team.id), "Withdraw your entire team? Every member's registration will be cancelled.", "Team withdrawn.")}>Withdraw team</button>
                </>
              ) : (
                <button type="button" className="team-reg__link-danger" disabled={busy} onClick={() => askThen(() => leaveEventTeam(team.id), "Leave this team? Your registration will be cancelled.", "You left the team.")}>Leave team</button>
              )}
            </div>
          )}
          <Link to="/my-registrations" className="team-reg__secondary">View My Registrations →</Link>
        </div>
      ) : !registrationOpen ? (
        <p className="team-reg__muted">Team registration has closed for this event.</p>
      ) : (
        <>
          <div className="team-reg__tabs" role="group" aria-label="Team registration option">
            <button type="button" aria-pressed={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => {setMode("create");setError("");}}>Create team</button>
            <button type="button" aria-pressed={mode === "join"} className={mode === "join" ? "active" : ""} onClick={() => {setMode("join");setError("");}}>Join team</button>
          </div>
          {mode === "create" ? (
            <form className="team-reg__form" onSubmit={submitCreate}>
              <label htmlFor="team-name">Team name</label>
              <input id="team-name" value={teamName} maxLength={100} onChange={(e) => setTeamName(e.target.value)} required placeholder="e.g. Code Warriors" />
              <button className="team-reg__button" type="submit" disabled={busy || !teamName.trim()}>{busy ? "Creating..." : "Create my team →"}</button>
              <p className="team-reg__muted">You'll become the team leader and can invite classmates.</p>
            </form>
          ) : (
            <form className="team-reg__form" onSubmit={submitJoin}>
              <label htmlFor="team-code">Invitation code</label>
              <input id="team-code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required placeholder="Paste your team's invitation code" autoComplete="off" />
              <button className="team-reg__button" type="submit" disabled={busy || !inviteCode.trim()}>{busy ? "Joining..." : "Join this team →"}</button>
              <p className="team-reg__muted">Request the private invitation code from your team leader.</p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
