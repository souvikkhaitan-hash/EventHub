// ============================================================
// EVENTHUB — API SERVICE
// React + Django REST Framework
// ============================================================

const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:8000"
    );
// Django CSRF endpoint
const CSRF_URL = `${API_BASE}/api/auth/csrf/`;


// ============================================================
// RESPONSE HANDLING
// ============================================================

async function readResponse(response) {
  const contentType =
    response.headers.get("content-type") || "";

  let data = {};

  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => ({}));
  } else {
    await response.text().catch(() => "");
  }

  if (!response.ok) {
    let message =
      data.message ||
      data.detail ||
      data.error;

    // Handle Django REST Framework validation errors.
    if (!message && data && typeof data === "object") {
      const validationMessages = Object.entries(data)
        .map(([field, value]) => {
          const text = Array.isArray(value)
            ? value.join(", ")
            : typeof value === "string"
              ? value
              : JSON.stringify(value);

          return `${field}: ${text}`;
        })
        .join("; ");

      message = validationMessages;
    }

    if (!message || typeof message !== "string") {
      message = `Request failed (HTTP ${response.status}).`;
    }

    const error = new Error(message);

    error.details = data;
    error.status = response.status;

    throw error;
  }

  return data;
}


// ============================================================
// AUTHENTICATION
// ============================================================

// Retrieve currently logged-in user.
export async function getCurrentUser() {
  const response = await fetch(
    `${API_BASE}/api/auth/me/`,
    {
      credentials: "include",
    }
  );

  return readResponse(response);
}


// ============================================================
// CSRF PROTECTION
// ============================================================

async function getCsrfToken() {
  const response = await fetch(CSRF_URL, {
    credentials: "include",
  });

  const data = await readResponse(response);

  return data.csrfToken;
}


// ============================================================
// COMMON API REQUEST HELPER
// ============================================================

async function apiRequest(
  path,
  method = "GET",
  body = null,
  responseType = "json",
  signal
) {
  const headers = {
    Accept:
      responseType === "blob"
        ? "application/pdf, image/png, application/json"
        : "application/json",
  };

  const unsafeMethod = ![
    "GET",
    "HEAD",
    "OPTIONS",
    "TRACE",
  ].includes(method.toUpperCase());

  if (unsafeMethod) {
    headers["X-CSRFToken"] = await getCsrfToken();
  }

  const isFormData = body instanceof FormData;

  if (body !== null && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    signal,
    body:
      body === null
        ? undefined
        : isFormData
          ? body
          : JSON.stringify(body),
  });

  // Preserve the existing JSON error handling.
  if (!response.ok) {
    return readResponse(response);
  }

  if (responseType === "blob") {
    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType.startsWith("application/pdf") &&
      !contentType.startsWith("image/png")
    ) {
      throw new Error(
        "The server returned an unexpected file format."
      );
    }

    return response.blob();
  }

  return readResponse(response);
}

// ============================================================
// ORGANIZER EVENT MANAGEMENT
// ============================================================

// Retrieve all events owned by the organizer.
export function getOrganizerEvents() {
  return apiRequest("/api/events/manage/");
}

// Retrieve one organizer event.
export function getOrganizerEvent(id) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(id)}/`
  );
}

// Create a new event.
export function createEvent(data) {
  return apiRequest(
    "/api/events/manage/",
    "POST",
    data
  );
}

// Update event details.
export function updateEvent(id, data) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(id)}/`,
    "PATCH",
    data
  );
}

// Publish a draft event.
export function publishEvent(id) {
  return updateEvent(id, {
    status: "published",
  });
}

// Cancel an event.
export function cancelEvent(id) {
  return updateEvent(id, {
    status: "cancelled",
  });
}


// ============================================================
// PUBLIC EVENT DISCOVERY
// ============================================================

// Retrieve published events.
export function getPublicEvents(signal) {
  return apiRequest("/api/events/", "GET", null, "json", signal);
}

// Retrieve event details.
export function getPublicEvent(id) {
  return apiRequest(
    `/api/events/${encodeURIComponent(id)}/`
  );
}


