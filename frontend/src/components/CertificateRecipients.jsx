import { useEffect, useRef, useState } from "react";

import CertificateBatches from "./CertificateBatches";

import {
  generateParticipantCertificatePreview,
  getCertificateRecipients,
} from "../services/events";

export default function CertificateRecipients({
  eventId,
  versionId,
  versionLabel,
  dirty,
  busy,
  runOperation,
}) {
  const [searchInput, setSearchInput] = useState("");

  const [request, setRequest] = useState({
    page: 1,
    search: "",
    revision: 0,
  });

  const [result, setResult] = useState({
    request: null,
    data: null,
    error: "",
  });

  const [selectedId, setSelectedId] = useState(null);
  const [reviewedNames, setReviewedNames] = useState({});

  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");

  const [picked, setPicked] = useState({});
  const [selectionMessage, setSelectionMessage] = useState("");

  const aliveRef = useRef(false);

  const loading = result.request !== request;
  const data = loading ? null : result.data;
  const rows = data?.results || [];

  const selected = rows.find(
    (row) => row.registration_id === selectedId
  );

  const selectedName = selected
    ? reviewedNames[selectedId] ?? selected.participant_name ?? ""
    : "";

  const hasValidSelectedName = Boolean(
    selectedName.trim() &&
    selectedName.trim().length <= 200
  );

  const pickedRecipients = Object.values(picked).map((row) => ({
    ...row,
    participant_name:
      reviewedNames[row.registration_id] ??
      row.participant_name ??
      "",
  }));

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Cancel older requests when searching or changing pages.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    getCertificateRecipients(
      eventId,
      {
        page: request.page,
        search: request.search,
      },
      controller.signal
    )
      .then((response) => {
        if (!active) return;

        setResult({
          request,
          data: response,
          error: "",
        });
      })
      .catch((error) => {
        if (active && error.name !== "AbortError") {
          setResult({
            request,
            data: null,
            error: error.message || "Unable to load participants.",
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [eventId, request]);

  // Release replaced or unmounted PDF previews.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ----------------------------------------------------------
  // Search and pagination
  // ----------------------------------------------------------

  function clearParticipantReview() {
    setSelectedId(null);
    setPreviewUrl("");
    setPreviewError("");
  }

  function search(event) {
    event.preventDefault();

    if (busy) return;

    clearParticipantReview();

    setRequest((previous) => ({
      page: 1,
      search: searchInput.trim(),
      revision: previous.revision + 1,
    }));
  }

  function refresh() {
    if (busy) return;

    clearParticipantReview();

    setRequest((previous) => ({
      ...previous,
      revision: previous.revision + 1,
    }));
  }

  function changePage(page) {
    if (busy || loading || page < 1) return;

    clearParticipantReview();

    setRequest((previous) => ({
      ...previous,
      page,
    }));
  }

  // ----------------------------------------------------------
  // Individual participant review
  // ----------------------------------------------------------

  function selectParticipant(row) {
    if (busy) return;

    setSelectedId(row.registration_id);
    setPreviewUrl("");
    setPreviewError("");
  }

  function changeReviewedName(registrationId, name) {
    if (busy) return;

    setReviewedNames((previous) => ({
      ...previous,
      [registrationId]: name,
    }));

    if (registrationId === selectedId) {
      setPreviewUrl("");
      setPreviewError("");
    }
  }

  function previewParticipant() {
    if (
      busy ||
      loading ||
      dirty ||
      !selected?.eligible ||
      !hasValidSelectedName
    ) {
      return;
    }

    setPreviewError("");

    runOperation(async () => {
      try {
        const blob = await generateParticipantCertificatePreview(
          versionId,
          selected.registration_id,
          selectedName
        );

        if (!aliveRef.current) return;

        setPreviewUrl(URL.createObjectURL(blob));
      } catch (error) {
        if (aliveRef.current) {
          setPreviewError(
            error.message || "Unable to generate this preview."
          );
        }

        throw error;
      }
    });
  }

  // ----------------------------------------------------------
  // Draft batch selection
  // ----------------------------------------------------------

  function removePicked(registrationId) {
    if (busy) return;

    setPicked((previous) => {
      const next = { ...previous };
      delete next[registrationId];
      return next;
    });

    setSelectionMessage("");
  }

  function togglePicked(row) {
    if (busy) return;

    if (picked[row.registration_id]) {
      removePicked(row.registration_id);
      return;
    }

    if (!row.eligible) return;

    if (pickedRecipients.length >= 50) {
      setSelectionMessage(
        "A batch can contain up to 50 participants."
      );
      return;
    }

    setPicked((previous) => ({
      ...previous,
      [row.registration_id]: row,
    }));

    setSelectionMessage("");
  }

  function selectEligiblePage() {
    if (busy || loading) return;

    const available = Math.max(
      0,
      50 - pickedRecipients.length
    );

    const candidates = rows.filter(
      (row) => row.eligible && !picked[row.registration_id]
    );

    const additions = candidates.slice(0, available);

    setPicked((previous) => ({
      ...previous,
      ...Object.fromEntries(
        additions.map((row) => [row.registration_id, row])
      ),
    }));

    setSelectionMessage(
      candidates.length > available
        ? "Selected up to the 50-participant batch limit."
        : additions.length
          ? `${additions.length} participants added to the batch.`
          : "No additional eligible participants on this page."
    );
  }

  function clearPicked() {
    setPicked({});
    setSelectionMessage("");
  }

  return (
    <section className="cert-card cert-recipients">
      <div className="cert-section-heading">
        <div>
          <h2>Certificates for your participants.</h2>

          <p>
            Review attendance, eligibility and printed names.
            Previews and new batches use the saved layout:{" "}
            <strong>{versionLabel}</strong>.
          </p>
        </div>

        <span className="cert-badge">
          Participation certificates
        </span>
      </div>

      {dirty && (
        <div className="cert-message cert-error" role="status">
          Save your layout changes before generating a participant
          preview or draft batch.
        </div>
      )}

      <form className="cert-recipient-search" onSubmit={search}>
        <label>
          Find a participant
          <input
            value={searchInput}
            maxLength={100}
            placeholder="Search by name, username or team"
            disabled={busy}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>

        <button type="submit" disabled={busy}>
          Search
        </button>

        <button
          type="button"
          disabled={busy || loading}
          onClick={refresh}
        >
          Refresh attendance
        </button>
      </form>

      <div className="cert-batch-actions">
        <button
          type="button"
          disabled={
            busy ||
            loading ||
            !rows.some((row) => row.eligible)
          }
          onClick={selectEligiblePage}
        >
          Select eligible on this page
        </button>

        <small>
          {pickedRecipients.length} selected for batch
        </small>

        {selectionMessage && (
          <small role="status">{selectionMessage}</small>
        )}
      </div>

      {loading ? (
        <p role="status">Loading participants…</p>
      ) : result.error ? (
        <div className="cert-message cert-error" role="alert">
          <p>{result.error}</p>

          <button
            type="button"
            disabled={busy}
            onClick={refresh}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {data?.policy && (
            <p className="cert-recipient-policy">
              {data.policy}
            </p>
          )}

          {rows.length === 0 ? (
            <p>No participants match this search.</p>
          ) : (
            <div className="cert-recipient-table-wrap">
              <table className="cert-recipient-table">
                <thead>
                  <tr>
                    <th scope="col">Batch</th>
                    <th scope="col">Participant</th>
                    <th scope="col">Team</th>
                    <th scope="col">Attendance</th>
                    <th scope="col">Certificate eligibility</th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.registration_id}
                      className={
                        selectedId === row.registration_id
                          ? "is-selected"
                          : ""
                      }
                    >
                      <td>
                        <input
                          className="cert-batch-checkbox"
                          type="checkbox"
                          checked={Boolean(
                            picked[row.registration_id]
                          )}
                          disabled={
                            busy ||
                            (
                              !row.eligible &&
                              !picked[row.registration_id]
                            )
                          }
                          aria-label={`Select ${row.username} for batch`}
                          onChange={() => togglePicked(row)}
                        />
                      </td>

                      <td>
                        <strong>
                          {row.participant_name || row.username}
                        </strong>

                        <small>
                          {row.needs_name
                            ? "Full name required"
                            : `@${row.username}`}
                        </small>
                      </td>

                      <td>{row.team_name || "—"}</td>

                      <td>
                        {row.checked_in_at
                          ? "Checked in"
                          : "Not checked in"}
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
                          disabled={busy}
                          aria-pressed={
                            selectedId === row.registration_id
                          }
                          onClick={() => selectParticipant(row)}
                        >
                          {selectedId === row.registration_id
                            ? "Selected"
                            : "Review"}
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
              {data?.count || 0} matching participants
              {" · "}Page {request.page}
            </small>

            <div>
              <button
                type="button"
                disabled={busy || request.page === 1}
                onClick={() => changePage(request.page - 1)}
              >
                Previous
              </button>

              <button
                type="button"
                disabled={busy || !data?.next}
                onClick={() => changePage(request.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <div className="cert-recipient-review">
          <h3>Review {selected.username}</h3>

          <p>
            Team:{" "}
            <strong>{selected.team_name || "Individual"}</strong>
            {" · "}Certificate type:{" "}
            <strong>Participation</strong>
          </p>

          {!selected.eligible && (
            <div className="cert-message cert-error">
              {selected.reasons.map((reason) => (
                <div key={reason.code}>{reason.message}</div>
              ))}
            </div>
          )}

          <div className="cert-preview-actions">
            <label>
              Full name printed on certificate
              <input
                maxLength={200}
                value={selectedName}
                placeholder="Enter the participant’s full name"
                disabled={busy}
                onChange={(event) =>
                  changeReviewedName(
                    selected.registration_id,
                    event.target.value
                  )
                }
              />
            </label>

            <button
              type="button"
              className="cert-primary"
              disabled={
                busy ||
                loading ||
                dirty ||
                !selected.eligible ||
                !hasValidSelectedName
              }
              onClick={previewParticipant}
            >
              Preview this participant
            </button>
          </div>

          <small>
            Reviewed names are shared with your current batch
            selection. They are stored when you generate a draft
            batch and do not change the student’s account.
          </small>

          {previewError && (
            <div className="cert-message cert-error" role="alert">
              {previewError}
            </div>
          )}

          {previewUrl && !dirty && (
            <>
              <div className="cert-preview-actions">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open participant preview ↗
                </a>

                <a
                  href={previewUrl}
                  download={`participant-${selected.registration_id}-preview.pdf`}
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
                title={`Certificate preview for ${selectedName}`}
              />
            </>
          )}
        </div>
      )}

      <CertificateBatches
        eventId={eventId}
        versionId={versionId}
        versionLabel={versionLabel}
        recipients={pickedRecipients}
        dirty={dirty}
        busy={busy}
        runOperation={runOperation}
        onNameChange={changeReviewedName}
        onRemove={removePicked}
        onClear={clearPicked}
        onGenerated={clearPicked}
      />
    </section>
  );
}