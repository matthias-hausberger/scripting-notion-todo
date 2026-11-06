import {
  ColumnType,
  DatabaseMapping,
  NotionStatusGroup,
  Todo,
} from "./types"

type Json = Record<string, unknown>
type FilterFn = (todo: Todo) => boolean

interface PreparedFilter {
  matches?: FilterFn
  warning?: string
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function badFilter(message: string): never {
  throw new Error(message)
}

function mappedPropertyType(name: string, mapping: DatabaseMapping): ColumnType | "title" | "status" | null {
  if (name === mapping.titleProp) return "title"
  if (name === mapping.statusProp) return mapping.statusType
  return mapping.columns.find((column) => column.name === name)?.type ?? null
}

const dateOperators = new Set([
  "after", "before", "equals", "on_or_after", "on_or_before", "is_empty", "is_not_empty",
])
const stringOperators = new Set([
  "equals", "does_not_equal", "contains", "does_not_contain", "starts_with", "ends_with", "is_empty", "is_not_empty",
])

function validateCondition(type: string, value: unknown): void {
  if (!isObject(value)) badFilter(`The “${type}” condition must be a JSON object.`)
  const operators = Object.keys(value)
  if (operators.length === 0) badFilter(`The “${type}” condition is empty.`)

  let allowed: Set<string>
  if (type === "title" || type === "rich_text") allowed = stringOperators
  else if (type === "date" || type === "created_time" || type === "last_edited_time") allowed = dateOperators
  else if (type === "select") allowed = new Set(["equals", "does_not_equal", "is_empty", "is_not_empty"])
  else if (type === "status") allowed = new Set(["equals", "does_not_equal", "group_equals", "group_does_not_equal", "is_empty", "is_not_empty"])
  else if (type === "multi_select") allowed = new Set(["contains", "does_not_contain", "is_empty", "is_not_empty"])
  else if (type === "checkbox") allowed = new Set(["equals", "does_not_equal"])
  else badFilter(`The “${type}” property is not available in the local cache.`)

  for (const [operator, expected] of Object.entries(value)) {
    if (!allowed.has(operator)) badFilter(`The “${operator}” operator for “${type}” is not supported locally.`)
    if (operator === "is_empty" || operator === "is_not_empty") {
      if (expected !== true) badFilter(`The “${operator}” operator must be true.`)
    } else if (type === "date" || type === "created_time" || type === "last_edited_time") {
      if (typeof expected !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(expected) || Number.isNaN(Date.parse(expected))) {
        badFilter("Use an absolute ISO date or date-time in advanced date filters; relative Notion dates are not supported offline.")
      }
    } else if (type === "checkbox") {
      if (typeof expected !== "boolean") badFilter(`The “${operator}” value must be true or false.`)
    } else if (type === "multi_select" && (operator === "contains" || operator === "does_not_contain")) {
      if (typeof expected !== "string") badFilter(`The “${operator}” value must be one option name; arrays are not supported locally.`)
    } else if (typeof expected !== "string") {
      badFilter(`The “${operator}” value for “${type}” must be a string.`)
    }
  }
}

function validateFilter(node: unknown, mapping: DatabaseMapping): void {
  if (!isObject(node)) badFilter("The advanced filter must be a JSON object.")
  const compound = ["and", "or"].filter((key) => key in node)
  if (compound.length > 0) {
    if (compound.length !== 1) badFilter("Use either “and” or “or” at each filter level.")
    const children = node[compound[0]]
    if (!Array.isArray(children) || children.length === 0) badFilter(`“${compound[0]}” must contain a non-empty array.`)
    children.forEach((child) => validateFilter(child, mapping))
    return
  }

  if (typeof node.timestamp === "string") {
    if (node.timestamp !== "created_time" && node.timestamp !== "last_edited_time") {
      badFilter(`Timestamp “${node.timestamp}” is not supported locally.`)
    }
    validateCondition(node.timestamp, node[node.timestamp])
    return
  }

  if (typeof node.property !== "string") badFilter("Each property filter needs a “property” name.")
  const conditionTypes = Object.keys(node).filter((key) => key !== "property")
  if (conditionTypes.length !== 1) badFilter("Each property filter must have exactly one condition type.")
  const conditionType = conditionTypes[0]
  const actualType = mappedPropertyType(node.property, mapping)
  if (!actualType) badFilter(`“${node.property}” is not included in the local cache. Add it under Edit columns first.`)
  if (conditionType !== actualType) {
    badFilter(`“${node.property}” is cached as “${actualType}”, but this filter uses “${conditionType}”.`)
  }
  validateCondition(conditionType, node[conditionType])
}

function empty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
}

function dateMatches(value: string | null, condition: Json): boolean {
  for (const [operator, expected] of Object.entries(condition)) {
    if (operator === "is_empty") {
      if (value !== null) return false
      continue
    }
    if (operator === "is_not_empty") {
      if (value === null) return false
      continue
    }
    if (!value || typeof expected !== "string") return false
    const actualDay = value.slice(0, 10)
    const expectedDay = expected.slice(0, 10)
    const samePrecisionIsDateOnly = value.length === 10 && expected.length === 10
    const actual = samePrecisionIsDateOnly ? actualDay : Date.parse(value)
    const target = samePrecisionIsDateOnly ? expectedDay : Date.parse(expected)
    if (operator === "after" && !(actual > target)) return false
    if (operator === "before" && !(actual < target)) return false
    if (operator === "equals" && !(actual === target)) return false
    if (operator === "on_or_after" && !(actual >= target)) return false
    if (operator === "on_or_before" && !(actual <= target)) return false
  }
  return true
}