// ============================================================
// STUDENT — INDIVIDUAL REGISTRATION
// ============================================================

// Register student for an individual event.
export function registerForEvent(eventId) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/register/`,
    "POST",
    {}
  );
}

// Retrieve student's event registrations.
export function getMyRegistrations() {
  return apiRequest("/api/registrations/");
}

// Cancel an individual registration.
export function cancelRegistration(registrationId) {
  return apiRequest(
    `/api/registrations/${encodeURIComponent(registrationId)}/cancel/`,
    "POST",
    {}
  );
}


// ============================================================
// ORGANIZER — PARTICIPANTS
// ============================================================

export function getOrganizerParticipants(eventId) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/participants/`
  );
}


// ============================================================
// STUDENT — DIGITAL TICKETS
// ============================================================

export function getStudentTicket(registrationId) {
  return apiRequest(
    `/api/registrations/${encodeURIComponent(registrationId)}/ticket/`
  );
}


// ============================================================
// ORGANIZER — ATTENDANCE
// ============================================================

// Retrieve event attendance statistics.
export function getOrganizerAttendance(eventId) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/attendance/`
  );
}

// Verify a QR ticket and check in a student.
export function checkInStudent(eventId, token) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/check-in/`,
    "POST",
    { token }
  );
}


// ============================================================
// ORGANIZER — ANALYTICS
// ============================================================

// Retrieve overall organizer analytics.
export function getOrganizerAnalytics() {
  return apiRequest("/api/analytics/overview/");
}

// Retrieve event-specific registration growth.
export function getEventRegistrationGrowth(eventId) {
  return apiRequest(
    `/api/analytics/events/${encodeURIComponent(eventId)}/registration-growth/`
  );
}


// ============================================================
// TEAM REGISTRATION — API CONFIGURATION
// ============================================================

// IMPORTANT:
// This prefix must match Django's registered team URLs.
//
// Expected paths:
// /api/team-events/<event_id>/create/
// /api/team-events/<event_id>/join/
// /api/team-events/<event_id>/my-team/
// /api/teams/<team_id>/confirm/
// /api/teams/<team_id>/leave/
// /api/teams/<team_id>/withdraw/
// /api/organizer/events/<event_id>/teams/

const TEAM_API_BASE = "/api";

const teamPath = (id) => encodeURIComponent(id);


// ============================================================
// TEAM — CREATE
// ============================================================

// Student creates a new team and becomes its leader.
export function createEventTeam(eventId, name) {
  return apiRequest(
    `${TEAM_API_BASE}/team-events/${teamPath(eventId)}/create/`,
    "POST",
    { name }
  );
}


// ============================================================
// TEAM — JOIN
// ============================================================

// Student joins an existing team using an invitation code.
export function joinEventTeam(eventId, invitation_code) {
  return apiRequest(
    `${TEAM_API_BASE}/team-events/${teamPath(eventId)}/join/`,
    "POST",
    { invitation_code }
  );
}


// ============================================================
// TEAM — MY TEAM
// ============================================================

// Retrieve the logged-in student's team for an event.
//
// A 404 response means the student is not in a team.
export function getMyEventTeam(eventId) {
  return apiRequest(
    `${TEAM_API_BASE}/team-events/${teamPath(eventId)}/my-team/`
  );
}


// ============================================================
// TEAM — CONFIRM
// ============================================================

// Team leader confirms the roster.
//
// The team must satisfy minimum membership requirements.
export function confirmEventTeam(teamId) {
  return apiRequest(
    `${TEAM_API_BASE}/teams/${teamPath(teamId)}/confirm/`,
    "POST",
    {}
  );
}


// ============================================================
// TEAM — LEAVE
// ============================================================

// A regular member leaves a forming team.
export function leaveEventTeam(teamId) {
  return apiRequest(
    `${TEAM_API_BASE}/teams/${teamPath(teamId)}/leave/`,
    "POST",
    {}
  );
}


// ============================================================
// TEAM — WITHDRAW
// ============================================================

