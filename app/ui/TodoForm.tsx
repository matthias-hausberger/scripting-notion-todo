import {
  Button,
  DatePicker,
  Group,
  HStack,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { msToTime, parseTime, timeToMs } from "../lib/settings"
import { toDateTimeValue, toDateValue } from "../lib/dateparse"
import {
  addTodo,
  deleteDraft,
  editTodo,
  getState,
  newDraftId,
  saveMapping,
  upsertDraft,
  useStore,
} from "../lib/store"
import { columnIsReadOnly, getDiscoveredPeople, listWorkspaceUsers } from "../lib/notion"
import {
  ColumnConfig,
  ColumnRawValue,
  ColumnValue,
  DatabaseMapping,
  Draft,
  NewTodoContext,
  Todo,
  WorkspaceUser,
} from "../lib/types"
import { ChoiceScreen } from "./ChoiceScreen"
import { notionColor, orderedStatusOptions } from "./theme"

type FormValue = string | string[] | boolean

interface FormProps {
  mapping: DatabaseMapping
  /** Edit this todo. */
  todo?: Todo
  /** Resume this draft. */
  draft?: Draft
  /** Start a new todo with these values (deep link or filter). */
  prefill?: NewTodoContext
}

export function openTodoForm(props: FormProps): Promise<void> {
  return Navigation.present({ element: <TodoForm {...props} />, modalPresentationStyle: "pageSheet" })
}

// ---------------------------------------------------------------- date helpers

function dateToMs(value: string): number {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number)
  return new Date(y, m - 1, d).getTime()
}

// ---------------------------------------------------------------- initial values

function emptyValue(column: ColumnConfig): FormValue {
  if (column.type === "multi_select" || column.type === "people") return []
  if (column.type === "checkbox") return false
  return ""
}

function initialColumns(
  mapping: DatabaseMapping,
  todo: Todo | undefined,
  saved: Record<string, ColumnRawValue> | undefined,
): Record<string, FormValue> {
  const result: Record<string, FormValue> = {}
  for (const column of mapping.columns) {
    const cell = todo?.columns?.[column.name]
    const fallback = saved?.[column.name]
    let value: FormValue = emptyValue(column)
    if (cell && "value" in cell && cell.value !== null) value = cell.value as FormValue
    else if (fallback !== undefined) value = fallback
    result[column.name] = value
  }
  return result
}

function mergePeople(...lists: WorkspaceUser[][]): WorkspaceUser[] {
  const byId = new Map<string, WorkspaceUser>()
  for (const list of lists) for (const u of list) byId.set(u.id, u)
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function summary(value: FormValue | undefined): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "None"
  if (typeof value === "string") return value || "None"
  return ""
}

// ---------------------------------------------------------------- form

