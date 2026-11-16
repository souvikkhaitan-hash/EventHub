import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import {
  getCertificateRevocation,
  revokeCertificate,
} from "../services/events";

export default function CertificateRevocation({
  certificateId,
  participantName,
  busy,
  runOperation,
}) {
  const [record, setRecord] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  const alive = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setRecord(null);
    setError("");

    getCertificateRevocation(certificateId, controller.signal)
      .then((data) => {
        if (active) setRecord(data);
      })
      .catch((failure) => {
        if (!active || controller.signal.aborted) return;
        setError(failure.message || "Unable to load certificate status.");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [certificateId, revision]);

  async function handleRevoke() {
    if (
      pending.current ||
      busy ||
      !record?.is_active ||
      !confirmed ||
      !reason.trim()
    ) {
      return;
    }

    pending.current = true;
    setError("");

    try {
      await runOperation(async () => {
        try {
          const updated = await revokeCertificate(certificateId, {
            reason: reason.trim(),
            issued_sha256: record.issued_sha256,
            confirm: true,
          });

          if (alive.current) {
            setRecord(updated);
            setConfirmed(false);
          }
        } catch (failure) {
          if (alive.current) {
            setError(
              failure.message || "Unable to revoke this certificate."
            );
          }
        }
      });
    } finally {
      pending.current = false;
    }
  }

  return (
    <section className="cert-revocation-panel">
      <div className="cert-revocation-heading">
        <strong>{participantName}</strong>

        <Link
          to={`/certificates/verify/${certificateId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Verify certificate ↗
        </Link>
      </div>

      {error && <p role="alert">{error}</p>}

      {!record && !error && (
        <p role="status">Loading certificate status…</p>
      )}

      {!record && error && (
        <button
          type="button"
          className="cert-button"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          Retry
        </button>
      )}

      {record?.revoked_at && (
        <div role="status">
          <p>
            <strong>Revoked</strong>
            {" · "}
            {new Date(record.revoked_at).toLocaleString()}
          </p>

          <p>Reason: {record.reason}</p>

          <p className="cert-help">
            Student downloads are blocked. The issued record and PDF
            remain preserved.
          </p>
        </div>
      )}

      {record && !record.is_active && !record.revoked_at && (
        <p>This certificate is inactive.</p>
      )}

      {record?.is_active && (
        <details>
          <summary>Revoke this certificate</summary>

          <p className="cert-help">
            Use this for an incorrect or withdrawn certificate.
            Revocation blocks future student downloads and updates
            its public verification status.
          </p>

          <label>
            Reason — visible only to the organiser
            <textarea
              value={reason}
              maxLength={500}
              rows={3}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this certificate needs to be revoked."
            />
          </label>

          <label className="cert-revocation-confirm">
            <input
              type="checkbox"
              className="cert-batch-checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I confirm that this certificate should be revoked.
            </span>
          </label>

          <button
            type="button"
            className="cert-button"
            disabled={busy || !confirmed || !reason.trim()}
            onClick={handleRevoke}
            style={{ color: "#a52a23" }}
          >
            Revoke certificate
          </button>
        </details>
      )}
    </section>
  );
}