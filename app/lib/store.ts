import { Script, useEffect, useState } from "scripting"
import { normalizeFilters } from "./filters"
import {
  archiveTodo,
  createTodo,
  errorMessage,
  fetchTodoContent,
  getDatabaseSchema,
  getDiscoveredPeople,
  getToken,
  isRetryable,
  mapWithConcurrency,
  queryTodoProperties,
  replacePageContent,
  seedDiscoveredPeople,
  syncMappingWithSchema,
  todosToPreviousContent,
  updateTodo,
  updateTodoStatus,
  getTodoLastEditedTime,
} from "./notion"
import { rescheduleReminders } from "./reminders"
import { defaultSettings, normalizeSettings } from "./settings"
import {
  DatabaseMapping,
  Draft,
  LaunchIntent,
  NewTodoContext,
  Op,
  SavedFilterState,
  SavedView,
  Settings,
  Todo,
  TodoFields,
  WorkspaceUser,
} from "./types"

// ---------------------------------------------------------------- state

export interface State {
  ready: boolean
  hasToken: boolean
  mapping: DatabaseMapping | null
  /** Last known server state. What the UI shows is `visibleTodos()`, which
   *  layers the pending outbox on top. */
  serverTodos: Todo[]
  outbox: Op[]
  lastFetched: number | null
  /** Lower-bound checkpoint for incremental Notion last_edited_time queries. */
  syncCheckpoint: string | null
  syncing: boolean
  /** Last sync problem; offline errors keep showing cached data. */
  error: string | null
  filters: SavedFilterState
  /** Per-tab edits that are active in this run but not saved as the baseline yet. */
  tabFilters: Record<string, SavedFilterState>
  views: SavedView[]
  drafts: Draft[]
  settings: Settings
  people: WorkspaceUser[]
  intent: LaunchIntent | null
}

let state: State = {
  ready: false,
  hasToken: false,
  mapping: null,
  serverTodos: [],
  outbox: [],
  lastFetched: null,
  syncCheckpoint: null,
  syncing: false,
  error: null,
  filters: {},
  tabFilters: {},
  views: [],
  drafts: [],
  settings: defaultSettings(),
  people: [],
  intent: null,
}

const listeners = new Set<() => void>()

function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function getState(): State {
  return state
}

export function useStore(): State {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((t) => t + 1)
    listeners.add(listener)
    listener() // catch changes made between render and subscribe
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return state
}

// ---------------------------------------------------------------- persistence

const K = {
  mapping: "mapping",
  todos: "todos",
  lastFetched: "lastFetched",
  syncCheckpoint: "syncCheckpoint",
  titleTextVersion: "titleTextVersion",
  outbox: "outbox",
  filters: "filters",
  views: "views",
  drafts: "drafts",
  settings: "settings",
  people: "people",
}

let persistTimer: number | undefined

function persistTodosSoon(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistTodosNow, 1000) as unknown as number
}

function persistTodosNow(): void {
  Storage.set(K.todos, state.serverTodos)
  Storage.set(K.lastFetched, state.lastFetched)
  Storage.set(K.syncCheckpoint, state.syncCheckpoint)
}

function persistOutbox(): void {
  Storage.set(K.outbox, state.outbox)
}

// ---------------------------------------------------------------- ids & optimistic view

const TEMP_PREFIX = "temp-"
export const CACHE_WINDOW_LIMIT = 10_000

function mostRecentlyEdited(todos: Todo[]): Todo[] {
  const unique = new Map<string, Todo>()
  for (const todo of todos) unique.set(todo.id, todo)
  return Array.from(unique.values())
    .sort((a, b) => {
      const delta = Date.parse(b.lastEditedTime) - Date.parse(a.lastEditedTime)
      return (Number.isFinite(delta) ? delta : 0) || a.id.localeCompare(b.id)
    })
    .slice(0, CACHE_WINDOW_LIMIT)
}

function mergeRecentTodos(current: Todo[], changed: Todo[]): Todo[] {
  return mostRecentlyEdited([...current, ...changed])
}

function newestEditedTime(todos: Todo[], fallback: string | null): string | null {
  let newest = fallback
  for (const todo of todos) {
    if (!newest || Date.parse(todo.lastEditedTime) > Date.parse(newest)) {
      newest = todo.lastEditedTime
    }
  }
  return newest
}

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX)
}

