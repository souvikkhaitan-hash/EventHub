import { deleteEventHubPush, getEventHubPushStatus, registerEventHubPush } from "./events";

function supported() {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function publicKey(value) {
  const decoded = atob((value + "=".repeat((4 - value.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function deviceStatus() {
  if (!supported()) return { supported:false, enabled:false, permission:"unsupported" };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  let enabled = false;
  if (subscription) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint));
    const key = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
    enabled = (await getEventHubPushStatus(key)).enabled;
  }
  return { supported:true, enabled, permission:Notification.permission };
}

export async function enableDeviceNotifications(vapidKey) {
  if (!supported()) throw new Error("Device notifications need a supported browser and a secure connection. The website inbox still works.");
  // Called only after the user presses Enable, preserving the browser's user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Device alerts were not enabled. You can still use the EventHub notification inbox.");
  const current = await navigator.serviceWorker.getRegistration("/");
  if (current?.active && !current.active.scriptURL.endsWith("/eventhub-notifications-sw.js")) {
    throw new Error("This site already has a service worker. Merge the notification handlers before enabling alerts.");
  }
  await navigator.serviceWorker.register("/eventhub-notifications-sw.js", { scope:"/" });
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:publicKey(vapidKey) });
  const data = subscription.toJSON();
  await registerEventHubPush({ endpoint:data.endpoint, keys:data.keys });
  return { supported:true, enabled:true, permission:"granted" };
}

export async function disableDeviceNotifications() {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    try { await deleteEventHubPush(subscription.endpoint); }
    finally { await subscription.unsubscribe(); }
  }
}
