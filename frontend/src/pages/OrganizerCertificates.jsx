import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import CertificateImages, {
  CertificateImageLayer,
} from "../components/CertificateImages";

import CertificateDelivery from "../components/CertificateDelivery";
import CertificateBatches from "../components/CertificateBatches";

import CertificateStudio, {
  CertificateStudioNav,
  CertificateStudioPanel,
  CertificateTextSize,
  CertificateAlignment,
} from "../components/CertificateStudio";

import {
  generateCertificatePreview,
  getCertificateBackground,
  getCertificateTemplates,
  getOrganizerEvent,
  saveCertificateLayout,
  uploadCertificateTemplate,
} from "../services/events";

import "../styles/certificates.css";
import "../styles/certificate-studio.css";

const PLACEHOLDERS = [
  "participant_name",
  "event_name",
  "event_date",
  "team_name",
  "position",
  "certificate_type",
  "organizer_name",
  "certificate_id",
  "issue_date",
];

const FIELD_LABELS = {
  participant_name: "Participant name",
  event_name: "Event name",
  event_date: "Event date",
  team_name: "Team name",
  position: "Award / position",
  certificate_type: "Certificate type",
  organizer_name: "Organizer name",
  certificate_id: "Certificate ID",
  issue_date: "Issue date",
};

const FONT_OPTIONS = [
  ["sans", "Sans regular"],
  ["sans-bold", "Sans bold"],
  ["sans-italic", "Sans italic"],
  ["sans-bold-italic", "Sans bold italic"],
  ["script-allura-v1", "Allura script"],
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeField(field) {
  const width = clamp(field.width ?? 0.8, 0.01, 1);
  const height = clamp(field.height ?? 0.08, 0.01, 1);
  const fontSize = clamp(field.font_size ?? 28, 8, 96);

  return {
    ...field,
    placeholder: field.placeholder ?? "participant_name",
    width,
    height,
    x: clamp(field.x ?? 0.1, 0, 1 - width),
    y: clamp(field.y ?? 0.45, 0, 1 - height),
    font_size: fontSize,
    min_font_size: clamp(
      field.min_font_size ?? 8,
      8,
      fontSize
    ),
    font: field.font ?? "sans",
    align: field.align ?? "center",
    color: field.color ?? "#18191d",
    text: field.text ?? "",
    line_spacing: clamp(field.line_spacing ?? 1.25, 1, 2),
    valign: field.valign ?? "middle",
  };
}

function newField(index) {
  return normalizeField({
    placeholder: "participant_name",
    x: 0.1,
    y: Math.min(0.1 + index * 0.1, 0.8),
    width: 0.8,
    height: 0.08,
  });
}

function copyFields(version) {
  return (version?.fields || []).map((field) =>
    normalizeField({ ...field })
  );
}

function copyImages(version) {
  return (version?.images || []).map((image) => ({
    ...image,
    rotation: Number(image.rotation ?? 0),
  }));
}

function latestVersion(template) {
  return [...(template?.versions || [])].sort(
    (first, second) => second.number - first.number
  )[0];
}

function fieldLabel(field) {
  return field.text?.trim()
    ? "Text block"
    : FIELD_LABELS[field.placeholder] || "Dynamic field";
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  step = 1,
  suffix = "",
  disabled,
  onChange,
}) {
  return (
    <label className="cert-control">
      <span>
        {label}
        <strong>
          {Number(value.toFixed(2))}
          {suffix}
        </strong>
      </span>

      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(Number(event.target.value))
        }
      />
    </label>
  );
}

