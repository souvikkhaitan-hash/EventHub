import { useEffect, useRef, useState } from "react";

import PublishCertificateBatch from "./PublishCertificateBatch";
import CertificateRevocation from "./CertificateRevocation";
import { useCertificateStudio } from "./CertificateStudio";

import {
  createCertificateBatch,
  getCertificateBatch,
  getCertificateBatches,
  getGeneratedCertificateDocument,
} from "../services/events";

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

  const aliveRef = useRef(false);
  const generationRef = useRef(null);

  const loading = result.request !== request;
  const data = loading ? null : result.data;
  const batches = data?.results || [];

  const invalidNames = recipients.some((recipient) => {
    const length = recipient.participant_name.trim().length;
    return length === 0 || length > 200;
  });

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!historyOnly) return;

    if (studioBatch) {
      setBatch(studioBatch);
      setPreviewUrl("");
      setPreviewName("");
    }
  }, [historyOnly, studioBatch]);

  useEffect(() => {
    if (historyOnly) {
      setRequest((previous) => ({
        page: 1,
        revision: previous.revision + 1,
      }));
    }
  }, [historyOnly, historyRevision]);

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
    if (
      busy ||
      dirty ||
      recipients.length === 0 ||
      recipients.length > 50 ||
      invalidNames
    ) {
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
            first.registration_id -
            second.registration_id
        )
        .map((recipient) => ({
          registration_id: recipient.registration_id,
          participant_name:
            recipient.participant_name.trim(),
        })),
    };

    const signature = JSON.stringify(basePayload);

    // Reuse the request key when retrying the same batch.
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
        onGenerated?.();

        // Open the new draft in the Saved batches tab.
        studio?.reviewBatch(created);
      } catch (generationError) {
        if (aliveRef.current) {
          setError(
            generationError.message ||
              "Unable to generate this draft batch."
          );
        }

        throw generationError;
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
        const blob =
          await getGeneratedCertificateDocument(
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
              Select eligible participants in the
              table above, then review their printed
              names. This batch will use{" "}
              <strong>{versionLabel}</strong>.
            </p>
          </div>

          <span className="cert-badge">
            {recipients.length} / 50 selected
          </span>
        </div>

        {recipients.length > 0 ? (
          <>
            <div className="cert-batch-names">
              {recipients.map((recipient) => (
                <div
                  key={recipient.registration_id}
                  className="cert-batch-name"
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
                      value={recipient.participant_name}
                      maxLength={200}
                      placeholder="Enter the participant’s full name"
                      disabled={busy}
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
              ))}
            </div>

            {invalidNames && (
              <small>
                Enter a full name for every selected
                participant. Names must contain
                between 1 and 200 characters.
              </small>
            )}

            {dirty && (
              <small>
                Save your template changes before
                generating a batch.
              </small>
            )}

            <div className="cert-batch-actions">
              <button
                type="button"
                className="cert-primary"
                disabled={
                  busy ||
                  dirty ||
                  invalidNames ||
                  recipients.length > 50
                }
                onClick={generate}
              >
                Generate draft batch
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={onClear}
              >
                Clear selection
              </button>
            </div>
          </>
        ) : (
          <p>
            No participants selected. Use the Batch
            checkboxes above.
          </p>
        )}

        <small>
          Eligibility is checked again during
          generation. Drafts remain private and are
          not issued to students.
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
                No certificate batches have been
                generated yet.
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
                        <td>
                          {formatDate(item.created_at)}
                        </td>

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
                            onClick={() =>
                              openBatch(item.id)
                            }
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
                    busy || request.page === 1
                  }
                  onClick={() =>
                    refreshBatches(request.page - 1)
                  }
                >
                  Previous
                </button>

                <button
                  type="button"
                  disabled={busy || !data?.next}
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
              information from generation time.
              Editing a name does not change an
              existing batch.
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
                    Open{" "}
                    {certificate.participant_name}
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

            {batch.status === "published" && (
              <section style={{ marginTop: 24 }}>
                <h3>Issued certificates</h3>

                <p className="cert-help">
                  Share the verification link or
                  revoke a certificate that needs
                  correction.
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