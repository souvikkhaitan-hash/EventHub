export const eventCategories = [
  { value: "all", label: "All Events" },
  { value: "technical", label: "Tech & Build" },
  { value: "cultural", label: "Culture & Art" },
  { value: "workshop", label: "Workshops" },
  { value: "seminar", label: "Seminars" },
  { value: "sports", label: "Sports" },
];

export function getCategoryLabel(category) {
  const found = eventCategories.find(
    (item) => item.value === category
  );

  return found?.label || category;
}

export function formatEventDate(value) {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function formatEventTime(value) {
  if (!value) return "Time unavailable";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function formatEventDateTime(value) {
  return `${formatEventDate(value)} · ${formatEventTime(value)} IST`;
}