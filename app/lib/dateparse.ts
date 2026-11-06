import type { DateAlias } from "./types"

/** Natural-language due dates for the quick-add bar, English and German:
 *  "tom", "tomorrow", "morgen", "friday", "next week", "in 3 days", "15 oct",
 *  "12.10.", "2026-10-30", optionally with a time ("at 5pm", "17:30", "um 17 Uhr"). */

export interface ParsedDate {
  /** `YYYY-MM-DD`, or an ISO date-time with the local UTC offset when a time was given. */
  value: string
  /** The input with the date phrase (and a directly preceding "on"/"at"/"am"/"um") removed. */
  title: string
  /** The date part exactly as typed, e.g. "tom". */
  phrase: string
}

interface Word {
  text: string
  /** Lowercased, without trailing punctuation. */
  norm: string
}

const DAY_MS = 86_400_000

const KEYWORDS: Record<string, number> = {
  today: 0,
  heute: 0,
  tomorrow: 1,
  morgen: 1,
  tmr: 1,
  tmrw: 1,
  übermorgen: 2,
  uebermorgen: 2,
  overmorrow: 2,
}

/** Short forms that are also ordinary words or names ("Tom", "Sat") only count when typed in lowercase. */
const LOWERCASE_ONLY: Record<string, number> = { tod: 0, tom: 1 }

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  sonntag: 0,
}

const WEEKDAYS_SHORT: Record<string, number> = {
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
  sun: 0,
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  januar: 0,
  jänner: 0,
  feb: 1,
  february: 1,
  februar: 1,
  mar: 2,
  march: 2,
  märz: 2,
  maerz: 2,
  apr: 3,
  april: 3,
  may: 4,
  mai: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  okt: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  dez: 11,
  dezember: 11,
}

const NEXT_WORDS = new Set(["next", "nächste", "nächsten", "nächster", "naechste", "naechsten"])
const UNIT_DAYS = new Set(["day", "days", "tag", "tage", "tagen"])
const UNIT_WEEKS = new Set(["week", "weeks", "woche", "wochen"])
const UNIT_MONTHS = new Set(["month", "months", "monat", "monate", "monaten"])
const PREPOSITIONS = new Set(["on", "at", "um", "am", "by", "bis", "until", "@"])

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const result = startOfDay(d)
  result.setDate(result.getDate() + days)
  return result
}

/** The next given weekday (0 = Sunday), strictly after today. */
function nextWeekday(now: Date, weekday: number): Date {
  const today = startOfDay(now)
  const ahead = ((weekday - today.getDay() + 6) % 7) + 1
  return addDays(today, ahead)
}

function mondayOfNextWeek(now: Date): Date {
  return nextWeekday(now, 1)
}

function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day)
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null
}

/** A day/month without a year means the next time it occurs. */
function upcoming(now: Date, month: number, day: number): Date | null {
  const today = startOfDay(now)
  const thisYear = validDate(today.getFullYear(), month, day)
  if (thisYear && thisYear >= today) return thisYear
  return validDate(today.getFullYear() + 1, month, day)
}

function words(text: string): Word[] {
  const result: Word[] = []
  for (const match of text.matchAll(/\S+/g)) {
    result.push({
      text: match[0],
      norm: match[0].toLowerCase().replace(/[.,;:!?]+$/, ""),
    })
  }
  return result
}

interface DateMatch {
  length: number
  date: Date
  /** Set by aliases that carry a time. */
  time?: { hour: number; minute: number }
}

function matchAlias(ws: Word[], i: number, now: Date, aliases: DateAlias[]): DateMatch | null {
  for (const alias of aliases) {
    const parts = alias.phrase.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0 || i + parts.length > ws.length) continue
    if (!parts.every((part, k) => ws[i + k].norm === part)) continue
    const time = alias.time ? parseAliasTime(alias.time) : undefined
    return { length: parts.length, date: addDays(now, alias.days), time }
  }
  return null
}

function parseAliasTime(value: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : undefined
}