function uid(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function placeholderTodo(op: Extract<Op, { kind: "create" }>): Todo {
  const iso = new Date(op.timestamp).toISOString()
  return {
    id: op.localId,
    title: op.fields.title,
    status: op.fields.status ?? null,
    url: "",
    createdTime: iso,
    lastEditedTime: iso,
    content: op.content,
    hasContent: op.content.trim().length > 0,
    contentLoaded: true,
    columns: op.fields.display ?? {},
  }
}

function applyOp(todos: Todo[], op: Op): Todo[] {
  switch (op.kind) {
    case "create":
      return todos.some((t) => t.id === op.localId)
        ? todos
        : [placeholderTodo(op), ...todos]
    case "update":
      return todos.map((t) =>
        t.id !== op.todoId
          ? t
          : {
              ...t,
              title: op.fields.title,
              status: op.fields.status ?? t.status,
              content: op.contentChanged ? op.content : t.content,
              hasContent: op.contentChanged
                ? op.content.trim().length > 0
                : t.hasContent,
              contentLoaded: op.contentChanged ? true : t.contentLoaded,
              columns: { ...t.columns, ...op.fields.display },
            },
      )
    case "status":
      return todos.map((t) =>
        t.id === op.todoId ? { ...t, status: op.value } : t,
      )
    case "delete":
      return todos.filter((t) => t.id !== op.todoId)
  }
}

let viewCache: { server: Todo[]; outbox: Op[]; result: Todo[] } | null = null

/** Server snapshot with every pending outbox operation applied on top. Failed
 *  operations are not applied, so a failed edit visibly rolls back. */
export function visibleTodos(): Todo[] {
  if (
    viewCache &&
    viewCache.server === state.serverTodos &&
    viewCache.outbox === state.outbox
  ) {
    return viewCache.result
  }
  let result = state.serverTodos
  for (const op of state.outbox) {
    if (op.state === "pending") result = applyOp(result, op)
  }
  viewCache = { server: state.serverTodos, outbox: state.outbox, result }
  return result
}

function patchServerTodo(id: string, patch: Partial<Todo>): void {
  set({
    serverTodos: state.serverTodos.map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    ),
  })
  persistTodosSoon()
}

// ---------------------------------------------------------------- outbox

function pushOp(op: Op): void {
  set({ outbox: [...state.outbox, op] })
  persistOutbox()
  void syncNow()
}

export function addTodo(fields: TodoFields, content: string): void {
  pushOp({
    id: uid("op-"),
    kind: "create",
    localId: uid(TEMP_PREFIX),
    label: fields.title,
    timestamp: Date.now(),
    state: "pending",
    fields,
    content,
  })
}

export function editTodo(
  todo: Todo,
  fields: TodoFields,
  content: string,
): void {
  pushOp({
    id: uid("op-"),
    kind: "update",
    todoId: todo.id,
    label: fields.title,
    timestamp: Date.now(),
    state: "pending",
    fields,
    content,
    contentChanged: content !== todo.content,
  })
}

export function changeStatus(todo: Todo, value: string): void {
  pushOp({
    id: uid("op-"),
    kind: "status",
    todoId: todo.id,
    label: todo.title,
    timestamp: Date.now(),
    state: "pending",
    value,
  })
}

export function removeTodo(todo: Todo): void {
  pushOp({
    id: uid("op-"),
    kind: "delete",
    todoId: todo.id,
    label: todo.title,
    timestamp: Date.now(),
    state: "pending",
  })
}

function updateOp(id: string, patch: Partial<Op>): void {
  set({
    outbox: state.outbox.map((o) => (o.id === id ? ({ ...o, ...patch } as Op) : o)),
  })
  persistOutbox()
}

function removeOp(id: string): void {
  set({ outbox: state.outbox.filter((o) => o.id !== id) })
  persistOutbox()
}

/** After a create resolved: later ops that referenced the temp id now point at the real page. */
function rewriteId(localId: string, realId: string): void {
  set({
    outbox: state.outbox.map((o) =>
      "todoId" in o && o.todoId === localId ? { ...o, todoId: realId } : o,
    ),
  })
  persistOutbox()
}

