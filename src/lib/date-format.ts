// L3 — GEB
// Input: Locale, instants (ms, ISO strings or Dates), display options and the reader's date-format preference.
// Output: The site's one date, time and range format; preference read/write for Settings.
// Pos: [Map](L2-2.md); every page formats dates and times through here.
// Effects/Dependencies: Reads/writes localStorage `haneoka.date-format.v1`; dispatches `haneoka:date-format-change`.

export const DATE_FORMAT_KEY = "haneoka.date-format.v1";
export const DATE_FORMAT_EVENT = "haneoka:date-format-change";
export const DATE_FORMATS = ["long", "short", "iso"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const isDateFormat = (value: unknown): value is DateFormat =>
  (DATE_FORMATS as readonly unknown[]).includes(value);

let preference: DateFormat | undefined;

export function currentDateFormat(): DateFormat {
  if (preference) return preference;
  try {
    const stored = globalThis.localStorage?.getItem(DATE_FORMAT_KEY);
    preference = isDateFormat(stored) ? stored : "long";
  } catch {
    preference = "long";
  }
  return preference;
}

export function applyDateFormat(format: DateFormat) {
  preference = format;
  try {
    localStorage.setItem(DATE_FORMAT_KEY, format);
  } catch {
    // Private mode: the choice lasts for this page view.
  }
  window.dispatchEvent(new CustomEvent(DATE_FORMAT_EVENT, { detail: format }));
}

export interface DateFormatOptions {
  /** Hours and minutes after the date. */
  time?: boolean;
  seconds?: boolean;
  weekday?: boolean;
  /** `auto` shows the year only outside the current year. */
  year?: "auto" | "always" | "never";
  /** Defaults to the viewer's zone; date-only values pass `UTC`. */
  timeZone?: string;
  format?: DateFormat;
}

export type DateInput = number | string | Date | null | undefined;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
    value = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, value);
  }
  return value;
}

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const date =
    value instanceof Date ? value : new Date(typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

/** Calendar fields of an instant in a zone, as zero-padded strings. */
function fields(date: Date, timeZone?: string) {
  const parts = formatter("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function showYear(dates: Date[], options: DateFormatOptions): boolean {
  const mode = options.year ?? "auto";
  if (mode !== "auto") return mode === "always";
  const current = fields(new Date(), options.timeZone).year;
  return dates.some((date) => fields(date, options.timeZone).year !== current);
}

function timeText(locale: string, date: Date, options: DateFormatOptions): string {
  const format = options.format ?? currentDateFormat();
  if (format === "iso") {
    const value = fields(date, options.timeZone);
    return `${value.hour}:${value.minute}${options.seconds ? `:${value.second}` : ""}`;
  }
  return formatter(locale, {
    timeZone: options.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  }).format(date);
}

function dateText(locale: string, date: Date, options: DateFormatOptions, year: boolean): string {
  const format = options.format ?? currentDateFormat();
  const weekday = options.weekday
    ? formatter(locale, { timeZone: options.timeZone, weekday: "short" }).format(date)
    : "";
  if (format === "iso") {
    const value = fields(date, options.timeZone);
    return `${value.year}-${value.month}-${value.day}${weekday ? ` ${weekday}` : ""}`;
  }
  return formatter(locale, {
    timeZone: options.timeZone,
    month: format === "long" ? "short" : "numeric",
    day: "numeric",
    ...(year ? { year: "numeric" as const } : {}),
    ...(options.weekday ? { weekday: "short" as const } : {}),
  }).format(date);
}

function joined(locale: string, date: Date, options: DateFormatOptions, year: boolean): string {
  const day = dateText(locale, date, options, year);
  return options.time ? `${day} ${timeText(locale, date, options)}` : day;
}

/** One instant in the site's date format; empty for a missing or invalid value. */
export function formatDate(locale: string, value: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(value);
  return date ? joined(locale, date, options, showYear([date], options)) : "";
}

/** A time of day in the site's format. */
export function formatTime(locale: string, value: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(value);
  return date ? timeText(locale, date, options) : "";
}

/** A window; the end drops its date when both ends fall on the same day. */
export function formatDateRange(
  locale: string,
  start: DateInput,
  end: DateInput,
  options: DateFormatOptions = {},
): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return from ? formatDate(locale, from, options) : to ? formatDate(locale, to, options) : "";
  const year = showYear([from, to], options);
  const a = fields(from, options.timeZone);
  const b = fields(to, options.timeZone);
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  const head = joined(locale, from, options, year);
  if (sameDay) return options.time ? `${head} – ${timeText(locale, to, options)}` : head;
  return `${head} – ${joined(locale, to, options, year)}`;
}

/** The machine-readable value for a `<time datetime>` attribute. */
export function dateTimeAttribute(value: DateInput): string {
  return toDate(value)?.toISOString() ?? "";
}
