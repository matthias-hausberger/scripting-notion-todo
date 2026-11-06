import { dueColumn } from "./due"
import { defaultColumnsFromFilters } from "./filters"
import {
  ColumnConfig,
  ColumnRawValue,
  ColumnValue,
  DatabaseMapping,
  NewTodoContext,
  SavedFilterState,
  TodoFields,
  WorkspaceUser,
} from "./types"

export interface ChipDef {
  /** "due", "status" or "col:<column name>". */
  id: string
  label: string
  /** Set for column chips. */
  column?: ColumnConfig
}

function isPickable(c: ColumnConfig): boolean {
  return c.type === "select" || c.type === "multi_select" || c.type === "people" || c.type === "checkbox"
}

/** Every chip the bar could show, in the default order. */
export function availableChips(mapping: DatabaseMapping): ChipDef[] {
  const due = dueColumn(mapping)
  return [
    ...(due ? [{ id: "due", label: due.name }] : []),
    { id: "status", label: "Status" },
    ...mapping.columns
      .filter((c) => c.name !== due?.name && isPickable(c))
      .map((c) => ({ id: `col:${c.name}`, label: c.name, column: c })),
  ]
}

/** The chips to show: the saved selection and order, or by default the due date,
 *  the status and the list columns. */
export function activeChips(mapping: DatabaseMapping, saved: string[] | null): ChipDef[] {
  const all = availableChips(mapping)
  if (saved === null) {
    return all.filter((c) => !c.column || c.column.showInList)
  }
  return saved.map((id) => all.find((c) => c.id === id)).filter((c): c is ChipDef => !!c)
}

/** What the active filters already pin down, in form shape (people as names). */
export function filterColumnValues(
  filters: SavedFilterState,
  mapping: DatabaseMapping,
): Record<string, ColumnRawValue> {
  return defaultColumnsFromFilters(filters.columnFilters ?? {}, mapping)
}

export function defaultStatus(mapping: DatabaseMapping, filters: SavedFilterState): string {
  return filters.status?.length === 1 ? filters.status[0] : (mapping.statusOptions[0] ?? "")
}

export interface QuickAddDraft {
  title: string
  content: string
  status: string
  /** Due date value (`YYYY-MM-DD` or date-time), or null for none. */
  due: string | null
  /** Column values in form shape: select/rich_text as string, multi_select and people as string[] (names). */
  values: Record<string, ColumnRawValue>
}

/** Fields for a todo created straight from the bar. People names become Notion
 *  user ids; names that aren't known yet are skipped. */
export function quickAddFields(
  draft: QuickAddDraft,
  mapping: DatabaseMapping,
  people: WorkspaceUser[],
): TodoFields {
  const raw: Record<string, ColumnRawValue> = {}
  const display: Record<string, ColumnValue> = {}
  const due = dueColumn(mapping)

  for (const column of mapping.columns) {
    if (column.name === due?.name) {
      if (draft.due) {
        raw[column.name] = draft.due
        display[column.name] = { type: "date", value: draft.due }
      }
      continue
    }
    const value = draft.values[column.name]
    if (value === undefined) continue
    if (column.type === "select") {
      raw[column.name] = value as string
      display[column.name] = { type: "select", value: (value as string) || null }
    } else if (column.type === "multi_select") {
      raw[column.name] = value as string[]
      display[column.name] = { type: "multi_select", value: value as string[] }
    } else if (column.type === "checkbox") {
      raw[column.name] = value as boolean
      display[column.name] = { type: "checkbox", value: value as boolean }
    } else if (column.type === "people") {
      const picked = (value as string[])
        .map((name) => people.find((p) => p.name === name))
        .filter((p): p is WorkspaceUser => !!p)
      raw[column.name] = picked.map((p) => p.id)
      display[column.name] = { type: "people", value: picked.map((p) => p.name) }
    }
  }

  return { title: draft.title, status: draft.status || undefined, columns: raw, display }
}

/** The same draft as a prefill for the full New Todo form. */
export function draftToPrefill(draft: QuickAddDraft, mapping: DatabaseMapping): NewTodoContext {
  const columns: Record<string, ColumnRawValue> = { ...draft.values }
  const due = dueColumn(mapping)
  if (due && draft.due) columns[due.name] = draft.due
  return { title: draft.title, status: draft.status || undefined, columns, content: draft.content }
}
