import type { Minutes } from "./types.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function fmt(m: Minutes | null | undefined): string {
  if (m === null || m === undefined) return "—";
  const day = Math.floor(m / 1440);
  const rem = ((m % 1440) + 1440) % 1440;
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return `${DAYS[((day % 7) + 7) % 7]} ${hh}:${mm}`;
}

export function fmtDur(min: number | null): string {
  if (min === null) return "—";
  const sign = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  return h ? `${sign}${h} h ${String(m).padStart(2, "0")} min` : `${sign}${m} min`;
}

// Spanish day names for household SMS. Kept inside the GSM-7 alphabet ("é" is in it, "á" is not),
// so one accent doesn't triple the number of SMS.
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sab", "dom"];
export function fmtEs(m: Minutes): string {
  const day = Math.floor(m / 1440);
  const rem = ((m % 1440) + 1440) % 1440;
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return `${DIAS[((day % 7) + 7) % 7]} ${hh}:${mm}`;
}

/** "Wed 14:30" style input → minutes. Returns null if it can't parse. */
export function parseSlot(day: number, hhmm: string): Minutes | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59 || day < 0 || day > 6) return null;
  return day * 1440 + h * 60 + mi;
}
