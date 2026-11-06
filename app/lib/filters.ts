import { Script } from "scripting"
import { applyAdvancedFilter } from "./advanced-filter"
import { addDaysToKey, dateOf, dateSortKey, dueColumn, dueDay, matchesDue, DUE_FILTER_LABELS } from "./due"
import { formatDueLabel, toDateValue } from "./dateparse"
import { findCompletedStatuses } from "./notion"
import {
  ColumnFilterState,
  ColumnRawValue,
  DatabaseMapping,
  GroupBy,
  HideCompletedThreshold,
  NewTodoContext,
  SavedFilterState,
  Todo,
} from "./types"

export interface Section {
  key: string
  title: string
  items: Todo[]
  /** Set on a section for one calendar day (`YYYY-MM-DD`), which can receive new todos. */
  dateValue?: string
}

// ---------------------------------------------------------------- matching

function matchesColumnFilters(
  todo: Todo,
  columnFilters: Record<string, ColumnFilterState>,
): boolean {
  for (const [name, filter] of Object.entries(columnFilters)) {
    const cell = todo.columns?.[name]
    if (!cell) continue
    if (cell.type === "select") {
      const wanted = filter.value as string[]
      const matches = cell.value !== null && wanted.includes(cell.value)
      const passes = filter.exclude ? !matches : matches
      if (wanted.length > 0 && !passes) return false
    } else if (cell.type === "rich_text") {
      const wanted = filter.value as string
      if (!cell.value.toLowerCase().includes(wanted.toLowerCase())) return false
    } else if (cell.type === "multi_select") {
      const wanted = filter.value as string[]
      const matches =
        filter.mode === "all"
          ? wanted.every((w) => cell.value.includes(w))
          : wanted.some((w) => cell.value.includes(w))
      const passes = filter.exclude ? !matches : matches
      if (wanted.length > 0 && !passes) return false
    } else if (cell.type === "people") {
      const wanted = filter.value as string
      if (wanted && !cell.value.includes(wanted)) return false
    } else if (
      cell.type === "date" ||
      cell.type === "created_time" ||
      cell.type === "last_edited_time"
    ) {
      const preset = filter.value as string
      if (preset === "none") {
        if (cell.value) return false
        continue
      }
      if (!cell.value) return false
      const d = new Date(cell.value)
      const now = new Date()
      if (preset === "today" && d.toDateString() !== now.toDateString())
        return false
      if (preset === "overdue" && d.getTime() >= now.getTime()) return false
      if (
        preset === "week" &&
        Math.abs(d.getTime() - now.getTime()) > 7 * 86_400_000
      )
        return false
    } else if (cell.type === "checkbox") {
      const wanted = filter.value as string
      if (wanted === "checked" && !cell.value) return false
      if (wanted === "unchecked" && cell.value) return false
    }
  }
  return true
}

export function filterTodos(
  todos: Todo[],
  filters: SavedFilterState,
  mapping: DatabaseMapping,
  search: string,
): Todo[] {
  const status = filters.status ?? []
  const hideCompleted: HideCompletedThreshold = filters.hideCompleted ?? "never"
  const columnFilters = filters.columnFilters ?? {}
  const completed = findCompletedStatuses(mapping)
  const needle = search.trim().toLowerCase()
  const today = toDateValue(new Date())
  const advancedFiltered = applyAdvancedFilter(todos, filters.advancedFilter, mapping)

  return advancedFiltered.filter((t) => {
    if (!matchesDue(dueDay(t, mapping), filters.due, today)) return false
    if (status.length > 0 && (t.status === null || !status.includes(t.status)))
      return false
    if (
      hideCompleted !== "never" &&
      t.status !== null &&
      completed.includes(t.status)
    ) {
      if (hideCompleted === "always") return false
      const ageDays = (Date.now() - new Date(t.lastEditedTime).getTime()) / 86_400_000
      if (ageDays >= Number(hideCompleted)) return false
    }
    if (!matchesColumnFilters(t, columnFilters)) return false
    if (needle && !t.title.toLowerCase().includes(needle)) return false
    return true
  })
}

// ---------------------------------------------------------------- grouping

