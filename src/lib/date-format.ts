// L3 — GEB
// Input: Locale, instants (ms, ISO strings or Dates), display options and the reader's date/time preferences.
// Output: The site's one date, time and range format; preference read/write for Settings.
// Pos: [Map](L2-2.md); every page formats dates and times through here.
// Effects/Dependencies: Reads/writes localStorage `haneoka.date-format.v3`; dispatches `haneoka:date-format-change`.

export const DATE_FORMAT_KEY = "haneoka.date-format.v3";
export const DATE_FORMAT_EVENT = "haneoka:date-format-change";

/** Every choice Settings offers, by preference key. The first value is the default. */
export const DATE_CHOICES = {
  order: ["auto", "mdy", "dmy", "ymd"],
  month: ["short", "long", "numeric", "2-digit"],
  day: ["numeric", "2-digit", "ordinal"],
  separator: ["/", "-", ".", " "],
  year: ["auto", "always", "never"],
  yearDigits: ["numeric", "2-digit"],
  weekday: ["none", "short", "long", "narrow"],
  cycle: ["h23", "h12"],
  hour: ["2-digit", "numeric"],
  seconds: ["off", "on"],
  zoneName: ["none", "short", "shortOffset", "long"],
} as const;

export type DateChoiceKey = keyof typeof DATE_CHOICES;
export type DatePreferences = { [K in DateChoiceKey]: (typeof DATE_CHOICES)[K][number] } & {
  /** `local` or an IANA zone. */
  zone: string;
};

const DEFAULTS = {
  ...(Object.fromEntries(Object.entries(DATE_CHOICES).map(([key, values]) => [key, values[0]])) as {
    [K in DateChoiceKey]: (typeof DATE_CHOICES)[K][number];
  }),
  zone: "local",
} satisfies DatePreferences;

export const isDateChoiceKey = (key: string): key is DateChoiceKey => Object.hasOwn(DATE_CHOICES, key);
export const isDateChoice = <K extends DateChoiceKey>(key: K, value: unknown): value is DatePreferences[K] =>
  (DATE_CHOICES[key] as readonly unknown[]).includes(value);

export function isTimeZone(value: unknown): value is string {
  if (value === "local") return true;
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

let preferences: DatePreferences | undefined;

export function datePreferences(): DatePreferences {
  if (preferences) return preferences;
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(globalThis.localStorage?.getItem(DATE_FORMAT_KEY) || "{}") || {};
  } catch {
    // Unreadable storage keeps the defaults.
  }
  const next: DatePreferences = { ...DEFAULTS };
  for (const key of Object.keys(DATE_CHOICES) as DateChoiceKey[])
    if (isDateChoice(key, stored[key])) (next as Record<string, unknown>)[key] = stored[key];
  if (isTimeZone(stored.zone)) next.zone = stored.zone;
  preferences = next;
  return next;
}

export function setDatePreferences(change: Partial<DatePreferences>) {
  preferences = { ...datePreferences(), ...change };
  try {
    localStorage.setItem(DATE_FORMAT_KEY, JSON.stringify(preferences));
  } catch {
    // Private mode: the choice lasts for this page view.
  }
  (globalThis as typeof globalThis & EventTarget).dispatchEvent(new CustomEvent(DATE_FORMAT_EVENT, { detail: preferences }));
}

export interface DateFormatOptions {
  /** Hours and minutes after the date. */
  time?: boolean;
  /** Seconds after the minutes; defaults to the reader's preference. */
  seconds?: boolean;
  /** Weekday beside the date; `true` uses the reader's style, or short when they show none. */
  weekday?: boolean;
  /** `auto` follows the reader. */
  year?: "auto" | "always" | "never";
  /** A fixed zone for values that are not instants (`UTC` for calendar days); defaults to the reader's zone. */
  timeZone?: string;
  /** Overrides the stored preferences (Settings samples). */
  preferences?: Partial<DatePreferences>;
}

export type DateInput = number | string | Date | null | undefined;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    if (formatters.size >= 128) formatters.delete(formatters.keys().next().value!);
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

interface Resolved extends DatePreferences {
  locale: string;
  timeZone: string | undefined;
  /** Instants show the zone label; fixed-zone calendar values do not. */
  instant: boolean;
  time: boolean;
}

function resolve(locale: string, options: DateFormatOptions): Resolved {
  const stored = { ...datePreferences(), ...options.preferences };
  const weekday =
    options.weekday === false ? "none" : options.weekday && stored.weekday === "none" ? "short" : stored.weekday;
  return {
    ...stored,
    locale,
    order: stored.order === "auto" ? (locale.startsWith("en") ? "mdy" : "ymd") : stored.order,
    weekday,
    seconds: options.seconds === undefined ? stored.seconds : options.seconds ? "on" : "off",
    year: options.year === "never" || options.year === "always" ? options.year : stored.year,
    timeZone: options.timeZone ?? (stored.zone === "local" ? undefined : stored.zone),
    instant: options.timeZone === undefined,
    time: options.time === true,
  };
}

