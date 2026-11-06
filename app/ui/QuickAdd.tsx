import {
  Button,
  Color,
  DatePicker,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationStack,
  Rectangle,
  ScrollView,
  Text,
  TextField,
  Toggle,
  VStack,
  gradient,
  useColorScheme,
  useMemo,
  useState,
} from "scripting"
import { datePresets, dueTone, formatDueLabel, parseDatePhrase, toDateTimeValue, toDateValue } from "../lib/dateparse"
import { dueColumn } from "../lib/due"
import {
  ChipDef,
  QuickAddDraft,
  activeChips,
  defaultStatus,
  draftToPrefill,
  filterColumnValues,
  quickAddFields,
} from "../lib/quickadd"
import { msToTime, parseTime, timeToMs } from "../lib/settings"
import { addTodo, useStore } from "../lib/store"
import {
  ColumnConfig,
  ColumnRawValue,
  DatabaseMapping,
  NewTodoContext,
  SavedFilterState,
  WorkspaceUser,
} from "../lib/types"
import { openTodoForm } from "./TodoForm"
import { APP_ACCENT, DUE_COLORS, columnIcon, notionColor, orderedStatusOptions, statusColor, statusIcon } from "./theme"

function Chip({
  label,
  systemImage,
  color = "secondaryLabel",
}: {
  label: string
  systemImage: string
  color?: Color
}) {
  return (
    <HStack
      spacing={5}
      padding={{ horizontal: 12, vertical: 8 }}
      background={{ style: "tertiarySystemFill", shape: "capsule" }}
    >
      <Image systemName={systemImage} font="footnote" foregroundStyle={color} />
      <Text font="subheadline" lineLimit={1} foregroundStyle={color}>
        {label}
      </Text>
    </HStack>
  )
}