// Team leader withdraws a forming team.
export function withdrawEventTeam(teamId) {
  return apiRequest(
    `${TEAM_API_BASE}/teams/${teamPath(teamId)}/withdraw/`,
    "POST",
    {}
  );
}


// ============================================================
// ORGANIZER — TEAM MANAGEMENT
// ============================================================

// Retrieve all teams registered for an organizer's event.
export function getOrganizerEventTeams(eventId) {
  return apiRequest(
    `${TEAM_API_BASE}/organizer/events/${teamPath(eventId)}/teams/`
  );
}

// ============================================================
// CERTIFICATE TEMPLATES
// ============================================================

export function getCertificateTemplates(eventId) {
  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/templates/`
  );
}

export function uploadCertificateTemplate(eventId, name, file) {
  const form = new FormData();

  form.append("name", name);
  form.append("background", file);

  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/templates/`,
    "POST",
    form
  );
}

export function saveCertificateLayout(
  templateId,
  baseVersion,
  fields,
  images
) {
  return apiRequest(
    `/api/certificates/templates/${encodeURIComponent(templateId)}/versions/`,
    "POST",
    {
      base_version: baseVersion,
      fields,
      ...(images === undefined ? {} : { images }),
    }
  );
}

export function getCertificateBackground(versionId, signal) {
  return apiRequest(
    `/api/certificates/versions/${encodeURIComponent(versionId)}/background/`,
    "GET",
    null,
    "blob",
    signal
  );
}

export function generateCertificatePreview(
  versionId,
  sampleName,
  fields,
  images
) {
  return apiRequest(
    `/api/certificates/versions/${encodeURIComponent(versionId)}/preview/`,
    "POST",
    {
      sample_name: sampleName,
      fields,
      ...(images === undefined ? {} : { images }),
    },
    "blob"
  );
}

export function getCertificateAssets(templateId, signal) {
  return apiRequest(
    `/api/certificates/templates/${encodeURIComponent(templateId)}/assets/`,
    "GET",
    null,
    "json",
    signal
  );
}

export function uploadCertificateAsset(templateId, name, file) {
  const form = new FormData();

  form.append("name", name);
  form.append("image", file);

  return apiRequest(
    `/api/certificates/templates/${encodeURIComponent(templateId)}/assets/`,
    "POST",
    form
  );
}

export function getCertificateAssetImage(assetId, signal) {
  return apiRequest(
    `/api/certificates/assets/${encodeURIComponent(assetId)}/image/`,
    "GET",
    null,
    "blob",
    signal
  );
}

export function getCertificateRecipients(
  eventId,
  { page = 1, search = "" } = {},
  signal
) {
  const query = new URLSearchParams({
    page: String(page),
    search,
  });

  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/recipients/?${query}`,
    "GET",
    null,
    "json",
    signal
  );
}

export function generateParticipantCertificatePreview(
  versionId,
  registrationId,
  participantName
) {
  return apiRequest(
    `/api/certificates/versions/${encodeURIComponent(versionId)}/recipient-preview/`,
    "POST",
    {
      registration_id: registrationId,
      participant_name: participantName.trim(),
    },
    "blob"
  );
}
export function getCertificateBatches(eventId, page = 1, signal) {
  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/batches/?page=${encodeURIComponent(page)}`,
    "GET",
    null,
    "json",
    signal
  );
}

