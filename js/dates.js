const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAYS_LONG = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export function weekday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return formatUTC(dt);
}

export function daysBetween(startIso, endIso) {
  const [y1, m1, d1] = startIso.split("-").map(Number);
  const [y2, m2, d2] = endIso.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

export function daysInMonth(isoOrYm) {
  const [y, m] = isoOrYm.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

export function todayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export function seoulDateTime(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return { date: "", time: "" };
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(dt);
  const [h, min] = time.split(":");
  return { date, time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}

export function monthGrid(ym) {
  const first = `${ym}-01`;
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDates(iso) {
  const start = addDays(iso, -weekday(iso));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatYearMonth(ym) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function formatMonthDay(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

export function formatFull(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일 ${WEEKDAYS_LONG[weekday(iso)]}`;
}

export function formatWeekRange(iso) {
  const days = weekDates(iso);
  const start = days[0];
  const end = days[6];
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${formatMonthDay(start)} – ${Number(end.slice(8))}일`;
  }
  return `${formatMonthDay(start)} – ${formatMonthDay(end)}`;
}

export function weekdayLabel(iso, long = false) {
  return (long ? WEEKDAYS_LONG : WEEKDAYS)[weekday(iso)];
}

export { WEEKDAYS, WEEKDAYS_LONG };

function formatUTC(dt) {
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
