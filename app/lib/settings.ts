import { DateAlias, Settings, TabConfig } from "./types"

export const MAX_TABS = 5

/** The tabs a fresh install starts with (Browse is added after them). */
export const DEFAULT_TABS: TabConfig[] = [
  {
    id: "inbox",
    title: "Unscheduled",
    icon: "tray",
    filter: { hideCompleted: "always", due: "none" },
  },
  {
    id: "today",
    title: "Today",
    icon: "sun.max.fill",
    filter: { hideCompleted: "always", due: "todayOrOverdue", groupBy: { kind: "date" } },
  },
  {
    id: "upcoming",
    title: "Later",
    icon: "calendar.badge.clock",
    filter: {
      hideCompleted: "always",
      due: "upcoming",
      groupBy: { kind: "date", showEmptyDates: true },
    },
  },
]

export function defaultSettings(): Settings {
  return {
    general: { fullScreen: true },
    browseFilter: {},
    notifications: { enabled: false, defaultTime: "09:00" },
    quickAdd: { dateRecognition: true, aliases: [], chips: null },
    database: {},
    tabs: DEFAULT_TABS.map((t) => ({ ...t, filter: { ...t.filter } })),
  }
}

/** Reads stored settings of any age: fills in missing values and migrates the
 *  old flat notification fields. The removed remember-filters option is ignored. */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings()
  if (!raw || typeof raw !== "object") return base
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as Record<string, any>

  const legacyTime =
    typeof r.reminderHour === "number" ? `${String(r.reminderHour).padStart(2, "0")}:00` : undefined

  const tabs = Array.isArray(r.tabs) ? (r.tabs as TabConfig[]).map((tab) => {
    // Rename only untouched factory presets. User-renamed or re-iconed tabs stay as they are.
    if (tab.id === "inbox" && tab.title === "Inbox" && tab.icon === "tray") {
      return { ...tab, title: "Unscheduled" }
    }
    if (tab.id === "today" && tab.title === "Today" && tab.icon === "calendar") {
      return { ...tab, icon: "sun.max.fill" }
    }
    if (tab.id === "upcoming" && tab.title === "Upcoming" && tab.icon === "calendar.badge.clock") {
      return { ...tab, title: "Later" }
    }
    return tab
  }) : base.tabs

  return {
    general: {
      fullScreen: r.general?.fullScreen ?? base.general.fullScreen,
    },
    browseFilter: r.browseFilter ?? {},
    notifications: {
      enabled: r.notifications?.enabled ?? r.reminders ?? base.notifications.enabled,
      column: r.notifications?.column ?? r.reminderColumn,
      defaultTime: r.notifications?.defaultTime ?? legacyTime ?? base.notifications.defaultTime,
    },
    quickAdd: {
      dateRecognition: r.quickAdd?.dateRecognition ?? base.quickAdd.dateRecognition,
      aliases: Array.isArray(r.quickAdd?.aliases) ? (r.quickAdd.aliases as DateAlias[]) : [],
      chips: Array.isArray(r.quickAdd?.chips) ? (r.quickAdd.chips as string[]) : null,
    },
    database: { doneStatus: r.database?.doneStatus },
    // An empty array is intentional: the user may keep only the fixed Browse tab.
    tabs,
  }
}

// ---------------------------------------------------------------- `HH:mm` helpers

export function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return { hour: 9, minute: 0 }
  return { hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) }
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

/** A timestamp today at the given `HH:mm`, for the time picker. */
export function timeToMs(value: string): number {
  const { hour, minute } = parseTime(value)
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime()
}

export function msToTime(ms: number): string {
  const d = new Date(ms)
  return formatTime(d.getHours(), d.getMinutes())
}

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
