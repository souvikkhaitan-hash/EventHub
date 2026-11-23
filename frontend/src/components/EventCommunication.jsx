import { useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useEventAccess } from "./EventAccessGate";
import { useAuth } from "../context/AuthContext";
import {
  getEventCommunication, createEventAnnouncement, changeEventAnnouncement,
  createEventQuestion, changeEventQuestion,
} from "../services/events";
import "../styles/event-communication.css";

const time = (value) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";

export function EventCommunicationLink() {
  const access = useEventAccess();
  const { id } = useParams();
  if (!access?.capabilities?.includes("edit_event")) return null;
  return <Link className="ec-workspace-link" to={`/organizer/events/${id}/communication`}>Questions & announcements ↗</Link>;
}

export default function EventCommunication({ eventId, manage = false }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading event updates…</p>;
  return <Board key={`${eventId}:${user?.id ?? user?.username ?? "guest"}:${manage}`} eventId={eventId} manage={manage} user={user} />;
}

function Board({ eventId, manage, user }) {
  const prefix = useId();
  const [tab, setTab] = useState("announcements");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [unanswered, setUnanswered] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const alive = useRef(false);
  const operation = useRef(false);
  const editorRef = useRef(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setData(null); setError("");
    getEventCommunication(eventId, { manage, tab, page, search: query, unanswered }, controller.signal)
      .then((result) => { if (active) setData(result); })
      .catch((requestError) => { if (active && requestError.name !== "AbortError") setError(requestError.message || "Unable to load event updates."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [eventId, manage, tab, page, query, unanswered, revision]);

  useEffect(() => {
    if (editor) editorRef.current?.querySelector("input,textarea")?.focus();
  }, [editor?.key]);

  function refresh() { setPage(1); setRevision((value) => value + 1); }
  function selectTab(value) {
    if (busy) return;
    setTab(value); setPage(1); setSearch(""); setQuery(""); setUnanswered(false); setEditor(null); setNotice("");
  }
  function openEditor(type, item = null) {
    if (busy) return;
    setError(""); setNotice("");
    setEditor({ key: crypto.randomUUID(), type, item, title: item?.title || "",
      body: type === "answer" ? item?.answer || "" : item?.body || "",
      stage: item?.stage || "general", pinned: item?.pinned || false, reason: "" });
  }
  function field(name, value) { setEditor((previous) => ({ ...previous, [name]: value })); }

  async function save(event) {
    event.preventDefault();
    if (operation.current || !editor) return;
    operation.current = true; setBusy(true); setError(""); setNotice("");
    const publish = event.nativeEvent.submitter?.value === "publish";
    try {
      if (editor.type === "announcement") {
        const details = { title: editor.title, body: editor.body, stage: editor.stage, pinned: editor.pinned };
        let item = editor.item;
        if (item) {
          item = await changeEventAnnouncement(eventId, item.id, { ...details, action: "edit", revision: item.revision });
        } else {
          item = await createEventAnnouncement(eventId, { ...details, request_key: editor.key });
        }
        // Preserve the saved draft if the following publication request fails.
        if (alive.current) setEditor((previous) => ({ ...previous, item }));
        if (publish && item.status === "draft") {
          await changeEventAnnouncement(eventId, item.id, { action: "publish", revision: item.revision });
        }
        if (alive.current) setNotice(publish ? "Announcement published. Registered participants will be notified." : "Announcement saved.");
      } else if (editor.type === "question") {
        if (editor.item) await changeEventQuestion(eventId, editor.item.id, { action: "edit", revision: editor.item.revision, body: editor.body });
        else await createEventQuestion(eventId, { body: editor.body, request_key: editor.key });
        if (alive.current) setNotice("Question saved. The event team can reply here.");
      } else {
        const isAnnouncement = editor.type === "withdraw-announcement";
        const payload = { revision: editor.item.revision,
          action: isAnnouncement ? "withdraw" : editor.type,
          ...(editor.type === "answer" ? { answer: editor.body } : {}),
          ...(editor.reason.trim() ? { reason: editor.reason } : {}) };
        if (isAnnouncement) await changeEventAnnouncement(eventId, editor.item.id, payload);
        else await changeEventQuestion(eventId, editor.item.id, payload);
        if (alive.current) setNotice(editor.type === "answer" ? "Answer saved. The participant will be notified." : "Update saved.");
      }
      if (alive.current) { setEditor(null); refresh(); }
    } catch (requestError) {
      if (alive.current) setError(requestError.status === 409
        ? "This item changed. Your text is still below. Copy it if needed, cancel editing, refresh and reopen the latest item."
        : requestError.message || "Unable to save. Your text has been kept so you can retry.");
    } finally { operation.current = false; if (alive.current) setBusy(false); }
  }

  const manages = manage && data?.can_manage;
  const title = editor?.type === "announcement" ? (editor.item ? "Edit announcement" : "New announcement")
    : editor?.type === "answer" ? "Official answer" : editor?.type === "question" ? "Ask the event team"
      : editor?.type === "restore" ? "Restore this question?" : "Remove this from the public board?";

  return <section className="ec-board" id="event-community" aria-labelledby={`${prefix}-title`}>
    <header className="ec-heading"><div><span className="ec-eyebrow">STAY IN THE LOOP</span>
      <h2 id={`${prefix}-title`}>{manage ? "Questions & announcements" : "Event updates & questions"}</h2>
      <p>{manage ? "Keep participants informed and answer their questions in one place." : "Read the latest announcements and get answers from the event team."}</p></div>
      {!manage && data?.can_manage && <Link className="ec-button" to={`/organizer/events/${eventId}/communication`}>Manage this board ↗</Link>}
    </header>
    {manage && data?.event && <p className="ec-event-name">{data.event.title} · {data.event.status}</p>}
    <div className="ec-tabs" role="tablist" aria-label="Event communication" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
      event.preventDefault(); const next = event.key === "Home" ? "announcements" : event.key === "End" ? "questions" : tab === "questions" ? "announcements" : "questions";
      selectTab(next); document.getElementById(`${prefix}-${next}-tab`)?.focus();
    }}>{[["announcements", "Announcements"], ["questions", "Questions & answers"]].map(([value, label]) =>
      <button key={value} type="button" role="tab" id={`${prefix}-${value}-tab`} aria-controls={`${prefix}-${value}-panel`}
        aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={busy} onClick={() => selectTab(value)}>{label}</button>)}</div>
    <div role="tabpanel" id={`${prefix}-${tab}-panel`} aria-labelledby={`${prefix}-${tab}-tab`}>
      <div className="ec-toolbar">
        <form onSubmit={(event) => { event.preventDefault(); if (!busy) { setQuery(search.trim()); setPage(1); setRevision((value) => value + 1); } }}>
          <label><span className="ec-sr-only">Search this board</span><input value={search} maxLength={100} placeholder="Search updates or questions" onChange={(event) => setSearch(event.target.value)} disabled={busy} /></label>
          <button type="submit" disabled={busy}>Search</button>
        </form>
        <div className="ec-actions">
          <button type="button" disabled={busy || loading} onClick={refresh}>Refresh</button>
          {manages && tab === "announcements" && <button className="ec-primary" type="button" disabled={busy} onClick={() => openEditor("announcement")}>New announcement</button>}
          {tab === "questions" && data?.can_ask && <button className="ec-primary" type="button" disabled={busy} onClick={() => openEditor("question")}>Ask a question</button>}
        </div>
      </div>
      {tab === "questions" && <label className="ec-check"><input type="checkbox" checked={unanswered} disabled={busy} onChange={(event) => { setUnanswered(event.target.checked); setPage(1); }} />Unanswered questions only</label>}
      {tab === "questions" && !user && <p className="ec-help"><Link to="/login">Log in</Link> to ask a question. You can read answers without an account.</p>}
      {data?.event.status === "cancelled" && <p className="ec-help">This event is cancelled. Existing questions and organiser updates remain readable.</p>}
      {error && <p className="ec-message ec-error" role="alert">{error}</p>}
      {notice && <p className="ec-message" role="status">{notice}</p>}
      {editor && <form ref={editorRef} className="ec-editor" onSubmit={save} aria-label={title}>
        <h3>{title}</h3>
        {["question", "announcement"].includes(editor.type) && <p className="ec-help">This content is public. Do not include phone numbers, ticket codes or other private details.</p>}
        {editor.type === "announcement" && <>
          <label>Title<input required maxLength={160} value={editor.title} disabled={busy} onChange={(event) => field("title", event.target.value)} /></label>
          <label>Event stage<select value={editor.stage} disabled={busy} onChange={(event) => field("stage", event.target.value)}>
            {["general", "before", "during", "after"].map((value) => <option key={value} value={value}>{value === "general" ? "General update" : `${value[0].toUpperCase()}${value.slice(1)} the event`}</option>)}
          </select></label>
          <label className="ec-check"><input type="checkbox" checked={editor.pinned} disabled={busy} onChange={(event) => field("pinned", event.target.checked)} />Pin this announcement</label>
        </>}
        {["question", "announcement", "answer"].includes(editor.type) && <label>{editor.type === "answer" ? "Answer" : editor.type === "question" ? "Your question" : "Announcement"}
          <textarea required rows={5} maxLength={editor.type === "question" ? 1500 : 5000} value={editor.body} disabled={busy} onChange={(event) => field("body", event.target.value)} />
          <small>{editor.body.length} / {editor.type === "question" ? 1500 : 5000}</small>
        </label>}
        {["hide", "withdraw-announcement"].includes(editor.type) && <label>Private moderation reason<textarea required maxLength={300} rows={2} value={editor.reason} disabled={busy} onChange={(event) => field("reason", event.target.value)} /></label>}
        {editor.type === "withdraw" && <p>Your question and its answer will disappear from the public board. A private moderation history is retained.</p>}
        {editor.type === "restore" && <p>The question and its existing answer will become public again.</p>}
        {editor.type === "announcement" && <p className="ec-help">Publishing alerts registered participants once. Later edits update this board without sending another alert. Save draft first if the event is not yet published.</p>}
        <div className="ec-actions">
          <button className="ec-primary" type="submit" value="save" disabled={busy}>{busy ? "Saving…" : editor.type === "announcement" && editor.item?.status !== "published" ? "Save draft" : "Save"}</button>
          {editor.type === "announcement" && editor.item?.status !== "published" && data?.event.status !== "draft" && <button className="ec-primary" type="submit" value="publish" disabled={busy}>Publish announcement</button>}
          <button type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
        </div>
      </form>}
      {loading ? <p role="status">Loading this board…</p> : data && <>
        {!data.results.length && <div className="ec-empty"><h3>{query ? "No matches" : tab === "announcements" ? "Updates will appear here" : "No questions yet"}</h3>
          <p>{query ? "Try a different search." : tab === "announcements" ? "The event team can share schedules, round details and results here." : "Ask about the event so others can benefit from the answer too."}</p></div>}
        <div className="ec-list">{data.results.map((item) => <article className="ec-card" key={item.id}>
          {tab === "announcements" ? <>
            <div className="ec-meta"><span>{item.pinned ? "Pinned · " : ""}{item.stage}</span>{manage && <span>{item.status}</span>}<time dateTime={item.published_at || item.updated_at}>{time(item.published_at || item.updated_at)}</time></div>
            <h3>{item.title}</h3><p className="ec-prose">{item.body}</p>
            {manages && item.status !== "withdrawn" && <div className="ec-actions">
              <button type="button" disabled={busy} onClick={() => openEditor("announcement", item)}>Edit{item.status === "draft" ? " / publish" : ""}</button>
              <button type="button" disabled={busy} onClick={() => openEditor("withdraw-announcement", item)}>Withdraw</button>
            </div>}
          </> : <>
            <div className="ec-meta"><span>{item.is_mine ? "Your question" : "Participant question"}{!item.visible ? " · Hidden" : ""}</span><time dateTime={item.created_at}>{time(item.created_at)}</time></div>
            <p className="ec-prose ec-question">{item.body}</p>
            {item.answer ? <div className="ec-answer"><strong>Official answer · Event team</strong><p className="ec-prose">{item.answer}</p><small>{time(item.answered_at)}</small></div> : <p className="ec-help">Awaiting an answer from the event team.</p>}
            <div className="ec-actions">
              {item.can_edit && <button type="button" disabled={busy} onClick={() => openEditor("question", item)}>Edit question</button>}
              {item.can_withdraw && <button type="button" disabled={busy} onClick={() => openEditor("withdraw", item)}>Withdraw my question</button>}
              {manages && item.visible && <button type="button" disabled={busy} onClick={() => openEditor("answer", item)}>{item.answer ? "Edit answer" : "Answer"}</button>}
              {manages && <button type="button" disabled={busy} onClick={() => openEditor(item.visible ? "hide" : "restore", item)}>{item.visible ? "Hide question" : "Restore question"}</button>}
            </div>
          </>}
        </article>)}</div>
        <nav className="ec-pagination" aria-label="Board pages"><button type="button" disabled={busy || !data.previous} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span>Page {page} · {data.count} {tab === "announcements" ? "updates" : "questions"}</span>
          <button type="button" disabled={busy || !data.next} onClick={() => setPage((value) => value + 1)}>Next</button></nav>
      </>}
    </div>
  </section>;
}
