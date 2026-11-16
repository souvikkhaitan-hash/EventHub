import { useEffect, useRef, useState } from "react";

import CertificateBatches from "./CertificateBatches";

import {
  generateAwardRecipientPreview,
  getAwardResultRecipients,
  getAwardResults,
  getAwardTeamCandidates,
  getCertificateRecipients,
  recordAwardResult,
  withdrawAwardResult,
} from "../services/events";

// Older responses cannot replace the currently requested data.
function useAwardQuery(kind, id, page = 1, search = "") {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);

  const queryKey = JSON.stringify([
    kind,
    id,
    page,
    search,
    revision,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let operation;

    if (kind === "results") {
      operation = getAwardResults(
        id,
        page,
        controller.signal
      );
    } else if (kind === "recipients") {
      operation = getAwardResultRecipients(
        id,
        controller.signal
      );
    } else if (kind === "teams") {
      operation = getAwardTeamCandidates(
        id,
        controller.signal
      );
    } else {
      operation = getCertificateRecipients(
        id,
        { page, search },
        controller.signal
      );
    }

    operation
      .then((data) => {
        if (active) {
          setResult({
            queryKey,
            data,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) {
          setResult({
            queryKey,
            data: null,
            error: error.message || "Unable to load data.",
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, id, page, search, revision, queryKey]);

  const loading = result?.queryKey !== queryKey;

  return {
    loading,
    data: loading ? null : result?.data,
    error: loading ? "" : result?.error,
    refresh: () => setRevision((value) => value + 1),
  };
}


// Search and choose a registered student or confirmed team.
function AwardTargetPicker({
  event,
  eventId,
  busy,
  value,
  onChange,
}) {
  const teamMode = event.registration_mode === "team";

  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = useAwardQuery(
    teamMode ? "teams" : "students",
    eventId,
    page,
    search
  );

  const rows = teamMode
    ? (query.data?.teams || []).filter(
        (row) =>
          row.status === "confirmed" &&
          row.name.toLowerCase().includes(search.toLowerCase())
      )
    : (query.data?.results || []).filter(
        (row) => row.registration_status === "registered"
      );

  function find() {
    if (busy) return;

    onChange(null);
    setPage(1);
    setSearch(input.trim());
    query.refresh();
  }

  function changePage(next) {
    onChange(null);
    setPage(next);
  }

  return (
    <div className="cert-award-target">
      <div className="cert-preview-actions">
        <label>
          {teamMode
            ? "Find a confirmed team"
            : "Find a registered participant"}

          <input
            value={input}
            maxLength={100}
            disabled={busy}
            placeholder={
              teamMode
                ? "Search team name"
                : "Search name or username"
            }
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                find();
              }
            }}
          />
        </label>

        <button
          type="button"
          disabled={busy || query.loading}
          onClick={find}
        >
          Search / refresh
        </button>
      </div>

      {query.loading ? (
        <p role="status">Loading choices…</p>
      ) : query.error ? (
        <p role="alert">{query.error}</p>
      ) : (
        <label>
          {teamMode ? "Awarded team" : "Awarded participant"}

          <select
            value={
              value
                ? String(
                    teamMode ? value.id : value.registration_id
                  )
                : ""
            }
            disabled={busy}
            required
            onChange={(event) =>
              onChange(
                rows.find(
                  (row) =>
                    String(
                      teamMode ? row.id : row.registration_id
                    ) === event.target.value
                ) || null
              )
            }
          >
            <option value="">
              Choose {teamMode ? "a team" : "a participant"}
            </option>

            {rows.map((row) => {
              const id = teamMode
                ? row.id
                : row.registration_id;

              return (
                <option key={id} value={id}>
                  {teamMode
                    ? row.name
                    : `${row.participant_name || row.username} (@${row.username})`}
                </option>
              );
            })}
          </select>

          {!rows.length && (
            <small>No matching active choices.</small>
          )}
        </label>
      )}

      {!teamMode && (
        <div className="cert-recipient-pagination">
          <small>Page {page}</small>

          <div>
            <button
              type="button"
              disabled={busy || query.loading || page === 1}
              onClick={() => changePage(page - 1)}
            >
              Previous
            </button>

            <button
              type="button"
              disabled={
                busy || query.loading || !query.data?.next
              }
              onClick={() => changePage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// Review real recipients, preview their PDFs, and select a batch.
function AwardRecipients({
  result,
  eventId,
  versionId,
  versionLabel,
  dirty,
  busy,
  runOperation,
}) {
  const query = useAwardQuery("recipients", result.id);

  const [names, setNames] = useState({});
  const [picked, setPicked] = useState([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const [error, setError] = useState("");

  const alive = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const rows = query.data?.recipients || [];
  const current = query.data?.result;

  const reviewedName = (row) =>
    names[row.registration_id] ?? row.participant_name ?? "";

  const selected = rows
    .filter(
      (row) =>
        row.eligible && picked.includes(row.registration_id)
    )
    .map((row) => ({
      ...row,
      participant_name: reviewedName(row),
    }));

  function changeName(id, name) {
    if (busy) return;

    setNames((previous) => ({
      ...previous,
      [id]: name,
    }));

    setPreviewUrl("");
    setError("");
  }

  function toggle(row) {
    if (busy || !row.eligible) return;

    setPicked((previous) =>
      previous.includes(row.registration_id)
        ? previous.filter(
            (id) => id !== row.registration_id
          )
        : [...previous, row.registration_id].slice(0, 50)
    );
  }

  async function preview(row) {
    const name = reviewedName(row).trim();

    if (
      busy ||
      pending.current ||
      dirty ||
      !row.eligible ||
      !name ||
      name.length > 200
    ) {
      return;
    }

    pending.current = true;
    setError("");

    await runOperation(async () => {
      try {
        const blob = await generateAwardRecipientPreview(
          versionId,
          result.id,
          row.registration_id,
          name
        );

        if (!alive.current) return;

        setPreviewUrl(URL.createObjectURL(blob));
        setPreviewName(name);
      } catch (failure) {
        if (alive.current) {
          setError(
            failure.message || "Unable to generate preview."
          );
        }

        throw failure;
      }
    }).finally(() => {
      pending.current = false;
    });
  }

  if (query.loading) {
    return <p role="status">Loading award recipients…</p>;
  }

  if (query.error) {
    return (
      <div className="cert-message cert-error" role="alert">
        <p>{query.error}</p>

        <button
          type="button"
          disabled={busy}
          onClick={query.refresh}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!current?.is_active) {
    return (
      <p>
        This result was withdrawn. Record a corrected result
        to issue new awards.
      </p>
    );
  }

  return (
    <section className="cert-award-recipients">
      <div className="cert-section-heading">
        <div>
          <h3>
            {current.target_name} · {current.position}
          </h3>

          <p>
            Achievement certificates use {versionLabel}.
            Review names before selecting recipients.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPreviewUrl("");
            setError("");
            query.refresh();
          }}
        >
          Refresh eligibility
        </button>
      </div>

      <p className="cert-recipient-policy">
        Team awards use the roster saved with the result.
        Each recipient still needs recorded attendance.
        Add a Position field or {"{position}"} to the saved
        award template.
      </p>

      {dirty && (
        <p className="cert-message cert-error">
          Save your layout before previewing or generating awards.
        </p>
      )}

      <button
        type="button"
        disabled={
          busy || !rows.some((row) => row.eligible)
        }
        onClick={() =>
          setPicked(
            rows
              .filter((row) => row.eligible)
              .slice(0, 50)
              .map((row) => row.registration_id)
          )
        }
      >
        Select eligible recipients
      </button>

      <div className="cert-recipient-table-wrap">
        <table className="cert-recipient-table">
          <thead>
            <tr>
              <th scope="col">Batch</th>
              <th scope="col">Participant</th>
              <th scope="col">Printed full name</th>
              <th scope="col">Eligibility</th>
              <th scope="col">Preview</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.registration_id}>
                <td>
                  <input
                    type="checkbox"
                    className="cert-batch-checkbox"
                    checked={
                      row.eligible &&
                      picked.includes(row.registration_id)
                    }
                    disabled={busy || !row.eligible}
                    aria-label={`Select ${row.username} for award batch`}
                    onChange={() => toggle(row)}
                  />
                </td>

                <td>
                  <strong>{row.username}</strong>
                  <small>{row.team_name || "Individual"}</small>
                </td>

                <td>
                  <input
                    value={reviewedName(row)}
                    maxLength={200}
                    disabled={busy}
                    aria-label={`Printed full name for ${row.username}`}
                    placeholder="Enter full name"
                    onChange={(event) =>
                      changeName(
                        row.registration_id,
                        event.target.value
                      )
                    }
                  />
                </td>

                <td>
                  <span
                    className={`cert-eligibility ${
                      row.eligible ? "is-eligible" : ""
                    }`}
                  >
                    {row.eligible
                      ? "Eligible"
                      : "Not eligible"}
                  </span>

                  {!row.eligible && (
                    <ul className="cert-reason-list">
                      {row.reasons.map((reason) => (
                        <li key={reason.code}>
                          {reason.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>

                <td>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      dirty ||
                      !row.eligible ||
                      !reviewedName(row).trim()
                    }
                    onClick={() => preview(row)}
                  >
                    Preview
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!rows.length && (
        <p>No recipients are available for this result.</p>
      )}

      {error && (
        <p className="cert-message cert-error" role="alert">
          {error}
        </p>
      )}

      {previewUrl && !dirty && (
        <>
          <div className="cert-preview-actions">
            <strong>{previewName}</strong>

            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open preview ↗
            </a>

            <a
              href={previewUrl}
              download={`award-${result.id}-preview.pdf`}
            >
              Download preview
            </a>

            <span className="cert-badge">
              Preview only · not issued
            </span>
          </div>

          <iframe
            className="cert-pdf"
            src={previewUrl}
            title={`Award preview for ${previewName}`}
          />
        </>
      )}

      <CertificateBatches
        eventId={eventId}
        versionId={versionId}
        versionLabel={versionLabel}
        awardResult={current}
        recipients={selected}
        dirty={dirty}
        busy={busy}
        runOperation={runOperation}
        onNameChange={changeName}
        onRemove={(id) =>
          setPicked((previous) =>
            previous.filter((item) => item !== id)
          )
        }
        onClear={() => setPicked([])}
        onGenerated={() => setPicked([])}
      />
    </section>
  );
}


// Record and withdraw results without overwriting their history.
export default function CertificateAwards({
  event,
  eventId,
  versionId,
  versionLabel,
  dirty,
  busy,
  runOperation,
}) {
  const [page, setPage] = useState(1);
  const [clock, setClock] = useState(() => Date.now());

  const query = useAwardQuery("results", eventId, page);

  const [target, setTarget] = useState(null);
  const [targetRevision, setTargetRevision] = useState(0);
  const [position, setPosition] = useState("");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const createRequest = useRef(null);
  const pending = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(Date.now()),
      30000
    );

    return () => window.clearInterval(timer);
  }, []);

  const teamMode = event.registration_mode === "team";

  const canRecord =
    event.status === "published" &&
    new Date(event.end_datetime).getTime() <= clock;

  const rows = query.data?.results || [];

  async function perform(action) {
    if (busy || pending.current) return;

    pending.current = true;
    setError("");

    try {
      await runOperation(async () => {
        try {
          await action();
        } catch (failure) {
          if (alive.current) {
            setError(
              failure.message || "Unable to save this change."
            );
          }

          throw failure;
        }
      });
    } finally {
      pending.current = false;
    }
  }

  function record(event) {
    event.preventDefault();

    if (
      !canRecord ||
      !target ||
      !position.trim() ||
      busy ||
      pending.current
    ) {
      return;
    }

    const base = {
      position: position.trim(),
      ...(teamMode
        ? { team_id: target.id }
        : { registration_id: target.registration_id }),
    };

    const signature = JSON.stringify(base);

    // Retry the same request after a network error.
    if (createRequest.current?.signature !== signature) {
      createRequest.current = {
        signature,
        payload: {
          ...base,
          request_key: crypto.randomUUID(),
        },
      };
    }

    const payload = createRequest.current.payload;

    perform(async () => {
      const saved = await recordAwardResult(
        eventId,
        payload
      );

      if (!alive.current) return;

      setSelected(saved);
      setReason("");
      setConfirmed(false);
      setTarget(null);
      setPosition("");

      setTargetRevision((value) => value + 1);
      createRequest.current = null;

      setPage(1);
      query.refresh();
    });
  }

  function withdraw() {
    if (
      !selected?.is_active ||
      !confirmed ||
      !reason.trim()
    ) {
      return;
    }

    perform(async () => {
      const updated = await withdrawAwardResult(
        selected.id,
        reason
      );

      if (!alive.current) return;

      setSelected(updated);
      setReason("");
      setConfirmed(false);
      query.refresh();
    });
  }

  return (
    <section className="cert-card cert-awards">
      <div className="cert-section-heading">
        <div>
          <h2>Results and award certificates.</h2>

          <p>
            Record the result once. Each eligible recipient
            receives their own achievement certificate.
          </p>
        </div>

        <span className="cert-badge">
          {teamMode ? "Team results" : "Individual results"}
        </span>
      </div>

      {!canRecord && (
        <p className="cert-recipient-policy">
          Results can be recorded after this published event
          finishes.
        </p>
      )}

      <details
        className="cert-award-create"
        open={
          canRecord &&
          !query.loading &&
          !rows.length
        }
      >
        <summary>Record a result</summary>

        <form onSubmit={record}>
          <AwardTargetPicker
            key={targetRevision}
            event={event}
            eventId={eventId}
            busy={busy || !canRecord}
            value={target}
            onChange={setTarget}
          />

          <label>
            Position or award

            <input
              value={position}
              maxLength={80}
              required
              list={`award-positions-${eventId}`}
              placeholder="For example: 1st place or Best Innovation"
              disabled={busy || !canRecord}
              onChange={(event) =>
                setPosition(event.target.value)
              }
            />
          </label>

          <datalist id={`award-positions-${eventId}`}>
            {[
              "Winner",
              "1st place",
              "2nd place",
              "3rd place",
              "Runner-up",
              "Best Innovation",
            ].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>

          <p className="cert-help">
            One active overall result per participant or team.
            Ties are allowed. Withdraw an incorrect result
            before recording its replacement.
          </p>

          <button
            type="submit"
            className="cert-primary"
            disabled={
              busy ||
              !canRecord ||
              !target ||
              !position.trim()
            }
          >
            Save result
          </button>
        </form>
      </details>

      {error && (
        <div className="cert-message cert-error" role="alert">
          {error}
        </div>
      )}

      <div className="cert-section-heading">
        <h3>Saved results</h3>

        <button
          type="button"
          disabled={busy || query.loading}
          onClick={query.refresh}
        >
          Refresh results
        </button>
      </div>

      {query.loading ? (
        <p role="status">Loading results…</p>
      ) : query.error ? (
        <p role="alert">{query.error}</p>
      ) : !rows.length ? (
        <p>No results recorded yet.</p>
      ) : (
        <div className="cert-recipient-table-wrap">
          <table className="cert-recipient-table">
            <thead>
              <tr>
                <th scope="col">Participant / team</th>
                <th scope="col">Position</th>
                <th scope="col">Status</th>
                <th scope="col">Review</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={
                    selected?.id === row.id ? "is-selected" : ""
                  }
                >
                  <td>
                    <strong>{row.target_name}</strong>

                    <small>
                      {row.recipient_registration_ids.length}
                      {" "}recorded recipients
                    </small>
                  </td>

                  <td>{row.position}</td>
                  <td>{row.is_active ? "Active" : "Withdrawn"}</td>

                  <td>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelected(row);
                        setReason("");
                        setConfirmed(false);
                        setError("");
                      }}
                    >
                      {selected?.id === row.id
                        ? "Selected"
                        : "Review result"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="cert-recipient-pagination">
        <small>
          {query.data?.count || 0} results · Page {page}
        </small>

        <div>
          <button
            type="button"
            disabled={busy || query.loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>

          <button
            type="button"
            disabled={
              busy || query.loading || !query.data?.next
            }
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {selected && (
        <>
          {selected.is_active ? (
            <details className="cert-award-withdraw">
              <summary>
                Correct or withdraw {selected.target_name}’s result
              </summary>

              <p>
                First revoke any active award certificates for
                this result using its published batch. Then
                withdraw the result and record its replacement.
              </p>

              <label>
                Private reason

                <textarea
                  value={reason}
                  maxLength={500}
                  rows={3}
                  disabled={busy}
                  onChange={(event) =>
                    setReason(event.target.value)
                  }
                />
              </label>

              <label className="cert-review-confirmation">
                <input
                  type="checkbox"
                  className="cert-batch-checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) =>
                    setConfirmed(event.target.checked)
                  }
                />

                <span>
                  I confirm that this result should be withdrawn.
                </span>
              </label>

              <button
                type="button"
                disabled={
                  busy || !confirmed || !reason.trim()
                }
                onClick={withdraw}
              >
                Withdraw result
              </button>
            </details>
          ) : (
            <p className="cert-recipient-policy">
              Withdrawn result: {selected.withdrawal_reason}
            </p>
          )}

          {selected.is_active && (
            <AwardRecipients
              key={selected.id}
              result={selected}
              eventId={eventId}
              versionId={versionId}
              versionLabel={versionLabel}
              dirty={dirty}
              busy={busy}
              runOperation={runOperation}
            />
          )}
        </>
      )}
    </section>
  );
}