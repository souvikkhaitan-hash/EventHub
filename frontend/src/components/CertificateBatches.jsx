import { useEffect, useRef, useState } from "react";

import { useEventAccess } from "./EventAccessGate";
import PublishCertificateBatch from "./PublishCertificateBatch";
import CertificateRevocation from "./CertificateRevocation";
import { useCertificateStudio } from "./CertificateStudio";

import {
  createCertificateBatch,
  getCertificateBatch,
  getCertificateBatches,
  getGeneratedCertificateDocument,
} from "../services/events";

import "../styles/certificate-batches.css";

const BATCH_LIMIT = 50;

function formatDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return "—";
  }

  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export default function CertificateBatches({
  eventId,
  versionId,
  versionLabel,
  recipients = [],
  historyOnly = false,
  awardResult = null,
  dirty,
  busy,
  runOperation,
  onNameChange,
  onRemove,
  onClear,
  onGenerated,
}) {
  const access = useEventAccess();
  const isEventOwner = access?.role === "owner";

  const studio = useCertificateStudio();
  const studioBatch = studio?.batch;
  const historyRevision = studio?.historyRevision;
  const generationOnly = Boolean(studio) && !historyOnly;

  const [request, setRequest] = useState({
    page: 1,
    revision: 0,
  });

  const [result, setResult] = useState({
    request: null,
    data: null,
    error: "",
  });

  const [batch, setBatch] = useState(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const [namesExpanded, setNamesExpanded] = useState(false);

  const aliveRef = useRef(false);
  const generationRef = useRef(null);
  const generatingRef = useRef(false);

  const loading = result.request !== request;
  const data = loading ? null : result.data;
  const batches = data?.results || [];

  const invalidNameCount = recipients.filter((recipient) => {
    const name = recipient.participant_name;

    return (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 200
    );
  }).length;

  const invalidNames = invalidNameCount > 0;
  const namesVisible = invalidNames || namesExpanded;

  const cannotGenerate =
    busy ||
    dirty ||
    !versionId ||
    recipients.length === 0 ||
    recipients.length > BATCH_LIMIT ||
    invalidNames;

  // Track whether asynchronous results can still update this screen.
  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Open the newly generated batch in the history screen.
  useEffect(() => {
    if (!historyOnly || !studioBatch) return;

    setBatch(studioBatch);
    setPreviewUrl("");
    setPreviewName("");
  }, [historyOnly, studioBatch]);

  // Refresh history when the studio records a batch change.
  useEffect(() => {
    if (!historyOnly) return;

    setRequest((previous) => ({
      page: 1,
      revision: previous.revision + 1,
    }));
  }, [historyOnly, historyRevision]);

  // Load paginated batch history.
  useEffect(() => {
    if (generationOnly) return;

    const controller = new AbortController();
    let active = true;

    getCertificateBatches(
      eventId,
      request.page,
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
      .catch((requestError) => {
        if (!active || controller.signal.aborted) return;

        setResult({
          request,
          data: null,
          error:
            requestError.message ||
            "Unable to load saved batches.",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [eventId, request, generationOnly]);

  // Release PDF preview URLs after replacement or unmounting.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function refreshBatches(page = request.page) {
    setRequest((previous) => ({
      page,
      revision: previous.revision + 1,
    }));
  }

  function clearPreview() {
    setPreviewUrl("");
    setPreviewName("");
  }

  function generate() {
    if (cannotGenerate || generatingRef.current) {
      return;
    }

    const basePayload = {
      template_version_id: versionId,

      ...(awardResult
        ? { award_result_id: awardResult.id }
        : {}),

      recipients: [...recipients]
        .sort(
          (first, second) =>
            first.registration_id - second.registration_id
        )
        .map((recipient) => ({
          registration_id: recipient.registration_id,
          participant_name: recipient.participant_name.trim(),
        })),
    };

    const signature = JSON.stringify(basePayload);

    // Retain the same request key when retrying an unchanged request.
    if (generationRef.current?.signature !== signature) {
      generationRef.current = {
        signature,
        payload: {
          ...basePayload,
          request_key: crypto.randomUUID(),
        },
      };
    }

    const payload = generationRef.current.payload;

    generatingRef.current = true;
    setError("");

    runOperation(async () => {
      try {
        const created = await createCertificateBatch(
          eventId,
          payload
        );

        if (!aliveRef.current) return;

        setBatch(created);
        clearPreview();

        generationRef.current = null;

        refreshBatches(1);
        setNamesExpanded(false);
        onGenerated?.();

        studio?.reviewBatch(created);
      } catch (generationError) {
        if (aliveRef.current) {
          setError(
            generationError.message ||
              "Unable to generate this draft batch."
          );
        }

        throw generationError;
      } finally {
        generatingRef.current = false;
      }
    });
  }

  function openBatch(batchId) {
    if (busy) return;

    setError("");

    runOperation(async () => {
      try {
        const response = await getCertificateBatch(batchId);

        if (!aliveRef.current) return;

        setBatch(response);
        clearPreview();
      } catch (requestError) {
        if (aliveRef.current) {
          setError(
            requestError.message ||
              "Unable to open this batch."
          );
        }

        throw requestError;
      }
    });
  }

  function openDocument(certificate) {
    if (busy) return;

    setError("");

    runOperation(async () => {
      try {
        const blob = await getGeneratedCertificateDocument(
          certificate.id
        );

        if (!aliveRef.current) return;

        setPreviewUrl(URL.createObjectURL(blob));
        setPreviewName(certificate.participant_name);
      } catch (requestError) {
        if (aliveRef.current) {
          setError(
            requestError.message ||
              "Unable to open this PDF."
          );
        }

        throw requestError;
      }
    });
  }

  return (
    <div className="cert-batches">
      <div hidden={historyOnly}>
        <div className="cert-section-heading">
          <div>
            <h2>Generate a draft batch.</h2>

            <p>
              Names are filled from participants’ saved
              profiles. You only need to correct missing or
              inaccurate names. This batch uses{" "}
              <strong>
                {versionLabel || "the selected saved layout"}
              </strong>.
            </p>
          </div>

          <span className="cert-badge">
            {recipients.length} / {BATCH_LIMIT} selected
          </span>
        </div>

        {recipients.length > 0 ? (
          <>
            <div
              className={`cert-batch-name-status ${
                invalidNames ? "is-warning" : "is-ready"
              }`}
              role="status"
            >
              <strong>
                {invalidNames
                  ? `${invalidNameCount} participant name${
                      invalidNameCount === 1 ? "" : "s"
                    } need attention`
                  : `${recipients.length} participant name${
                      recipients.length === 1 ? " is" : "s are"
                    } ready`}
              </strong>

              <p>
                {invalidNames
                  ? "Complete the highlighted names below before generating."
                  : "You can generate the draft batch directly. Individual name review is optional."}
              </p>
            </div>

            <div className="cert-name-review">
              <button
                type="button"
                className="cert-name-review-toggle"
                aria-expanded={namesVisible}
                disabled={busy || invalidNames}
                onClick={() =>
                  setNamesExpanded((previous) => !previous)
                }
              >
                <span>
                  {invalidNames
                    ? "Complete missing or invalid names"
                    : "Review or correct names — optional"}
                </span>

                <span aria-hidden="true">
                  {namesVisible ? "−" : "+"}
                </span>
              </button>

              {namesVisible && (
                <div className="cert-batch-names">
                  {recipients.map((recipient) => {
                    const name =
                      recipient.participant_name ?? "";

                    const valid =
                      typeof name === "string" &&
                      name.trim().length > 0 &&
                      name.trim().length <= 200;

                    return (
                      <div
                        key={recipient.registration_id}
                        className={`cert-batch-name ${
                          valid ? "" : "cert-batch-name-invalid"
                        }`}
                      >
                        <div>
                          <strong>
                            {recipient.username}
                          </strong>

                          <small>
                            {recipient.team_name ||
                              "Individual participant"}
                          </small>
                        </div>

                        <label>
                          Printed full name

                          <input
                            value={name}
                            maxLength={200}
                            placeholder="Participant’s official full name"
                            disabled={busy}
                            aria-invalid={!valid}
                            onChange={(event) =>
                              onNameChange(
                                recipient.registration_id,
                                event.target.value
                              )
                            }
                          />
                        </label>

                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Remove ${recipient.username} from batch`}
                          onClick={() =>
                            onRemove(
                              recipient.registration_id
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {invalidNames && (
              <p className="cert-help">
                Names must contain between 1 and 200
                characters. Corrections apply to this
                certificate batch and do not update student
                accounts.
              </p>
            )}

            {dirty && (
              <p className="cert-help">
                Save your template changes before generating
                a batch.
              </p>
            )}

            {!versionId && (
              <p className="cert-help">
                Choose a saved template version before
                generating.
              </p>
            )}

            {recipients.length > BATCH_LIMIT && (
              <p className="cert-help">
                Select no more than {BATCH_LIMIT} participants
                for this batch.
              </p>
            )}

            <div className="cert-batch-actions">
              <button
                type="button"
                className="cert-primary"
                disabled={cannotGenerate}
                onClick={generate}
              >
                Generate draft batch
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onClear?.();
                  setNamesExpanded(false);
                }}
              >
                Clear selection
              </button>
            </div>
          </>
        ) : (
          <p>
            No participants selected. Use “Select eligible on
            this page” above, or choose individual participants.
          </p>
        )}

        <small>
          Eligibility is checked again during generation.
          Drafts remain private until the event owner
          publishes them.
        </small>
      </div>

      {error && (
        <div
          className="cert-message cert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <div hidden={Boolean(studio) && !historyOnly}>
        <div className="cert-section-heading cert-batch-history-heading">
          <h2>Saved batches</h2>

          <button
            type="button"
            disabled={busy || loading}
            onClick={() => refreshBatches()}
          >
            Refresh batches
          </button>
        </div>

        {loading ? (
          <p role="status">Loading saved batches…</p>
        ) : result.error ? (
          <div
            className="cert-message cert-error"
            role="alert"
          >
            <p>{result.error}</p>

            <button
              type="button"
              disabled={busy}
              onClick={() => refreshBatches()}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {batches.length === 0 ? (
              <p>
                No certificate batches have been generated yet.
              </p>
            ) : (
              <div className="cert-recipient-table-wrap">
                <table className="cert-recipient-table">
                  <thead>
                    <tr>
                      <th scope="col">Created</th>
                      <th scope="col">Certificates</th>
                      <th scope="col">Status</th>
                      <th scope="col">Review</th>
                    </tr>
                  </thead>

                  <tbody>
                    {batches.map((item) => (
                      <tr
                        key={item.id}
                        className={
                          batch?.id === item.id
                            ? "is-selected"
                            : ""
                        }
                      >
                        <td>{formatDate(item.created_at)}</td>

                        <td>
                          {item.certificate_count}

                          <small>
                            {item.award_result_id
                              ? "Achievement"
                              : "Participation"}
                          </small>
                        </td>

                        <td>
                          {item.status === "published"
                            ? "Published"
                            : "Private draft"}
                        </td>

                        <td>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openBatch(item.id)}
                          >
                            Review batch
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
                {data?.count || 0} batches · Page{" "}
                {request.page}
              </small>

              <div>
                <button
                  type="button"
                  disabled={
                    busy || loading || request.page === 1
                  }
                  onClick={() =>
                    refreshBatches(request.page - 1)
                  }
                >
                  Previous
                </button>

                <button
                  type="button"
                  disabled={busy || loading || !data?.next}
                  onClick={() =>
                    refreshBatches(request.page + 1)
                  }
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {batch && (
          <div className="cert-batch-review">
            <h3>
              {batch.award_result_id
                ? "Achievement"
                : "Participation"}{" "}
              batch review · {batch.certificate_count}{" "}
              certificates
            </h3>

            <p>
              These PDFs contain the saved names and
              information from generation time. Editing a name
              does not change an existing batch.
            </p>

            <div className="cert-batch-documents">
              {(batch.certificates ?? []).map(
                (certificate) => (
                  <button
                    key={certificate.id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      openDocument(certificate)
                    }
                  >
                    Open {certificate.participant_name}
                  </button>
                )
              )}
            </div>

            {previewUrl && (
              <>
                <div className="cert-preview-actions">
                  <strong>{previewName}</strong>

                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open PDF ↗
                  </a>

                  <a
                    href={previewUrl}
                    download={`certificate-batch-${batch.id}.pdf`}
                  >
                    Download PDF
                  </a>
                </div>

                <iframe
                  className="cert-pdf"
                  src={previewUrl}
                  title={`Saved certificate for ${previewName}`}
                />
              </>
            )}

            {isEventOwner ? (
              <PublishCertificateBatch
                key={`${batch.id}-${batch.review_hash}-${batch.status}`}
                batch={batch}
                busy={busy}
                runOperation={runOperation}
                onPublished={(published) => {
                  setBatch(published);
                  studio?.rememberBatch(published);

                  clearPreview();
                  refreshBatches();
                }}
              />
            ) : (
              <p className="cert-message" role="note">
                {batch.status === "published"
                  ? "This batch has been published. You can view its certificates."
                  : "This is a draft batch. Ask the event owner to review the PDFs and publish it."}
              </p>
            )}

            {isEventOwner &&
              batch.status === "published" && (
                <section className="cert-batch-issued">
                  <h3>Issued certificates</h3>

                  <p className="cert-help">
                    Share the verification link or revoke a
                    certificate that needs correction.
                  </p>

                  {(batch.certificates ?? []).map(
                    (certificate) => (
                      <CertificateRevocation
                        key={certificate.id}
                        certificateId={certificate.id}
                        participantName={
                          certificate.participant_name
                        }
                        busy={busy}
                        runOperation={runOperation}
                      />
                    )
                  )}
                </section>
              )}
          </div>
        )}
      </div>
    </div>
  );
}