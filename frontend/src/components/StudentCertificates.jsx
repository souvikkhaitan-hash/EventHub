import {
  useEffect,
  useRef,
  useState,
} from "react";

import { Link } from "react-router";

import {
  getMyCertificateDocument,
  getMyCertificates,
} from "../services/events";

import "../styles/my-registrations-editorial.css";

function publishedDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function CertificateIcon() {
  return (
    <svg
      viewBox="0 0 64 76"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="4"
        width="43"
        height="59"
        rx="6"
        stroke="#192b71"
        strokeWidth="2.5"
      />

      <path
        d="M18 19h25M18 28h25M18 37h18"
        stroke="#192b71"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      <path
        d="m39 58-3 13 9-5 8 5-3-13"
        fill="#e9bd51"
      />

      <circle
        cx="45"
        cy="54"
        r="10"
        fill="#ffe5a0"
        stroke="#b98521"
        strokeWidth="2"
      />

      <circle
        cx="45"
        cy="54"
        r="5"
        stroke="#b98521"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function StudentCertificates() {
  const [request, setRequest] = useState({
    page: 1,
    revision: 0,
  });

  const [result, setResult] = useState({
    request: null,
    data: null,
    error: "",
  });

  const [openingId, setOpeningId] = useState(null);
  const [fileError, setFileError] = useState("");
  const [preview, setPreview] = useState(null);

  const alive = useRef(false);
  const busy = useRef(false);
  const viewer = useRef(null);

  const loading = result.request !== request;
  const data = loading ? null : result.data;
  const certificates = data?.results || [];

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    getMyCertificates(
      request.page,
      controller.signal
    )
      .then((response) => {
        if (
          !response ||
          !Array.isArray(response.results)
        ) {
          throw new Error(
            "Unable to read your certificates."
          );
        }

        if (active) {
          setResult({
            request,
            data: response,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (
          active &&
          error.name !== "AbortError"
        ) {
          setResult({
            request,
            data: null,
            error:
              error.message ||
              "Unable to load certificates.",
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [request]);

  // Release the previous PDF URL when replaced or closed.
  useEffect(() => {
    return () => {
      if (preview?.url) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview?.url]);

  useEffect(() => {
    if (!preview) return;

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    viewer.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [preview]);

  function loadPage(page) {
    if (
      busy.current ||
      loading ||
      page < 1
    ) {
      return;
    }

    setPreview(null);
    setFileError("");

    setRequest((previous) => ({
      page,
      revision: previous.revision + 1,
    }));
  }

  async function openCertificate(certificate) {
    if (busy.current) return;

    busy.current = true;

    setOpeningId(certificate.id);
    setFileError("");
    setPreview(null);

    try {
      const blob = await getMyCertificateDocument(
        certificate.id
      );

      if (alive.current) {
        setPreview({
          url: URL.createObjectURL(blob),
          certificate,
        });
      }
    } catch (error) {
      if (alive.current) {
        setFileError(
          error.message ||
          "Unable to open this certificate."
        );
      }
    } finally {
      busy.current = false;

      if (alive.current) {
        setOpeningId(null);
      }
    }
  }

  return (
    <section
      className="sc-section"
      id="my-certificates"
      aria-labelledby="sc-title"
      aria-busy={loading}
    >
      <div className="mr-section-heading">
        <div>
          <h2 id="sc-title">
            Your certificates.
          </h2>

          <p>
            Published certificates are ready
            to open and share.
          </p>
        </div>

        <button
          className="mr-button mr-button--outline"
          type="button"
          disabled={loading || openingId !== null}
          onClick={() => loadPage(request.page)}
        >
          ↻ &nbsp; Refresh
        </button>
      </div>

      {loading ? (
        <div className="mr-empty" role="status">
          Loading your certificates…
        </div>
      ) : result.error ? (
        <div className="mr-empty" role="alert">
          <p>{result.error}</p>

          <button
            className="mr-button"
            onClick={() => loadPage(request.page)}
          >
            Retry
          </button>
        </div>
      ) : certificates.length === 0 ? (
        <div className="mr-empty">
          <h3>No published certificates yet.</h3>

          <p>
            Once an organiser publishes your
            certificate, you can open it here.
          </p>
        </div>
      ) : (
        <>
          <div className="sc-grid">
            {certificates.map((certificate) => (
              <article
                className="sc-card"
                key={certificate.id}
              >
                <div className="sc-icon">
                  <CertificateIcon />
                </div>

                <div className="sc-card-copy">
                  <div className="sc-tags">
                    <span>Published</span>

                    <span>
                      {certificate.certificate_type}
                    </span>
                  </div>

                  <h3>{certificate.event_name}</h3>

                  <strong>
                    {certificate.participant_name}
                  </strong>

                  <small>
                    {certificate.certificate_type}
                    {" · "}
                    {certificate.event_date}
                  </small>

                  {certificate.team_name && (
                    <small>
                      Team: {certificate.team_name}
                    </small>
                  )}

                  <small>
                    Published{" "}
                    {publishedDate(
                      certificate.published_at
                    )}
                  </small>
                </div>

                <div className="sc-actions">
                  <button
                    className="mr-button"
                    type="button"
                    disabled={openingId !== null}
                    onClick={() =>
                      openCertificate(certificate)
                    }
                    aria-label={`Open ${certificate.certificate_type} certificate for ${certificate.event_name}`}
                  >
                    {openingId === certificate.id
                      ? "Opening…"
                      : "Open certificate ↗"}
                  </button>

                  <Link
                    to={`/certificates/verify/${certificate.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Verify / share certificate ↗
                  </Link>
                </div>
              </article>
            ))}
          </div>

          <div className="sc-pagination">
            <small>
              {data.count}{" "}
              {data.count === 1
                ? "certificate"
                : "certificates"}
              {" · "}Page {request.page}
            </small>

            <div>
              <button
                className="mr-button mr-button--outline"
                type="button"
                disabled={
                  openingId !== null ||
                  request.page === 1
                }
                onClick={() =>
                  loadPage(request.page - 1)
                }
              >
                Previous
              </button>

              <button
                className="mr-button mr-button--outline"
                type="button"
                disabled={
                  openingId !== null ||
                  !data.next
                }
                onClick={() =>
                  loadPage(request.page + 1)
                }
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {fileError && (
        <p className="mr-error" role="alert">
          {fileError}
        </p>
      )}

      {preview && (
        <div className="sc-viewer" ref={viewer}>
          <div className="mr-section-heading">
            <div>
              <h3>
                {preview.certificate.event_name}
              </h3>

              <p>
                {preview.certificate.certificate_type}
                {" · "}
                {preview.certificate.participant_name}
              </p>
            </div>

            <button
              className="mr-button mr-button--outline"
              onClick={() => setPreview(null)}
              type="button"
            >
              Close preview
            </button>
          </div>

          <div className="sc-preview-actions">
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open PDF ↗
            </a>

            <a
              href={preview.url}
              download={`eventhub-certificate-${preview.certificate.id}.pdf`}
            >
              Download certificate
            </a>
          </div>

          <iframe
            src={preview.url}
            title={`${preview.certificate.certificate_type} certificate for ${preview.certificate.participant_name}`}
          />
        </div>
      )}
    </section>
  );
}