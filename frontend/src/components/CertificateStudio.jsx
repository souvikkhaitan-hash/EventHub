import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

const StudioContext = createContext(null);

export function useCertificateStudio() {
  return useContext(StudioContext);
}

export default function CertificateStudio({
  busy,
  available,
  children,
}) {
  const [view, setView] = useState("design");
  const [batch, setBatch] = useState(null);
  const [historyRevision, setHistoryRevision] = useState(0);

  const prefix = useId().replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );

  const focusHistory = useRef(false);

  useEffect(() => {
    if (
      !busy &&
      view === "batches" &&
      focusHistory.current
    ) {
      document
        .getElementById(`${prefix}-batches-tab`)
        ?.focus();

      focusHistory.current = false;
    }
  }, [busy, view, prefix]);

  function choose(next) {
    if (
      busy ||
      (next !== "design" && !available)
    ) {
      return;
    }

    setView(next);

    if (next === "batches") {
      setHistoryRevision((value) => value + 1);
    }
  }

  function reviewBatch(created) {
    focusHistory.current = true;
    setBatch(created);
    setHistoryRevision((value) => value + 1);
    setView("batches");
  }

  return (
    <StudioContext.Provider
      value={{
        view,
        choose,
        batch,
        reviewBatch,
        rememberBatch: setBatch,
        historyRevision,
        busy,
        available,
        prefix,
      }}
    >
      <div className="cert-page cert-studio">
        {children}
      </div>
    </StudioContext.Provider>
  );
}

export function CertificateStudioNav() {
  const studio = useCertificateStudio();

  const tabs = [
    ["design", "Design template"],
    ["recipients", "Participants & awards"],
    ["batches", "Saved batches"],
  ];

  function keyboardNavigation(event) {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      return;
    }

    const buttons = [
      ...event.currentTarget.querySelectorAll(
        '[role="tab"]'
      ),
    ].filter((button) => !button.disabled);

    const index = buttons.indexOf(event.target);

    if (index < 0) return;

    event.preventDefault();

    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (
              index +
              (event.key === "ArrowRight" ? 1 : -1) +
              buttons.length
            ) % buttons.length;

    buttons[next].focus();
    buttons[next].click();
  }

  return (
    <div
      className="cs-tabs"
      role="tablist"
      aria-label="Certificate workspace"
      onKeyDown={keyboardNavigation}
    >
      {tabs.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`${studio.prefix}-${value}-tab`}
          aria-controls={`${studio.prefix}-${value}-panel`}
          aria-selected={studio.view === value}
          tabIndex={studio.view === value ? 0 : -1}
          disabled={
            studio.busy ||
            (value !== "design" && !studio.available)
          }
          onClick={() => studio.choose(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function CertificateStudioPanel({
  name,
  children,
}) {
  const studio = useCertificateStudio();

  return (
    <div
      className="cs-panel"
      role="tabpanel"
      id={`${studio.prefix}-${name}-panel`}
      aria-labelledby={`${studio.prefix}-${name}-tab`}
      hidden={studio.view !== name}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export function CertificateTextSize({
  label,
  value,
  minimum,
  maximum,
  disabled,
  onChange,
}) {
  function change(next) {
    onChange(
      Math.max(minimum, Math.min(maximum, next))
    );
  }

  return (
    <div className="cs-size">
      <span>{label}</span>

      <div>
        <button
          type="button"
          aria-label="Decrease text size"
          disabled={disabled || value <= minimum}
          onClick={() => change(value - 1)}
        >
          −
        </button>

        <label>
          <span className="cs-sr-only">
            Text size in points
          </span>

          <input
            type="number"
            min={minimum}
            max={maximum}
            step={1}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.valueAsNumber;

              if (Number.isFinite(next)) {
                change(next);
              }
            }}
          />

          <span>pt</span>
        </label>

        <button
          type="button"
          aria-label="Increase text size"
          disabled={disabled || value >= maximum}
          onClick={() => change(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function CertificateAlignment({
  label,
  value,
  options,
  disabled,
  onChange,
}) {
  return (
    <div className="cs-align">
      <span>{label}</span>

      <div role="group" aria-label={label}>
        {options.map(([key, title]) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            {title}
          </button>
        ))}
      </div>
    </div>
  );
}