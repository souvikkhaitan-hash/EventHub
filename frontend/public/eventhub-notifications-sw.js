/* No private page/API caching. All access checks remain with Django. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* Show a generic alert. */ }
  const parsed = new URL(typeof data.url === "string" ? data.url : "/", self.location.origin);
  const url = parsed.origin === self.location.origin ? parsed.href : self.location.origin;
  event.waitUntil(self.registration.showNotification("EventHub", {
    body: data.body || "You have a new EventHub notification.",
    icon:"/eventhub-logo.svg", badge:"/eventhub-logo.svg",
    tag:data.tag || "eventhub-update", data:{ url },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || "/", self.location.origin);
  const url = requested.origin === self.location.origin ? requested.href : self.location.origin;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) { await client.navigate(url); return client.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
