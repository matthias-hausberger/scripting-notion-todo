import { Color, HStack, Image, Spacer, Text, VStack } from "scripting"
import { dueTone, formatDueLabel } from "../lib/dateparse"
import { findCompletedStatuses, findStatusGroup } from "../lib/notion"
import { dueColumn } from "../lib/due"
import { ColumnConfig, DatabaseMapping, Todo } from "../lib/types"

const NOTION_COLORS: Record<string, Color> = {
  default: "secondaryLabel",
  gray: "secondaryLabel",
  brown: "systemOrange",
  orange: "systemOrange",
  yellow: "systemYellow",
  green: "systemGreen",
  blue: "systemBlue",
  purple: "systemPurple",
  pink: "systemPink",
  red: "systemRed",
}

/** App-owned accent for primary actions and selection; Notion property colors stay data-driven. */
export const APP_ACCENT: Color = "#2563EB"

export function notionColor(color: string | undefined): Color {
  return NOTION_COLORS[color ?? "default"] ?? "secondaryLabel"
}

/** A status takes the color of the Notion status group (To-do / In progress / Complete) it belongs to. */
export function statusColor(mapping: DatabaseMapping, status: string | null): Color {
  return notionColor(findStatusGroup(mapping, status)?.color)
}

export function statusIcon(mapping: DatabaseMapping, status: string | null): string {
  if (status && findCompletedStatuses(mapping).includes(status)) {
    return "checkmark.circle.fill"
  }
  const group = findStatusGroup(mapping, status)?.name.toLowerCase() ?? ""
  if (group.includes("progress")) return "circle.lefthalf.filled"
  return "circle"
}

/** Status names ordered by Notion's own groups, alphabetical within a group. */
export function orderedStatusOptions(mapping: DatabaseMapping): string[] {
  if (mapping.statusGroups.length === 0) {
    return [...mapping.statusOptions].sort((a, b) => a.localeCompare(b))
  }
  return mapping.statusGroups.flatMap((g) =>
    mapping.statusOptions
      .filter((s) => g.optionNames.includes(s))
      .sort((a, b) => a.localeCompare(b)),
  )
}

export function columnIcon(column: ColumnConfig): string {
  switch (column.type) {
    case "people":
      return "person"
    case "date":
    case "created_time":
    case "last_edited_time":
      return "calendar"
    case "checkbox":
      return "checkmark.circle"
    case "relation":
      return "link"
    default:
      return "tag"
  }
}

interface Chip {
  text: string
  color: Color
  icon?: string
}

export const DUE_COLORS: Record<"overdue" | "today" | "future", Color> = {
  overdue: "systemRed",
  today: "systemGreen",
  future: "systemOrange",
}

export function columnChips(todo: Todo, column: ColumnConfig, mapping?: DatabaseMapping): Chip[] {
  const cell = todo.columns?.[column.name]
  if (!cell) return []
  if (cell.type === "date" && mapping && dueColumn(mapping)?.name === column.name) {
    return cell.value
      ? [{ text: formatDueLabel(cell.value), color: DUE_COLORS[dueTone(cell.value)], icon: "calendar" }]
      : []
  }
  const optionColor = (v: string) => notionColor(column.optionColors?.[v])
  switch (cell.type) {
    case "select":
      return cell.value ? [{ text: cell.value, color: optionColor(cell.value) }] : []
    case "multi_select":
      return cell.value.map((v) => ({ text: v, color: optionColor(v) }))
    case "people":
    case "relation":
      return cell.value.length > 0
        ? [{ text: cell.value.join(", "), color: "secondaryLabel", icon: columnIcon(column) }]
        : []
    case "checkbox":
      return cell.value
        ? [{ text: column.name, color: "secondaryLabel", icon: "checkmark" }]
        : []
    case "date":
    case "created_time":
    case "last_edited_time":
      return cell.value
        ? [{ text: cell.value.slice(0, 10), color: "secondaryLabel", icon: columnIcon(column) }]
        : []
    case "rich_text":
      return cell.value
        ? [{ text: cell.value, color: "secondaryLabel" }]
        : []
  }
}

export function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <HStack spacing={8}>
      {chips.map((chip, i) => (
        <HStack key={`${chip.text}-${i}`} spacing={3}>
          {chip.icon ? (
            <Image systemName={chip.icon} font="caption2" foregroundStyle={chip.color} />
          ) : null}
          <Text font="caption" lineLimit={1} foregroundStyle={chip.color}>
            {chip.text}
          </Text>
        </HStack>
      ))}
    </HStack>
  )
}

export function TodoRow({
  todo,
  mapping,
  hasPendingChange,
}: {
  todo: Todo
  mapping: DatabaseMapping
  hasPendingChange: boolean
}) {
  const done = todo.status !== null && findCompletedStatuses(mapping).includes(todo.status)
  const chips: Chip[] = [
    {
      text: todo.status ?? "No status",
      color: statusColor(mapping, todo.status),
    },
    ...mapping.columns
      .filter((c) => c.showInList)
      .flatMap((c) => columnChips(todo, c, mapping)),
  ]
  return (
    <HStack spacing={12}>
      <Image
        systemName={statusIcon(mapping, todo.status)}
        foregroundStyle={statusColor(mapping, todo.status)}
      />
      <VStack alignment="leading" spacing={3}>
        <Text lineLimit={2} foregroundStyle={done ? "secondaryLabel" : "label"}>
          {todo.title}
        </Text>
        <ChipRow chips={chips} />
      </VStack>
      <Spacer />
      {hasPendingChange ? (
        <Image
          systemName="icloud.and.arrow.up"
          font="caption"
          foregroundStyle="secondaryLabel"
        />
      ) : todo.hasContent ? (
        <Image systemName="text.alignleft" font="caption" foregroundStyle="secondaryLabel" />
      ) : null}
    </HStack>
  )
}