function SelectControl({
  label,
  value,
  options,
  disabled,
  onChange,
}) {
  return (
    <label>
      {label}

      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function CertificateEditor({ eventId }) {
  const [event, setEvent] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [version, setVersion] = useState(null);

  const [fields, setFields] = useState([]);
  const [selected, setSelected] = useState(0);

  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(0);
  const [editMode, setEditMode] = useState("text");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [templateName, setTemplateName] = useState("");
  const [upload, setUpload] = useState(null);
  const [sampleName, setSampleName] = useState("Alex Morgan");

  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const paperRef = useRef(null);
  const uploadInputRef = useRef(null);
  const dragRef = useRef(null);
  const operationRef = useRef(false);
  const aliveRef = useRef(false);

  const versionId = version?.id ?? null;

  const template = templates.find(
    (item) => item.id === version?.templateId
  );

  const newest = template ? latestVersion(template) : null;
  const isLatest = Boolean(
    version && newest?.id === version.id
  );

  const editable = Boolean(version && isLatest && !busy);
  const selectedField = fields[selected];
  const hasTextBlock = Boolean(selectedField?.text?.trim());

  const paperAspect = version
    ? version.image_width / version.image_height
    : 1.414;

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [eventResult, templateResult] = await Promise.all([
          getOrganizerEvent(eventId),
          getCertificateTemplates(eventId),
        ]);

        if (!active) return;

        setEvent(eventResult);
        setTemplates(templateResult);

        const firstTemplate = templateResult[0];
        const firstVersion = latestVersion(firstTemplate);

        if (firstTemplate && firstVersion) {
          setVersion({
            ...firstVersion,
            templateId: firstTemplate.id,
          });

          setFields(copyFields(firstVersion));
          setImages(copyImages(firstVersion));
        }
      } catch (err) {
        if (active) {
          setError(
            err.message ||
              "Unable to load the certificate workspace."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (versionId === null) return;

    const controller = new AbortController();
    let active = true;
    let objectUrl = "";

    async function loadBackground() {
      try {
        const blob = await getCertificateBackground(
          versionId,
          controller.signal
        );

        if (!active) return;

        objectUrl = URL.createObjectURL(blob);
        setBackgroundUrl(objectUrl);
      } catch (err) {
        if (active && err.name !== "AbortError") {
          setError(
            err.message ||
              "Unable to load the certificate artwork."
          );
        }
      }
    }

    loadBackground();

    return () => {
      active = false;
      controller.abort();

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [versionId]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!dirty) return;

    function warnBeforeLeaving(browserEvent) {
      browserEvent.preventDefault();
      browserEvent.returnValue = "";
    }

    window.addEventListener(
      "beforeunload",
      warnBeforeLeaving
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        warnBeforeLeaving
      );
    };
  }, [dirty]);

  function confirmDiscard() {
    return (
      !dirty ||
      window.confirm("Discard the unsaved layout changes?")
    );
  }

  function applyVersion(targetTemplate, targetVersion) {
    const nextVersionId = targetVersion?.id ?? null;

    if (nextVersionId !== versionId) {
      setBackgroundUrl("");
    }

    setVersion(
      targetVersion
        ? {
            ...targetVersion,
            templateId: targetTemplate.id,
          }
        : null
    );

    setFields(copyFields(targetVersion));
    setImages(copyImages(targetVersion));

    setSelected(0);
    setSelectedImage(0);
    setEditMode("text");

    setPreviewUrl("");
    setDirty(false);
    setError("");
    setNotice("");

    dragRef.current = null;
  }

  async function runOperation(action) {
    if (operationRef.current) return;

    operationRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await action();
    } catch (err) {
      if (aliveRef.current) {
        setError(
          err.message ||
            "The request could not be completed."
        );
      }
    } finally {
      operationRef.current = false;

      if (aliveRef.current) {
        setBusy(false);
      }
    }
  }

  function markLayoutChanged() {
    setDirty(true);
    setPreviewUrl("");
    setNotice("");
  }

  function changeField(index, changes) {
    if (!editable || operationRef.current) return;

    setFields((previous) =>
      previous.map((field, fieldIndex) =>
        fieldIndex === index
          ? normalizeField({ ...field, ...changes })
          : field
      )
    );

    setEditMode("text");
    markLayoutChanged();
  }

  function changeImages(nextImages) {
    if (!editable || operationRef.current) return;

    setImages(nextImages);
    markLayoutChanged();
  }

  function selectTemplate(templateId) {
    if (busy || !confirmDiscard()) return;

    const target = templates.find(
      (item) => item.id === Number(templateId)
    );

    if (target) {
      applyVersion(target, latestVersion(target));
    }
  }

  function selectVersion(targetId) {
    if (busy || !template || !confirmDiscard()) return;

    const target = template.versions.find(
      (item) => item.id === Number(targetId)
    );

    if (target) {
      applyVersion(template, target);
    }
  }

  function changeMode(mode) {
    dragRef.current = null;
    setEditMode(mode);
  }

  function addField() {
    if (!editable || fields.length >= 20) return;

    setSelected(fields.length);
    setEditMode("text");

    setFields((previous) => [
      ...previous,
      newField(previous.length),
    ]);

    markLayoutChanged();
  }

  function removeField() {
    if (!editable || !selectedField) return;

    setFields((previous) =>
      previous.filter((_, index) => index !== selected)
    );

    setSelected(0);
    markLayoutChanged();
  }

  function startDrag(pointerEvent, index) {
    if (editMode !== "text") return;

    setSelected(index);

    if (
      !editable ||
      operationRef.current ||
      pointerEvent.button !== 0 ||
      !paperRef.current
    ) {
      return;
    }

    const bounds =
      paperRef.current.getBoundingClientRect();

    if (!bounds.width || !bounds.height) return;

    dragRef.current = {
      pointerId: pointerEvent.pointerId,
      index,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      originalX: fields[index].x,
      originalY: fields[index].y,
      paperWidth: bounds.width,
      paperHeight: bounds.height,
    };

    pointerEvent.currentTarget.setPointerCapture(
      pointerEvent.pointerId
    );
  }

  function moveDrag(pointerEvent) {
    const drag = dragRef.current;

    if (
      !editable ||
      editMode !== "text" ||
      !drag ||
      drag.pointerId !== pointerEvent.pointerId
    ) {
      return;
    }

    changeField(drag.index, {
      x:
        drag.originalX +
        (pointerEvent.clientX - drag.startX) /
          drag.paperWidth,
      y:
        drag.originalY +
        (pointerEvent.clientY - drag.startY) /
          drag.paperHeight,
    });
  }

  function endDrag(pointerEvent) {
    if (
      dragRef.current?.pointerId !==
      pointerEvent.pointerId
    ) {
      return;
    }

    dragRef.current = null;

    if (
      pointerEvent.currentTarget.hasPointerCapture(
        pointerEvent.pointerId
      )
    ) {
      pointerEvent.currentTarget.releasePointerCapture(
        pointerEvent.pointerId
      );
    }
  }

  function moveWithKeyboard(keyEvent, index) {
    if (!editable || editMode !== "text") return;

    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[keyEvent.key];

    if (!direction) return;

    keyEvent.preventDefault();

    const distance = keyEvent.shiftKey ? 0.01 : 0.002;

    changeField(index, {
      x: fields[index].x + direction[0] * distance,
      y: fields[index].y + direction[1] * distance,
    });
  }

  function handleUpload(formEvent) {
    formEvent.preventDefault();

    if (
      busy ||
      !upload ||
      !templateName.trim() ||
      !confirmDiscard()
    ) {
      return;
    }

    if (upload.size > 10 * 1024 * 1024) {
      setError(
        "Choose a PNG or JPG no larger than 10 MB."
      );
      return;
    }

    runOperation(async () => {
      const created = await uploadCertificateTemplate(
        eventId,
        templateName.trim(),
        upload
      );

      if (!aliveRef.current) return;

      setTemplates((previous) => [created, ...previous]);
      applyVersion(created, latestVersion(created));

      setTemplateName("");
      setUpload(null);

      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }

      setNotice(
        "Artwork uploaded. Add text or images to your certificate."
      );
    });
  }

  function handleSave() {
    if (!editable || !dirty || !template) return;

    runOperation(async () => {
      const saved = await saveCertificateLayout(
        template.id,
        version.number,
        fields,
        images
      );

      if (!aliveRef.current) return;

      const updatedTemplate = {
        ...template,
        versions: [saved, ...template.versions],
      };

      setTemplates((previous) =>
        previous.map((item) =>
          item.id === template.id
            ? updatedTemplate
            : item
        )
      );

      applyVersion(updatedTemplate, saved);

      setNotice(
        `Certificate layout saved as version ${saved.number}.`
      );
    });
  }

  function handlePreview() {
    if (busy || !version || !sampleName.trim()) return;

    runOperation(async () => {
      const blob = await generateCertificatePreview(
        version.id,
        sampleName.trim(),
        fields,
        images
      );

      if (!aliveRef.current) return;

      setPreviewUrl(URL.createObjectURL(blob));

      setNotice(
        "PDF preview generated using the current text and images."
      );
    });
  }

  function handleReload() {
    if (busy || !confirmDiscard()) return;

    runOperation(async () => {
      const result = await getCertificateTemplates(
        eventId
      );

      if (!aliveRef.current) return;

      setTemplates(result);

      const target =
        result.find((item) => item.id === template?.id) ||
        result[0];

      applyVersion(
        target,
        target ? latestVersion(target) : null
      );
    });
  }

  if (loading) {
    return (
      <div className="cert-page" role="status">
        Loading certificate workspace…
      </div>
    );
  }

  if (!event) {
    return (
      <div className="cert-page">
        <p role="alert">
          {error || "The event could not be loaded."}
        </p>

        <Link to="/organizer">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <CertificateStudio
      busy={busy}
      available={Boolean(template && version)}
    >
      <Link
        className="organizer-back-link"
        to={`/organizer/events/${eventId}/participants`}
        onClick={(clickEvent) => {
          if (busy || !confirmDiscard()) {
            clickEvent.preventDefault();
          }
        }}
      >
        ← Back to participants
      </Link>

      <header className="cert-header">
        <div>
          <span className="org-eyebrow">
            Certificate studio
          </span>

          <h1>
            Certificates<span>.</span>
          </h1>

          <p>{event.title}</p>
        </div>

        <span className="cert-badge">
          Templates & issuing
        </span>
      </header>

      <CertificateStudioNav />

      {error && (
        <div
          className="cert-message cert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="cert-message cert-success"
          role="status"
        >
          {notice}
        </div>
      )}

      <CertificateStudioPanel name="design">
        <details
          className="cert-card"
          open={templates.length === 0}
        >
          <summary>
            {templates.length === 0
              ? "Upload your first certificate background"
              : "Upload another certificate background"}
          </summary>

          <p>
            Upload your fixed artwork and wording.
            Leave participant names and editable
            paragraphs blank. Signatures and logos can
            be added separately in the Images panel.
          </p>

          <form
            className="cert-upload"
            onSubmit={handleUpload}
          >
            <label>
              Template name
              <input
                required
                maxLength={120}
                value={templateName}
                disabled={busy}
                placeholder="Workshop participation"
                onChange={(changeEvent) =>
                  setTemplateName(
                    changeEvent.target.value
                  )
                }
              />
            </label>

            <label>
              Background artwork
              <input
                ref={uploadInputRef}
                required
                type="file"
                accept="image/png,image/jpeg"
                disabled={busy}
                onChange={(changeEvent) =>
                  setUpload(
                    changeEvent.target.files?.[0] ||
                      null
                  )
                }
              />
            </label>

            <button
              type="submit"
              className="cert-primary"
              disabled={
                busy ||
                !upload ||
                !templateName.trim()
              }
            >
              Upload template
            </button>
          </form>

          <small>
            PNG/JPG · up to 10 MB · minimum 400 × 400
            pixels · maximum 6000 pixels per side and
            16 million pixels total
          </small>
        </details>

        {!template || !version ? (
          <section className="cert-card cert-empty">
            <h2>Your first certificate starts here.</h2>
            <p>
              Upload blank artwork to open the layout
              editor.
            </p>
          </section>
        ) : (
          <>
            <section className="cert-card cert-toolbar">
              <label>
                Template
                <select
                  value={template.id}
                  disabled={busy}
                  onChange={(changeEvent) =>
                    selectTemplate(
                      changeEvent.target.value
                    )
                  }
                >
                  {templates.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Saved version
                <select
                  value={version.id}
                  disabled={busy}
                  onChange={(changeEvent) =>
                    selectVersion(
                      changeEvent.target.value
                    )
                  }
                >
                  {[...template.versions]
                    .sort(
                      (first, second) =>
                        second.number - first.number
                    )
                    .map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                      >
                        Version {item.number}
                        {item.id === newest?.id
                          ? " · latest"
                          : ""}
                      </option>
                    ))}
                </select>
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={handleReload}
              >
                Reload
              </button>

              <button
                type="button"
                className="cert-primary"
                disabled={!editable || !dirty}
                onClick={handleSave}
              >
                Save new version
              </button>

              <span className="cert-status">
                {busy
                  ? "Working…"
                  : !isLatest
                    ? "Historical version · preview only"
                    : dirty
                      ? "Unsaved changes"
                      : "Saved"}
              </span>
            </section>

            <div
              className="cert-mode-toolbar"
              role="group"
              aria-label="Canvas editing mode"
            >
              <button
                type="button"
                className={
                  editMode === "text"
                    ? "cert-primary"
                    : ""
                }
                aria-pressed={editMode === "text"}
                disabled={busy}
                onClick={() => changeMode("text")}
              >
                Text
              </button>

              <button
                type="button"
                className={
                  editMode === "images"
                    ? "cert-primary"
                    : ""
                }
                aria-pressed={editMode === "images"}
                disabled={busy}
                onClick={() => changeMode("images")}
              >
                Images
              </button>

              <small>
                Choose Text or Images to display its
                editing controls.
              </small>
            </div>

            <div className="cert-editor-grid">
              <section className="cert-card cert-canvas-panel">
                <div className="cert-section-heading">
                  <h2>Your certificate</h2>

                  <button
                    type="button"
                    disabled={
                      !editable || fields.length >= 20
                    }
                    onClick={addField}
                  >
                    + Add text
                  </button>
                </div>

                <p>
                  Drag a box to move it. In Images
                  mode, drag the corner dot to resize.
                  Arrow keys move a focused box; hold
                  Shift for larger movements.
                </p>

                <div className="cert-paper-area">
                  {backgroundUrl ? (
                    <div
                      className={`cert-paper ${
                        editMode === "images"
                          ? "is-image-mode"
                          : ""
                      }`}
                      ref={paperRef}
                      style={{
                        "--page-ratio": paperAspect,
                      }}
                    >
                      <img
                        src={backgroundUrl}
                        alt="Uploaded certificate background"
                        draggable={false}
                      />

                      <CertificateImageLayer
                        images={images}
                        selected={selectedImage}
                        active={
                          editMode === "images" &&
                          editable
                        }
                        busy={busy}
                        paperRef={paperRef}
                        paperAspect={paperAspect}
                        onSelect={setSelectedImage}
                        onChange={changeImages}
                      />

                      {fields.map((field, index) => (
                        <button
                          key={index}
                          type="button"
                          className={`cert-field-box ${
                            editMode === "text" &&
                            selected === index
                              ? "is-selected"
                              : ""
                          }`}
                          aria-label={`${fieldLabel(
                            field
                          )}, field ${index + 1}`}
                          aria-pressed={
                            editMode === "text" &&
                            selected === index
                          }
                          tabIndex={
                            editMode === "text" ? 0 : -1
                          }
                          disabled={busy}
                          title={fieldLabel(field)}
                          style={{
                            left: `${field.x * 100}%`,
                            top: `${field.y * 100}%`,
                            width: `${field.width * 100}%`,
                            height: `${field.height * 100}%`,
                          }}
                          onClick={() => {
                            if (editMode === "text") {
                              setSelected(index);
                            }
                          }}
                          onPointerDown={(pointerEvent) =>
                            startDrag(pointerEvent, index)
                          }
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onLostPointerCapture={() => {
                            dragRef.current = null;
                          }}
                          onKeyDown={(keyEvent) =>
                            moveWithKeyboard(
                              keyEvent,
                              index
                            )
                          }
                        >
                          {index + 1}.{" "}
                          {fieldLabel(field)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p role="status">
                      Loading private artwork…
                    </p>
                  )}
                </div>

                <small>
                  Layout guides only. Generate a PDF
                  to check the final text and layout.
                </small>
              </section>

              <div className="cert-inspector">
                <aside
                  className="cert-card cert-controls"
                  hidden={editMode !== "text"}
                >
                  <h2>Text settings</h2>

                  {fields.length > 0 && (
                    <label>
                      Selected text
                      <select
                        value={selected}
                        disabled={busy}
                        onChange={(changeEvent) => {
                          setSelected(
                            Number(
                              changeEvent.target.value
                            )
                          );
                          setEditMode("text");
                        }}
                      >
                        {fields.map((field, index) => (
                          <option
                            key={index}
                            value={index}
                          >
                            {index + 1}.{" "}
                            {fieldLabel(field)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {selectedField ? (
                    <>
                      <SelectControl
                        label="Information to insert"
                        value={
                          selectedField.placeholder
                        }
                        options={PLACEHOLDERS.map(
                          (placeholder) => [
                            placeholder,
                            FIELD_LABELS[placeholder],
                          ]
                        )}
                        disabled={
                          !editable || hasTextBlock
                        }
                        onChange={(placeholder) =>
                          changeField(selected, {
                            placeholder,
                          })
                        }
                      />

                      <label>
                        Custom wording — optional
                        <textarea
                          rows={4}
                          maxLength={2000}
                          value={selectedField.text}
                          disabled={!editable}
                          placeholder={
                            "Leave empty for the selected information.\n\n" +
                            "{participant_name} participated in " +
                            "{event_name} on {event_date}."
                          }
                          onChange={(changeEvent) =>
                            changeField(selected, {
                              text:
                                changeEvent.target.value,
                            })
                          }
                        />
                      </label>

                      <small>
                        {hasTextBlock
                          ? "This box uses your custom wording. Clear it to use the information selector."
                          : "For fixed coordinator or signatory names, type their name in Custom wording."}
                      </small>

                      <SelectControl
                        label="Font"
                        value={selectedField.font}
                        options={FONT_OPTIONS}
                        disabled={!editable}
                        onChange={(font) =>
                          changeField(selected, { font })
                        }
                      />

                      <CertificateTextSize
                        label="Text size"
                        value={selectedField.font_size}
                        minimum={8}
                        maximum={96}
                        disabled={!editable}
                        onChange={(font_size) =>
                          changeField(selected, {
                            font_size,
                          })
                        }
                      />

                      <CertificateAlignment
                        label="Text alignment"
                        value={selectedField.align}
                        options={[
                          ["left", "Left"],
                          ["center", "Centre"],
                          ["right", "Right"],
                        ]}
                        disabled={!editable}
                        onChange={(align) =>
                          changeField(selected, { align })
                        }
                      />

                      <label>
                        Text colour
                        <input
                          type="color"
                          value={selectedField.color}
                          disabled={!editable}
                          onChange={(changeEvent) =>
                            changeField(selected, {
                              color:
                                changeEvent.target.value,
                            })
                          }
                        />
                      </label>

                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() =>
                          changeField(selected, {
                            x:
                              (1 -
                                selectedField.width) /
                              2,
                          })
                        }
                      >
                        Center box horizontally
                      </button>

                      <details>
                        <summary>
                          Advanced positioning
                        </summary>

                        {[
                          [
                            "x",
                            "Distance from left",
                            0,
                            (1 -
                              selectedField.width) *
                              100,
                          ],
                          [
                            "y",
                            "Distance from top",
                            0,
                            (1 -
                              selectedField.height) *
                              100,
                          ],
                          [
                            "width",
                            "Text box width",
                            1,
                            100,
                          ],
                          [
                            "height",
                            "Text box height",
                            1,
                            100,
                          ],
                        ].map(
                          ([
                            property,
                            label,
                            minimum,
                            maximum,
                          ]) => (
                            <RangeControl
                              key={property}
                              label={label}
                              value={
                                selectedField[
                                  property
                                ] * 100
                              }
                              minimum={minimum}
                              maximum={maximum}
                              step={0.1}
                              suffix="%"
                              disabled={!editable}
                              onChange={(value) =>
                                changeField(selected, {
                                  [property]:
                                    value / 100,
                                })
                              }
                            />
                          )
                        )}
                      </details>

                      <details>
                        <summary>
                          Advanced text settings
                        </summary>

                        <RangeControl
                          label="Smallest automatic text size"
                          value={
                            selectedField.min_font_size
                          }
                          minimum={8}
                          maximum={
                            selectedField.font_size
                          }
                          suffix=" pt"
                          disabled={!editable}
                          onChange={(min_font_size) =>
                            changeField(selected, {
                              min_font_size,
                            })
                          }
                        />

                        <small>
                          Long text can shrink to this
                          size to fit.
                        </small>

                        <RangeControl
                          label="Line spacing"
                          value={
                            selectedField.line_spacing
                          }
                          minimum={1}
                          maximum={2}
                          step={0.05}
                          disabled={
                            !editable || !hasTextBlock
                          }
                          onChange={(line_spacing) =>
                            changeField(selected, {
                              line_spacing,
                            })
                          }
                        />

                        <SelectControl
                          label="Vertical alignment in box"
                          value={selectedField.valign}
                          options={[
                            ["top", "Top"],
                            ["middle", "Middle"],
                            ["bottom", "Bottom"],
                          ]}
                          disabled={!editable}
                          onChange={(valign) =>
                            changeField(selected, {
                              valign,
                            })
                          }
                        />

                        <small>
                          {"Available placeholders: " +
                            PLACEHOLDERS.map(
                              (placeholder) =>
                                `{${placeholder}}`
                            ).join(", ")}
                        </small>
                      </details>

                      <button
                        type="button"
                        className="cert-remove"
                        disabled={!editable}
                        onClick={removeField}
                      >
                        Remove selected text
                      </button>
                    </>
                  ) : (
                    <p>
                      Click Add text to insert a name
                      or paragraph.
                    </p>
                  )}
                </aside>

                <div hidden={editMode !== "images"}>
                  <CertificateImages
                    key={template.id}
                    templateId={template.id}
                    images={images}
                    selected={selectedImage}
                    editable={editable}
                    busy={busy}
                    paperAspect={paperAspect}
                    onSelect={setSelectedImage}
                    onActivate={() =>
                      changeMode("images")
                    }
                    onChange={changeImages}
                    runOperation={runOperation}
                  />
                </div>
              </div>
            </div>

            <section className="cert-card">
              <div className="cert-section-heading">
                <div>
                  <h2>Check the actual PDF.</h2>
                  <p>
                    Preview your current text, image
                    sizes and rotation. Event
                    information comes from this event;
                    team and award values are still
                    samples.
                  </p>
                </div>

                <span className="cert-badge">
                  Sample only · not issued
                </span>
              </div>

              <div className="cert-preview-actions">
                <label>
                  Sample participant name
                  <input
                    maxLength={200}
                    value={sampleName}
                    disabled={busy}
                    onChange={(changeEvent) => {
                      setSampleName(
                        changeEvent.target.value
                      );
                      setPreviewUrl("");
                      setNotice("");
                    }}
                  />
                </label>

                <button
                  type="button"
                  className="cert-primary"
                  disabled={
                    busy || !sampleName.trim()
                  }
                  onClick={handlePreview}
                >
                  Generate PDF preview
                </button>

                {previewUrl && (
                  <>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open PDF ↗
                    </a>

                    <a
                      href={previewUrl}
                      download={`eventhub-template-${version.id}-sample.pdf`}
                    >
                      Download sample
                    </a>
                  </>
                )}
              </div>

              {previewUrl ? (
                <iframe
                  className="cert-pdf"
                  src={previewUrl}
                  title="Generated sample certificate PDF"
                />
              ) : (
                <div className="cert-preview-empty">
                  Generate a PDF after making your
                  changes. Editing text, images or the
                  sample name clears the previous
                  preview.
                </div>
              )}
            </section>
          </>
        )}
      </CertificateStudioPanel>

      {template && version && (
        <>
          <CertificateStudioPanel name="recipients">
            <CertificateDelivery
              key={`${eventId}-${version.id}`}
              event={event}
              eventId={eventId}
              versionId={version.id}
              versionLabel={`Version ${version.number}`}
              dirty={dirty}
              busy={busy}
              runOperation={runOperation}
            />
          </CertificateStudioPanel>

          <CertificateStudioPanel name="batches">
            <section className="cert-card">
              <CertificateBatches
                key={`${eventId}-${version.id}`}
                historyOnly
                eventId={eventId}
                versionId={version.id}
                versionLabel={`Version ${version.number}`}
                dirty={dirty}
                busy={busy}
                runOperation={runOperation}
              />
            </section>
          </CertificateStudioPanel>
        </>
      )}
    </CertificateStudio>
  );
}

export default function OrganizerCertificates() {
  const { id } = useParams();

  return <CertificateEditor key={id} eventId={id} />;
}