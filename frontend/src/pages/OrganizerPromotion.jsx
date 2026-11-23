import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Link,
  useParams,
} from "react-router";

import { QRCodeCanvas } from "qrcode.react";

import {
  getOrganizerEvent,
} from "../services/events";

import {
  drawEventPoster,
} from "../utils/eventPoster";

import {
  drawCustomPoster,
  newDesign,
  validateDesign,
} from "../utils/posterDesign";

import "../styles/event-promotion.css";

const initialInvitation =
  "Join us for a campus experience worth showing up for.";

const titleFor = (text = "") =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(
      /([a-zA-Z])(\d{4})\b/g,
      "$1 $2"
    )
    .slice(0, 140);

const dateFor = (value) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = url;
  link.download = file.name;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(
    () => URL.revokeObjectURL(url),
    30000
  );
}

export default function OrganizerPromotion() {
  const { id } = useParams();

  return <Promotion key={id} id={id} />;
}

function Promotion({ id }) {
  const [event, setEvent] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [headline, setHeadline] = useState("");
  const [tagline, setTagline] = useState(
    initialInvitation
  );
  const [host, setHost] = useState("");

  const [mode, setMode] = useState("light");
  const [design, setDesign] = useState(newDesign);
  const [selected, setSelected] =
    useState("title");

  const [image, setImage] = useState(null);
  const [uploading, setUploading] =
    useState(false);

  const [asset, setAsset] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());

  const canvas = useRef(null);
  const qr = useRef(null);

  const alive = useRef(false);
  const uploadToken = useRef(0);
  const shareLock = useRef(false);

  const format = design.format;

  const block = design.blocks.find(
    (item) => item.id === selected
  );

  const url =
    `${window.location.origin}/events/` +
    encodeURIComponent(id);

  const hostname = window.location.hostname;

  const local =
    window.location.protocol !== "https:" ||
    /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]$)/.test(
      hostname
    ) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost");

  const ended =
    event &&
    now >= new Date(
      event.end_datetime
    ).getTime();

  const publicReady =
    event?.status === "published" &&
    !ended &&
    !local;

  const designKey = JSON.stringify([
    event,
    headline,
    tagline,
    host,
    mode,
    design,
    image?.token,
    Boolean(ended),
    local,
  ]);

  const currentAsset =
    asset?.key === designKey
      ? asset
      : null;

  const file =
    uploading
      ? null
      : currentAsset?.file;

  const caption = event
    ? [
        !publicReady ? "PREVIEW" : "",
        headline,
        tagline,
        host ? `Hosted by ${host}` : "",
        `${dateFor(event.start_datetime)} IST`,
        event.venue,

        event.status !== "published"
          ? "Registration is not open for this preview."
          : ended
            ? "This event has ended."
            : "View the event for registration details.",

        local
          ? "Local preview link — accessible only where this development server is reachable."
          : "",

        event.status === "published"
          ? url
          : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  useEffect(() => {
    alive.current = true;

    const timer = window.setInterval(
      () => setNow(Date.now()),
      60000
    );

    return () => {
      alive.current = false;
      uploadToken.current++;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    setError("");

    getOrganizerEvent(id)
      .then((data) => {
        if (!active) return;

        setEvent(data);
        setHeadline(titleFor(data.title));
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError.message ||
              "Unable to load this event."
          );
        }
      });

    return () => {
      active = false;
    };
  }, [id, retry]);

  useEffect(() => {
    if (!event) return;

    let active = true;

    const frame =
      window.requestAnimationFrame(() => {
        try {
          const options = {
            event,
            headline,
            tagline,
            host,
            format,
            palette: mode,
            local,
            cover: image?.element,
            now,
          };

          const qrCanvas =
            qr.current?.querySelector("canvas");

          if (mode === "custom") {
            drawCustomPoster(
              canvas.current,
              qrCanvas,
              options,
              design
            );
          } else {
            drawEventPoster(
              canvas.current,
              qrCanvas,
              options
            );
          }

          canvas.current.toBlob((blob) => {
            if (!active) return;

            if (!blob) {
              setAsset({
                key: designKey,
                error:
                  "PNG export failed. Try again.",
              });
              return;
            }

            setAsset({
              key: designKey,
              file: new File(
                [blob],
                `eventhub-${id}-${format}.png`,
                { type: "image/png" }
              ),
            });
          }, "image/png");
        } catch (renderError) {
          if (active) {
            setAsset({
              key: designKey,
              error:
                renderError.message ||
                "Unable to render this poster.",
            });
          }
        }
      });

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [
    designKey,
    event,
    headline,
    tagline,
    host,
    format,
    mode,
    design,
    image,
    local,
    now,
    id,
  ]);

  function customise() {
    if (mode === "custom") return;

    setDesign({
      ...newDesign(mode === "dark"),
      format,
    });

    setSelected("title");
    setMode("custom");
  }

  function changeBlock(field, value) {
    setDesign((previous) => ({
      ...previous,

      blocks: previous.blocks.map((item) => {
        if (item.id !== selected) {
          return item;
        }

        const next = {
          ...item,
          [field]: value,
        };

        next.w = Math.min(
          next.w,
          100 - next.x
        );

        const canvasHeight =
          previous.format === "story"
            ? 1920
            : 1350;

        const maximumY =
          94 -
          (
            next.kind === "qr"
              ? next.w * 1080 / canvasHeight
              : next.h
          );

        next.y = Math.max(
          0,
          Math.min(next.y, maximumY)
        );

        return next;
      }),
    }));
  }

  function changeFormat(value) {
    setDesign((previous) => ({
      ...previous,
      format: value,

      blocks: previous.blocks.map((item) => {
        const canvasHeight =
          value === "story"
            ? 1920
            : 1350;

        const maximumY =
          94 -
          (
            item.kind === "qr"
              ? item.w * 1080 / canvasHeight
              : item.h
          );

        return {
          ...item,
          y: Math.min(item.y, maximumY),
        };
      }),
    }));
  }

  async function importDesign(change) {
    const chosen =
      change.target.files?.[0];

    change.target.value = "";

    if (!chosen) return;

    try {
      if (chosen.size > 65536) {
        throw new Error(
          "Design JSON must be under 64 KB."
        );
      }

      const imported = validateDesign(
        JSON.parse(await chosen.text())
      );

      if (!alive.current) return;

      setDesign(imported);
      setSelected(imported.blocks[0].id);
      setMode("custom");

      setNotice(
        "Layout imported. It uses this event’s details. Images are added separately."
      );
    } catch (importError) {
      if (alive.current) {
        setNotice(
          importError.message ||
            "Unable to import this design."
        );
      }
    }
  }

  async function importImage(change) {
    const chosen =
      change.target.files?.[0];

    change.target.value = "";

    if (!chosen) return;

    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
      ].includes(chosen.type) ||
      chosen.size > 8 * 1024 * 1024
    ) {
      setNotice(
        "Choose a JPG, PNG or WebP under 8 MB."
      );
      return;
    }

    const token = ++uploadToken.current;
    const imageUrl =
      URL.createObjectURL(chosen);

    setUploading(true);

    try {
      const element = new Image();

      await new Promise((resolve, reject) => {
        element.onload = resolve;

        element.onerror = () => {
          reject(
            new Error(
              "Unable to open this image."
            )
          );
        };

        element.src = imageUrl;
      });

      if (
        element.width * element.height >
        20000000
      ) {
        throw new Error(
          "Use an image under 20 megapixels."
        );
      }

      if (
        alive.current &&
        token === uploadToken.current
      ) {
        setImage({
          element,
          token,
        });
      }
    } catch (imageError) {
      if (
        alive.current &&
        token === uploadToken.current
      ) {
        setNotice(imageError.message);
      }
    } finally {
      URL.revokeObjectURL(imageUrl);

      if (
        alive.current &&
        token === uploadToken.current
      ) {
        setUploading(false);
      }
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(
        caption
      );

      if (alive.current) {
        setNotice(
          "Caption and event link copied."
        );
      }
    } catch {
      if (alive.current) {
        setNotice(
          "Open the caption below, select it and copy manually."
        );
      }
    }
  }

  async function shareImage() {
    if (!file || shareLock.current) return;

    if (
      !navigator.share ||
      !navigator.canShare?.({
        files: [file],
      })
    ) {
      saveFile(file);

      setNotice(
        "Image downloaded. Attach it in WhatsApp or Instagram; this browser does not support image sharing."
      );

      return;
    }

    shareLock.current = true;
    setSharing(true);

    try {
      await navigator.share({
        files: [file],
        title: headline,
        text: caption,
      });
    } catch (shareError) {
      if (
        alive.current &&
        shareError.name !== "AbortError"
      ) {
        setNotice(
          "Share did not complete. Use Download PNG and attach the image manually."
        );
      }
    } finally {
      shareLock.current = false;

      if (alive.current) {
        setSharing(false);
      }
    }
  }

  function addText() {
    const extra = {
      ...newDesign().blocks[1],
      id: `text-${Date.now()}`,
      kind: "text",
      text: "Your text",
      y: 62,
      h: 10,
    };

    setDesign({
      ...design,
      blocks: [...design.blocks, extra],
    });

    setSelected(extra.id);
  }

  function removeText() {
    setDesign({
      ...design,
      blocks: design.blocks.filter(
        (item) => item.id !== selected
      ),
    });

    setSelected(
      design.blocks.find(
        (item) => item.kind === "headline"
      ).id
    );
  }

  function exportDesign() {
    const validated =
      validateDesign(design);

    saveFile(
      new File(
        [
          JSON.stringify(
            validated,
            null,
            2
          ),
        ],
        "eventhub-poster-design.json",
        { type: "application/json" }
      )
    );
  }

  const positionControls = block
    ? [
        [
          "x",
          "Horizontal position",
          0,
          100 - block.w,
        ],
        [
          "y",
          "Vertical position",
          0,
          93,
        ],
        [
          "w",
          "Width",
          block.kind === "qr" ? 18 : 5,
          Math.min(
            block.kind === "qr" ? 30 : 100,
            100 - block.x
          ),
        ],

        ...(
          block.kind === "qr"
            ? []
            : [
                ["h", "Height", 3, 90],
                ["size", "Text size", 16, 140],
              ]
        ),
      ]
    : [];

  return (
    <section className="ep-page ep-studio">
      <Link
        className="ep-back"
        to={`/organizer/events/${id}/workspace`}
      >
        ← Event workspace
      </Link>

      <header className="ep-heading">
        <div>
          <span className="ep-eyebrow">
            EVENT PROMOTION
          </span>

          <h1>Create your event poster.</h1>

          <p>
            Choose a style or build your own.
            Preview, download and share.
          </p>
        </div>

        {event && (
          <Link
            className="ep-button"
            to={`/organizer/events/${id}/edit`}
          >
            Edit event details ↗
          </Link>
        )}
      </header>

      {error && (
        <p role="alert">
          {error}{" "}

          <button
            type="button"
            onClick={() => {
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}

      {!event && !error && (
        <p role="status">Loading event…</p>
      )}

      {event && (
        <>
          <div className="ep-event-strip">
            <strong>{event.title}</strong>

            <span>
              {event.status}
              {ended ? " · Ended" : ""}
            </span>
          </div>

          {!publicReady && (
            <p className="ep-preview-note">
              Preview mode.{" "}

              {local &&
                "The QR points to your local server, not the public website. "}

              {ended &&
                "This event has ended. "}

              {event.status !== "published"
                ? "This preview does not open registrations."
                : local
                  ? "Export from the live site for a public event link."
                  : ""}
            </p>
          )}

          <div className="ep-grid">
            <div className="ep-editor-column">
              <section className="ep-card">
                <h2>1. Content</h2>

                <label className="ep-field">
                  Headline

                  <input
                    maxLength={140}
                    value={headline}
                    onChange={(change) => {
                      setHeadline(
                        change.target.value
                      );
                    }}
                  />
                </label>

                <label className="ep-field">
                  Invitation

                  <textarea
                    maxLength={110}
                    rows={2}
                    value={tagline}
                    onChange={(change) => {
                      setTagline(
                        change.target.value
                      );
                    }}
                  />
                </label>

                <label className="ep-field">
                  Hosted by · optional

                  <input
                    maxLength={60}
                    value={host}
                    onChange={(change) => {
                      setHost(
                        change.target.value
                      );
                    }}
                  />
                </label>

                <p className="ep-help">
                  Date and venue come from the
                  event. Times use IST.
                </p>
              </section>

              <section className="ep-card">
                <h2>2. Design</h2>

                <label className="ep-field">
                  Size

                  <select
                    value={format}
                    onChange={(change) => {
                      changeFormat(
                        change.target.value
                      );
                    }}
                  >
                    <option value="feed">
                      Portrait post · 1080 × 1350
                    </option>

                    <option value="story">
                      Story · 1080 × 1920
                    </option>
                  </select>
                </label>

                <div
                  className="ep-share-actions"
                  role="group"
                  aria-label="Design style"
                >
                  {[
                    ["light", "Editorial"],
                    ["dark", "Midnight"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={
                        mode === value
                      }
                      onClick={() => {
                        setMode(value);
                      }}
                    >
                      {label}
                    </button>
                  ))}

                  <button
                    type="button"
                    aria-pressed={
                      mode === "custom"
                    }
                    onClick={customise}
                  >
                    Custom design
                  </button>
                </div>

                <label className="ep-field">
                  {mode === "custom"
                    ? "Background / imported poster image"
                    : "Optional poster photo"}

                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploading}
                    onChange={importImage}
                  />
                </label>

                {uploading && (
                  <p role="status">
                    Preparing image…
                  </p>
                )}

                {image && (
                  <button
                    type="button"
                    onClick={() => {
                      uploadToken.current++;
                      setImage(null);
                      setUploading(false);
                    }}
                  >
                    Remove image
                  </button>
                )}

                <p className="ep-help">
                  Images are centre-cropped.
                  Text inside an imported image
                  is not separately editable.
                </p>

                {mode === "custom" && (
                  <>
                    <div className="ep-custom-grid">
                      <label className="ep-field">
                        Background

                        <input
                          type="color"
                          value={
                            design.background
                          }
                          onChange={(change) => {
                            setDesign({
                              ...design,
                              background:
                                change.target.value,
                            });
                          }}
                        />
                      </label>

                      <label className="ep-field">
                        Accent

                        <input
                          type="color"
                          value={design.accent}
                          onChange={(change) => {
                            setDesign({
                              ...design,
                              accent:
                                change.target.value,
                            });
                          }}
                        />
                      </label>
                    </div>

                    {image && (
                      <label className="ep-field">
                        Background tint ·{" "}
                        {design.overlay}%

                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={design.overlay}
                          onChange={(change) => {
                            setDesign({
                              ...design,
                              overlay: Number(
                                change.target.value
                              ),
                            });
                          }}
                        />
                      </label>
                    )}

                    <label className="ep-field">
                      Edit block

                      <select
                        value={selected}
                        onChange={(change) => {
                          setSelected(
                            change.target.value
                          );
                        }}
                      >
                        {design.blocks.map(
                          (item) => (
                            <option
                              key={item.id}
                              value={item.id}
                            >
                              {item.kind === "text"
                                ? item.text.slice(
                                    0,
                                    25
                                  ) || "Custom text"
                                : item.kind}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    {block && (
                      <>
                        <div className="ep-custom-grid">
                          {positionControls.map(
                            ([
                              field,
                              label,
                              minimum,
                              maximum,
                            ]) => (
                              <label
                                className="ep-field"
                                key={field}
                              >
                                {label}

                                <input
                                  type="range"
                                  min={minimum}
                                  max={maximum}
                                  step="1"
                                  value={
                                    block[field]
                                  }
                                  onChange={(
                                    change
                                  ) => {
                                    changeBlock(
                                      field,
                                      Number(
                                        change
                                          .target
                                          .value
                                      )
                                    );
                                  }}
                                />

                                <small>
                                  {Math.round(
                                    block[field]
                                  )}
                                  {field === "size"
                                    ? " px"
                                    : "%"}
                                </small>
                              </label>
                            )
                          )}

                          {block.kind !== "qr" && (
                            <label className="ep-field">
                              Text colour

                              <input
                                type="color"
                                value={
                                  block.colour
                                }
                                onChange={(
                                  change
                                ) => {
                                  changeBlock(
                                    "colour",
                                    change.target
                                      .value
                                  );
                                }}
                              />
                            </label>
                          )}
                        </div>

                        {![
                          "headline",
                          "qr",
                        ].includes(block.kind) && (
                          <label className="ep-check">
                            <input
                              type="checkbox"
                              checked={
                                block.visible
                              }
                              onChange={(
                                change
                              ) => {
                                changeBlock(
                                  "visible",
                                  change.target
                                    .checked
                                );
                              }}
                            />

                            Show this block
                          </label>
                        )}

                        {block.kind === "text" && (
                          <label className="ep-field">
                            Custom text

                            <textarea
                              rows={2}
                              maxLength={300}
                              value={block.text}
                              onChange={(
                                change
                              ) => {
                                changeBlock(
                                  "text",
                                  change.target
                                    .value
                                );
                              }}
                            />
                          </label>
                        )}
                      </>
                    )}

                    <div className="ep-share-actions">
                      <button
                        type="button"
                        disabled={
                          design.blocks.length >=
                          16
                        }
                        onClick={addText}
                      >
                        + Add text
                      </button>

                      {block?.kind === "text" && (
                        <button
                          type="button"
                          onClick={removeText}
                        >
                          Remove selected text
                        </button>
                      )}
                    </div>
                  </>
                )}

                <details className="ep-caption">
                  <summary>
                    Save or import a reusable layout
                  </summary>

                  <p className="ep-help">
                    EventHub JSON keeps block
                    positions, colours and custom
                    text. Photos and the event-specific
                    headline, invitation and host
                    are not included.
                  </p>

                  <button
                    type="button"
                    disabled={
                      mode !== "custom" ||
                      Boolean(
                        currentAsset?.error
                      )
                    }
                    onClick={exportDesign}
                  >
                    Save design JSON
                  </button>

                  <label className="ep-field">
                    Import EventHub design

                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={importDesign}
                    />
                  </label>
                </details>
              </section>

              <section className="ep-card">
                <h2>3. Share</h2>

                <div className="ep-share-actions">
                  <button
                    type="button"
                    disabled={
                      !file || sharing
                    }
                    onClick={shareImage}
                  >
                    {sharing
                      ? "Opening…"
                      : publicReady
                        ? "Share image"
                        : "Share preview image"}
                  </button>

                  <a
                    className="ep-button"
                    href={
                      "https://wa.me/?text=" +
                      encodeURIComponent(caption)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {publicReady
                      ? "WhatsApp link ↗"
                      : "WhatsApp preview ↗"}
                  </a>

                  <button
                    type="button"
                    onClick={copyCaption}
                  >
                    Copy caption & link
                  </button>
                </div>

                <p className="ep-help">
                  WhatsApp opens a message you
                  choose to send. To include the
                  PNG, use Share image or attach
                  the download. For Instagram,
                  download the post/story image
                  and copy its caption.
                </p>

                <details className="ep-caption">
                  <summary>View caption</summary>

                  <textarea
                    aria-label="Event caption"
                    readOnly
                    rows={8}
                    value={caption}
                    onFocus={(focus) => {
                      focus.target.select();
                    }}
                  />
                </details>
              </section>
            </div>

            <aside
              className="ep-preview-column"
              aria-label="Poster preview"
            >
              <div className="ep-preview-top">
                <h2>Live preview</h2>

                <span>
                  1080 ×{" "}
                  {format === "story"
                    ? "1920"
                    : "1350"}
                </span>
              </div>

              <div className="ep-canvas-wrap">
                <canvas
                  ref={canvas}
                  role="img"
                  aria-label={
                    `Poster for ${event.title}`
                  }
                  style={{
                    visibility:
                      currentAsset?.error
                        ? "hidden"
                        : "visible",
                  }}
                />
              </div>

              <p className="ep-help">
                {currentAsset?.error ||
                  (
                    file
                      ? "PNG ready. Check text, contrast and QR before sharing."
                      : "Preparing preview…"
                  )}
              </p>

              <button
                className="ep-primary"
                type="button"
                disabled={!file || sharing}
                onClick={() => {
                  saveFile(file);

                  setNotice(
                    "PNG download requested."
                  );
                }}
              >
                Download{" "}
                {publicReady
                  ? "PNG"
                  : "preview PNG"}{" "}
                ↓
              </button>

              {currentAsset?.error && (
                <p
                  className="ep-feedback"
                  role="alert"
                >
                  {currentAsset.error}
                </p>
              )}

              {notice && (
                <p
                  className="ep-feedback"
                  role="status"
                >
                  {notice}
                </p>
              )}

              <p className="ep-help">
                Your edits affect this poster
                only. Save the JSON to reuse
                your custom layout.
              </p>
            </aside>
          </div>

          <div
            ref={qr}
            hidden
            aria-hidden="true"
          >
            <QRCodeCanvas
              value={url}
              size={300}
              level="M"
              marginSize={4}
            />
          </div>
        </>
      )}
    </section>
  );
}