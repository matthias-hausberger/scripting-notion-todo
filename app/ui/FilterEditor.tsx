import {
  Button,
  Group,
  HStack,
  NavigationLink,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  useEffect,
  useState,
} from "scripting"
import { DUE_FILTER_LABELS, dueColumn } from "../lib/due"
import { activeFilterLabels } from "../lib/filters"
import { findCompletedStatuses } from "../lib/notion"
import {
  ColumnConfig,
  ColumnFilterState,
  DatabaseMapping,
  DueFilter,
  GroupBy,
  HideCompletedThreshold,
  SavedFilterState,
  Todo,
  WorkspaceUser,
} from "../lib/types"
import { ChoiceScreen } from "./ChoiceScreen"
import { notionColor, orderedStatusOptions } from "./theme"

const HIDE_OPTIONS: { value: HideCompletedThreshold; label: string }[] = [
  { value: "never", label: "Show all" },
  { value: "always", label: "Always hide" },
  { value: "1", label: "Older than 1 day" },
  { value: "3", label: "Older than 3 days" },
  { value: "7", label: "Older than 7 days" },
  { value: "30", label: "Older than 30 days" },
]

const DATE_PRESETS = [
  { value: "", label: "Any" },
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "week", label: "Within 7 days" },
  { value: "none", label: "No date" },
]

function groupKey(g: GroupBy | undefined): string {
  if (!g || g.kind === "none") return "none"
  if (g.kind === "date") return g.column ? `date:${g.column}` : "date"
  return g.kind === "column" ? `col:${g.name}` : g.kind
}

/** Switching between date columns keeps the "show empty dates" choice. */
function parseGroupKey(key: string, previous: GroupBy | undefined): GroupBy {
  if (key === "status") return { kind: "status" }
  if (key === "date" || key.startsWith("date:")) {
    return {
      kind: "date",
      column: key.startsWith("date:") ? key.slice(5) : undefined,
      showEmptyDates: previous?.kind === "date" ? previous.showEmptyDates : undefined,
    }
  }
  if (key.startsWith("col:")) return { kind: "column", name: key.slice(4) }
  return { kind: "none" }
}

/** Group by, and the extra option that only makes sense for dates. Used by the
 *  every tab's filter screen. */
export function GroupBySection({
  mapping,
  filters,
  onChange,
}: {
  mapping: DatabaseMapping
  filters: SavedFilterState
  onChange: (next: SavedFilterState) => void
}) {
  const due = dueColumn(mapping)
  const otherDates = mapping.columns.filter((c) => c.type === "date" && c.name !== due?.name)
  const groupBy = filters.groupBy
  return (
    <Section
      header={<Text>Group by</Text>}
      footer={
        groupBy?.kind === "date" ? (
          <Text>Overdue first, then one section per day, then todos without a date.</Text>
        ) : undefined
      }
    >
      <Picker
        title="Group by"
        pickerStyle="menu"
        value={groupKey(groupBy)}
        onChanged={(key: string) => onChange({ ...filters, groupBy: parseGroupKey(key, groupBy) })}
      >
        <Text tag="none">None</Text>
        <Text tag="status">Status</Text>
        {due ? <Text tag="date">{`Date (${due.name})`}</Text> : null}
        {otherDates.map((c) => (
          <Text key={c.name} tag={`date:${c.name}`}>{`Date (${c.name})`}</Text>
        ))}
        {mapping.columns
          .filter(
            (c) =>
              c.type === "select" ||
              c.type === "multi_select" ||
              c.type === "people" ||
              c.type === "checkbox",
          )
          .map((c) => (
            <Text key={c.name} tag={`col:${c.name}`}>
              {c.name}
            </Text>
          ))}
      </Picker>
      {groupBy?.kind === "date" ? (
        <Toggle
          title="Also show dates without todos"
          value={!!groupBy.showEmptyDates}
          onChanged={(on: boolean) =>
            onChange({ ...filters, groupBy: { ...groupBy, showEmptyDates: on || undefined } })
          }
        />
      ) : null}
    </Section>
  )
}