export function retryOp(id: string): void {
  updateOp(id, { state: "pending", error: undefined })
  void syncNow()
}

export function retryAllFailed(): void {
  set({
    outbox: state.outbox.map((o) =>
      o.state === "failed" ? { ...o, state: "pending", error: undefined } : o,
    ),
  })
  persistOutbox()
  void syncNow()
}

export function discardOp(id: string): void {
  removeOp(id)
}

export function discardAllFailed(): void {
  set({ outbox: state.outbox.filter((o) => o.state !== "failed") })
  persistOutbox()
}

async function executeOp(op: Op): Promise<void> {
  const mapping = state.mapping
  if (!mapping) throw Object.assign(new Error("No database configured"), { status: 400 })

  if (op.kind === "create") {
    const page = await createTodo(mapping, op.fields, op.content)
    const real: Todo = {
      ...placeholderTodo(op),
      id: page.id,
      url: page.url,
      createdTime: page.createdTime,
      lastEditedTime: page.lastEditedTime,
    }
    rewriteId(op.localId, page.id)
    removeOp(op.id)
    set({
      serverTodos: mergeRecentTodos(
        state.serverTodos.filter((t) => t.id !== op.localId && t.id !== page.id),
        [real],
      ),
    })
    persistTodosSoon()
    return
  }

  if (isTempId(op.todoId)) {
    throw Object.assign(new Error("Depends on a todo that could not be created"), {
      status: 400,
    })
  }

  let mutationLastEditedTime: string | undefined
  if (op.kind === "update") {
    mutationLastEditedTime = await updateTodo(mapping, op.todoId, op.fields)
    if (op.contentChanged) {
      await replacePageContent(op.todoId, op.content)
      mutationLastEditedTime = await getTodoLastEditedTime(op.todoId)
    }
  } else if (op.kind === "status") {
    mutationLastEditedTime = await updateTodoStatus(mapping, op.todoId, op.value)
  } else {
    await archiveTodo(op.todoId)
  }
  removeOp(op.id)
  const changed = applyOp(state.serverTodos, op).map((todo) =>
    todo.id === op.todoId && mutationLastEditedTime
      ? { ...todo, lastEditedTime: mutationLastEditedTime }
      : todo,
  )
  set({ serverTodos: mostRecentlyEdited(changed) })
  persistTodosSoon()
}

/** Sends pending operations in order. Stops at the first offline/transient
 *  error (keeping order); marks permanent errors as failed and continues. */
async function drainOutbox(): Promise<boolean> {
  const ids = state.outbox.filter((o) => o.state === "pending").map((o) => o.id)
  for (const id of ids) {
    const op = state.outbox.find((o) => o.id === id)
    if (!op || op.state !== "pending") continue
    try {
      await executeOp(op)
    } catch (error) {
      if (isRetryable(error)) {
        set({ error: errorMessage(error) })
        return false
      }
      updateOp(op.id, { state: "failed", error: errorMessage(error) })
    }
  }
  return true
}

// ---------------------------------------------------------------- sync

const STALE_AFTER_MS = 60_000
let running: Promise<void> | null = null
let rerun = false
let rerunForce = false

function isStale(): boolean {
  return !state.lastFetched || Date.now() - state.lastFetched > STALE_AFTER_MS
}

async function refreshTodos(): Promise<void> {
  const mapping = await ensureDataSourceMapping()
  if (!mapping) return
  const checkpoint = state.syncCheckpoint
  const fullBootstrap = !checkpoint || state.serverTodos.length === 0
  const [fetched, schema] = await Promise.all([
    queryTodoProperties(
      mapping,
      todosToPreviousContent(state.serverTodos),
      fullBootstrap ? null : checkpoint,
    ),
    // Best-effort: a schema failure must not block the todos.
    getDatabaseSchema(mapping.databaseId, mapping.dataSourceId).catch(() => null),
  ])
  const serverTodos = fullBootstrap
    ? mostRecentlyEdited(fetched)
    : mergeRecentTodos(state.serverTodos, fetched)
  set({
    serverTodos,
    lastFetched: Date.now(),
    // Use Notion's timestamps as the watermark; device clocks can be skewed.
    // The query is inclusive, so edits sharing this timestamp are re-read.
    syncCheckpoint: newestEditedTime(fetched, checkpoint),
    error: null,
  })
  persistTodosNow()
  if (fullBootstrap) Storage.set(K.titleTextVersion, TITLE_TEXT_CACHE_VERSION)
  const people = getDiscoveredPeople()
  set({ people })
  Storage.set(K.people, people)

  if (schema) {
    const updated = syncMappingWithSchema(mapping, schema)
    if (JSON.stringify(updated) !== JSON.stringify(mapping)) saveMapping(updated)
  }
  scheduleRemindersSoon()
}

