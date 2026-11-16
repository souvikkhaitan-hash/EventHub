import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { verifyCertificate } from "../services/events";
import "../styles/certificates.css";

const STATUS = {
  valid: {
    title: "Certificate verified.",
    message: "This certificate has an active issued record in EventHub.",
    color: "#176b35",
    background: "#edf8ee",
  },
  revoked: {
    title: "Certificate revoked.",
    message: "The organiser has revoked this certificate. It is no longer valid.",
    color: "#a52a23",
    background: "#fff1ef",
  },
  unavailable: {
    title: "Certificate unavailable.",
    message: "This record cannot currently be confirmed as valid.",
    color: "#805500",
    background: "#fff8e7",
  },
};

export default function VerifyCertificate() {
  const { certificateId } = useParams();
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setResult(null);

    verifyCertificate(certificateId, controller.signal)
      .then((data) => {
        if (active) setResult({ data });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;

        setResult({
          error:
            error.message ||
            "Unable to verify this certificate. Check the link and try again.",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [certificateId, revision]);

  const data = result?.data;
  const status = data ? STATUS[data.status] || STATUS.unavailable : null;

  return (
    <main
      className="cert-page"
      style={{
        maxWidth: 760,
        margin: "48px auto",
        padding: "0 20px",
      }}
    >
      <Link to="/" style={{ fontWeight: 700 }}>
        ← EventHub
      </Link>

      <section className="cert-card" style={{ marginTop: 24 }}>
        <p className="cert-eyebrow">CERTIFICATE VERIFICATION</p>

        {!result && (
          <p role="status">Checking the certificate record…</p>
        )}

        {result?.error && (
          <div role="alert">
            <h1>Verification unavailable.</h1>
            <p>{result.error}</p>

            <button
              type="button"
              className="cert-button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}

        {data && (
          <>
            <div
              role="status"
              style={{
                padding: 20,
                borderRadius: 12,
                color: status.color,
                background: status.background,
              }}
            >
              <h1 style={{ margin: "0 0 8px" }}>
                {status.title}
              </h1>
              <p style={{ margin: 0 }}>{status.message}</p>
            </div>

            <dl className="cert-verification-details">
              <dt>Participant</dt>
              <dd>{data.participant_name}</dd>

              <dt>Event</dt>
              <dd>{data.event_name}</dd>

              <dt>Certificate type</dt>
              <dd>{data.certificate_type}</dd>

              <dt>Event date</dt>
              <dd>{data.event_date || "—"}</dd>

              <dt>Published</dt>
              <dd>
                {data.published_at
                  ? new Date(data.published_at).toLocaleString()
                  : "—"}
              </dd>

              <dt>Certificate ID</dt>
              <dd style={{ overflowWrap: "anywhere" }}>
                {data.certificate_id}
              </dd>
            </dl>

            <p className="cert-help">
              Verification confirms the stored record. Compare these details
              with the certificate you received.
            </p>
          </>
        )}
      </section>
    </main>
  );
}