function matchDate(ws: Word[], i: number, now: Date, aliases: DateAlias[]): DateMatch | null {
  const alias = matchAlias(ws, i, now, aliases)
  if (alias) return alias
  const w = ws[i]
  const w1 = ws[i + 1]
  const w2 = ws[i + 2]

  // "in 3 days", "in 2 wochen"
  if (w.norm === "in" && w1 && w2 && /^\d{1,3}$/.test(w1.norm)) {
    const n = Number(w1.norm)
    if (UNIT_DAYS.has(w2.norm)) return { length: 3, date: addDays(now, n) }
    if (UNIT_WEEKS.has(w2.norm)) return { length: 3, date: addDays(now, n * 7) }
    if (UNIT_MONTHS.has(w2.norm)) {
      const d = startOfDay(now)
      d.setMonth(d.getMonth() + n)
      return { length: 3, date: d }
    }
  }

  if (w1) {
    // "next week", "next friday"
    if (NEXT_WORDS.has(w.norm)) {
      if (UNIT_WEEKS.has(w1.norm)) return { length: 2, date: mondayOfNextWeek(now) }
      const weekday = WEEKDAYS[w1.norm]
      if (weekday !== undefined) {
        // "next friday" is the one in next week, not the coming one.
        const coming = nextWeekday(now, weekday)
        return { length: 2, date: coming < mondayOfNextWeek(now) ? addDays(coming, 7) : coming }
      }
    }
    // "this weekend"
    if (w.norm === "this" && w1.norm === "weekend") {
      return { length: 2, date: nextWeekday(now, 6) }
    }
    // "15 oct", "15. oktober"
    const dayFirst = /^(\d{1,2})\.?$/.exec(w.norm)
    if (dayFirst && MONTHS[w1.norm] !== undefined) {
      const d = upcoming(now, MONTHS[w1.norm], Number(dayFirst[1]))
      if (d) return { length: 2, date: d }
    }
    // "oct 15"
    const dayLast = /^(\d{1,2})$/.exec(w1.norm)
    if (MONTHS[w.norm] !== undefined && dayLast) {
      const d = upcoming(now, MONTHS[w.norm], Number(dayLast[1]))
      if (d) return { length: 2, date: d }
    }
  }

  // Single words
  if (KEYWORDS[w.norm] !== undefined) return { length: 1, date: addDays(now, KEYWORDS[w.norm]) }
  if (LOWERCASE_ONLY[w.norm] !== undefined && w.text.replace(/[.,;:!?]+$/, "") === w.norm) {
    return { length: 1, date: addDays(now, LOWERCASE_ONLY[w.norm]) }
  }
  if (WEEKDAYS[w.norm] !== undefined) return { length: 1, date: nextWeekday(now, WEEKDAYS[w.norm]) }
  if (WEEKDAYS_SHORT[w.norm] !== undefined && w.text.replace(/[.,;:!?]+$/, "") === w.norm) {
    return { length: 1, date: nextWeekday(now, WEEKDAYS_SHORT[w.norm]) }
  }
  if (w.norm === "weekend" || w.norm === "wochenende") return { length: 1, date: nextWeekday(now, 6) }

  // 2026-10-30
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w.norm)
  if (iso) {
    const d = validDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    if (d) return { length: 1, date: d }
  }
  // 12.10 / 12.10.2026 / 12.10.26
  const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(w.norm)
  if (dotted) {
    const month = Number(dotted[2]) - 1
    const day = Number(dotted[1])
    if (dotted[3]) {
      const year = dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3])
      const d = validDate(year, month, day)
      if (d) return { length: 1, date: d }
    } else {
      const d = upcoming(now, month, day)
      if (d) return { length: 1, date: d }
    }
  }
  return null
}

interface TimeMatch {
  length: number
  hour: number
  minute: number
}

function matchTime(ws: Word[], i: number): TimeMatch | null {
  const w = ws[i]
  const w1 = ws[i + 1]

  // 5pm, 5:30pm
  const meridiem = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(w.norm)
  if (meridiem) return withMeridiem(Number(meridiem[1]), Number(meridiem[2] ?? 0), meridiem[3], 1)
  // 5 pm
  if (w1 && /^\d{1,2}$/.test(w.norm) && (w1.norm === "am" || w1.norm === "pm")) {
    return withMeridiem(Number(w.norm), 0, w1.norm, 2)
  }
  // 17:30, 17:30 uhr
  const clock = /^(\d{1,2}):(\d{2})(uhr)?$/.exec(w.norm)
  if (clock) {
    const length = w1?.norm === "uhr" && !clock[3] ? 2 : 1
    return withClock(Number(clock[1]), Number(clock[2]), length)
  }
  // 17 uhr, 17uhr
  const uhr = /^(\d{1,2})uhr$/.exec(w.norm)
  if (uhr) return withClock(Number(uhr[1]), 0, 1)
  if (w1?.norm === "uhr" && /^\d{1,2}$/.test(w.norm)) return withClock(Number(w.norm), 0, 2)
  return null
}

function withMeridiem(hour: number, minute: number, meridiem: string, length: number): TimeMatch | null {
  if (hour < 1 || hour > 12 || minute > 59) return null
  const h = (hour % 12) + (meridiem === "pm" ? 12 : 0)
  return { length, hour: h, minute }
}

