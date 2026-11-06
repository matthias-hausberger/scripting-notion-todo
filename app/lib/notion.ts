
import { blocksToMarkdown, markdownToBlocks } from "./markdown"
import {
  ColumnConfig,
  ColumnRawValue,
  ColumnType,
  ColumnValue,
  DatabaseMapping,
  JsonObject,
  NotionDatabaseSchema,
  NotionDatabaseSummary,
  NotionProperty,
  NotionStatusGroup,
  Todo,
  TodoFields,
  WorkspaceUser,
} from "./types"

const NOTION_VERSION = "2026-03-11"
const BASE_URL = "https://api.notion.com/v1"
const TOKEN_KEY = "notion-token"
const MAX_RATE_LIMIT_RETRIES = 5

export const SUPPORTED_COLUMN_TYPES: ColumnType[] = [
  "rich_text",
  "select",
  "multi_select",
  "people",
  "date",
  "checkbox",
  "relation",
  "created_time",
  "last_edited_time",
]

export function getToken(): string | null {
  return Keychain.get(TOKEN_KEY)
}

export function setToken(token: string): void {
  Keychain.set(TOKEN_KEY, token.trim())
}

export function clearToken(): void {
  Keychain.remove(TOKEN_KEY)
}

// ---------------------------------------------------------------- errors

interface NotionError extends Error {
  status?: number
  /** True when the request never reached Notion (offline, timeout, DNS). */
  offline?: boolean
}

function makeError(
  message: string,
  extra: { status?: number; offline?: boolean },
): NotionError {
  return Object.assign(new Error(message), extra)
}

/** Notion title/rich-text values can span multiple segments (formatting, links, etc.). */
function plainText(segments: unknown): string {
  if (!Array.isArray(segments)) return ""
  return segments
    .map((segment: JsonObject) =>
      typeof segment.plain_text === "string"
        ? segment.plain_text
        : typeof segment.text?.content === "string"
          ? segment.text.content
          : "",
    )
    .join("")
}

function titleText(property: JsonObject | undefined): string {
  return plainText(property?.title) || "Untitled"
}

/** Worth retrying later without user action: offline, rate limited, 5xx. */
export function isRetryable(error: unknown): boolean {
  const e = error as NotionError
  if (e?.offline) return true
  if (e?.status === undefined) return false
  return e.status === 429 || e.status >= 500
}

export function isOffline(error: unknown): boolean {
  return !!(error as NotionError)?.offline
}

export function errorMessage(error: unknown): string {
  return (error as Error)?.message ?? String(error)
}

// ---------------------------------------------------------------- transport

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Notion allows ~3 requests/second on average. Chained so concurrent callers
 *  queue up in order instead of racing the clock. */
const MIN_REQUEST_INTERVAL_MS = 350
let lastRequestAt = 0
let requestGate: Promise<void> = Promise.resolve()

function paceRequest(): Promise<void> {
  const turn = requestGate.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now()
    if (wait > 0) await delay(wait)
    lastRequestAt = Date.now()
  })
  requestGate = turn
  return turn
}

async function notionFetch(
  path: string,
  init?: { method?: string; body?: string },
  retriesLeft = MAX_RATE_LIMIT_RETRIES,
): Promise<JsonObject> {
  const token = getToken()
  if (!token) {
    throw makeError("No Notion token set. Open Settings and add one.", {
      status: 401,
    })
  }
  await paceRequest()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      body: init?.body,
      timeout: 30,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    })
  } catch (error) {
    throw makeError(`Offline: ${errorMessage(error)}`, { offline: true })
  }
  if (res.status === 429 && retriesLeft > 0) {
    const retryAfter = Number(res.headers?.get?.("retry-after"))
    const waitMs =
      retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (MAX_RATE_LIMIT_RETRIES - retriesLeft)
    await delay(waitMs)
    return notionFetch(path, init, retriesLeft - 1)
  }
  if (!res.ok) {
    const body = await res.text()
    throw makeError(`Notion API error ${res.status}: ${body}`, {
      status: res.status,
    })
  }
  return (await res.json()) as JsonObject
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  async function worker() {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await fn(items[current])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}

// ---------------------------------------------------------------- column helpers

export function columnIsReadOnly(type: ColumnType): boolean {
  return (
    type === "relation" ||
    type === "created_time" ||
    type === "last_edited_time"
  )
}

export function columnIsDateLike(type: ColumnType): boolean {
  return (
    type === "date" || type === "created_time" || type === "last_edited_time"
  )
}

export function columnIsGroupable(type: ColumnType): boolean {
  return (
    type === "select" ||
    type === "multi_select" ||
    type === "people" ||
    type === "checkbox"
  )
}

