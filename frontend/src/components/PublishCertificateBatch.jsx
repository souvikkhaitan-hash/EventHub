import { useEffect, useRef, useState } from "react";

import { publishCertificateBatch } from "../services/events";
export default function PublishCertificateBatch({
  batch,
  busy,
  runOperation,
  onPublished,
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const aliveRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  function publish() {
    if (
      busy ||
      !confirmed ||
      !batch.review_hash ||
      batch.status !== "draft"
    ) {
      return;
    }

    setError("");

    runOperation(async () => {
      try {
        const published = await publishCertificateBatch(
          batch.id,
          batch.review_hash
        );

        if (!aliveRef.current) return;

        onPublished(published);
      } catch (requestError) {
        if (aliveRef.current) {
          setError(
            requestError.message || "Unable to publish this batch."
          );
        }

        throw requestError;
      }
    });
  }

  if (batch.status === "published") {
    return (
      <div className="cert-message cert-success" role="status">
        <strong>Published successfully.</strong>
        <div>
          Students can now open their certificates in My Registrations.
          The final PDFs have no draft label.
        </div>
      </div>
    );
  }

  return (
    <div className="cert-publication-panel">
      <h3>Publish these certificates</h3>

      <p>
        Publication releases this saved batch to its participants.
        Attendance and eligibility will be checked again.
      </p>

      <label className="cert-review-confirmation">
        <input
          className="cert-batch-checkbox"
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />

        <span>
          I reviewed the participant names and certificate PDFs
          in this batch.
        </span>
      </label>

      <button
        type="button"
        className="cert-primary"
        disabled={busy || !confirmed || !batch.review_hash}
        onClick={publish}
      >
        Publish {batch.certificate_count} certificates
      </button>

      {!batch.review_hash && (
        <small>
          Reopen this batch to load its latest review information.
        </small>
      )}

      {error && (
        <div className="cert-message cert-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}