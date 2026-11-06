// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = Record<string, any>

export interface NotionStatusGroup {
  name: string
  color: string
  optionNames: string[]
}

export interface NotionProperty {
  name: string
  type: string
  options?: { id: string; name: string; color?: string }[]
  statusGroups?: NotionStatusGroup[]
}

export interface NotionDatabaseSchema {
  id: string
  title: string
  properties: NotionProperty[]
}

export interface NotionDatabaseSummary {
  databaseId: string
  dataSourceId: string
  title: string
}

export type ColumnType =
  | "rich_text"
  | "select"
  | "multi_select"
  | "people"
  | "date"
  | "checkbox"
  | "relation"
  | "created_time"
  | "last_edited_time"

export interface ColumnConfig {
  name: string
  type: ColumnType
  options?: string[]
  optionColors?: Record<string, string>
  showInList: boolean
  showInDetail: boolean
}

export interface DatabaseMapping {
  databaseId: string
  /** Notion's data-source ID; optional only for migration from the old cache. */
  dataSourceId?: string
  databaseTitle: string
  titleProp: string
  statusProp: string
  statusType: "status" | "select"
  statusOptions: string[]
  statusGroups: NotionStatusGroup[]
  /** Name of the date column used as the due date by the quick-add bar. */
  dueProp?: string
  columns: ColumnConfig[]
}

export type ColumnValue =
  | { type: "rich_text"; value: string }
  | { type: "select"; value: string | null }
  | { type: "multi_select"; value: string[] }
  | { type: "people"; value: string[] }
  | { type: "date"; value: string | null }
  | { type: "checkbox"; value: boolean }
  | { type: "relation"; value: string[] }
  | { type: "created_time"; value: string }
  | { type: "last_edited_time"; value: string }

/** What a form submits for a column. */
export type ColumnRawValue = string | string[] | boolean

export interface WorkspaceUser {
  id: string
  name: string
}

export interface Todo {
  id: string
  title: string
  status: string | null
  url: string
  createdTime: string
  lastEditedTime: string
  content: string
  hasContent: boolean
  /** False until `content`/`hasContent` were actually fetched. */
  contentLoaded: boolean
  columns: Record<string, ColumnValue>
}

export type GroupBy =
  | { kind: "none" }
  | { kind: "status" }
  /** A date column (default: the due date): Overdue, then one section per day, then No date. */
  | { kind: "date"; column?: string; showEmptyDates?: boolean }
  | { kind: "column"; name: string }

/** Conditions on the due date column. */
export type DueFilter =
  | "any"
  | "none"
  | "has"
  | "overdue"
  | "today"
  | "todayOrOverdue"
  | "upcoming"
  | "week"

export type HideCompletedThreshold = "never" | "always" | "1" | "3" | "7" | "30"

/** select/multi_select -> string[]; people -> string; rich_text -> substring;
 *  date -> "today" | "overdue" | "week" | "none"; checkbox -> "checked" | "unchecked". */
export interface ColumnFilterState {
  value: string | string[]
  mode?: "any" | "all"
  exclude?: boolean
}

export interface SavedFilterState {
  status?: string[]
  hideCompleted?: HideCompletedThreshold
  due?: DueFilter
  /** Raw Notion API filter JSON, evaluated locally against cached properties. */
  advancedFilter?: string
  columnFilters?: Record<string, ColumnFilterState>
  groupBy?: GroupBy
}

export interface NewTodoContext {
  title?: string
  status?: string
  columns?: Record<string, ColumnRawValue>
  content?: string
}

export interface SavedView {
  id: string
  name: string
  filter: SavedFilterState
}

export interface Draft {
  id: string
  title: string
  content: string
  status: string
  /** Raw form values keyed by column name. */
  columns: Record<string, ColumnRawValue>
  /** Comma-separated new select/multi_select options keyed by column name. */
  newOptions: Record<string, string>
  updatedAt: number
}

export interface TodoFields {
  title: string
  status?: string
  columns?: Record<string, ColumnRawValue>
  /** Display values for the optimistic row. */
  display?: Record<string, ColumnValue>
}

interface OpBase {
  id: string
  label: string
  timestamp: number
  /** "failed" ops are not retried automatically and not shown optimistically. */
  state: "pending" | "failed"
  error?: string
}

export type Op = OpBase &
  (
    | { kind: "create"; localId: string; fields: TodoFields; content: string }
    | {
        kind: "update"
        todoId: string
        fields: TodoFields
        content: string
        contentChanged: boolean
      }
    | { kind: "status"; todoId: string; value: string }
    | { kind: "delete"; todoId: string }
  )

/** A tab in the bottom bar. Browse is always the last tab and is not part of this list. */
export interface TabConfig {
  id: string
  title: string
  /** SF Symbol name. */
  icon: string
  /** Filters and grouping; `advancedFilter` is ignored here. */
  filter: SavedFilterState
}

/** A phrase typed in quick add that means a relative date, e.g. "eod" is today at 17:00. */
export interface DateAlias {
  phrase: string
  /** Days from today. */
  days: number
  /** Optional `HH:mm`. */
  time?: string
}

/** Everything the user can configure, stored as one JSON object. */
export interface Settings {
  general: {
    /** Open the app full screen. Takes effect at the next launch. */
    fullScreen: boolean
  }
  /** Saved Browse filter. Custom tab filters remain with their tab records. */
  browseFilter: SavedFilterState
  notifications: {
    enabled: boolean
    /** Date column to notify for; defaults to the due date column. */
    column?: string
    /** `HH:mm` used for dates that have no time. */
    defaultTime: string
  }
  quickAdd: {
    /** Recognise dates typed into the title. */
    dateRecognition: boolean
    aliases: DateAlias[]
    /** Chips to show, in order: "due", "status" or "col:<column>". Null = due, status and the list columns. */
    chips: string[] | null
  }
  database: {
    /** The status the swipe-right gesture sets. */
    doneStatus?: string
  }
  tabs: TabConfig[]
}

export type LaunchIntent =
  | { kind: "new"; prefill: NewTodoContext }
  /** A deep link applied filters: show the full list. */
  | { kind: "list" }
