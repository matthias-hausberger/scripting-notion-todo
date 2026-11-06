import {
  Button,
  DatePicker,
  HStack,
  List,
  NavigationLink,
  Section,
  Spacer,
  Stepper,
  Text,
  TextField,
  Toggle,
  useState,
} from "scripting"
import { activeChips, availableChips } from "../lib/quickadd"
import { msToTime, timeToMs } from "../lib/settings"
import { updateSettings, useStore } from "../lib/store"
import { DateAlias } from "../lib/types"

function updateAlias(index: number, change: (alias: DateAlias) => DateAlias) {
  updateSettings((cur) => ({
    ...cur,
    quickAdd: {
      ...cur.quickAdd,
      aliases: cur.quickAdd.aliases.map((a, i) => (i === index ? change(a) : a)),
    },
  }))
}

function describe(alias: DateAlias): string {
  const day = alias.days === 0 ? "today" : alias.days === 1 ? "tomorrow" : `in ${alias.days} days`
  return alias.time ? `${day} at ${alias.time}` : day
}

/** What the capture card offers: which chips, whether dates are recognised in the title, and your own date phrases. */
export function QuickAddSettings() {
  const s = useStore()
  const [toastVisible, setToastVisible] = useState(false)
  const mapping = s.mapping
  const quickAdd = s.settings.quickAdd
  if (!mapping) return <List navigationTitle="Quick add" />

  const all = availableChips(mapping)
  const enabled = new Set(activeChips(mapping, quickAdd.chips).map((c) => c.id))

  function toggleChip(id: string, on: boolean) {
    const next = new Set(enabled)
    if (on) next.add(id)
    else next.delete(id)
    // Order always follows the default order.
    updateSettings((cur) => ({
      ...cur,
      quickAdd: { ...cur.quickAdd, chips: all.filter((c) => next.has(c.id)).map((c) => c.id) },
    }))
  }

  return (
    <List
      navigationTitle="Quick add"
      navigationBarTitleDisplayMode="inline"
      toast={{
        isPresented: toastVisible,
        onChanged: setToastVisible,
        message: "Quick Add chips restored to defaults",
        duration: 2.5,
        position: "bottom",
        shadowRadius: 12,
      }}
    >
      <Section
        header={<Text>Chips</Text>}
        footer={<Text>The buttons under the text field. By default: due date, status and your list columns.</Text>}
      >
        {all.map((chip) => (
          <Toggle
            key={chip.id}
            title={chip.label}
            value={enabled.has(chip.id)}
            onChanged={(on: boolean) => toggleChip(chip.id, on)}
          />
        ))}
        <Button
          title="Reset to Default"
          systemImage="arrow.counterclockwise"
          action={() => {
            HapticFeedback.lightImpact()
            updateSettings((cur) => ({ ...cur, quickAdd: { ...cur.quickAdd, chips: null } }))
            setToastVisible(true)
          }}
        />
      </Section>

      <Section
        header={<Text>Dates in the title</Text>}
        footer={
          <Text>
            Recognised: today, tom, tomorrow, weekdays, next week, in 3 days, 15 oct, 12.10., times like at 5pm or 17:30, also in German. A recognised phrase leaves the title and becomes the due date.
          </Text>
        }
      >
        <Toggle
          title="Recognise dates"
          value={quickAdd.dateRecognition}
          onChanged={(on: boolean) =>
            updateSettings((cur) => ({ ...cur, quickAdd: { ...cur.quickAdd, dateRecognition: on } }))
          }
        />
      </Section>

      <Section
        header={<Text>Your own phrases</Text>}
        footer={<Text>A word that means a date, for example eod = today at 17:00. Swipe to delete.</Text>}
      >
        {quickAdd.aliases.map((alias, index) => (
          <NavigationLink
            key={`${index}-${alias.phrase}`}
            destination={<AliasEditor index={index} />}
            trailingSwipeActions={{
              actions: [
                <Button
                  title="Delete"
                  systemImage="trash"
                  role="destructive"
                  action={() =>
                    updateSettings((cur) => ({
                      ...cur,
                      quickAdd: { ...cur.quickAdd, aliases: cur.quickAdd.aliases.filter((_, i) => i !== index) },
                    }))
                  }
                />,
              ],
            }}
          >
            <HStack>
              <Text>{alias.phrase || "(empty)"}</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{describe(alias)}</Text>
            </HStack>
          </NavigationLink>
        ))}
        <Button
          title="Add Phrase"
          systemImage="plus"
          action={() =>
            updateSettings((cur) => ({
              ...cur,
              quickAdd: { ...cur.quickAdd, aliases: [...cur.quickAdd.aliases, { phrase: "", days: 0 }] },
            }))
          }
        />
      </Section>
    </List>
  )
}

function AliasEditor({ index }: { index: number }) {
  const s = useStore()
  const alias = s.settings.quickAdd.aliases[index]
  if (!alias) return <List navigationTitle="Phrase" />

  return (
    <List navigationTitle={alias.phrase || "New phrase"} navigationBarTitleDisplayMode="inline">
      <Section footer={<Text>{`"${alias.phrase || "…"}" → ${describe(alias)}`}</Text>}>
        <TextField
          title="Phrase"
          prompt="e.g. eod"
          value={alias.phrase}
          onChanged={(phrase: string) => updateAlias(index, (a) => ({ ...a, phrase }))}
        />
        <Stepper
          title={`Days from today: ${alias.days}`}
          onIncrement={() => updateAlias(index, (a) => ({ ...a, days: Math.min(365, a.days + 1) }))}
          onDecrement={() => updateAlias(index, (a) => ({ ...a, days: Math.max(0, a.days - 1) }))}
        />
        <Toggle
          title="With a time"
          value={alias.time !== undefined}
          onChanged={(on: boolean) => updateAlias(index, (a) => ({ ...a, time: on ? "09:00" : undefined }))}
        />
        {alias.time ? (
          <DatePicker
            title="At"
            value={timeToMs(alias.time)}
            onChanged={(ms: number) => updateAlias(index, (a) => ({ ...a, time: msToTime(ms) }))}
            displayedComponents={["hourAndMinute"]}
          />
        ) : null}
      </Section>
    </List>
  )
}
