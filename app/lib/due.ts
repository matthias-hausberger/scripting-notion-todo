import { findCompletedStatuses } from "./notion"
import { ColumnConfig, DatabaseMapping, DueFilter, Settings, Todo } from "./types"

/** The date column used as the due date: the one chosen in the database mapping,
 *  or the first date column for mappings saved before that existed. */
export function dueColumn(mapping: DatabaseMapping): ColumnConfig | undefined {
  return (
    mapping.columns.find((c) => c.name === mapping.dueProp && c.type === "date") ??
    mapping.columns.find((c) => c.type === "date")
  )
}

/** The todo's value in a date column as `YYYY-MM-DD`, or null. */
export function dateOf(todo: Todo, columnName: string | undefined): string | null {
  if (!columnName) return null
  const cell = todo.columns[columnName]
  return cell?.type === "date" && cell.value ? cell.value.slice(0, 10) : null
}

export function dueDay(todo: Todo, mapping: DatabaseMapping): string | null {
  return dateOf(todo, dueColumn(mapping)?.name)
}

/** Sort key by date and time; todos without a date go last. */
export function dateSortKey(todo: Todo, columnName: string | undefined): number {
  const cell = columnName ? todo.columns[columnName] : undefined
  const time = cell?.type === "date" && cell.value ? new Date(cell.value).getTime() : NaN
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time
}

/** Open means not in Notion's "Complete" status group. Without such a group nothing counts as done. */
export function isOpen(todo: Todo, mapping: DatabaseMapping): boolean {
  return todo.status === null || !findCompletedStatuses(mapping).includes(todo.status)
}

function addDaysToKey(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(y, m - 1, d + days)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function matchesDue(day: string | null, filter: DueFilter | undefined, today: string): boolean {
  switch (filter) {
    case undefined:
    case "any":
      return true
    case "none":
      return day === null
    case "has":
      return day !== null
    case "overdue":
      return day !== null && day < today
    case "today":
      return day === today
    case "todayOrOverdue":
      return day !== null && day <= today
    case "upcoming":
      return day !== null && day >= today
    case "week":
      return day !== null && day >= today && day <= addDaysToKey(today, 7)
  }
}

export const DUE_FILTER_LABELS: { value: DueFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "none", label: "No date" },
  { value: "has", label: "Has a date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "todayOrOverdue", label: "Today and overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "week", label: "Next 7 days" },
]

/** The status the swipe-right gesture sets: the one chosen in Settings, else the first "Complete" status. */
export function resolveDoneStatus(mapping: DatabaseMapping, settings: Settings): string | undefined {
  const chosen = settings.database.doneStatus
  if (chosen && mapping.statusOptions.includes(chosen)) return chosen
  return findCompletedStatuses(mapping)[0]
}

export { addDaysToKey }
