import { useEffect, useRef, useState } from "react";

import {
  getCertificateAssetImage,
  getCertificateAssets,
  uploadCertificateAsset,
} from "../services/events";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeImage(image) {
  const width = clamp(image.width ?? 0.25, 0.01, 1);
  const height = clamp(image.height ?? 0.1, 0.01, 1);

  return {
    asset_id: Number(image.asset_id),
    x: clamp(image.x ?? 0.1, 0, 1 - width),
    y: clamp(image.y ?? 0.75, 0, 1 - height),
    width,
    height,
    rotation: clamp(Number(image.rotation ?? 0), -180, 180),
  };
}

function AssetImage({ assetId, rotation, boxRatio }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";

    getCertificateAssetImage(assetId, controller.signal)
      .then((blob) => {
        if (!active) return;

        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (active && error.name !== "AbortError") {
          setFailed(true);
        }
      });

    return () => {
      active = false;
      controller.abort();

      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  if (failed) return <span>Image unavailable</span>;
  if (!url) return <span>Loading…</span>;

  const radians = rotation * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));

  const rotatedWidth = ratio * cosine + sine;
  const rotatedHeight = ratio * sine + cosine;

  const scale = Math.min(
    boxRatio / rotatedWidth,
    1 / rotatedHeight
  );

  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onLoad={(event) => {
        const image = event.currentTarget;

        if (image.naturalWidth && image.naturalHeight) {
          setRatio(image.naturalWidth / image.naturalHeight);
        }
      }}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: `${ratio * scale / boxRatio * 100}%`,
        height: `${scale * 100}%`,
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        objectFit: "contain",
        pointerEvents: "none",
      }}
    />
  );
}

