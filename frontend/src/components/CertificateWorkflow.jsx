import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useEventAccess } from "./EventAccessGate";
import {
  changeCertificateWorkflow, createCertificateWorkflow,
  generateParticipantCertificatePreview, getCertificateWorkflow,
  getCertificateWorkflowReview, getCertificateWorkflows,
  getGeneratedCertificateDocument,
} from "../services/events";
import "../styles/certificate-workflow.css";

const unfinished = ["queued", "generating", "ready", "publishing", "failed"];
const working = ["queued", "generating", "publishing"];
const labels = {
  queued: "Waiting for worker", generating: "Preparing certificates", ready: "Ready for owner review",
  publishing: "Publishing certificates", published: "Published", failed: "Action needed", cancelled: "Cancelled",
};
const validName = (name) => typeof name === "string" && name.trim().length > 0 && name.trim().length <= 200;

export default function CertificateWorkflow(props) {
  return <WorkflowWorkspace key={`${props.eventId}:${props.versionId}`} {...props} />;
}

function WorkflowWorkspace({ eventId, versionId, versionLabel, dirty, busy }) {
  const { user } = useAuth();
  const access = useEventAccess();
  const owner = access?.role === "owner";
  const prefix = useId();
  const [review, setReview] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState("");
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState("");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [jobError, setJobError] = useState("");
  const [pollRevision, setPollRevision] = useState(0);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [picked, setPicked] = useState({});
  const [names, setNames] = useState({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [publicationConfirmed, setPublicationConfirmed] = useState(false);
  const [action, setAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const alive = useRef(false);
  const operation = useRef(false);
  const requestRef = useRef(null);
  const previewSequence = useRef(0);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setJobsLoading(true);
    getCertificateWorkflows(eventId, controller.signal).then((data) => {
      if (!active) return;
      const list = data.results ?? [];
      setJobs(list);
      setJobsError("");
      const current = list.find((item) => unfinished.includes(item.status)) ?? list[0];
      if (current) setJobId(current.id);
    }).catch((error) => {
      if (active && !controller.signal.aborted) setJobsError(error.message || "Unable to load certificate runs.");
    }).finally(() => { if (active) setJobsLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [eventId]);

  useEffect(() => {
    if (!versionId) { setReviewLoading(false); return; }
    const controller = new AbortController();
    let active = true;
    setReviewLoading(true);
    setReviewError("");
    getCertificateWorkflowReview(eventId, versionId, controller.signal).then((data) => {
      if (!active) return;
      setReview(data);
      setNames({});
      setPicked(Object.fromEntries(data.results.filter((row) => row.selectable && row.name_valid)
        .map((row) => [row.registration_id, true])));
      
      setPage(1);
    }).catch((error) => {
      if (!active || controller.signal.aborted) return;
      setReview(null);
      setReviewError(error.message || "Unable to review recipients.");
    }).finally(() => { if (active) setReviewLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [eventId, versionId, reviewRevision]);

  useEffect(() => {
    setJob(null);
    setJobError("");
    setPublicationConfirmed(false);
    setCancelConfirm(false);
    setPreview(null);
    previewSequence.current += 1;
    if (!jobId) return;
    const controller = new AbortController();
    let active = true;
    let timer;
    async function poll() {
      try {
        const current = await getCertificateWorkflow(jobId, controller.signal);
        if (!active) return;
        setJob(current);
        setJobs((previous) => [current, ...previous.filter((item) => item.id !== current.id)]);
        setJobError("");
        if (working.includes(current.status)) {
          timer = window.setTimeout(poll, ["published", "cancelled"].includes(current.status) ? 8000 : 2500);
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setJobError(error.message || "Progress could not refresh. Your saved run is retained.");
        if (![401, 403, 404].includes(error.status)) timer = window.setTimeout(poll, 8000);
      }
    }
    poll();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [jobId, pollRevision]);

  useEffect(() => { setPublicationConfirmed(false); }, [job?.review_hash]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const rows = review?.results ?? [];
  const nameFor = (row) => names[row.registration_id] ?? row.participant_name ?? "";
  const selected = rows.filter((row) => picked[row.registration_id] && row.selectable && validName(nameFor(row)));
  const missing = rows.filter((row) => row.selectable && !validName(nameFor(row))).length;
  const filtered = rows.filter((row) => `${nameFor(row)} ${row.username} ${row.team_name}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 30));
  const visibleRows = filtered.slice((page - 1) * 30, page * 30);
  const locked = busy || Boolean(action);
  const canControl = owner || (user && job?.created_by === user.id);
  const reviewable = job?.status === "ready" || (job?.status === "failed" && job.phase === "publication");

  function invalidatePreview() { previewSequence.current += 1; setPreview(null); setPreviewError(""); }

  async function mutate(label, callback) {
    if (operation.current || busy || jobsLoading || jobsError) return;
    operation.current = true;
    setAction(label);
    setActionError("");
    try {
      const current = await callback();
      if (!alive.current) return;
      setJob(current);
      setJobId(current.id);
      setPublicationConfirmed(false);
      setCancelConfirm(false);
      setPollRevision((value) => value + 1);
    } catch (error) {
      if (alive.current) {
        setActionError(error.message || "Unable to complete this action.");
        if (jobId) setPollRevision((value) => value + 1);
      }
    } finally {
      operation.current = false;
      if (alive.current) setAction("");
    }
  }

  function generate() {
    if (dirty || !versionId || reviewLoading || !selected.length || jobId) return;
    const payload = {
      template_version_id: versionId,
      recipients: selected.map((row) => ({ registration_id: row.registration_id, participant_name: nameFor(row).trim() }))
        .sort((first, second) => first.registration_id - second.registration_id),
    };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature) {
      requestRef.current = { signature, payload: { ...payload, request_key: crypto.randomUUID() } };
    }
    mutate("generation", () => createCertificateWorkflow(eventId, requestRef.current.payload));
  }

  async function openPreview(certificate = null) {
    if (previewBusy || locked || (!certificate && (dirty || !selected.length))) return;
    const sequence = ++previewSequence.current;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const row = selected[0];
      const blob = certificate
        ? await getGeneratedCertificateDocument(certificate.id)
        : await generateParticipantCertificatePreview(versionId, row.registration_id, nameFor(row).trim());
      if (!alive.current || sequence !== previewSequence.current) return;
      setPreview({ url: URL.createObjectURL(blob), name: certificate?.participant_name ?? nameFor(row) });
    } catch (error) {
      if (alive.current && sequence === previewSequence.current) setPreviewError(error.message || "Unable to open PDF preview.");
    } finally { if (alive.current) setPreviewBusy(false); }
  }

  function freshRun() {
    setJobId(""); setJob(null); setActionError(""); 
    requestRef.current = null;
    setReviewRevision((value) => value + 1);
  }

  return (
    <section className="cf-workspace" aria-label="Participation certificate workflow">
      <header className="cf-heading">
        <div><span className="cf-eyebrow">PARTICIPATION CERTIFICATES</span><h2>One template. Every participant.</h2>
          <p>Confirm the recipients, prepare the PDFs, then publish them together.</p></div>
        <span className="cf-template">{versionLabel || "Choose a saved template"}</span>
      </header>
      <ol className="cf-steps" aria-label="Certificate steps">
        {["Confirm recipients", "Generate", "Review & publish"].map((label, index) => (
          <li key={label} aria-current={(!jobId && index === 0) || (job && working.slice(0, 2).includes(job.status) && index === 1)
            || (job && !["queued", "generating"].includes(job.status) && index === 2) ? "step" : undefined}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
      {jobsLoading && <p role="status">Checking saved certificate runs…</p>}
      {jobsError && <p className="cf-message cf-error" role="alert">{jobsError} Refresh the page before starting a new run.</p>}
      {!jobId && !jobsLoading && !jobsError && <>
        {dirty && <p className="cf-message cf-warning">Save your template changes before generating certificates.</p>}
        {!versionId && <p className="cf-message">Choose and save a template in Design template first.</p>}
        {reviewLoading ? <p role="status">Checking attendance and saved names…</p> : reviewError ? (
          <div className="cf-message cf-error" role="alert"><p>{reviewError}</p>
            <button type="button" disabled={locked || !versionId} onClick={() => setReviewRevision((value) => value + 1)}>Refresh recipients</button></div>
        ) : review && <>
          <div className="cf-metrics">
            <div><span>Selected</span><strong>{selected.length}</strong></div>
            <div><span>Need a name</span><strong>{missing}</strong></div>
            <div><span>Already issued</span><strong>{review.already_issued_count}</strong></div>
          </div>
          <p className="cf-help">All eligible participants with valid saved names are selected automatically, across every page.
            Attendance and eligibility are checked again during generation and publication.</p>
          {missing > 0 && <p className="cf-message cf-warning">{missing} eligible participant(s) need a full name.
            Correct and select them in the recipient list, or continue with the currently selected participants.</p>}
          <details className="cf-recipients">
            <summary>Review recipients or correct names <span>{review.count} registrations</span></summary>
            <div className="cf-recipient-tools">
              <label htmlFor={`${prefix}-search`}>Find a participant<input id={`${prefix}-search`} value={search} maxLength={100}
                placeholder="Name, username or team" disabled={locked} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
              <button type="button" disabled={locked} onClick={() => {
                setPicked(Object.fromEntries(rows.filter((row) => row.selectable && validName(nameFor(row))).map((row) => [row.registration_id, true])));
                 invalidatePreview();
              }}>Select all ready</button>
              <button type="button" disabled={locked} onClick={() => { setPicked({});  invalidatePreview(); }}>Clear</button>
            </div>
            <div className="cf-table-scroll"><table><thead><tr><th>Select</th><th>Participant</th><th>Printed name</th><th>Status</th></tr></thead>
              <tbody>{visibleRows.map((row) => <tr key={row.registration_id}>
                <td><input type="checkbox" checked={Boolean(picked[row.registration_id])} aria-label={`Select ${row.username}`}
                  disabled={locked || !row.selectable || !validName(nameFor(row))} onChange={(event) => {
                    setPicked((previous) => ({ ...previous, [row.registration_id]: event.target.checked }));
                     invalidatePreview();
                  }} /></td>
                <td><strong>{row.participant_name || row.username}</strong><small>@{row.username}{row.team_name ? ` · ${row.team_name}` : ""}</small></td>
                <td><input value={nameFor(row)} maxLength={200} disabled={locked || !row.selectable}
                  aria-label={`Printed name for ${row.username}`} aria-invalid={row.selectable && !validName(nameFor(row))}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNames((previous) => ({ ...previous, [row.registration_id]: value }));
                    if (!validName(value)) setPicked((previous) => ({ ...previous, [row.registration_id]: false }));
                     invalidatePreview();
                  }} /></td>
                <td>{row.already_issued ? "Already issued" : row.eligible ? validName(nameFor(row)) ? "Ready" : "Full name needed"
                  : (row.reasons ?? []).map((reason) => reason.message).join(" ")}</td>
              </tr>)}</tbody></table></div>
            <div className="cf-pagination"><span>Page {page} of {pageCount}</span><div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
          </details>
          <div className="cf-actions"><button type="button" className="cf-primary" onClick={generate}
            disabled={locked || dirty || !selected.length || !versionId}>
            {action === "generation" ? "Saving your run…" : `Generate for ${selected.length} selected`}</button>
            <button type="button" disabled={locked || dirty || !selected.length || previewBusy} onClick={() => openPreview()}>
              {previewBusy ? "Opening preview…" : "Preview a participant"}</button>
            <button type="button" disabled={locked} onClick={() => { invalidatePreview(); setReviewRevision((value) => value + 1); }}>Refresh recipients</button>
          </div>
          <p className="cf-help">Name corrections apply to these certificates, not to student profiles. New drafts stay private.</p>
        </>}
      </>}
      {jobId && !job && !jobError && <p role="status">Loading your saved run…</p>}
      {jobError && <div className="cf-message cf-error" role="alert"><p>{jobError}</p>
        <button type="button" disabled={locked} onClick={() => setPollRevision((value) => value + 1)}>Refresh progress</button></div>}
      {job && <div className="cf-run">
        <div className="cf-run-heading"><div><h3>{labels[job.status] || job.status}</h3>
          <p>Saved template version #{job.template_version_id} · {job.total} participants</p></div>
          <button type="button" disabled={locked} onClick={() => setPollRevision((value) => value + 1)}>Refresh</button></div>
        <div className="cf-metrics"><div><span>Selected</span><strong>{job.total}</strong></div>
          <div><span>Prepared</span><strong>{job.generated}</strong></div><div><span>Published</span><strong>{job.published}</strong></div></div>
        <label className="cf-progress-label" htmlFor={`${prefix}-progress`}>
          {job.phase === "publication" ? "Publication" : "Generation"} progress
          <span>{job.phase === "publication" ? job.published : job.generated} / {job.total}</span></label>
        <progress id={`${prefix}-progress`} max={job.total} value={job.phase === "publication" ? job.published : job.generated} />
        {working.includes(job.status) && <p className="cf-help" role="status">You can leave this page and return later.
          Processing continues while the certificate worker is running.{job.status === "queued" ? " Waiting here? Check that the worker is started." : ""}</p>}
        {job.error_message && <p className="cf-message cf-error" role="alert">{job.error_message}</p>}
        {job.status === "failed" && job.published > 0 && <p className="cf-message cf-warning">
          {job.published} certificates are already available to students. The remaining work has stopped; retrying does not revoke the issued certificates.</p>}
        {job.samples.length > 0 && <div className="cf-samples"><h4>Sample certificates</h4><p>Check the design, names and positioning before publication.</p>
          <div className="cf-actions">{job.samples.map((sample) => <button type="button" key={sample.id}
            disabled={locked || previewBusy} onClick={() => openPreview(sample)}>Preview {sample.participant_name}</button>)}</div></div>}
        {reviewable && (owner ? <>
          <label className="cf-confirm"><input type="checkbox" checked={publicationConfirmed} disabled={locked || !job.review_hash}
            onChange={(event) => setPublicationConfirmed(event.target.checked)} /><span>I reviewed the recipient selection and sample PDFs, and approve publication of this run.</span></label>
          <button type="button" className="cf-primary" disabled={locked || !publicationConfirmed || !job.review_hash}
            onClick={() => mutate("publication", () => changeCertificateWorkflow(job.id, {
              action: "publish", confirm_review: true, review_hash: job.review_hash,
            }))}>{action === "publication" ? "Queuing publication…" : job.published > 0 ? "Publish remaining certificates" : `Publish all ${job.total} certificates`}</button>
        </> : <p className="cf-message">Drafts are ready. The event owner can review and publish this entire run with one action.</p>)}
        {job.status === "failed" && job.phase === "generation" && canControl && <button type="button" className="cf-primary" disabled={locked}
          onClick={() => mutate("retry", () => changeCertificateWorkflow(job.id, { action: "retry" }))}>Resume generation</button>}
        {((job.phase === "generation" && ["queued", "generating", "ready", "failed"].includes(job.status) && canControl)
          || (job.phase === "publication" && ["publishing", "failed"].includes(job.status) && owner)) && (
          <div className="cf-cancel"><button type="button" disabled={locked} onClick={() => setCancelConfirm((value) => !value)}>
            {job.phase === "publication" ? "Stop remaining publication" : "Cancel this run"}</button>
            {cancelConfirm && <div className="cf-message cf-warning"><p>{job.phase === "publication"
              ? "Stop future publication? Already published certificates stay available; the remaining drafts stay private. This does not revoke certificates."
              : "Stop future work? Completed drafts will remain private in batch history."}</p>
              <button type="button" disabled={locked} onClick={() => mutate("cancel", () => changeCertificateWorkflow(job.id, { action: "cancel" }))}>Confirm cancellation</button></div>}</div>)}
        {(["published", "cancelled"].includes(job.status) && job.published > 0) && <div className="cf-delivery">
          <h4>Published to student accounts</h4><p>Students can open their certificates in My Registrations.
            They will also see a notification in their EventHub bell. Device alerts follow their notification preferences.</p>
          {job.active_certificates < job.published && <p className="cf-message cf-warning">{job.published - job.active_certificates} previously published certificate(s) are no longer active.</p>}
        </div>}
        {["published", "cancelled"].includes(job.status) && <div className="cf-actions"><button type="button" disabled={locked} onClick={freshRun}>Prepare another run</button></div>}
      </div>}
      {actionError && <p className="cf-message cf-error" role="alert">{actionError}</p>}
      {previewError && <p className="cf-message cf-error" role="alert">{previewError}</p>}
      {preview && <section className="cf-pdf-preview"><div className="cf-run-heading"><h3>{preview.name}</h3><div className="cf-actions">
        <a href={preview.url} target="_blank" rel="noopener noreferrer">Open PDF ↗</a><button type="button" onClick={invalidatePreview}>Close preview</button></div></div>
        <iframe src={preview.url} title={`Certificate preview for ${preview.name}`} /></section>}
      {jobs.length > 0 && <details className="cf-history"><summary>Recent certificate runs</summary><ul>{jobs.map((item) => <li key={item.id}>
        <div><strong>{labels[item.status] || item.status}</strong><small>{item.total} participants · Template version #{item.template_version_id}</small></div>
        <button type="button" disabled={locked || item.id === jobId} onClick={() => { setJobId(item.id); setActionError(""); }}>Open run</button></li>)}</ul></details>}
    </section>
  );
}