export function createCertificateBatch(eventId, payload) {
  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/batches/`,
    "POST",
    payload
  );
}

export function getCertificateBatch(batchId) {
  return apiRequest(
    `/api/certificates/batches/${encodeURIComponent(batchId)}/`
  );
}

export function getGeneratedCertificateDocument(certificateId) {
  return apiRequest(
    `/api/certificates/documents/${encodeURIComponent(certificateId)}/`,
    "GET",
    null,
    "blob"
  );
}
export function publishCertificateBatch(batchId, reviewHash) {
  return apiRequest(
    `/api/certificates/batches/${encodeURIComponent(batchId)}/publish/`,
    "POST",
    {
      review_hash: reviewHash,
      confirm_review: true,
    }
  );
}

export function getMyCertificates(page = 1, signal) {
  return apiRequest(
    `/api/certificates/mine/?page=${encodeURIComponent(page)}`,
    "GET",
    null,
    "json",
    signal
  );
}

export function getMyCertificateDocument(certificateId) {
  return apiRequest(
    `/api/certificates/mine/${encodeURIComponent(certificateId)}/document/`,
    "GET",
    null,
    "blob"
  );
}
export function getCertificateRevocation(certificateId, signal) {
  return apiRequest(
    `/api/certificates/documents/${certificateId}/revocation/`,
    "GET",
    null,
    "json",
    signal
  );
}

export function revokeCertificate(certificateId, payload) {
  return apiRequest(
    `/api/certificates/documents/${certificateId}/revocation/`,
    "POST",
    payload
  );
}

export function verifyCertificate(certificateId, signal) {
  return apiRequest(
    `/api/certificates/verify/${certificateId}/`,
    "GET",
    null,
    "json",
    signal
  );
}
export function getAwardResults(eventId, page = 1, signal) {
  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/results/?page=${page}`,
    "GET",
    null,
    "json",
    signal
  );
}

export function recordAwardResult(eventId, payload) {
  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/results/`,
    "POST",
    payload
  );
}

export function withdrawAwardResult(resultId, reason) {
  return apiRequest(
    `/api/certificates/results/${encodeURIComponent(resultId)}/withdraw/`,
    "POST",
    {
      reason: reason.trim(),
      confirm: true,
    }
  );
}

export function getAwardResultRecipients(resultId, signal) {
  return apiRequest(
    `/api/certificates/results/${encodeURIComponent(resultId)}/recipients/`,
    "GET",
    null,
    "json",
    signal
  );
}

export function getAwardTeamCandidates(eventId, signal) {
  return apiRequest(
    `/api/organizer/events/${encodeURIComponent(eventId)}/teams/`,
    "GET",
    null,
    "json",
    signal
  );
}

export function generateAwardRecipientPreview(
  versionId,
  resultId,
  registrationId,
  name
) {
  return apiRequest(
    `/api/certificates/versions/${encodeURIComponent(versionId)}/award-preview/`,
    "POST",
    {
      award_result_id: resultId,
      registration_id: registrationId,
      participant_name: name.trim(),
    },
    "blob"
  );
}

// ============================================================
// EVENT STAFF
// ============================================================

export function getMyEventAccess(eventId) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/my-access/`
  );
}

export function getEventStaff(eventId) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/staff/`
  );
}

export function addEventStaff(eventId, data) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/staff/`,
    "POST",
    data
  );
}

export function updateEventStaff(eventId, membershipId, data) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/staff/${encodeURIComponent(membershipId)}/`,
    "PATCH",
    data
  );
}

export function lookupAttendanceParticipant(
  eventId,
  kind,
  query,
  signal
) {
  const parameters = new URLSearchParams({
    kind,
    query: query.trim(),
  });

  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/attendance-lookup/?${parameters}`,
    "GET",
    null,
    "json",
    signal
  );
}

export function checkInRegisteredStudent(eventId, registrationId) {
  return apiRequest(
    `/api/events/manage/${encodeURIComponent(eventId)}/check-in/`,
    "POST",
    { registration_id: registrationId }
  );
}

export async function downloadAttendanceExport(
  eventId,
  report = "attendance",
  fileType = "xlsx"
) {
  const query = new URLSearchParams({
    report,
    file_type: fileType,
  });

  const expectedType =
    fileType === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv";

  const response = await fetch(
    `${API_BASE}/api/events/manage/${encodeURIComponent(eventId)}/attendance-export/?${query}`,
    {
      credentials: "include",
        headers: {
        Accept: "*/*",
      },
    }
  );

  if (!response.ok) {
    return readResponse(response);
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes(expectedType)) {
    throw new Error(
      "The server returned an unexpected export format."
    );
  }

  return response.blob();
}