export function findStatusGroup(
  mapping: DatabaseMapping,
  status: string | null,
): NotionStatusGroup | undefined {
  if (!status) return undefined
  return (mapping.statusGroups ?? []).find((g) =>
    g.optionNames.includes(status),
  )
}

/** Options in Notion's own "Complete" status group. Empty for `select`. */
export function findCompletedStatuses(mapping: DatabaseMapping): string[] {
  const group = (mapping.statusGroups ?? []).find((g) =>
    g.name.toLowerCase().includes("complete"),
  )
  return group?.optionNames ?? []
}

// ---------------------------------------------------------------- pages & blocks

async function getPageBlocks(pageId: string): Promise<JsonObject[]> {
  const blocks: JsonObject[] = []
  let cursor: string | undefined
  do {
    const params = cursor
      ? `?start_cursor=${cursor}&page_size=100`
      : "?page_size=100"
    const data = await notionFetch(`/blocks/${pageId}/children${params}`)
    blocks.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return blocks
}

export async function fetchTodoContent(
  pageId: string,
): Promise<{ content: string; hasContent: boolean }> {
  const content = blocksToMarkdown(await getPageBlocks(pageId))
  return { content, hasContent: content.trim().length > 0 }
}

export async function replacePageContent(
  pageId: string,
  markdown: string,
): Promise<void> {
  const existing = await getPageBlocks(pageId)
  await Promise.all(
    existing.map((block) =>
      notionFetch(`/blocks/${block.id}`, { method: "DELETE" }),
    ),
  )
  const blocks = markdownToBlocks(markdown)
  for (let i = 0; i < blocks.length; i += 100) {
    await notionFetch(`/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
    })
  }
}

export async function listWorkspaceUsers(): Promise<WorkspaceUser[]> {
  const users: WorkspaceUser[] = []
  let cursor: string | undefined
  do {
    const params = cursor
      ? `?start_cursor=${cursor}&page_size=100`
      : "?page_size=100"
    const data = await notionFetch(`/users${params}`)
    for (const u of data.results as JsonObject[]) {
      if (u.type === "person") {
        users.push({ id: u.id, name: u.name ?? u.person?.email ?? "Unknown" })
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return users
}

// ---------------------------------------------------------------- databases

export async function searchDatabases(): Promise<NotionDatabaseSummary[]> {
  const data = await notionFetch("/search", {
    method: "POST",
    body: JSON.stringify({ filter: { property: "object", value: "data_source" } }),
  })
  return (data.results as JsonObject[]).map((r) => {
    const properties = (r.properties ?? {}) as Record<string, JsonObject>
    const titleProperty = Object.values(properties).find((property) => property.type === "title")
    return {
      databaseId: r.parent?.database_id ?? r.id,
      dataSourceId: r.id,
      title:
        plainText(r.title) ||
        plainText(titleProperty?.title) ||
        (typeof r.name === "string" ? r.name : "Untitled"),
    }
  })
}

export async function getDatabaseSchema(
  databaseId: string,
  dataSourceId?: string,
): Promise<NotionDatabaseSchema> {
  let resolvedDataSourceId = dataSourceId
  let database: JsonObject | undefined
  if (!resolvedDataSourceId) {
    database = await notionFetch(`/databases/${databaseId}`)
    const sources = (database.data_sources ?? []) as JsonObject[]
    if (sources.length !== 1) {
      throw makeError(
        sources.length === 0
          ? "This database has no accessible data source. Check the Notion connection."
          : "This database has multiple data sources. Choose the intended data source again in Settings.",
        { status: 400 },
      )
    }
    resolvedDataSourceId = String(sources[0].id ?? "")
  }
  if (!resolvedDataSourceId) {
    throw makeError("The Notion data source ID is missing. Reopen Settings → Task database.", {
      status: 400,
    })
  }
  const data = await notionFetch(`/data_sources/${resolvedDataSourceId}`)
  const properties: NotionProperty[] = Object.entries(
    data.properties as JsonObject,
  ).map(([name, value]: [string, JsonObject]) => {
    const optionsById = new Map<string, JsonObject>(
      (value.status?.options ?? []).map((o: JsonObject) => [o.id, o]),
    )
    const statusGroups: NotionStatusGroup[] | undefined =
      value.type === "status"
        ? (value.status?.groups ?? []).map((g: JsonObject) => ({
            name: g.name,
            color: g.color,
            optionNames: (g.option_ids ?? [])
              .map((id: string) => optionsById.get(id)?.name)
              .filter((n: string | undefined): n is string => !!n),
          }))
        : undefined
    return {
      name,
      type: value.type,
      options: value[value.type]?.options,
      statusGroups,
    }
  })
  return {
    id: resolvedDataSourceId,
    title: plainText(data.title) || plainText(database?.title) || "Untitled",
    properties,
  }
}

/** Refreshes status options/groups and select option lists from the schema
 *  without touching which properties are mapped or displayed. */
export function syncMappingWithSchema(
  mapping: DatabaseMapping,
  schema: NotionDatabaseSchema,
): DatabaseMapping {
  const statusProperty = schema.properties.find(
    (p) => p.name === mapping.statusProp,
  )
  const columns = mapping.columns.map((column): ColumnConfig => {
    const property = schema.properties.find((p) => p.name === column.name)
    if (!property?.options) return column
    return {
      ...column,
      options: property.options.map((o) => o.name),
      optionColors: Object.fromEntries(
        property.options.map((o) => [o.name, o.color ?? "default"]),
      ),
    }
  })
  return {
    ...mapping,
    statusOptions:
      statusProperty?.options?.map((o) => o.name) ?? mapping.statusOptions,
    statusGroups: statusProperty?.statusGroups ?? mapping.statusGroups,
    columns,
  }
}

// ---------------------------------------------------------------- extraction

function extractStatus(prop: JsonObject | undefined): string | null {
  if (!prop) return null
  if (prop.type === "status") return prop.status?.name ?? null
  if (prop.type === "select") return prop.select?.name ?? null
  return null
}

/** Every person seen on a people column — covers guests, which /users never lists. */
const discoveredPeople = new Map<string, string>()

export function getDiscoveredPeople(): WorkspaceUser[] {
  return Array.from(discoveredPeople, ([id, name]) => ({ id, name }))
}

export function seedDiscoveredPeople(people: WorkspaceUser[]): void {
  for (const p of people) discoveredPeople.set(p.id, p.name)
}

const relationTitleCache = new Map<string, string>()

async function resolveRelationTitles(ids: string[]): Promise<void> {
  const unresolved = ids.filter((id) => !relationTitleCache.has(id))
  await mapWithConcurrency(unresolved, 5, async (id) => {
    try {
      const page = await notionFetch(`/pages/${id}`)
      const titleProp = Object.values(page.properties as JsonObject).find(
        (p: JsonObject) => p.type === "title",
      ) as JsonObject | undefined
      relationTitleCache.set(id, titleText(titleProp))
    } catch {
      relationTitleCache.set(id, "Unknown")
    }
  })
}

function extractColumnValue(
  type: ColumnType,
  prop: JsonObject | undefined,
): ColumnValue {
  switch (type) {
    case "rich_text":
      return {
        type,
        value: (prop?.rich_text ?? [])
          .map((t: JsonObject) => t.plain_text)
          .join(""),
      }
    case "select":
      return { type, value: prop?.select?.name ?? null }
    case "multi_select":
      return {
        type,
        value: (prop?.multi_select ?? []).map((t: JsonObject) => t.name),
      }
    case "people":
      return {
        type,
        value: (prop?.people ?? []).map((p: JsonObject) => {
          const name = p.name ?? p.person?.email ?? "Unknown"
          discoveredPeople.set(p.id, name)
          return name
        }),
      }
    case "date":
      return { type, value: prop?.date?.start ?? null }
    case "checkbox":
      return { type, value: prop?.checkbox ?? false }
    case "relation": {
      const ids = (prop?.relation ?? []).map((r: JsonObject) => r.id)
      return {
        type,
        value: ids.map((id: string) => relationTitleCache.get(id) ?? id),
      }
    }
    case "created_time":
      return { type, value: prop?.created_time ?? "" }
    case "last_edited_time":
      return { type, value: prop?.last_edited_time ?? "" }
  }
}

function buildColumnProperty(
  type: ColumnType,
  raw: ColumnRawValue,
): unknown | undefined {
  switch (type) {
    case "rich_text":
      return { rich_text: raw ? [{ text: { content: raw as string } }] : [] }
    case "select":
      return { select: raw ? { name: raw as string } : null }
    case "multi_select":
      return {
        multi_select: ((raw as string[]) ?? []).map((name) => ({ name })),
      }
    case "people":
      return { people: ((raw as string[]) ?? []).map((id) => ({ id })) }
    case "date":
      return { date: raw ? { start: raw as string } : null }
    case "checkbox":
      return { checkbox: !!raw }
    default:
      // relation / created_time / last_edited_time are read-only.
      return undefined
  }
}

type PreviousContentById = Map<
  string,
  { lastEditedTime: string; content: string; hasContent: boolean }
>

export function todosToPreviousContent(todos: Todo[]): PreviousContentById {
  return new Map(
    todos
      .filter((t) => t.contentLoaded)
      .map((t) => [
        t.id,
        {
          lastEditedTime: t.lastEditedTime,
          content: t.content,
          hasContent: t.hasContent,
        },
      ]),
  )
}

/** Fetches every row's properties (fast, no per-row content request). Content
 *  is reused from `previousContent` while a row's `last_edited_time` is
 *  unchanged; otherwise `contentLoaded` stays false for lazy loading. */
export async function queryTodoProperties(
  mapping: DatabaseMapping,
  previousContent?: PreviousContentById,
  updatedSince?: string | null,
): Promise<Todo[]> {
  if (!mapping.dataSourceId) {
    throw makeError("The Notion data source has not been selected. Reopen Settings → Task database.", {
      status: 400,
    })
  }
  const results: JsonObject[] = []
  let cursor: string | undefined
  do {
    const filter = updatedSince
      ? {
          timestamp: "last_edited_time",
          last_edited_time: { on_or_after: updatedSince },
        }
      : undefined
    const data = await notionFetch(`/data_sources/${mapping.dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        start_cursor: cursor,
        page_size: 100,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        ...(filter ? { filter } : {}),
      }),
    })
    results.push(...(data.results as JsonObject[]).slice(0, Math.max(0, 10_000 - results.length)))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor && results.length < 10_000)

  const relationColumns = mapping.columns.filter((c) => c.type === "relation")
  if (relationColumns.length > 0) {
    const ids = new Set<string>()
    for (const page of results) {
      for (const column of relationColumns) {
        for (const r of page.properties[column.name]?.relation ?? []) {
          ids.add(r.id)
        }
      }
    }
    await resolveRelationTitles(Array.from(ids))
  }

  return results.map((page) => {
    const props = page.properties
    const previous = previousContent?.get(page.id)
    const canReuse =
      previous !== undefined && previous.lastEditedTime === page.last_edited_time
    const columns: Record<string, ColumnValue> = {}
    for (const column of mapping.columns) {
      columns[column.name] = extractColumnValue(column.type, props[column.name])
    }
    return {
      id: page.id,
      title: titleText(props[mapping.titleProp]),
      status: extractStatus(props[mapping.statusProp]),
      url: page.url,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      content: canReuse ? previous.content : "",
      hasContent: canReuse ? previous.hasContent : false,
      contentLoaded: canReuse,
      columns,
    }
  })
}

