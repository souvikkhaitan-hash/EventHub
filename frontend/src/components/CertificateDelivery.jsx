import { useState } from "react";

import CertificateAwards from "./CertificateAwards";
import CertificateRecipients from "./CertificateRecipients";

export default function CertificateDelivery({ event, ...shared }) {
  const [mode, setMode] = useState("participation");
  const [awardsOpened, setAwardsOpened] = useState(false);

  const prefix =
    `certificate-delivery-${shared.eventId}-${shared.versionId}`;

  function chooseMode(next) {
    if (shared.busy) return;

    if (next === "awards") {
      setAwardsOpened(true);
    }

    setMode(next);
  }

  return (
    <section>
      <div
        className="cert-delivery-tabs"
        role="tablist"
        aria-label="Certificate type"
        onKeyDown={(event) => {
          const keys = [
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
          ];

          if (!keys.includes(event.key) || shared.busy) return;

          event.preventDefault();

          const buttons = [
            ...event.currentTarget.querySelectorAll("[role=tab]"),
          ];

          const index = buttons.indexOf(event.target);

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
        }}
      >
        {[
          ["participation", "Participation certificates"],
          ["awards", "Results and award certificates"],
        ].map(([value, label]) => (
          <button
            key={value}
            id={`${prefix}-${value}-tab`}
            type="button"
            role="tab"
            aria-selected={mode === value}
            aria-controls={`${prefix}-${value}-panel`}
            tabIndex={mode === value ? 0 : -1}
            disabled={shared.busy}
            onClick={() => chooseMode(value)}
            className={mode === value ? "cert-primary" : ""}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${prefix}-participation-panel`}
        aria-labelledby={`${prefix}-participation-tab`}
        hidden={mode !== "participation"}
      >
        <CertificateRecipients {...shared} />
      </div>

      <div
        role="tabpanel"
        id={`${prefix}-awards-panel`}
        aria-labelledby={`${prefix}-awards-tab`}
        hidden={mode !== "awards"}
      >
        {awardsOpened && (
          <CertificateAwards event={event} {...shared} />
        )}
      </div>
    </section>
  );
}