/** The editable parts of a filter: status, completed, due date, grouping, column
 *  filters and (for Browse only) the advanced Notion filter. Returns sections to put in a List. */
export function FilterEditor({
  mapping,
  filters,
  onChange,
  people,
  todos,
  showAdvanced = false,
}: {
  mapping: DatabaseMapping
  filters: SavedFilterState
  onChange: (next: SavedFilterState) => void
  people: WorkspaceUser[]
  todos: Todo[]
  showAdvanced?: boolean
}) {
  const [advanced, setAdvanced] = useState(filters.advancedFilter ?? "")
  useEffect(() => setAdvanced(filters.advancedFilter ?? ""), [filters.advancedFilter])
  const labels = activeFilterLabels(filters)
  const hasCompleted = findCompletedStatuses(mapping).length > 0
  const columnFilters = filters.columnFilters ?? {}
  const due = dueColumn(mapping)

  function update(patch: Partial<SavedFilterState>) {
    onChange({ ...filters, ...patch })
  }

  function setColumnFilter(name: string, next: ColumnFilterState | undefined) {
    const copy = { ...columnFilters }
    if (next) copy[name] = next
    else delete copy[name]
    update({ columnFilters: copy })
  }

  /** Keep the JSON field text local until it parses and becomes part of the editor draft. */
  async function applyAdvanced() {
    const text = advanced.trim()
    if (text) {
      try {
        JSON.parse(text)
      } catch {
        await Dialog.alert({ title: "Invalid JSON", message: "The advanced filter is not valid JSON." })
        return
      }
    }
    update({ advancedFilter: text })
  }

  function columnRow(column: ColumnConfig) {
    const current = columnFilters[column.name]
    if (column.type === "select" || column.type === "multi_select") {
      const selected = (current?.value as string[] | undefined) ?? []
      const options = column.options ?? []
      return (
        <Section key={column.name}>
          <NavigationLink
            destination={
              <ChoiceScreen
                title={column.name}
                options={options}
                selected={selected}
                multi
                colors={Object.fromEntries(
                  options.map((o) => [o, notionColor(column.optionColors?.[o])]),
                )}
                onChange={(next) =>
                  setColumnFilter(column.name, next.length > 0 ? { ...current, value: next } : undefined)
                }
              />
            }
          >
            <HStack>
              <Text>{column.name}</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel" lineLimit={1}>
                {selected.length > 0 ? selected.join(", ") : "Any"}
              </Text>
            </HStack>
          </NavigationLink>
          {selected.length > 0 ? (
            <Toggle
              title={`Exclude (not ${column.name})`}
              value={!!current?.exclude}
              onChanged={(on: boolean) =>
                setColumnFilter(column.name, {
                  value: selected,
                  mode: current?.mode,
                  exclude: on || undefined,
                })
              }
            />
          ) : null}
          {selected.length > 1 && column.type === "multi_select" ? (
            <Picker
              title="Match"
              pickerStyle="segmented"
              value={current?.mode ?? "any"}
              onChanged={(mode: string) =>
                setColumnFilter(column.name, {
                  value: selected,
                  exclude: current?.exclude,
                  mode: mode as "any" | "all",
                })
              }
            >
              <Text tag="any">Any of</Text>
              <Text tag="all">All of</Text>
            </Picker>
          ) : null}
        </Section>
      )
    }
    if (column.type === "people") {
      const names = Array.from(
        new Set(
          [
            ...people.map((p) => p.name),
            ...todos.flatMap((t) => {
              const cell = t.columns?.[column.name]
              return cell?.type === "people" ? cell.value : []
            }),
          ].filter(Boolean),
        ),
      ).sort()
      return (
        <Picker
          key={column.name}
          title={column.name}
          pickerStyle="menu"
          value={(current?.value as string | undefined) ?? ""}
          onChanged={(v: string) => setColumnFilter(column.name, v ? { value: v } : undefined)}
        >
          <Text tag="">Anyone</Text>
          {names.map((n) => (
            <Text key={n} tag={n}>
              {n}
            </Text>
          ))}
        </Picker>
      )
    }
    if (column.type === "checkbox") {
      return (
        <Picker
          key={column.name}
          title={column.name}
          pickerStyle="menu"
          value={(current?.value as string | undefined) ?? ""}
          onChanged={(v: string) => setColumnFilter(column.name, v ? { value: v } : undefined)}
        >
          <Text tag="">Any</Text>
          <Text tag="checked">Checked</Text>
          <Text tag="unchecked">Unchecked</Text>
        </Picker>
      )
    }
    if (column.type === "rich_text") {
      return (
        <TextField
          key={column.name}
          title={column.name}
          prompt="Contains…"
          value={(current?.value as string | undefined) ?? ""}
          onChanged={(v: string) => setColumnFilter(column.name, v ? { value: v } : undefined)}
        />
      )
    }
    if (column.type === "date" || column.type === "created_time" || column.type === "last_edited_time") {
      return (
        <Picker
          key={column.name}
          title={column.name}
          pickerStyle="menu"
          value={(current?.value as string | undefined) ?? ""}
          onChanged={(v: string) => setColumnFilter(column.name, v ? { value: v } : undefined)}
        >
          {DATE_PRESETS.map((p) => (
            <Text key={p.value} tag={p.value}>
              {p.label}
            </Text>
          ))}
        </Picker>
      )
    }
    return null
  }

  return (
    <Group>
      <Section
        header={<Text>Status and due date</Text>}
        footer={labels.length > 0 ? <Text>{labels.join(" · ")}</Text> : undefined}
      >
        <NavigationLink
          destination={
            <ChoiceScreen
              title="Status"
              options={orderedStatusOptions(mapping)}
              selected={filters.status ?? []}
              multi
              onChange={(next) => update({ status: next })}
            />
          }
        >
          <HStack>
            <Text>Status</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel" lineLimit={1}>
              {filters.status && filters.status.length > 0 ? filters.status.join(", ") : "All"}
            </Text>
          </HStack>
        </NavigationLink>
        {hasCompleted ? (
          <Picker
            title="Completed"
            pickerStyle="menu"
            value={filters.hideCompleted ?? "never"}
            onChanged={(v: string) => update({ hideCompleted: v as HideCompletedThreshold })}
          >
            {HIDE_OPTIONS.map((o) => (
              <Text key={o.value} tag={o.value}>
                {o.label}
              </Text>
            ))}
          </Picker>
        ) : null}
        {due ? (
          <Picker
            title={`Due (${due.name})`}
            pickerStyle="menu"
            value={filters.due ?? "any"}
            onChanged={(v: string) => update({ due: v as DueFilter })}
          >
            {DUE_FILTER_LABELS.map((o) => (
              <Text key={o.value} tag={o.value}>
                {o.label}
              </Text>
            ))}
          </Picker>
        ) : null}
      </Section>

      <GroupBySection mapping={mapping} filters={filters} onChange={onChange} />

      {mapping.columns.length > 0 ? (
        <Section header={<Text>Columns</Text>}>
          {mapping.columns.filter((c) => c.name !== due?.name).map((column) => columnRow(column))}
        </Section>
      ) : null}

      {showAdvanced ? (
        <Section
          header={<Text>Advanced (Notion filter JSON)</Text>}
          footer={
            <Text>
              This filter runs on the local cache and never changes which tasks sync. Use properties included in the cache (title, status, and columns under Edit columns); unsupported properties or operators are called out in the task list. Use absolute ISO dates for date filters.
            </Text>
          }
        >
          <TextField
            title="Filter"
            prompt='{"property":"Status","status":{"equals":"Done"}}'
            value={advanced}
            onChanged={setAdvanced}
            axis="vertical"
            lineLimit={{ min: 2, max: 8 }}
          />
          <Button title="Use Advanced Filter" systemImage="checkmark" action={applyAdvanced} />
        </Section>
      ) : null}
    </Group>
  )
}