export function CertificateImageLayer({
  images,
  selected,
  active,
  busy,
  paperRef,
  paperAspect = 1.414,
  onSelect,
  onChange,
}) {
  const dragRef = useRef(null);

  function changeImage(index, changes) {
    if (!active || busy) return;

    onChange(
      images.map((image, imageIndex) =>
        imageIndex === index
          ? normalizeImage({ ...image, ...changes })
          : image
      )
    );
  }

  function startDrag(event, index, mode = "move") {
    if (!active || busy || event.button !== 0) return;

    onSelect(index);

    const bounds = paperRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;

    dragRef.current = {
      pointerId: event.pointerId,
      index,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...images[index] },
      pageWidth: bounds.width,
      pageHeight: bounds.height,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    const drag = dragRef.current;

    if (
      !active ||
      busy ||
      !drag ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const original = drag.original;

    if (drag.mode === "resize") {
      const widthPixels = original.width * drag.pageWidth;
      const heightPixels = original.height * drag.pageHeight;

      const requestedFactor = 1 + (
        dx * widthPixels + dy * heightPixels
      ) / (
        widthPixels * widthPixels +
        heightPixels * heightPixels
      );

      const factor = clamp(
        requestedFactor,
        Math.max(
          0.01 / original.width,
          0.01 / original.height
        ),
        Math.min(
          (1 - original.x) / original.width,
          (1 - original.y) / original.height
        )
      );

      changeImage(drag.index, {
        width: original.width * factor,
        height: original.height * factor,
      });

      return;
    }

    changeImage(drag.index, {
      x: original.x + dx / drag.pageWidth,
      y: original.y + dy / drag.pageHeight,
    });
  }

  function endDrag(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;

    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function moveWithKeyboard(event, index) {
    if (!active || busy) return;

    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];

    if (!direction) return;

    event.preventDefault();

    const distance = event.shiftKey ? 0.01 : 0.002;

    changeImage(index, {
      x: images[index].x + direction[0] * distance,
      y: images[index].y + direction[1] * distance,
    });
  }

  return (
    <div className="cert-image-layer">
      {images.map((image, index) => (
        <button
          key={`${index}-${image.asset_id}`}
          type="button"
          className={`cert-field-box cert-image-box ${
            active && selected === index ? "is-selected" : ""
          }`}
          style={{
            left: `${image.x * 100}%`,
            top: `${image.y * 100}%`,
            width: `${image.width * 100}%`,
            height: `${image.height * 100}%`,
            pointerEvents: active && !busy ? "auto" : "none",
          }}
          disabled={busy}
          tabIndex={active ? 0 : -1}
          aria-label={`Move certificate image ${index + 1}`}
          aria-pressed={selected === index}
          onClick={() => onSelect(index)}
          onPointerDown={(event) => startDrag(event, index)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
          onKeyDown={(event) =>
            moveWithKeyboard(event, index)
          }
        >
          <AssetImage
            key={image.asset_id}
            assetId={image.asset_id}
            rotation={Number(image.rotation ?? 0)}
            boxRatio={
              image.width * paperAspect / image.height
            }
          />

          {active && selected === index && (
            <span
              className="cert-resize-handle"
              aria-hidden="true"
              title="Drag to resize"
              onPointerDown={(event) => {
                event.stopPropagation();
                startDrag(event, index, "resize");
              }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  onChange,
  disabled,
}) {
  return (
    <label className="cert-control">
      <span>
        {label}
        <strong>{Number((value * 100).toFixed(1))}%</strong>
      </span>

      <input
        type="range"
        min={minimum}
        max={maximum}
        step={0.001}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(Number(event.target.value))
        }
      />
    </label>
  );
}

export default function CertificateImages({
  templateId,
  images,
  selected,
  editable,
  busy,
  paperAspect = 1.414,
  onSelect,
  onActivate,
  onChange,
  runOperation,
}) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);

  const [assetChoice, setAssetChoice] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);

  const inputRef = useRef(null);
  const aliveRef = useRef(false);

  const item = images[selected];

  const chosenAsset =
    assets.find((asset) => String(asset.id) === assetChoice) ||
    assets[0];

  const selectedAsset = assets.find(
    (asset) => asset.id === item?.asset_id
  );

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    getCertificateAssets(templateId, controller.signal)
      .then((result) => {
        if (active) {
          setAssets(result);
          setLoadError("");
        }
      })
      .catch((error) => {
        if (active && error.name !== "AbortError") {
          setLoadError(
            error.message || "Unable to load uploaded images."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [templateId, retry]);

  function changeSelected(changes) {
    if (!editable || !item) return;

    onActivate();

    onChange(
      images.map((image, index) =>
        index === selected
          ? normalizeImage({ ...image, ...changes })
          : image
      )
    );
  }

  function naturalBox(asset, width, rotation = 0) {
    const angle = rotation * Math.PI / 180;
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));

    const rotatedWidth =
      asset.image_width * cosine +
      asset.image_height * sine;

    const rotatedHeight =
      asset.image_width * sine +
      asset.image_height * cosine;

    let height = width * paperAspect *
      rotatedHeight / rotatedWidth;

    if (height > 0.9) {
      width *= 0.9 / height;
      height = 0.9;
    }

    return {
      width: Math.max(0.01, width),
      height: Math.max(0.01, height),
    };
  }

  function addImage() {
    if (!editable || !chosenAsset || images.length >= 20) return;

    const size = naturalBox(chosenAsset, 0.25);

    onSelect(images.length);
    onActivate();

    onChange([
      ...images,
      normalizeImage({
        asset_id: chosenAsset.id,
        x: 0.1,
        y: 0.75,
        ...size,
        rotation: 0,
      }),
    ]);
  }

  function scaleImage(factor) {
    if (!item || !editable) return;

    const actualFactor = clamp(
      factor,
      Math.max(0.01 / item.width, 0.01 / item.height),
      Math.min(1 / item.width, 1 / item.height)
    );

    const width = item.width * actualFactor;
    const height = item.height * actualFactor;

    changeSelected({
      width,
      height,
      x: item.x + (item.width - width) / 2,
      y: item.y + (item.height - height) / 2,
    });
  }

  function rotateBy(amount) {
    const current = Number(item.rotation ?? 0);
    const rotation = ((current + amount + 180) % 360 + 360) % 360 - 180;

    changeSelected({ rotation });
  }

  function upload(event) {
    event.preventDefault();

    if (!editable || !name.trim() || !file) return;

    runOperation(async () => {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Choose a PNG or JPG no larger than 5 MB.");
      }

      const created = await uploadCertificateAsset(
        templateId,
        name.trim(),
        file
      );

      if (!aliveRef.current) return;

      setAssets((previous) => [created, ...previous]);
      setAssetChoice(String(created.id));
      setName("");
      setFile(null);

      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <section className="cert-card cert-image-inspector">
      <h2>Images</h2>
      <p>Drag to move. Drag the corner dot to resize.</p>

      <details>
        <summary>Upload a signature or logo</summary>

        <form className="cert-upload" onSubmit={upload}>
          <label>
            Image name
            <input
              value={name}
              maxLength={120}
              placeholder="Coordinator signature"
              disabled={!editable}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label>
            PNG or JPG
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              disabled={!editable}
              onChange={(event) =>
                setFile(event.target.files?.[0] || null)
              }
            />
          </label>

          <button
            type="submit"
            disabled={!editable || !name.trim() || !file}
          >
            Upload image
          </button>
        </form>

        <small>
          Up to 5 MB. Transparent PNGs work best for signatures.
        </small>
      </details>

      {loading && <small role="status">Loading images…</small>}

      {loadError && (
        <div className="cert-message cert-error" role="alert">
          {loadError}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setLoading(true);
              setRetry((previous) => previous + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      <label>
        Image library
        <select
          value={chosenAsset?.id || ""}
          disabled={!editable || !assets.length}
          onChange={(event) => setAssetChoice(event.target.value)}
        >
          {!assets.length && (
            <option value="">Upload an image first</option>
          )}

          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="cert-primary"
        disabled={!editable || !chosenAsset || images.length >= 20}
        onClick={addImage}
      >
        + Add image
      </button>

      {images.length > 0 && (
        <label>
          Selected image
          <select
            value={item ? selected : ""}
            disabled={busy}
            onChange={(event) => {
              onSelect(Number(event.target.value));
              onActivate();
            }}
          >
            {images.map((image, index) => (
              <option
                key={`${index}-${image.asset_id}`}
                value={index}
              >
                {index + 1}. {
                  assets.find((asset) => asset.id === image.asset_id)?.name ||
                  "Uploaded image"
                }
              </option>
            ))}
          </select>
        </label>
      )}

      {item && (
        <>
          <div className="cert-action-grid">
            <button
              type="button"
              disabled={!editable}
              onClick={() => scaleImage(0.9)}
            >
              − Smaller
            </button>

            <button
              type="button"
              disabled={!editable}
              onClick={() => scaleImage(1.1)}
            >
              + Bigger
            </button>

            <button
              type="button"
              disabled={!editable || !selectedAsset}
              onClick={() => {
                changeSelected(
                  naturalBox(
                    selectedAsset,
                    item.width,
                    Number(item.rotation ?? 0)
                  )
                );
              }}
            >
              Fit image
            </button>

            <button
              type="button"
              disabled={!editable}
              onClick={() => changeSelected({
                x: (1 - item.width) / 2,
              })}
            >
              Center horizontally
            </button>

            <button
              type="button"
              disabled={!editable}
              onClick={() => rotateBy(-90)}
            >
              ↶ Rotate left
            </button>

            <button
              type="button"
              disabled={!editable}
              onClick={() => rotateBy(90)}
            >
              ↷ Rotate right
            </button>
          </div>

          <label>
            Rotation: {Number(item.rotation ?? 0)}°
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Number(item.rotation ?? 0)}
              disabled={!editable}
              onChange={(event) => changeSelected({
                rotation: Number(event.target.value),
              })}
            />
          </label>

          <button
            type="button"
            disabled={!editable}
            onClick={() => changeSelected({ rotation: 0 })}
          >
            Reset rotation
          </button>

          <details>
            <summary>Advanced positioning</summary>

            <RangeControl
              label="Distance from left"
              value={item.x}
              minimum={0}
              maximum={1 - item.width}
              disabled={!editable}
              onChange={(x) => changeSelected({ x })}
            />

            <RangeControl
              label="Distance from top"
              value={item.y}
              minimum={0}
              maximum={1 - item.height}
              disabled={!editable}
              onChange={(y) => changeSelected({ y })}
            />

            <button
              type="button"
              disabled={!editable}
              onClick={() => changeSelected({
                y: (1 - item.height) / 2,
              })}
            >
              Center vertically
            </button>
          </details>

          <button
            type="button"
            className="cert-remove"
            disabled={!editable}
            onClick={() => {
              onChange(
                images.filter((_, index) => index !== selected)
              );
              onSelect(0);
            }}
          >
            Remove from certificate
          </button>
        </>
      )}
    </section>
  );
}