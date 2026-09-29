// Time-zone helpers for receipts and reports (Pacific Time by default).

export function formatDateTime(iso: string | null | undefined, timeZone: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export const formatTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

// UTC offset (ms) of a time zone at a given instant.
function tzOffset(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
}

// Start/end instants of a calendar day (YYYY-MM-DD) in the given time zone.
export function dayRange(date: string, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number);
  const at = (day: number) => {
    const guess = Date.UTC(y, m - 1, day);
    return new Date(guess - tzOffset(guess - tzOffset(guess, timeZone), timeZone));
  };
  return { start: at(d).toISOString(), end: at(d + 1).toISOString() };
}

export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

export const dayKey = (iso: string, timeZone: string) => todayIn(timeZone, new Date(iso));
