/** Formats a timestamp in the business time zone, e.g. "2:40 PM". */
export function formatClock(value, timeZone) {
  if (value == null) return '—';
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  }
}

export function minutesBetween(fromIso, toMs) {
  if (!fromIso) return 0;
  return Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 60_000));
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${m} min`;
}

/** Value for <input type="datetime-local"> in the device's local time. */
export function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