export async function downloadEventReference(eventId) {
  const response = await fetch(
    `${API_BASE}/api/events/manage/${encodeURIComponent(eventId)}/reference-download/`,
    {
      credentials: "include",
      headers: {
        Accept: "*/*",
      },
    }
  );

  if (!response.ok) {
    return readResponse(response);
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(
      "The server returned an unexpected reference format."
    );
  }

  return response.blob();
}
// Append to your existing frontend/src/services/events.js, below the certificate workflow additions.
export function getEventHubNotifications(page=1, signal) {
  return apiRequest(`/api/notifications/?page=${encodeURIComponent(page)}`,"GET",null,"json",signal);
}
export function markEventHubNotificationRead(id) {
  return apiRequest(`/api/notifications/${encodeURIComponent(id)}/read/`,"POST",{});
}
export function markAllEventHubNotificationsRead() {
  return apiRequest("/api/notifications/","POST",{action:"read_all"});
}
export function getEventHubNotificationPreferences() { return apiRequest("/api/notifications/preferences/"); }
export function updateEventHubNotificationPreferences(data) { return apiRequest("/api/notifications/preferences/","PATCH",data); }
export function getEventHubNotificationConfig() { return apiRequest("/api/notifications/config/"); }
export function registerEventHubPush(data) { return apiRequest("/api/notifications/subscriptions/","POST",data); }
export function getEventHubPushStatus(hash) { return apiRequest(`/api/notifications/subscriptions/?endpoint_hash=${encodeURIComponent(hash)}`); }
export function deleteEventHubPush(endpoint) { return apiRequest("/api/notifications/subscriptions/","DELETE",{endpoint}); }
export function connectEventHubWhatsApp(phone) { return apiRequest("/api/notifications/whatsapp/connect/","POST",{phone,consent:true}); }
export function disconnectEventHubWhatsApp() { return apiRequest("/api/notifications/whatsapp/connect/","DELETE",{}); }

// Append to frontend/src/services/events.js. Keep the existing apiRequest helper.

export function getCertificateWorkflowReview(eventId, versionId, signal) {
  return apiRequest(
    `/api/certificates/events/${encodeURIComponent(eventId)}/workflow-review/?template_version_id=${encodeURIComponent(versionId)}`,
    "GET", null, "json", signal
  );
}

export function getCertificateWorkflows(eventId, signal) {
  return apiRequest(`/api/certificates/events/${encodeURIComponent(eventId)}/workflows/`, "GET", null, "json", signal);
}

export function createCertificateWorkflow(eventId, payload) {
  return apiRequest(`/api/certificates/events/${encodeURIComponent(eventId)}/workflows/`, "POST", payload);
}

export function getCertificateWorkflow(workflowId, signal) {
  return apiRequest(`/api/certificates/workflows/${encodeURIComponent(workflowId)}/`, "GET", null, "json", signal);
}

export function changeCertificateWorkflow(workflowId, payload) {
  return apiRequest(`/api/certificates/workflows/${encodeURIComponent(workflowId)}/`, "POST", payload);
}
// Append to your existing frontend/src/services/events.js.
export function getEventCommunication(eventId, options = {}, signal) {
  const query = new URLSearchParams({
    tab: options.tab || "announcements", page: String(options.page || 1),
    manage: options.manage ? "1" : "0", search: options.search || "",
    unanswered: options.unanswered ? "1" : "0",
  });
  return apiRequest(`/api/communication/events/${encodeURIComponent(eventId)}/?${query}`, "GET", null, "json", signal);
}
export function createEventAnnouncement(eventId, payload) {
  return apiRequest(`/api/communication/events/${encodeURIComponent(eventId)}/announcements/`, "POST", payload);
}
export function changeEventAnnouncement(eventId, itemId, payload) {
  return apiRequest(`/api/communication/events/${encodeURIComponent(eventId)}/announcements/${encodeURIComponent(itemId)}/`, "POST", payload);
}
export function createEventQuestion(eventId, payload) {
  return apiRequest(`/api/communication/events/${encodeURIComponent(eventId)}/questions/`, "POST", payload);
}
export function changeEventQuestion(eventId, itemId, payload) {
  return apiRequest(`/api/communication/events/${encodeURIComponent(eventId)}/questions/${encodeURIComponent(itemId)}/`, "POST", payload);
}