/** Migrates mappings saved before Notion introduced data-source IDs. */
async function ensureDataSourceMapping(): Promise<DatabaseMapping | null> {
  let mapping = state.mapping
  if (!mapping) return null
  if (mapping.dataSourceId) return mapping
  const schema = await getDatabaseSchema(mapping.databaseId)
  mapping = { ...mapping, dataSourceId: schema.id }
  saveMapping(mapping)
  return mapping
}

/** Drains the outbox, then refreshes from Notion when forced or stale. A call
 *  made while a sync is running queues exactly one more pass, so operations
 *  added mid-sync are never left behind. */
export function syncNow(force = false): Promise<void> {
  if (running) {
    rerun = true
    rerunForce = rerunForce || force
    return running
  }
  running = (async () => {
    set({ syncing: true })
    let forceNext = force
    try {
      do {
        rerun = false
        rerunForce = false
        if (state.mapping && getToken()) {
          await ensureDataSourceMapping()
          const drained = await drainOutbox()
          const needsBootstrap =
            !state.lastFetched || (state.serverTodos.length > 0 && !state.syncCheckpoint)
          if (drained && (forceNext || isStale() || needsBootstrap)) await refreshTodos()
        }
        forceNext = rerunForce
      } while (rerun)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ syncing: false })
      running = null
    }
  })()
  return running
}

// ---------------------------------------------------------------- lazy content

const contentInflight = new Set<string>()
const contentFailed = new Set<string>()

/** Fetches page content for the given rows, a few at a time. Failures are
 *  remembered for this session so an offline list doesn't loop. */
export function ensureContent(ids: string[], retry = false): void {
  const wanted = ids.filter((id) => {
    if (isTempId(id) || contentInflight.has(id)) return false
    if (retry) contentFailed.delete(id)
    return !contentFailed.has(id)
  })
  if (wanted.length === 0) return
  wanted.forEach((id) => contentInflight.add(id))
  void mapWithConcurrency(wanted, 3, async (id) => {
    try {
      const result = await fetchTodoContent(id)
      patchServerTodo(id, { ...result, contentLoaded: true })
    } catch {
      contentFailed.add(id)
    } finally {
      contentInflight.delete(id)
    }
  })
}

// ---------------------------------------------------------------- reminders

let reminderTimer: number | undefined

export function scheduleRemindersSoon(): void {
  if (reminderTimer !== undefined) clearTimeout(reminderTimer)
  reminderTimer = setTimeout(() => {
    if (state.mapping) {
      void rescheduleReminders(visibleTodos(), state.mapping, state.settings)
    }
  }, 2000) as unknown as number
}

// ---------------------------------------------------------------- mapping, token, settings

export function saveMapping(mapping: DatabaseMapping): void {
  set({ mapping })
  Storage.set(K.mapping, mapping)
}

/** Switching to another database drops the cache and any queued operations,
 *  which would otherwise be sent to the wrong database. */