/** Calendar fields of an instant in a zone. */
function fields(date: Date, timeZone?: string) {
  const parts = formatter("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

function showYear(dates: Date[], settings: Resolved): boolean {
  if (settings.year !== "auto") return settings.year === "always";
  const current = fields(new Date(), settings.timeZone).year;
  return dates.some((date) => fields(date, settings.timeZone).year !== current);
}

function timeText(date: Date, settings: Resolved): string {
  return formatter(settings.locale, {
    timeZone: settings.timeZone,
    hour: settings.hour,
    minute: "2-digit",
    ...(settings.seconds === "on" ? { second: "2-digit" as const } : {}),
    ...(settings.instant && settings.zoneName !== "none" ? { timeZoneName: settings.zoneName } : {}),
    hourCycle: settings.cycle,
  }).format(date);
}

const CJK = /^(?:ja|zh)/u;
const ordinals = new Map<string, Intl.PluralRules>();
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };

function dateText(date: Date, settings: Resolved, year: boolean): string {
  const { locale, order, timeZone } = settings;
  const part = (options: Intl.DateTimeFormatOptions) => formatter(locale, { timeZone, ...options }).format(date);
  const value = fields(date, timeZone);
  const yearNumber = settings.yearDigits === "2-digit" ? value.year.slice(-2) : value.year;
  let text: string;
  if (settings.month === "numeric" || settings.month === "2-digit") {
    const pad = (text: string, padded: boolean) => (padded ? text : String(Number(text)));
    const month = pad(value.month, settings.month === "2-digit");
    const day = pad(value.day, settings.day === "2-digit");
    const shown = year ? yearNumber : "";
    const pieces = order === "mdy" ? [month, day, shown] : order === "dmy" ? [day, month, shown] : [shown, month, day];
    text = pieces.filter(Boolean).join(settings.separator);
  } else {
    const month = part({ month: settings.month });
    let day = part({ day: settings.day === "2-digit" ? "2-digit" : "numeric" });
    if (settings.day === "ordinal" && locale.startsWith("en")) {
      let rules = ordinals.get(locale);
      if (!rules) ordinals.set(locale, (rules = new Intl.PluralRules(locale, { type: "ordinal" })));
      day = `${Number(value.day)}${SUFFIX[rules.select(Number(value.day))] ?? "th"}`;
    }
    const yearText = year ? part({ year: settings.yearDigits }) : "";
    const tight = CJK.test(locale);
    const join = (items: string[]) => items.filter(Boolean).join(tight ? "" : " ");
    if (order === "ymd") text = join([yearText, month, day]);
    else if (order === "dmy") text = join([day, month, yearText]);
    else if (tight) text = join([month, day, yearText && ` ${yearText}`]);
    else text = `${month} ${day}${yearText ? `, ${yearText}` : ""}`;
  }
  if (settings.weekday === "none") return text;
  const weekday = part({ weekday: settings.weekday });
  return locale.startsWith("en") ? `${weekday}, ${text}` : `${text} ${weekday}`;
}

function joined(date: Date, settings: Resolved, year: boolean): string {
  const day = dateText(date, settings, year);
  return settings.time ? `${day} ${timeText(date, settings)}` : day;
}

/** One instant in the site's date format; empty for a missing or invalid value. */
export function formatDate(locale: string, value: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(value);
  if (!date) return "";
  const settings = resolve(locale, options);
  return joined(date, settings, showYear([date], settings));
}

/** A time of day in the site's format. */
export function formatTime(locale: string, value: DateInput, options: DateFormatOptions = {}): string {
  const date = toDate(value);
  return date ? timeText(date, resolve(locale, options)) : "";
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
  if (!from || !to) return formatDate(locale, from ?? to, options);
  const settings = resolve(locale, options);
  const year = showYear([from, to], settings);
  const a = fields(from, settings.timeZone);
  const b = fields(to, settings.timeZone);
  if (a.year === b.year && a.month === b.month && a.day === b.day)
    return settings.time
      ? `${dateText(from, settings, year)} ${timeText(from, { ...settings, instant: false })} – ${timeText(to, settings)}`
      : dateText(from, settings, year);
  return `${joined(from, { ...settings, instant: false }, year)} – ${joined(to, settings, year)}`;
}

/** The machine-readable value for a `<time datetime>` attribute. */
export function dateTimeAttribute(value: DateInput): string {
  return toDate(value)?.toISOString() ?? "";
}