function withClock(hour: number, minute: number, length: number): TimeMatch | null {
  if (hour > 23 || minute > 59) return null
  return { length, hour, minute }
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export function toDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A date-time with the device's UTC offset, so Notion shows the intended local time. */
export function toDateTimeValue(d: Date, hour: number, minute: number): string {
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute)
  const offset = -at.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const abs = Math.abs(offset)
  return `${toDateValue(at)}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Finds the last date phrase in `text` and returns it with the remaining title.
 *  Returns null when there is none, or when removing it would leave no title. */
export function parseDatePhrase(
  text: string,
  now = new Date(),
  aliases: DateAlias[] = [],
): ParsedDate | null {
  const ws = words(text)
  if (ws.length === 0) return null

  let date: { start: number; length: number; value: Date; time?: { hour: number; minute: number } } | null = null
  for (let i = ws.length - 1; i >= 0 && !date; i--) {
    const match = matchDate(ws, i, now, aliases)
    if (!match) continue
    date = { start: i, length: match.length, value: match.date, time: match.time }
    // A longer phrase that starts earlier and covers this word wins:
    // "next friday" over "friday", "in 3 days" over "days".
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const longer = matchDate(ws, j, now, aliases)
      if (longer && j + longer.length > i) {
            date = { start: j, length: longer.length, value: longer.date, time: longer.time }
        break
      }
    }
  }

  let time: { start: number; length: number; hour: number; minute: number } | null = null
  for (let i = ws.length - 1; i >= 0 && !time; i--) {
    if (date && i >= date.start && i < date.start + date.length) continue
    const match = matchTime(ws, i)
    if (match) time = { start: i, length: match.length, hour: match.hour, minute: match.minute }
  }

  const aliasTime = date?.time
  if (!time && aliasTime) time = { start: -1, length: 0, hour: aliasTime.hour, minute: aliasTime.minute }
  if (!date && !time) return null

  let day: Date
  if (date) {
    day = date.value
  } else {
    // A time alone means today, or tomorrow once it has passed.
    day = startOfDay(now)
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time!.hour, time!.minute)
    if (at.getTime() <= now.getTime()) day = new Date(day.getTime() + DAY_MS)
  }

  const consumed = new Set<number>()
  for (const range of [date, time]) {
    if (!range || range.length === 0) continue
    for (let k = range.start; k < range.start + range.length; k++) consumed.add(k)
    const before = ws[range.start - 1]
    if (before && PREPOSITIONS.has(before.norm)) consumed.add(range.start - 1)
  }

  const title = ws
    .filter((_, index) => !consumed.has(index))
    .map((w) => w.text)
    .join(" ")
    .trim()
  if (!title) return null

  const phraseWords = [date, time]
    .filter((r): r is NonNullable<typeof r> => !!r && r.length > 0)
    .flatMap((r) => ws.slice(r.start, r.start + r.length).map((w) => w.text))

  return {
    value: time ? toDateTimeValue(day, time.hour, time.minute) : toDateValue(day),
    title,
    phrase: phraseWords.join(" "),
  }
}

/** "Today", "Tomorrow", "Fri", "26 Oct", with the time when there is one. */
export function formatDueLabel(value: string, now = new Date()): string {
  const hasTime = value.includes("T")
  const [y, m, d] = value.slice(0, 10).split("-").map(Number)
  const day = new Date(y, m - 1, d)
  const diff = Math.round((day.getTime() - startOfDay(now).getTime()) / DAY_MS)

  let label: string
  if (diff === 0) label = "Today"
  else if (diff === 1) label = "Tomorrow"
  else if (diff === -1) label = "Yesterday"
  else if (diff > 1 && diff < 7) label = day.toLocaleDateString(undefined, { weekday: "short" })
  else {
    label = day.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      ...(day.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    })
  }
  if (hasTime) {
    const at = new Date(value)
    if (!Number.isNaN(at.getTime())) label += ` ${pad(at.getHours())}:${pad(at.getMinutes())}`
  }
  return label
}

/** Presets for the date chip's menu. */
export function datePresets(now = new Date()): { label: string; systemImage: string; value: string }[] {
  const today = startOfDay(now)
  return [
    { label: "Today", systemImage: "sun.max", value: toDateValue(today) },
    { label: "Tomorrow", systemImage: "sunrise", value: toDateValue(addDays(today, 1)) },
    { label: "This weekend", systemImage: "calendar.badge.clock", value: toDateValue(nextWeekday(today, 6)) },
    { label: "Next week", systemImage: "calendar", value: toDateValue(mondayOfNextWeek(today)) },
  ]
}

export type DueTone = "overdue" | "today" | "future"

/** Where a due date sits relative to today, for coloring. */
export function dueTone(value: string, now = new Date()): DueTone {
  const day = value.slice(0, 10)
  const today = toDateValue(now)
  if (day < today) return "overdue"
  if (day === today) return "today"
  return "future"
}
