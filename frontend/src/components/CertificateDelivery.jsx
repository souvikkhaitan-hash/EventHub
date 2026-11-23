import { useState } from "react";
import { useEventAccess } from "./EventAccessGate";
import CertificateAwards from "./CertificateAwards";
import CertificateWorkflow from "./CertificateWorkflow";

export default function CertificateDelivery({ event, ...shared }) {
  const [mode, setMode] = useState("participation");
  const [awardsOpened, setAwardsOpened] = useState(false);
  const access = useEventAccess();
  const isEventOwner = access?.role === "owner";
  const prefix = `certificate-delivery-${shared.eventId}-${shared.versionId}`;

  function chooseMode(next) {
    if (shared.busy) return;
    if (next === "awards") setAwardsOpened(true);
    setMode(next);
  }

  if (!isEventOwner) {
    return <section>
      <p className="cert-message" role="note">You can prepare participation certificates for the whole event.
        The event owner reviews and publishes the completed run. Award decisions remain with the event owner.</p>
      <CertificateWorkflow {...shared} />
    </section>;
  }

  return <section>
    <div className="cert-delivery-tabs" role="tablist" aria-label="Certificate type"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || shared.busy) return;
        const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')].filter((button) => !button.disabled);
        const index = buttons.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); buttons[next].click();
      }}>
      {[["participation", "Participation certificates"], ["awards", "Results and awards"]].map(([value, label]) => (
        <button key={value} id={`${prefix}-${value}-tab`} type="button" role="tab"
          aria-selected={mode === value} aria-controls={`${prefix}-${value}-panel`} tabIndex={mode === value ? 0 : -1}
          disabled={shared.busy} onClick={() => chooseMode(value)} className={mode === value ? "cert-primary" : ""}>{label}</button>
      ))}
    </div>
    <div role="tabpanel" id={`${prefix}-participation-panel`} aria-labelledby={`${prefix}-participation-tab`} hidden={mode !== "participation"}>
      <CertificateWorkflow {...shared} />
    </div>
    <div role="tabpanel" id={`${prefix}-awards-panel`} aria-labelledby={`${prefix}-awards-tab`} hidden={mode !== "awards"}>
      {awardsOpened && <CertificateAwards event={event} {...shared} />}
    </div>
  </section>;
}