export function switchDatabase(mapping: DatabaseMapping): void {
  const previous = state.mapping
  const sourceChanged = !!previous && (
    previous.databaseId !== mapping.databaseId ||
    previous.dataSourceId !== mapping.dataSourceId
  )
  const columnShape = (columns: DatabaseMapping["columns"]) => columns
    .map(({ name, type }) => ({ name, type }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const cacheShapeChanged = !!previous && JSON.stringify({
    titleProp: previous.titleProp,
    statusProp: previous.statusProp,
    statusType: previous.statusType,
    columns: columnShape(previous.columns),
  }) !== JSON.stringify({
    titleProp: mapping.titleProp,
    statusProp: mapping.statusProp,
    statusType: mapping.statusType,
    columns: columnShape(mapping.columns),
  })

  if (sourceChanged) {
    updateSettings((cur) => ({
      ...cur,
      browseFilter: {},
      database: { ...cur.database, doneStatus: undefined },
      tabs: cur.tabs.map((tab) => ({ ...tab, filter: {} })),
    }))
    set({
      serverTodos: [],
      outbox: [],
      lastFetched: null,
      syncCheckpoint: null,
      filters: {},
      tabFilters: Object.fromEntries(state.settings.tabs.map((tab) => [tab.id, {}])),
      views: [],
    })
    persistTodosNow()
    persistOutbox()
    Storage.set(K.views, [])
  } else if (cacheShapeChanged) {
    // A delta query cannot populate a newly mapped property on older rows.
    set({ lastFetched: null, syncCheckpoint: null })
    persistTodosNow()
  }
  saveMapping(mapping)
  void syncNow(true)
}

export function refreshTokenState(): void {
  set({ hasToken: !!getToken() })
}

/** Changes settings with a function that returns the new value. Everything is
 *  stored as one JSON object under "settings". */
export function updateSettings(change: (current: Settings) => Settings): void {
  const before = state.settings
  const settings = change(before)
  set({ settings })
  Storage.set(K.settings, settings)
  if (JSON.stringify(settings.notifications) !== JSON.stringify(before.notifications)) {
    scheduleRemindersSoon()
  }
}

export function clearCache(): void {
  set({ serverTodos: [], lastFetched: null, syncCheckpoint: null })
  persistTodosNow()
  void syncNow(true)
}

// ---------------------------------------------------------------- filters & views

function savedFilter(key: string): SavedFilterState {
  if (key === "browse") return state.settings.browseFilter ?? {}
  return state.settings.tabs.find((tab) => tab.id === key)?.filter ?? {}
}

export function savedFilterFor(key: string): SavedFilterState {
  return savedFilter(key)
}

export function activeFilterFor(key: string): SavedFilterState {
  return key === "browse" ? state.filters : state.tabFilters[key] ?? savedFilter(key)
}

export function filterHasUnsavedChanges(key: string): boolean {
  return JSON.stringify(normalizeFilters(activeFilterFor(key))) !==
    JSON.stringify(normalizeFilters(savedFilter(key)))
}

/** Applies an edit to the current view without changing its saved baseline. */
export function setActiveFilter(key: string, next: SavedFilterState): void {
  const normalized = normalizeFilters(next)
  if (key === "browse") {
    set({ filters: normalized })
  } else {
    set({ tabFilters: { ...state.tabFilters, [key]: normalized } })
  }
}

/** Saves the current edit as the restore point for this tab. */
export function saveActiveFilter(key: string): void {
  const normalized = normalizeFilters(activeFilterFor(key))
  if (key === "browse") {
    updateSettings((current) => ({ ...current, browseFilter: normalized }))
    set({ filters: normalized })
    return
  }
  updateSettings((current) => ({
    ...current,
    tabs: current.tabs.map((tab) => tab.id === key ? { ...tab, filter: normalized } : tab),
  }))
  set({ tabFilters: { ...state.tabFilters, [key]: normalized } })
}

/** Discards the current edit and restores its most recently saved filter. */
export function restoreActiveFilter(key: string): void {
  setActiveFilter(key, savedFilter(key))
}

export function saveView(name: string, filter: SavedFilterState): void {
  const normalized = normalizeFilters(filter)
  const existing = state.views.find(
    (v) => v.name.toLowerCase() === name.toLowerCase(),
  )
  const views = existing
    ? state.views.map((v) => (v === existing ? { ...v, filter: normalized } : v))
    : [...state.views, { id: uid("view-"), name, filter: normalized }]
  set({ views })
  Storage.set(K.views, views)
}

export function deleteView(id: string): void {
  const views = state.views.filter((v) => v.id !== id)
  set({ views })
  Storage.set(K.views, views)
}

// ---------------------------------------------------------------- drafts

export function newDraftId(): string {
  return uid("draft-")
}

export function upsertDraft(draft: Draft): void {
  const exists = state.drafts.some((d) => d.id === draft.id)
  const drafts = exists
    ? state.drafts.map((d) => (d.id === draft.id ? draft : d))
    : [draft, ...state.drafts]
  set({ drafts })
  Storage.set(K.drafts, drafts)
}

export function deleteDraft(id: string): void {
  if (!state.drafts.some((d) => d.id === id)) return
  const drafts = state.drafts.filter((d) => d.id !== id)
  set({ drafts })
  Storage.set(K.drafts, drafts)
}

// ---------------------------------------------------------------- launch / deep links

export function clearIntent(): void {
  set({ intent: null })
}

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Handles `scripting://run/<script>?...`:
 *  `view=<name>` applies a saved view, `filter=<json>` applies a filter,
 *  `action=new[&prefill=<json>|&title=&status=&content=]` opens Quick Add. */
export function handleLaunch(params: Record<string, unknown> | null | undefined): void {
  if (!params) return

  if (typeof params.view === "string") {
    const wanted = params.view.toLowerCase()
    const view = state.views.find(
      (v) => v.id === params.view || v.name.toLowerCase() === wanted,
    )
    if (view) {
      setActiveFilter("browse", view.filter)
      set({ intent: { kind: "list" } })
    }
  }

  const filter = parseJson<SavedFilterState>(params.filter)
  if (filter) {
    setActiveFilter("browse", filter)
    set({ intent: { kind: "list" } })
  }

  if (params.action === "new") {
    const prefill: NewTodoContext = parseJson<NewTodoContext>(params.prefill) ?? {
      title: typeof params.title === "string" ? params.title : undefined,
      status: typeof params.status === "string" ? params.status : undefined,
      content: typeof params.content === "string" ? params.content : undefined,
    }
    set({ intent: { kind: "new", prefill } })
  }
}

// ---------------------------------------------------------------- init

let initialized = false
const TITLE_TEXT_CACHE_VERSION = 1

export function init(): void {
  if (initialized) return
  initialized = true

  const rawSettings = Storage.get<unknown>(K.settings)
  const settings = normalizeSettings(rawSettings)
  const legacyBrowseFilter = Storage.get<SavedFilterState>(K.filters)
  const hasSavedBrowseFilter = !!rawSettings && typeof rawSettings === "object" &&
    Object.prototype.hasOwnProperty.call(rawSettings, "browseFilter")
  if (!hasSavedBrowseFilter && legacyBrowseFilter) {
    settings.browseFilter = normalizeFilters(legacyBrowseFilter)
  } else {
    settings.browseFilter = normalizeFilters(settings.browseFilter)
  }
  Storage.set(K.settings, settings)
  Storage.remove(K.filters)
  const tabFilters = Object.fromEntries(
    settings.tabs.map((tab) => [tab.id, normalizeFilters(tab.filter ?? {})]),
  ) as Record<string, SavedFilterState>
  const people = Storage.get<WorkspaceUser[]>(K.people) ?? []
  seedDiscoveredPeople(people)
  const titleTextNeedsRefresh =
    Storage.get<number>(K.titleTextVersion) !== TITLE_TEXT_CACHE_VERSION
  const syncCheckpoint = titleTextNeedsRefresh
    ? null
    : Storage.get<string>(K.syncCheckpoint) ?? null
  if (titleTextNeedsRefresh) Storage.set(K.syncCheckpoint, null)

  set({
    ready: true,
    hasToken: !!getToken(),
    mapping: Storage.get<DatabaseMapping>(K.mapping),
    serverTodos: Storage.get<Todo[]>(K.todos) ?? [],
    outbox: Storage.get<Op[]>(K.outbox) ?? [],
    lastFetched: Storage.get<number>(K.lastFetched),
    syncCheckpoint,
    views: Storage.get<SavedView[]>(K.views) ?? [],
    drafts: Storage.get<Draft[]>(K.drafts) ?? [],
    filters: settings.browseFilter,
    tabFilters,
    settings,
    people,
  })

  handleLaunch(Script.queryParameters)
  Script.onResume((details) => {
    handleLaunch(details.queryParameters)
    void syncNow()
  })
  void syncNow()
}