/** Date, with an optional time, for the due date chip's "Pick date…". */
function PickDate({
  title = "Due date",
  initial,
  defaultTime,
  onPick,
}: {
  title?: string
  initial: string | null
  defaultTime: string
  onPick: (value: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [dayMs, setDayMs] = useState(() => {
    if (!initial) return Date.now()
    const [y, m, d] = initial.slice(0, 10).split("-").map(Number)
    return new Date(y, m - 1, d).getTime()
  })
  const [time, setTime] = useState<string | null>(() => {
    if (!initial?.includes("T")) return null
    const at = new Date(initial)
    return Number.isNaN(at.getTime()) ? null : msToTime(at.getTime())
  })

  function confirm() {
    const day = new Date(dayMs)
    if (time) {
      const { hour, minute } = parseTime(time)
      onPick(toDateTimeValue(day, hour, minute))
    } else {
      onPick(toDateValue(day))
    }
    dismiss()
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        padding
        spacing={12}
        toolbar={{
          cancellationAction: <Button title="Cancel" action={dismiss} />,
          confirmationAction: <Button title="Set" action={confirm} />,
        }}
      >
        <DatePicker
          title={title}
          value={dayMs}
          onChanged={setDayMs}
          displayedComponents={["date"]}
          datePickerStyle="graphical"
        />
        <Toggle
          title="Time"
          value={time !== null}
          onChanged={(on: boolean) => setTime(on ? defaultTime : null)}
        />
        {time ? (
          <DatePicker
            title="At"
            value={timeToMs(time)}
            onChanged={(ms: number) => setTime(msToTime(ms))}
            displayedComponents={["hourAndMinute"]}
            datePickerStyle="wheel"
          />
        ) : null}
      </VStack>
    </NavigationStack>
  )
}

/** Quick task capture. Type a title and press return or the arrow.
 *  A date phrase in the text ("tom", "friday", "in 3 days", "15 oct", "at 5pm", or your own
 *  phrases from Settings) becomes the due date and is taken out of the title. Use Add details
 *  to continue in the full task form with the current values prefilled. */
export function QuickAdd({
  mapping,
  filters,
  people,
  defaultDue = null,
  prefill,
  autofocus = false,
  closing = false,
  onClose,
}: {
  mapping: DatabaseMapping
  filters: SavedFilterState
  people: WorkspaceUser[]
  /** Due date used when none is typed or picked, e.g. today on the Today tab. */
  defaultDue?: string | null
  /** Optional values from an "add new" deep link. */
  prefill?: NewTodoContext
  autofocus?: boolean
  /** Remove the focused input immediately while the card fades out. */
  closing?: boolean
  /** Called when Quick Add closes or opens the full form. */
  onClose?: () => void
}) {
  const s = useStore()
  const colorScheme = useColorScheme()
  const settings = s.settings.quickAdd
  const due = dueColumn(mapping)
  const [text, setText] = useState(prefill?.title ?? "")
  const [content, setContent] = useState(prefill?.content ?? "")
  const [dismissedPhrase, setDismissedPhrase] = useState<string | null>(null)
  /** undefined = follow the typed phrase; null = explicitly no date; string = picked in the menu. */
  const [manualDue, setManualDue] = useState<string | null | undefined>(() => {
    const value = due ? prefill?.columns?.[due.name] : undefined
    return typeof value === "string" ? value : undefined
  })
  const [statusOverride, setStatusOverride] = useState<string | undefined>(prefill?.status)
  const [overrides, setOverrides] = useState<Record<string, ColumnRawValue>>(() => {
    const initial = { ...(prefill?.columns ?? {}) }
    if (due) delete initial[due.name]
    return initial
  })

  const aliasKey = JSON.stringify(settings.aliases)
  const parsed = useMemo(
    () => (due && settings.dateRecognition ? parseDatePhrase(text, new Date(), settings.aliases) : null),
    [text, due?.name, settings.dateRecognition, aliasKey],
  )
  const auto = parsed && parsed.phrase !== dismissedPhrase && manualDue === undefined ? parsed : null

  const dueValue = manualDue !== undefined ? manualDue : (auto?.value ?? defaultDue)
  const status = statusOverride ?? defaultStatus(mapping, filters)
  const values = { ...filterColumnValues(filters, mapping), ...overrides }
  const title = (auto ? auto.title : text).trim()
  const ready = title.length > 0
  const chips = activeChips(mapping, settings.chips)

  function draft(): QuickAddDraft {
    return { title, content, status, due: dueValue, values }
  }

  function reset() {
    setText("")
    setContent("")
    setDismissedPhrase(null)
    setManualDue(undefined)
    setStatusOverride(undefined)
    setOverrides({})
  }

  function submit() {
    if (!ready) return
    addTodo(quickAddFields(draft(), mapping, people), content)
    reset()
  }

  function openForm() {
    const prefill = draftToPrefill(draft(), mapping)
    reset()
    onClose?.()
    // Let the sheet finish closing before the next modal is presented.
    setTimeout(() => void openTodoForm({ mapping, prefill }), 400)
  }

  function setValue(name: string, value: ColumnRawValue) {
    setOverrides((prev) => ({ ...prev, [name]: value }))
  }

  function openDatePicker(title: string, initial: string | null, onPick: (value: string) => void) {
    void Navigation.present({
      element: (
        <PickDate
          title={title}
          initial={initial}
          defaultTime={s.settings.notifications.defaultTime}
          onPick={onPick}
        />
      ),
    })
  }

  function removeDue() {
    if (auto) setDismissedPhrase(auto.phrase)
    setManualDue(null)
  }

  function dueChip() {
    if (!due) return null
    return (
      <Menu
        key="due"
        label={
          <Chip
            label={dueValue ? formatDueLabel(dueValue) : due.name}
            systemImage="calendar"
            color={dueValue ? DUE_COLORS[dueTone(dueValue)] : "secondaryLabel"}
          />
        }
      >
        {datePresets().map((preset) => (
          <Button
            key={preset.label}
            title={preset.label}
            systemImage={preset.systemImage}
            action={() => setManualDue(preset.value)}
          />
        ))}
        <Button
          title="Pick date…"
          systemImage="calendar.badge.plus"
          action={() => openDatePicker(due.name, dueValue, setManualDue)}
        />
        {dueValue ? (
          <Button title="Remove date" systemImage="xmark.circle" role="destructive" action={removeDue} />
        ) : null}
      </Menu>
    )
  }

  function statusChip() {
    return (
      <Menu
        key="status"
        label={
          <Chip
            label={status || "Status"}
            systemImage={statusIcon(mapping, status)}
            color={statusColor(mapping, status)}
          />
        }
      >
        {orderedStatusOptions(mapping).map((option) => (
          <Button
            key={option}
            title={option}
            systemImage={option === status ? "checkmark" : undefined}
            action={() => setStatusOverride(option)}
          />
        ))}
      </Menu>
    )
  }

  function columnChip(column: ColumnConfig) {
    const value = values[column.name]
    const optionColor = (option: string) => notionColor(column.optionColors?.[option])

    if (column.type === "checkbox") {
      const on = value === true
      return (
        <Button key={column.name} action={() => setValue(column.name, !on)} buttonStyle="plain">
          <Chip
            label={column.name}
            systemImage={on ? "checkmark.circle.fill" : "circle"}
            color={on ? "systemGreen" : "secondaryLabel"}
          />
        </Button>
      )
    }

    if (column.type === "select") {
      const current = typeof value === "string" ? value : ""
      return (
        <Menu
          key={column.name}
          label={
            <Chip
              label={current || column.name}
              systemImage={columnIcon(column)}
              color={current ? optionColor(current) : "secondaryLabel"}
            />
          }
        >
          {(column.options ?? []).map((option) => (
            <Button
              key={option}
              title={option}
              systemImage={option === current ? "checkmark" : undefined}
              action={() => setValue(column.name, option === current ? "" : option)}
            />
          ))}
        </Menu>
      )
    }

    // multi_select and people: toggle entries in a list of names
    const current = Array.isArray(value) ? value : []
    const options =
      column.type === "people"
        ? Array.from(new Set([...people.map((p) => p.name), ...current])).sort()
        : (column.options ?? [])
    return (
      <Menu
        key={column.name}
        label={
          <Chip
            label={current.length > 0 ? current.join(", ") : column.name}
            systemImage={columnIcon(column)}
            color={
              current.length === 1 && column.type === "multi_select"
                ? optionColor(current[0])
                : current.length > 0
                  ? "label"
                  : "secondaryLabel"
            }
          />
        }
      >
        {options.map((option) => (
          <Button
            key={option}
            title={option}
            systemImage={current.includes(option) ? "checkmark" : undefined}
            action={() =>
              setValue(
                column.name,
                current.includes(option) ? current.filter((o) => o !== option) : [...current, option],
              )
            }
          />
        ))}
      </Menu>
    )
  }

  function renderChip(chip: ChipDef) {
    if (chip.id === "due") return dueChip()
    if (chip.id === "status") return statusChip()
    return chip.column ? columnChip(chip.column) : null
  }

  // The hint row has a fixed height, so it never pushes the text field around.
  const hint = auto
    ? `“${auto.phrase}” → ${formatDueLabel(auto.value)}, left out of the title`
    : settings.dateRecognition && due
      ? "Dates in the text, like “tomorrow”, become the due date"
      : " "

  return (
    <VStack padding={{ horizontal: 8, vertical: 6 }}>
      <VStack
        alignment="leading"
        spacing={9}
        padding={14}
        background={{
          style: colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground",
          shape: { type: "rect", cornerRadius: 24 },
        }}
        shadow={{ color: "rgba(0,0,0,0.42)", radius: 26, y: 9 }}
      >
        <Text font="caption" foregroundStyle="secondaryLabel">New task</Text>
        <Text
          font="caption"
          lineLimit={1}
          frame={{ height: 16, alignment: "leading" }}
          foregroundStyle={auto ? "systemOrange" : "tertiaryLabel"}
        >
          {hint}
        </Text>
        {closing ? (
          <Text font="title3" foregroundStyle={text ? "label" : "tertiaryLabel"}>
            {text || "What needs doing?"}
          </Text>
        ) : (
          <TextField
            title=""
            prompt="What needs doing?"
            value={text}
            onChanged={setText}
            onSubmit={submit}
            submitLabel="done"
            autofocus={autofocus}
            font="title3"
          />
        )}
        <Button action={openForm} buttonStyle="plain">
          <HStack spacing={6}>
            <Image systemName="text.alignleft" font="caption" foregroundStyle={APP_ACCENT} />
            <Text font="subheadline" foregroundStyle={APP_ACCENT}>Add details</Text>
            <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
          </HStack>
        </Button>
        <HStack spacing={8}>
          <ScrollView
            axes="horizontal"
            scrollIndicator={{ visibility: "hidden", axes: "horizontal" }}
            mask={
              <Rectangle
                fill={gradient("linear", {
                  stops: [
                    { color: "clear", location: 0 },
                    { color: "white", location: 0.07 },
                    { color: "white", location: 0.93 },
                    { color: "clear", location: 1 },
                  ],
                  startPoint: "leading",
                  endPoint: "trailing",
                })}
              />
            }
          >
            <HStack spacing={8}>{chips.map(renderChip)}</HStack>
          </ScrollView>
          <Button action={submit}>
            <Image
              systemName="arrow.up.circle.fill"
              font={36}
              foregroundStyle={ready ? APP_ACCENT : "systemGray3"}
            />
          </Button>
        </HStack>
      </VStack>
    </VStack>
  )
}