export function TodoForm({ mapping, todo, draft, prefill }: FormProps) {
  const dismiss = Navigation.useDismiss()
  const s = useStore()
  const isEdit = !!todo
  const draftId = useMemo(() => draft?.id ?? newDraftId(), [])

  const [title, setTitle] = useState(todo?.title ?? draft?.title ?? prefill?.title ?? "")
  const [content, setContent] = useState(
    todo?.content ?? draft?.content ?? prefill?.content ?? "",
  )
  const [status, setStatus] = useState(
    todo?.status ?? draft?.status ?? prefill?.status ?? mapping.statusOptions[0] ?? "",
  )
  const [columns, setColumns] = useState<Record<string, FormValue>>(() =>
    initialColumns(mapping, todo, draft?.columns ?? prefill?.columns),
  )
  const [newOptions, setNewOptions] = useState<Record<string, string>>(
    draft?.newOptions ?? {},
  )
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([])

  const hasPeople = mapping.columns.some((c) => c.type === "people" && c.showInDetail)
  const users = useMemo(
    () => mergePeople(workspaceUsers, s.people, getDiscoveredPeople()),
    [workspaceUsers, s.people],
  )

  // Personal access tokens can't list users, and offline there's nothing to
  // list: both fall back to the people already seen on fetched todos.
  useEffect(() => {
    if (!hasPeople) return
    listWorkspaceUsers()
      .then(setWorkspaceUsers)
      .catch(() => undefined)
  }, [hasPeople])

  // Drafts: a new todo is saved on every change and removed once it has
  // nothing in it or has been submitted.
  useEffect(() => {
    if (isEdit) return
    if (!title.trim() && !content.trim()) {
      deleteDraft(draftId)
      return
    }
    upsertDraft({
      id: draftId,
      title,
      content,
      status,
      columns: columns as Record<string, ColumnRawValue>,
      newOptions,
      updatedAt: Date.now(),
    })
  }, [title, content, status, columns, newOptions])

  function setColumn(name: string, value: FormValue) {
    setColumns((prev) => ({ ...prev, [name]: value }))
  }

  function typedOptions(name: string): string[] {
    return (newOptions[name] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  }

  function build() {
    const raw: Record<string, ColumnRawValue> = {}
    const display: Record<string, ColumnValue> = {}
    for (const column of mapping.columns.filter((c) => c.showInDetail)) {
      if (columnIsReadOnly(column.type)) continue
      const value = columns[column.name]
      switch (column.type) {
        case "select": {
          const selected = typedOptions(column.name)[0] ?? (value as string)
          raw[column.name] = selected
          display[column.name] = { type: "select", value: selected || null }
          break
        }
        case "multi_select": {
          const all = Array.from(
            new Set([...(value as string[]), ...typedOptions(column.name)]),
          )
          raw[column.name] = all
          display[column.name] = { type: "multi_select", value: all }
          break
        }
        case "people": {
          const picked = (value as string[])
            .map((name) => users.find((u) => u.name === name))
            .filter((u): u is WorkspaceUser => !!u)
          raw[column.name] = picked.map((u) => u.id)
          display[column.name] = { type: "people", value: picked.map((u) => u.name) }
          break
        }
        case "date":
          raw[column.name] = value as string
          display[column.name] = { type: "date", value: (value as string) || null }
          break
        case "checkbox":
          raw[column.name] = value as boolean
          display[column.name] = { type: "checkbox", value: value as boolean }
          break
        case "rich_text":
          raw[column.name] = value as string
          display[column.name] = { type: "rich_text", value: value as string }
          break
      }
    }
    return { raw, display }
  }

  /** Newly typed select options are remembered so they're pickable next time. */
  function rememberTypedOptions() {
    const current = getState().mapping
    if (!current) return
    let changed = false
    const next = {
      ...current,
      columns: current.columns.map((column) => {
        const typed = typedOptions(column.name)
        const merged = Array.from(new Set([...(column.options ?? []), ...typed]))
        if (typed.length === 0 || merged.length === (column.options ?? []).length) return column
        changed = true
        return { ...column, options: merged }
      }),
    }
    if (changed) saveMapping(next)
  }

  async function submit() {
    if (!title.trim()) {
      await Dialog.alert({ message: "Title is required" })
      return
    }
    const { raw, display } = build()
    const fields = { title: title.trim(), status, columns: raw, display }
    rememberTypedOptions()
    if (todo) editTodo(todo, fields, content)
    else addTodo(fields, content)
    deleteDraft(draftId)
    dismiss()
  }

  function discardDraft() {
    deleteDraft(draftId)
    dismiss()
  }

  const formColumns = mapping.columns.filter((c) => c.showInDetail)

  function choiceRow(column: ColumnConfig, multi: boolean, options: string[]) {
    const value = columns[column.name]
    const selected = Array.isArray(value) ? value : value ? [value as string] : []
    const colors = Object.fromEntries(
      options.map((o) => [o, notionColor(column.optionColors?.[o])]),
    )
    return (
      <NavigationLink
        key={column.name}
        destination={
          <ChoiceScreen
            title={column.name}
            options={options}
            selected={selected}
            multi={multi}
            colors={column.type === "people" ? undefined : colors}
            onChange={(next) => setColumn(column.name, multi ? next : (next[0] ?? ""))}
          />
        }
      >
        <HStack>
          <Text>{column.name}</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel" lineLimit={1}>
            {summary(value)}
          </Text>
        </HStack>
      </NavigationLink>
    )
  }

  return (
    <NavigationStack presentationDetents={["medium", "large"]} presentationDragIndicator="visible">
      <List
        navigationTitle={isEdit ? "Edit Task" : "New Task"}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="Close" action={dismiss} />,
          confirmationAction: (
            <Button title={isEdit ? "Save" : "Create"} action={submit} />
          ),
        }}
      >
        <Section>
          <TextField
            title="Title"
            prompt="What needs to be done?"
            value={title}
            onChanged={setTitle}
            autofocus={!isEdit && !title}
          />
          <TextField
            title="Description"
            prompt="Markdown: **bold**, - lists, # headings"
            value={content}
            onChanged={setContent}
            axis="vertical"
            lineLimit={{ min: 3, max: 12 }}
          />
          <Picker title="Status" pickerStyle="menu" value={status} onChanged={setStatus}>
            {orderedStatusOptions(mapping).map((option) => (
              <Text key={option} tag={option}>
                {option}
              </Text>
            ))}
          </Picker>
        </Section>

        {formColumns.length > 0 ? (
          <Section header={<Text>Fields</Text>}>
            {formColumns.map((column) => {
              const value = columns[column.name]
              if (columnIsReadOnly(column.type)) {
                const cell = todo?.columns?.[column.name]
                return (
                  <HStack key={column.name}>
                    <Text>{column.name}</Text>
                    <Spacer />
                    <Text foregroundStyle="secondaryLabel">
                      {cell && "value" in cell ? summary(cell.value as FormValue) : "None"}
                    </Text>
                  </HStack>
                )
              }
              switch (column.type) {
                case "rich_text":
                  return (
                    <TextField
                      key={column.name}
                      title={column.name}
                      value={value as string}
                      onChanged={(v) => setColumn(column.name, v)}
                    />
                  )
                case "checkbox":
                  return (
                    <Toggle
                      key={column.name}
                      title={column.name}
                      value={value as boolean}
                      onChanged={(v) => setColumn(column.name, v)}
                    />
                  )
                case "date":
                  {
                    const dateValue = value as string
                    const hasTime = dateValue.includes("T")
                    const time = hasTime
                      ? msToTime(new Date(dateValue).getTime())
                      : s.settings.notifications.defaultTime
                    return (
                      <Group key={column.name}>
                        <Toggle
                          title={column.name}
                          value={!!dateValue}
                          onChanged={(on) => setColumn(column.name, on ? toDateValue(new Date()) : "")}
                        />
                        {dateValue ? (
                          <Group>
                            <DatePicker
                              title="Date"
                              value={dateToMs(dateValue)}
                              onChanged={(ms) => {
                                const day = new Date(ms)
                                setColumn(
                                  column.name,
                                  hasTime
                                    ? toDateTimeValue(day, parseTime(time).hour, parseTime(time).minute)
                                    : toDateValue(day),
                                )
                              }}
                              displayedComponents={["date"]}
                            />
                            <Toggle
                              title="Include time"
                              value={hasTime}
                              onChanged={(on) => {
                                const day = new Date(dateToMs(dateValue))
                                setColumn(
                                  column.name,
                                  on
                                    ? toDateTimeValue(day, parseTime(time).hour, parseTime(time).minute)
                                    : toDateValue(day),
                                )
                              }}
                            />
                            {hasTime ? (
                              <DatePicker
                                title="At"
                                value={timeToMs(time)}
                                onChanged={(ms) => {
                                  const chosen = new Date(ms)
                                  const day = new Date(dateToMs(dateValue))
                                  setColumn(column.name, toDateTimeValue(day, chosen.getHours(), chosen.getMinutes()))
                                }}
                                displayedComponents={["hourAndMinute"]}
                              />
                            ) : null}
                          </Group>
                        ) : null}
                      </Group>
                    )
                  }
                case "people":
                  return choiceRow(
                    column,
                    true,
                    users.map((u) => u.name),
                  )
                case "select":
                  return choiceRow(column, false, column.options ?? [])
                case "multi_select":
                  return choiceRow(column, true, column.options ?? [])
                default:
                  return null
              }
            })}
          </Section>
        ) : null}

        {formColumns.some((c) => c.type === "select" || c.type === "multi_select") ? (
          <Section
            header={<Text>New values</Text>}
            footer={<Text>Comma-separated. Notion creates options that don't exist yet.</Text>}
          >
            {formColumns
              .filter((c) => c.type === "select" || c.type === "multi_select")
              .map((column) => (
                <TextField
                  key={column.name}
                  title={column.name}
                  prompt={column.type === "select" ? "Replaces the selection above" : "urgent, backlog"}
                  value={newOptions[column.name] ?? ""}
                  onChanged={(v) => setNewOptions((prev) => ({ ...prev, [column.name]: v }))}
                />
              ))}
          </Section>
        ) : null}

        {!isEdit ? (
          <Section footer={<Text>Drafts are saved as you type and appear on the list.</Text>}>
            <Button title="Discard Draft" role="destructive" action={discardDraft} />
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}
