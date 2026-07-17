/**
 * Computes the start of "today" IN THE COMPANY'S timezone, not the
 * server's. Reuses Company.timezone, set at registration and editable
 * from Settings — without this, "Orders today" would silently mean "today
 * in whatever timezone the server happens to run in," which is wrong the
 * moment your server and a customer's operation aren't in the same zone.
 */
export function startOfTodayInTimezone(timezone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');

  // Constructing "YYYY-MM-DDT00:00:00" and parsing it as being IN that
  // timezone requires knowing the zone's current UTC offset — derived by
  // comparing the formatted local wall-clock time against `now` itself.
  const localMidnightUtcGuess = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const offsetMs = getTimezoneOffsetMs(timezone, now);
  return new Date(localMidnightUtcGuess.getTime() - offsetMs);
}

function getTimezoneOffsetMs(timezone: string, at: Date): number {
  const utcString = at.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzString = at.toLocaleString('en-US', { timeZone: timezone });
  return new Date(utcString).getTime() - new Date(tzString).getTime();
}