function dayTitle(day: string, now: Date): string {
  const label = formatDueLabel(day, now)
  if (label === "Today" || label === "Tomorrow") return label
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
}

/** How many days ahead empty days are shown, at least, when "also show dates without todos" is on. */
const EMPTY_DATES_MIN_AHEAD = 6
const EMPTY_DATES_MAX_DAYS = 90

/** Overdue first, then one section per day, then No date. With `showEmptyDates`
 *  the days between today and the last dated todo (at least a week) are listed too. */
function buildDateSections(
  todos: Todo[],
  mapping: DatabaseMapping,
  groupBy: { column?: string; showEmptyDates?: boolean },
  now: Date,
): Section[] {
  const column = groupBy.column ?? dueColumn(mapping)?.name
  const today = toDateValue(now)
  const overdue: Todo[] = []
  const undated: Todo[] = []
  const days = new Map<string, Todo[]>()

  for (const todo of todos) {
    const day = dateOf(todo, column)
    if (day === null) undated.push(todo)
    else if (day < today) overdue.push(todo)
    else days.set(day, [...(days.get(day) ?? []), todo])
  }

  const byTime = (a: Todo, b: Todo) => dateSortKey(a, column) - dateSortKey(b, column)
  const sections: Section[] = []
  if (overdue.length > 0) {
    sections.push({ key: "overdue", title: "Overdue", items: [...overdue].sort(byTime) })
  }

  let dayKeys = Array.from(days.keys()).sort()
  if (groupBy.showEmptyDates) {
    const last = dayKeys[dayKeys.length - 1] ?? today
    const end = last > addDaysToKey(today, EMPTY_DATES_MIN_AHEAD) ? last : addDaysToKey(today, EMPTY_DATES_MIN_AHEAD)
    dayKeys = []
    for (let day = today, n = 0; day <= end && n < EMPTY_DATES_MAX_DAYS; day = addDaysToKey(day, 1), n++) {
      dayKeys.push(day)
    }
  }
  for (const day of dayKeys) {
    sections.push({
      key: day,
      title: dayTitle(day, now),
      items: [...(days.get(day) ?? [])].sort(byTime),
      dateValue: day,
    })
  }

  if (undated.length > 0) sections.push({ key: "none", title: "No date", items: undated })
  return sections
}

function addToBucket(buckets: Map<string, Todo[]>, key: string, todo: Todo) {
  const list = buckets.get(key) ?? []
  list.push(todo)
  buckets.set(key, list)
}

export function groupByLabel(g: GroupBy): string {
  if (g.kind === "none") return ""
  if (g.kind === "status") return "status"
  if (g.kind === "date") return g.column ?? "date"
  return g.name
}

export function buildSections(
  todos: Todo[],
  groupBy: GroupBy,
  mapping: DatabaseMapping,
): Section[] {
  const buckets = new Map<string, Todo[]>()

  if (groupBy.kind === "status") {
    for (const t of todos) addToBucket(buckets, t.status ?? "No Status", t)
    const order = [
      ...mapping.statusOptions.filter((s) => buckets.has(s)),
      ...(buckets.has("No Status") ? ["No Status"] : []),
    ]
    return order.map((key) => ({ key, title: key, items: buckets.get(key)! }))
  }

  if (groupBy.kind === "date") {
    return buildDateSections(todos, mapping, groupBy, new Date())
  }

  if (groupBy.kind === "column") {
    const none = "None"
    for (const t of todos) {
      const cell = t.columns[groupBy.name]
      let keys: string[]
      if (!cell) keys = [none]
      else if (cell.type === "multi_select" || cell.type === "people")
        keys = cell.value.length > 0 ? cell.value : [none]
      else if (cell.type === "select") keys = [cell.value ?? none]
      else if (cell.type === "checkbox") keys = [cell.value ? "Checked" : "Unchecked"]
      else keys = [none]
      for (const key of keys) addToBucket(buckets, key, t)
    }
    // Notion's own option order first, then anything else alphabetically.
    const defined = mapping.columns.find((c) => c.name === groupBy.name)?.options ?? []
    const ordered = defined.filter((k) => buckets.has(k))
    const rest = Array.from(buckets.keys())
      .filter((k) => k !== none && !defined.includes(k))
      .sort()
    const keys = [...ordered, ...rest]
    return (buckets.has(none) ? [...keys, none] : keys).map((key) => ({
      key,
      title: key,
      items: buckets.get(key)!,
    }))
  }

  return []
}

