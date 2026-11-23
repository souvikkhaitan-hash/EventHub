import { useEffect, useRef, useState } from "react";

import {
  lookupAttendanceParticipant,
} from "../services/events";

export default function AttendanceLookup({
  eventId,
  disabled,
  onCheckIn,
}) {
  const [kind, setKind] = useState("roll");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const controller = useRef(null);
  const sequence = useRef(0);
  const saving = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      sequence.current += 1;
      controller.current?.abort();
    };
  }, []);

  function clearSearch() {
    sequence.current += 1;
    controller.current?.abort();
    setMatches([]);
    setSearched(false);
    setSearching(false);
    setError("");
  }

  async function search(event) {
    event.preventDefault();

    if (disabled || confirming || !query.trim()) return;

    controller.current?.abort();
    controller.current = new AbortController();

    const current = ++sequence.current;

    setSearching(true);
    setError("");
    setMatches([]);
    setSearched(false);

    try {
      const response = await lookupAttendanceParticipant(
        eventId,
        kind,
        query,
        controller.current.signal
      );

      if (!Array.isArray(response.results)) {
        throw new Error("Unexpected participant lookup response.");
      }

      if (mounted.current && current === sequence.current) {
        setMatches(response.results);
        setSearched(true);
      }
    } catch (err) {
      if (
        mounted.current &&
        current === sequence.current &&
        err.name !== "AbortError"
      ) {
        setError(err.message || "Unable to find this participant.");
      }
    } finally {
      if (mounted.current && current === sequence.current) {
        setSearching(false);
      }
    }
  }

  async function confirmParticipant(participant) {
    if (
      disabled ||
      searching ||
      saving.current ||
      participant.checked_in_at ||
      participant.is_self
    ) {
      return;
    }

    saving.current = true;
    setConfirming(true);

    try {
      const success = await onCheckIn(participant.registration_id);

      if (success && mounted.current) {
        clearSearch();
      }
    } finally {
      saving.current = false;

      if (mounted.current) {
        setConfirming(false);
      }
    }
  }

  const locked = disabled || confirming;

  return (
    <section className="at-lookup">
      <h3>Find a participant</h3>

      <p>
        Search by the exact roll/register number or complete
        ticket UUID. Confirm the person’s identity before check-in.
      </p>

      <form onSubmit={search}>
        <label htmlFor="attendance-lookup-kind">
          Search using
        </label>

        <select
          id="attendance-lookup-kind"
          value={kind}
          disabled={locked}
          onChange={(event) => {
            clearSearch();
            setKind(event.target.value);
            setQuery("");
          }}
        >
          <option value="roll">Roll / register number</option>
          <option value="ticket">Ticket UUID</option>
        </select>

        <label htmlFor="attendance-lookup-query">
          {kind === "roll"
            ? "Complete roll / register number"
            : "Complete ticket UUID"}
        </label>

        <input
          id="attendance-lookup-query"
          value={query}
          disabled={locked}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={100}
          required
          onChange={(event) => {
            clearSearch();
            setQuery(event.target.value);
          }}
        />

        <button
          type="submit"
          className="at-button"
          disabled={locked || searching || !query.trim()}
        >
          {searching ? "Searching..." : "Find participant"}
        </button>
      </form>

      {error && (
        <p className="at-notice at-error" role="alert">
          {error}
        </p>
      )}

      {searched && matches.length === 0 && (
        <p role="status">
          No eligible active registration matched this event.
          Check the code, or ask the participant to open their ticket.
        </p>
      )}

      {matches.length > 1 && (
        <p className="at-form-help">
          Multiple registrations match. Check the name and username
          carefully, or search again using the unique ticket UUID.
        </p>
      )}

      {matches.map((participant) => (
        <article
          className="at-lookup-result"
          key={participant.registration_id}
        >
          <strong>{participant.full_name}</strong>
          <span>@{participant.username}</span>
          <span>
            {participant.roll_number || "Roll number unavailable"}
            {participant.department
              ? ` · ${participant.department}`
              : ""}
          </span>
          <span>Registration #{participant.registration_id}</span>

          {participant.checked_in_at ? (
            <p>Already checked in.</p>
          ) : participant.is_self ? (
            <p>Another authorized staff member must check you in.</p>
          ) : (
            <button
              type="button"
              className="at-button at-primary"
              disabled={locked || searching}
              onClick={() => confirmParticipant(participant)}
            >
              {confirming
                ? "Checking in..."
                : "Confirm identity & check in"}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}