import {
  Button,
  HStack,
  List,
  Markdown,
  Menu,
  Navigation,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
} from "scripting"
import { changeStatus, ensureContent, removeTodo, useStore, visibleTodos } from "../lib/store"
import { DatabaseMapping, Todo } from "../lib/types"
import { openTodoForm } from "./TodoForm"
import { ChipRow, columnChips, orderedStatusOptions, statusColor } from "./theme"

export function formatTodoAsText(todo: Todo, mapping: DatabaseMapping): string {
  const lines = [todo.title]
  if (todo.status) lines.push(`Status: ${todo.status}`)
  if (todo.hasContent) lines.push("", todo.content)
  const fields = mapping.columns
    .filter((column) => column.showInDetail)
    .map((column) => {
      const text = columnChips(todo, column)
        .map((c) => c.text)
        .join(", ")
      return text ? `${column.name}: ${text}` : null
    })
    .filter((l): l is string => l !== null)
  if (fields.length > 0) lines.push("", ...fields)
  return lines.join("\n")
}

export async function confirmDelete(todo: Todo): Promise<boolean> {
  return Dialog.confirm({
    title: `Delete "${todo.title}"?`,
    message: "This moves the page to Notion's trash.",
    confirmLabel: "Delete",
  })
}

export function DetailScreen({ todoId }: { todoId: string }) {
  const s = useStore()
  const dismiss = Navigation.useDismiss()
  const mapping = s.mapping
  const todo = visibleTodos().find((t) => t.id === todoId)

  useEffect(() => {
    if (todo && !todo.contentLoaded) ensureContent([todo.id], true)
  }, [todoId, todo?.contentLoaded])

  if (!mapping || !todo) {
    return (
      <List navigationTitle="Todo">
        <Text foregroundStyle="secondaryLabel">This todo no longer exists.</Text>
      </List>
    )
  }

  const detailColumns = mapping.columns.filter((c) => c.showInDetail)

  return (
    <List
      navigationTitle="Todo"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: [
          <Button
            title="Edit"
            action={() => openTodoForm({ mapping, todo })}
          />,
          <Menu title="More" systemImage="ellipsis.circle">
            <Button
              title="Open in Notion"
              systemImage="arrow.up.right.square"
              action={() => todo.url && Safari.openURL(todo.url)}
            />
            <Button
              title="Copy Link"
              systemImage="link"
              action={() => Pasteboard.setString(todo.url)}
            />
            <Button
              title="Copy Todo"
              systemImage="doc.on.doc"
              action={() => Pasteboard.setString(formatTodoAsText(todo, mapping))}
            />
            <Button
              title="Delete"
              systemImage="trash"
              role="destructive"
              action={async () => {
                if (await confirmDelete(todo)) {
                  removeTodo(todo)
                  dismiss()
                }
              }}
            />
          </Menu>,
        ],
      }}
    >
      <Section>
        <VStack alignment="leading" spacing={6}>
          <Text font="title2">{todo.title}</Text>
          <ChipRow
            chips={[{ text: todo.status ?? "No status", color: statusColor(mapping, todo.status) }]}
          />
        </VStack>
        <Picker
          title="Status"
          pickerStyle="menu"
          value={todo.status ?? ""}
          onChanged={(value: string) => value && changeStatus(todo, value)}
        >
          {orderedStatusOptions(mapping).map((option) => (
            <Text key={option} tag={option}>
              {option}
            </Text>
          ))}
        </Picker>
      </Section>

      {detailColumns.length > 0 ? (
        <Section header={<Text>Fields</Text>}>
          {detailColumns.map((column) => {
            const chips = columnChips(todo, column, mapping)
            if (chips.length === 0) return null
            return (
              <HStack key={column.name}>
                <Text>{column.name}</Text>
                <Spacer />
                <ChipRow chips={chips.map((c) => ({ ...c, icon: undefined }))} />
              </HStack>
            )
          })}
        </Section>
      ) : null}

      <Section header={<Text>Description</Text>}>
        {!todo.contentLoaded ? (
          <Text foregroundStyle="secondaryLabel">Loading…</Text>
        ) : todo.content ? (
          <Markdown content={todo.content} scrollable={false} />
        ) : (
          <Text foregroundStyle="secondaryLabel">No description</Text>
        )}
      </Section>
    </List>
  )
}