// ---------------------------------------------------------------- summaries

export function activeFilterLabels(f: SavedFilterState): string[] {
  return [
    f.status && f.status.length > 0 ? `Status: ${f.status.join(", ")}` : null,
    f.hideCompleted && f.hideCompleted !== "never"
      ? `Hide Completed (${f.hideCompleted === "always" ? "always" : `older than ${f.hideCompleted}d`})`
      : null,
    f.due && f.due !== "any"
      ? `Due: ${DUE_FILTER_LABELS.find((l) => l.value === f.due)?.label ?? f.due}`
      : null,
    f.advancedFilter ? "Advanced Filter" : null,
    ...Object.entries(f.columnFilters ?? {}).map(
      ([name, c]) =>
        `${name}: ${c.exclude ? "not " : ""}${Array.isArray(c.value) ? c.value.join(", ") : c.value}`,
    ),
    f.groupBy && f.groupBy.kind !== "none" ? `Grouped by ${groupByLabel(f.groupBy)}` : null,
  ].filter((l): l is string => l !== null)
}

/** Drops empty fields so the saved/linked filter stays minimal. */
export function normalizeFilters(f: SavedFilterState): SavedFilterState {
  return {
    status: f.status && f.status.length > 0 ? f.status : undefined,
    hideCompleted:
      f.hideCompleted && f.hideCompleted !== "never" ? f.hideCompleted : undefined,
    due: f.due && f.due !== "any" ? f.due : undefined,
    advancedFilter: f.advancedFilter || undefined,
    columnFilters:
      f.columnFilters && Object.keys(f.columnFilters).length > 0
        ? f.columnFilters
        : undefined,
    groupBy: f.groupBy && f.groupBy.kind !== "none" ? f.groupBy : undefined,
  }
}

export function relativeTime(ms: number | null): string {
  if (!ms) return "never"
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

// ---------------------------------------------------------------- prefill from filters

/** Select/multi_select/people/checkbox filters pick concrete values a new todo
 *  can start with; text and date presets don't. */
export function defaultColumnsFromFilters(
  columnFilters: Record<string, ColumnFilterState>,
  mapping: DatabaseMapping,
): Record<string, ColumnRawValue> {
  const result: Record<string, ColumnRawValue> = {}
  for (const column of mapping.columns) {
    const filter = columnFilters[column.name]
    if (!filter) continue
    if (column.type === "select") {
      const values = filter.value as string[]
      if (!filter.exclude && values.length === 1) result[column.name] = values[0]
    } else if (column.type === "multi_select") {
      if (!filter.exclude) result[column.name] = filter.value as string[]
    } else if (column.type === "people") {
      result[column.name] = [filter.value as string]
    } else if (column.type === "checkbox") {
      result[column.name] = filter.value === "checked"
    }
  }
  return result
}

export function filterToNewTodoContext(
  filters: SavedFilterState,
  mapping: DatabaseMapping,
): NewTodoContext {
  const columns = defaultColumnsFromFilters(filters.columnFilters ?? {}, mapping)
  const due = dueColumn(mapping)
  if (due && (filters.due === "today" || filters.due === "todayOrOverdue")) {
    columns[due.name] = toDateValue(new Date())
  }
  return {
    status: filters.status?.length === 1 ? filters.status[0] : undefined,
    columns,
  }
}

// ---------------------------------------------------------------- deep links

/** Opens the list with these filters applied. */
export function filterDeepLink(filters: SavedFilterState): string {
  return Script.createRunURLScheme(Script.name, {
    filter: JSON.stringify(normalizeFilters(filters)),
  })
}

/** Opens Quick Add prefilled. */
export function newTodoDeepLink(prefill: NewTodoContext): string {
  return Script.createRunURLScheme(Script.name, {
    action: "new",
    prefill: JSON.stringify(prefill),
  })
}

export function viewDeepLink(name: string): string {
  return Script.createRunURLScheme(Script.name, { view: name })
}