function stringMatches(actual: string | null, condition: Json): boolean {
  for (const [operator, expected] of Object.entries(condition)) {
    if (operator === "is_empty") {
      if (actual !== null && actual !== "") return false
      continue
    }
    if (operator === "is_not_empty") {
      if (actual === null || actual === "") return false
      continue
    }
    if (typeof expected !== "string" || actual === null) return false
    if (operator === "equals" && actual !== expected) return false
    if (operator === "does_not_equal" && actual === expected) return false
    if (operator === "contains" && !actual.toLowerCase().includes(expected.toLowerCase())) return false
    if (operator === "does_not_contain" && actual.toLowerCase().includes(expected.toLowerCase())) return false
    if (operator === "starts_with" && !actual.toLowerCase().startsWith(expected.toLowerCase())) return false
    if (operator === "ends_with" && !actual.toLowerCase().endsWith(expected.toLowerCase())) return false
  }
  return true
}

function statusGroupMatches(
  status: string | null,
  groupName: string,
  groups: NotionStatusGroup[],
): boolean {
  return !!status && !!groups.find((group) => group.name === groupName)?.optionNames.includes(status)
}

function propertyValue(todo: Todo, name: string, mapping: DatabaseMapping): { type: string; value: unknown } | null {
  if (name === mapping.titleProp) return { type: "title", value: todo.title }
  if (name === mapping.statusProp) return { type: mapping.statusType, value: todo.status }
  const cell = todo.columns?.[name]
  return cell ? { type: cell.type, value: cell.value } : null
}

function matchNode(node: Json, todo: Todo, mapping: DatabaseMapping): boolean {
  if (Array.isArray(node.and)) return node.and.every((child) => matchNode(child as Json, todo, mapping))
  if (Array.isArray(node.or)) return node.or.some((child) => matchNode(child as Json, todo, mapping))
  if (typeof node.timestamp === "string") {
    const time = node.timestamp === "created_time" ? todo.createdTime : todo.lastEditedTime
    return dateMatches(time, node[node.timestamp] as Json)
  }

  const name = node.property as string
  const conditionType = Object.keys(node).find((key) => key !== "property") as string
  const condition = node[conditionType] as Json
  const property = propertyValue(todo, name, mapping)
  if (!property) return false
  const value = property.value

  if (conditionType === "title" || conditionType === "rich_text") {
    return stringMatches(value as string | null, condition)
  }
  if (conditionType === "date" || conditionType === "created_time" || conditionType === "last_edited_time") {
    return dateMatches(value as string | null, condition)
  }
  if (conditionType === "select") return stringMatches(value as string | null, condition)
  if (conditionType === "status") {
    for (const [operator, expected] of Object.entries(condition)) {
      if (operator === "group_equals" && !statusGroupMatches(value as string | null, expected as string, mapping.statusGroups)) return false
      if (operator === "group_does_not_equal" && statusGroupMatches(value as string | null, expected as string, mapping.statusGroups)) return false
      if (operator === "is_empty" && !empty(value)) return false
      if (operator === "is_not_empty" && empty(value)) return false
      if (operator === "equals" && value !== expected) return false
      if (operator === "does_not_equal" && value === expected) return false
    }
    return true
  }
  if (conditionType === "multi_select") {
    const values = value as string[]
    for (const [operator, expected] of Object.entries(condition)) {
      if (operator === "is_empty" && !empty(values)) return false
      if (operator === "is_not_empty" && empty(values)) return false
      if (operator === "contains" && !values.includes(expected as string)) return false
      if (operator === "does_not_contain" && values.includes(expected as string)) return false
    }
    return true
  }
  if (conditionType === "checkbox") {
    for (const [operator, expected] of Object.entries(condition)) {
      if (operator === "equals" && value !== expected) return false
      if (operator === "does_not_equal" && value === expected) return false
    }
    return true
  }
  return false
}

function prepare(raw: string | undefined, mapping: DatabaseMapping): PreparedFilter {
  if (!raw?.trim()) return {}
  try {
    const filter: unknown = JSON.parse(raw)
    validateFilter(filter, mapping)
    return { matches: (todo) => matchNode(filter as Json, todo, mapping) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { warning: `Advanced filter isn't applied locally: ${message}` }
  }
}

/** A clear warning is preferable to a partial or misleading local filter. */
export function advancedFilterWarning(raw: string | undefined, mapping: DatabaseMapping): string | null {
  return prepare(raw, mapping).warning ?? null
}

/** Applies supported Notion filter JSON to the cached page properties. */
export function applyAdvancedFilter(todos: Todo[], raw: string | undefined, mapping: DatabaseMapping): Todo[] {
  const prepared = prepare(raw, mapping)
  if (!prepared.matches) return todos
  return todos.filter(prepared.matches)
}