// ---------------------------------------------------------------- mutations

function buildProperties(
  mapping: DatabaseMapping,
  input: TodoFields,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [mapping.titleProp]: { title: [{ text: { content: input.title } }] },
  }
  if (input.status) {
    properties[mapping.statusProp] =
      mapping.statusType === "status"
        ? { status: { name: input.status } }
        : { select: { name: input.status } }
  }
  if (input.columns) {
    for (const column of mapping.columns) {
      if (!(column.name in input.columns)) continue
      const built = buildColumnProperty(column.type, input.columns[column.name])
      if (built !== undefined) properties[column.name] = built
    }
  }
  return properties
}

export async function createTodo(
  mapping: DatabaseMapping,
  input: TodoFields,
  content: string,
): Promise<{ id: string; url: string; createdTime: string; lastEditedTime: string }> {
  if (!mapping.dataSourceId) {
    throw makeError("The Notion data source has not been selected. Reopen Settings → Task database.", {
      status: 400,
    })
  }
  const page = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: mapping.dataSourceId },
      properties: buildProperties(mapping, input),
      children: content ? markdownToBlocks(content) : [],
    }),
  })
  return {
    id: page.id,
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
  }
}

export async function updateTodo(
  mapping: DatabaseMapping,
  pageId: string,
  input: TodoFields,
): Promise<string> {
  const page = await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: buildProperties(mapping, input) }),
  })
  return typeof page.last_edited_time === "string" ? page.last_edited_time : ""
}

export async function updateTodoStatus(
  mapping: DatabaseMapping,
  pageId: string,
  value: string,
): Promise<string> {
  const propertyValue =
    mapping.statusType === "status"
      ? { status: { name: value } }
      : { select: { name: value } }
  const page = await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { [mapping.statusProp]: propertyValue },
    }),
  })
  return typeof page.last_edited_time === "string" ? page.last_edited_time : ""
}

export async function getTodoLastEditedTime(pageId: string): Promise<string> {
  const page = await notionFetch(`/pages/${pageId}`)
  return typeof page.last_edited_time === "string" ? page.last_edited_time : ""
}

/** Notion has no hard delete; archiving is what the trash does. */
export async function archiveTodo(pageId: string): Promise<void> {
  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ in_trash: true }),
  })
}
