import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { createPortal } from "react-dom";
import { Link } from "react-router";

import { useAuth } from "../context/AuthContext";

import {
  connectEventHubWhatsApp,
  disconnectEventHubWhatsApp,
  getEventHubNotifications,
  getEventHubNotificationConfig,
  getEventHubNotificationPreferences,
  markAllEventHubNotificationsRead,
  markEventHubNotificationRead,
  updateEventHubNotificationPreferences,
} from "../services/events";

import {
  deviceStatus,
  disableDeviceNotifications,
  enableDeviceNotifications,
} from "../services/notificationDevice";

import "../styles/notifications.css";

const categories = [
  "technical",
  "cultural",
  "workshop",
  "seminar",
  "sports",
];

const formatDate = (value) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function NotificationBell() {
  const { user, loading } = useAuth();

  return !loading && user ? (
    <AccountBell key={user.id} />
  ) : null;
}

function AccountBell() {
  const prefix = useId();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("inbox");
  const [page, setPage] = useState(1);

  const [inbox, setInbox] = useState(null);
  const [unread, setUnread] = useState(0);

  const [preferences, setPreferences] = useState(null);
  const [configuration, setConfiguration] = useState(null);
  const [device, setDevice] = useState(null);

  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [connection, setConnection] = useState(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  const trigger = useRef(null);
  const panel = useRef(null);
  const title = useRef(null);

  const alive = useRef(false);
  const operation = useRef(false);
  const settingsLoadedAt = useRef(0);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  // Refresh the inbox without blocking page rendering.
  // Pause these requests while Settings is open.
  useEffect(() => {
    if (open && tab === "settings") return;

    const controller = new AbortController();

    let active = true;
    let timer;

    async function refresh() {
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(refresh, 30000);
        return;
      }

      try {
        const result = await getEventHubNotifications(
          open ? page : 1,
          controller.signal
        );

        if (!active) return;

        setUnread(result.unread_count);

        if (open) {
          setInbox(result);
        }
      } catch (requestError) {
        if (
          active &&
          !controller.signal.aborted &&
          open
        ) {
          setError(
            requestError.message ||
              "Unable to load notifications."
          );
        }
      } finally {
        if (active) {
          setLoading(false);

          timer = window.setTimeout(
            refresh,
            open ? 10000 : 30000
          );
        }
      }
    }

    if (open) {
      setLoading(true);
    }

    refresh();

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, tab, page, revision]);

  // Modal keyboard controls.
  useEffect(() => {
    if (!open) return;

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";
    title.current?.focus();

    function handleKeyboard(event) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const controls = [
        ...panel.current.querySelectorAll(
          [
            "button:not(:disabled)",
            "a[href]",
            "input:not(:disabled)",
            "select:not(:disabled)",
          ].join(",")
        ),
      ].filter(
        (element) => element.getClientRects().length > 0
      );

      const first = controls[0];
      const last = controls[controls.length - 1];

      if (
        event.shiftKey &&
        (
          document.activeElement === first ||
          document.activeElement === title.current
        )
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener(
      "keydown",
      handleKeyboard
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      document.removeEventListener(
        "keydown",
        handleKeyboard
      );

      if (trigger.current?.isConnected) {
        trigger.current.focus();
      }
    };
  }, [open]);

  // Settings and device status load independently.
  useEffect(() => {
    if (!open || tab !== "settings") return;

    let active = true;
    setError("");

    const cacheExpired =
      Date.now() - settingsLoadedAt.current > 30000;

    if (cacheExpired) {
      Promise.all([
        getEventHubNotificationPreferences(),
        getEventHubNotificationConfig(),
      ])
        .then(([pref, config]) => {
          if (!active) return;

          setPreferences(pref);
          setPhone(pref.whatsapp_phone);
          setConfiguration(config);

          settingsLoadedAt.current = Date.now();
        })
        .catch((requestError) => {
          if (active) {
            setError(
              requestError.message ||
                "Unable to load notification settings."
            );
          }
        });
    }

    deviceStatus()
      .then((status) => {
        if (active) {
          setDevice(status);
        }
      })
      .catch(() => {
        if (active) {
          setDevice({
            error:
              "Unable to check device alerts. Close and reopen Settings to retry. Your inbox still works.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [open, tab]);

  async function perform(callback) {
    if (operation.current) return;

    operation.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await callback();
    } catch (requestError) {
      if (alive.current) {
        setError(
          requestError.message ||
            "Unable to complete this action."
        );
      }
    } finally {
      operation.current = false;

      if (alive.current) {
        setBusy(false);
      }
    }
  }

  async function savePreferences() {
    const fields = [
      "push_enabled",
      "reminders",
      "event_categories",
      "preferred_channel",
      "whatsapp_enabled",
      "whatsapp_marketing",
    ];

    const payload = Object.fromEntries(
      fields.map((key) => [
        key,
        preferences[key],
      ])
    );

    const result =
      await updateEventHubNotificationPreferences(
        payload
      );

    if (alive.current) {
      setPreferences(result);
      settingsLoadedAt.current = Date.now();
      setNotice("Notification preferences saved.");
    }
  }

  function chooseTab(next) {
    if (busy) return;

    setTab(next);
    setError("");
    setNotice("");
  }

  function updatePreference(key, value) {
    setPreferences((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  async function toggleDevice() {
    if (device.enabled) {
      await disableDeviceNotifications();

      if (alive.current) {
        setDevice({
          supported: true,
          enabled: false,
          permission: Notification.permission,
        });

        setNotice("Alerts disabled on this device.");
      }
    } else {
      const result =
        await enableDeviceNotifications(
          configuration.vapid_public_key
        );

      if (alive.current) {
        setDevice(result);
        setNotice("Alerts enabled on this device.");
      }
    }
  }

  async function disconnectWhatsApp() {
    const result =
      await disconnectEventHubWhatsApp();

    if (alive.current) {
      setPreferences(result);
      settingsLoadedAt.current = Date.now();

      setPhone("");
      setConsent(false);
      setConnection(null);
      setNotice("WhatsApp disconnected.");
    }
  }

  async function checkWhatsAppConnection() {
    const result =
      await getEventHubNotificationPreferences();

    if (alive.current) {
      setPreferences(result);
      settingsLoadedAt.current = Date.now();

      setNotice(
        result.whatsapp_verified
          ? "WhatsApp connected."
          : "Not connected yet. Send the CONNECT message from the number above, then check again."
      );
    }
  }

  function handleTabKeyboard(event) {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key) ||
      busy
    ) {
      return;
    }

    event.preventDefault();

    const next =
      event.key === "Home"
        ? "inbox"
        : event.key === "End"
          ? "settings"
          : tab === "inbox"
            ? "settings"
            : "inbox";

    chooseTab(next);

    document
      .getElementById(`${prefix}-${next}-tab`)
      ?.focus();
  }

  return (
    <div className="eh-notification-bell">
      <button
        ref={trigger}
        type="button"
        className="eh-bell-button"
        aria-label={
          `Notifications${
            unread ? `, ${unread} unread` : ""
          }`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4" />
        </svg>

        {unread > 0 && (
          <span
            className="eh-bell-count"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="eh-notification-overlay"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setOpen(false);
              }
            }}
          >
            <section
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${prefix}-title`}
              className="eh-notification-panel"
            >
              <header>
                <div>
                  <h2
                    ref={title}
                    tabIndex={-1}
                    id={`${prefix}-title`}
                  >
                    Notifications
                  </h2>

                  <p>
                    {unread
                      ? `${unread} unread update${
                          unread === 1 ? "" : "s"
                        }`
                      : "You're up to date"}
                  </p>
                </div>

                <button
                  type="button"
                  className="eh-close"
                  aria-label="Close notifications"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </header>

              <div
                className="eh-notification-tabs"
                role="tablist"
                aria-label="Notification views"
                onKeyDown={handleTabKeyboard}
              >
                {[
                  ["inbox", "Inbox"],
                  ["settings", "Settings"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    id={`${prefix}-${value}-tab`}
                    role="tab"
                    type="button"
                    aria-selected={tab === value}
                    aria-controls={
                      `${prefix}-${value}-panel`
                    }
                    tabIndex={
                      tab === value ? 0 : -1
                    }
                    onClick={() => chooseTab(value)}
                    disabled={busy}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="eh-notification-content">
                {error && (
                  <p
                    className="eh-notice eh-error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                {notice && (
                  <p
                    className="eh-notice"
                    role="status"
                  >
                    {notice}
                  </p>
                )}

                <div
                  role="tabpanel"
                  id={`${prefix}-inbox-panel`}
                  aria-labelledby={
                    `${prefix}-inbox-tab`
                  }
                  hidden={tab !== "inbox"}
                >
                  <div className="eh-inbox-tools">
                    <button
                      type="button"
                      disabled={busy || !unread}
                      onClick={() =>
                        perform(async () => {
                          await markAllEventHubNotificationsRead();

                          if (alive.current) {
                            setUnread(0);
                            setRevision(
                              (value) => value + 1
                            );
                          }
                        })
                      }
                    >
                      Mark all read
                    </button>

                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => {
                        setError("");
                        setRevision(
                          (value) => value + 1
                        );
                      }}
                    >
                      Refresh
                    </button>
                  </div>

                  {loading && !inbox ? (
                    <p role="status">
                      Loading updates…
                    </p>
                  ) : !inbox?.results?.length ? (
                    <div className="eh-inbox-empty">
                      <strong>
                        Your updates will appear here.
                      </strong>

                      <p>
                        Tickets, certificates, event
                        changes and team updates stay
                        together in this inbox.
                      </p>
                    </div>
                  ) : (
                    <ul className="eh-inbox-list">
                      {inbox.results.map((item) => (
                        <li
                          key={item.id}
                          className={
                            item.is_read
                              ? ""
                              : "is-unread"
                          }
                        >
                          <Link
                            to={item.href}
                            onClick={() => {
                              setOpen(false);

                              markEventHubNotificationRead(
                                item.id
                              )
                                .then(() => {
                                  if (alive.current) {
                                    setRevision(
                                      (value) =>
                                        value + 1
                                    );
                                  }
                                })
                                .catch(() => {});
                            }}
                          >
                            <span
                              className="eh-unread-dot"
                              aria-hidden="true"
                            />

                            <div>
                              <strong>
                                {item.title}
                              </strong>

                              <p>{item.body}</p>

                              <time
                                dateTime={
                                  item.updated_at
                                }
                              >
                                {formatDate(
                                  item.updated_at
                                )}
                              </time>
                            </div>
                          </Link>

                          {!item.is_read && (
                            <button
                              type="button"
                              className="eh-mark-read"
                              disabled={busy}
                              aria-label={
                                `Mark ${item.title} as read`
                              }
                              onClick={() =>
                                perform(async () => {
                                  await markEventHubNotificationRead(
                                    item.id
                                  );

                                  if (alive.current) {
                                    setRevision(
                                      (value) =>
                                        value + 1
                                    );
                                  }
                                })
                              }
                            >
                              Mark read
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="eh-inbox-pagination">
                    <button
                      type="button"
                      disabled={
                        loading ||
                        busy ||
                        page === 1
                      }
                      onClick={() =>
                        setPage(
                          (value) => value - 1
                        )
                      }
                    >
                      Previous
                    </button>

                    <span>Page {page}</span>

                    <button
                      type="button"
                      disabled={
                        loading ||
                        busy ||
                        !inbox?.next
                      }
                      onClick={() =>
                        setPage(
                          (value) => value + 1
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div
                  role="tabpanel"
                  id={`${prefix}-settings-panel`}
                  aria-labelledby={
                    `${prefix}-settings-tab`
                  }
                  hidden={tab !== "settings"}
                >
                  {!preferences ||
                  !configuration ? (
                    <p role="status">
                      Loading preferences…
                    </p>
                  ) : (
                    <>
                      <section className="eh-settings-section">
                        <h3>Device notifications</h3>

                        <p>
                          Your website inbox always
                          works. Device alerts are
                          optional and depend on your
                          browser settings.
                        </p>

                        {!device ? (
                          <p role="status">
                            Checking device alerts…
                          </p>
                        ) : device.error ? (
                          <p
                            className="eh-settings-help"
                            role="status"
                          >
                            {device.error}
                          </p>
                        ) : device.supported ? (
                          <>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                !configuration
                                  .push_configured
                              }
                              onClick={() =>
                                perform(toggleDevice)
                              }
                            >
                              {device.enabled
                                ? "Disable on this device"
                                : "Enable on this device"}
                            </button>

                            {!configuration
                              .push_configured && (
                              <p className="eh-settings-help">
                                Device delivery is not
                                configured yet. Your
                                notification inbox
                                remains available.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="eh-settings-help">
                            This browser does not
                            currently support device
                            alerts here. On iPhone/iPad,
                            try installing EventHub to
                            the Home Screen and opening
                            it there.
                          </p>
                        )}

                        <label className="eh-check">
                          <input
                            type="checkbox"
                            checked={
                              preferences.push_enabled
                            }
                            disabled={busy}
                            onChange={(event) =>
                              updatePreference(
                                "push_enabled",
                                event.target.checked
                              )
                            }
                          />

                          <span>
                            Allow device alerts on
                            linked devices
                          </span>
                        </label>
                      </section>

                      <section className="eh-settings-section">
                        <h3>WhatsApp updates</h3>

                        <p>
                          Choose WhatsApp for
                          registration confirmations
                          and important changes.
                          Certificates remain in your
                          EventHub inbox.
                        </p>

                        {preferences
                          .whatsapp_verified ? (
                          <>
                            <p className="eh-linked">
                              Verified:{" "}
                              {
                                preferences
                                  .whatsapp_phone
                              }
                            </p>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                perform(
                                  disconnectWhatsApp
                                )
                              }
                            >
                              Disconnect / change number
                            </button>
                          </>
                        ) : (
                          <>
                            <label
                              htmlFor={
                                `${prefix}-phone`
                              }
                            >
                              Your WhatsApp number

                              <input
                                id={`${prefix}-phone`}
                                type="tel"
                                autoComplete="tel"
                                value={phone}
                                placeholder="+919876543210"
                                maxLength={16}
                                disabled={busy}
                                onChange={(event) =>
                                  setPhone(
                                    event.target.value
                                      .replace(
                                        /\s/g,
                                        ""
                                      )
                                  )
                                }
                              />
                            </label>

                            <label className="eh-check">
                              <input
                                type="checkbox"
                                checked={consent}
                                disabled={busy}
                                onChange={(event) =>
                                  setConsent(
                                    event.target.checked
                                  )
                                }
                              />

                              <span>
                                I want EventHub
                                registration updates and
                                important event changes
                                on this WhatsApp number.
                              </span>
                            </label>

                            <button
                              type="button"
                              disabled={
                                busy ||
                                !consent ||
                                !configuration
                                  .whatsapp_configured
                              }
                              onClick={() =>
                                perform(async () => {
                                  const result =
                                    await connectEventHubWhatsApp(
                                      phone
                                    );

                                  if (alive.current) {
                                    setConnection(
                                      result
                                    );
                                  }
                                })
                              }
                            >
                              Link my WhatsApp
                            </button>

                            {!configuration
                              .whatsapp_configured && (
                              <p className="eh-settings-help">
                                WhatsApp is not
                                configured by the
                                administrator yet.
                              </p>
                            )}

                            {connection && (
                              <div className="eh-notice">
                                <p>
                                  {connection.message}
                                </p>

                                <a
                                  href={connection.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open WhatsApp to
                                  confirm ↗
                                </a>

                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    perform(
                                      checkWhatsAppConnection
                                    )
                                  }
                                >
                                  Check connection
                                </button>
                              </div>
                            )}
                          </>
                        )}

                        <label className="eh-check">
                          <input
                            type="checkbox"
                            checked={
                              preferences
                                .whatsapp_enabled
                            }
                            disabled={
                              busy ||
                              !preferences
                                .whatsapp_verified
                            }
                            onChange={(event) =>
                              updatePreference(
                                "whatsapp_enabled",
                                event.target.checked
                              )
                            }
                          />

                          <span>
                            Allow WhatsApp registration
                            and important event updates
                          </span>
                        </label>

                        <label
                          htmlFor={`${prefix}-channel`}
                        >
                          Preferred external channel

                          <select
                            id={`${prefix}-channel`}
                            value={
                              preferences
                                .preferred_channel
                            }
                            disabled={busy}
                            onChange={(event) =>
                              updatePreference(
                                "preferred_channel",
                                event.target.value
                              )
                            }
                          >
                            <option value="push">
                              Device notifications
                            </option>

                            <option
                              value="whatsapp"
                              disabled={
                                !preferences
                                  .whatsapp_verified
                              }
                            >
                              WhatsApp
                            </option>
                          </select>
                        </label>

                        <p className="eh-settings-help">
                          Eligible updates use your
                          preferred external channel.
                          If WhatsApp is unavailable
                          for an update, an enabled
                          device alert may be used.
                          The inbox remains the
                          permanent record.
                        </p>

                        <label className="eh-check">
                          <input
                            type="checkbox"
                            checked={
                              preferences
                                .whatsapp_marketing
                            }
                            disabled={
                              busy ||
                              !preferences
                                .whatsapp_verified ||
                              !configuration
                                .whatsapp_marketing_available
                            }
                            onChange={(event) =>
                              updatePreference(
                                "whatsapp_marketing",
                                event.target.checked
                              )
                            }
                          />

                          <span>
                            Also allow promotional
                            WhatsApp messages for event
                            categories I follow
                            (optional)
                          </span>
                        </label>
                      </section>

                      <section className="eh-settings-section">
                        <h3>What you hear about</h3>

                        <label className="eh-check">
                          <input
                            type="checkbox"
                            checked={
                              preferences.reminders
                            }
                            disabled={busy}
                            onChange={(event) =>
                              updatePreference(
                                "reminders",
                                event.target.checked
                              )
                            }
                          />

                          <span>
                            Remind me before events
                            I registered for
                          </span>
                        </label>

                        <p>
                          New-event alerts: choose
                          categories to follow. None
                          are selected automatically.
                        </p>

                        <div className="eh-category-options">
                          {categories.map(
                            (category) => (
                              <label
                                className="eh-check"
                                key={category}
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    preferences
                                      .event_categories
                                      .includes(
                                        category
                                      )
                                  }
                                  disabled={busy}
                                  onChange={(event) => {
                                    const checked =
                                      event.target
                                        .checked;

                                    setPreferences(
                                      (previous) => ({
                                        ...previous,
                                        event_categories:
                                          checked
                                            ? [
                                                ...previous.event_categories,
                                                category,
                                              ]
                                            : previous.event_categories.filter(
                                                (value) =>
                                                  value !==
                                                  category
                                              ),
                                      })
                                    );
                                  }}
                                />

                                <span>
                                  {category}
                                </span>
                              </label>
                            )
                          )}
                        </div>

                        <p className="eh-settings-help">
                          Verification, password
                          recovery and account-security
                          emails remain separate from
                          these preferences.
                        </p>
                      </section>

                      <button
                        type="button"
                        className="eh-primary"
                        disabled={busy}
                        onClick={() =>
                          perform(savePreferences)
                        }
                      >
                        {busy
                          ? "Saving…"
                          : "Save preferences"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
}