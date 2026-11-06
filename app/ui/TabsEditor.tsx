import {
  Button,
  EditButton,
  ForEach,
  HStack,
  Image,
  Label,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  useState,
} from "scripting"
import { DEFAULT_TABS, MAX_TABS, newId } from "../lib/settings"
import { updateSettings, useStore } from "../lib/store"
import { TabConfig } from "../lib/types"
import { APP_ACCENT } from "./theme"

const ICONS = [
  "tray", "calendar", "calendar.badge.clock", "sun.max", "moon", "star", "flag", "bolt",
  "flame", "heart", "bookmark", "tag", "folder", "house", "briefcase", "cart",
  "person", "bell", "clock", "checkmark.circle", "list.bullet", "square.grid.2x2",
  "leaf", "gift", "paperplane", "book", "lightbulb", "hammer", "target", "airplane",
]

/** The editor as its own modal, opened by a long press on the tab bar. */
export function openTabsEditor(): Promise<void> {
  return Navigation.present({
    element: (
      <NavigationStack>
        <TabsEditor modalRoot />
      </NavigationStack>
    ),
    modalPresentationStyle: "pageSheet",
  })
}

function setTabs(tabs: TabConfig[]) {
  updateSettings((cur) => ({ ...cur, tabs }))
}

function updateTab(id: string, change: (tab: TabConfig) => TabConfig) {
  updateSettings((cur) => ({
    ...cur,
    tabs: cur.tabs.map((t) => (t.id === id ? change(t) : t)),
  }))
}

/** Add, remove, reorder and edit the tabs. Browse always stays last and cannot be removed.
 *  Shown inside a NavigationStack (modal or pushed from Settings). */
export function TabsEditor({ modalRoot = false }: { modalRoot?: boolean } = {}) {
  const s = useStore()
  const tabs = s.settings.tabs
  const dismiss = Navigation.useDismiss()
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const atLimit = tabs.length + 1 >= MAX_TABS

  function showToast(message: string) {
    setToastMessage(message)
    setToastVisible(true)
  }

  function onDelete(indices: number[]) {
    setTabs(tabs.filter((_, index) => !indices.includes(index)))
  }

  function onMove(indices: number[], newOffset: number) {
    const moving = indices.map((index) => tabs[index])
    const rest = tabs.filter((_, index) => !indices.includes(index))
    rest.splice(newOffset, 0, ...moving)
    setTabs(rest)
  }

  function addTab() {
    setTabs([
      ...tabs,
      { id: newId("tab-"), title: "New tab", icon: "star", filter: { hideCompleted: "always" } },
    ])
  }

  return (
    <List
      navigationTitle="Tab bar"
      navigationBarTitleDisplayMode="inline"
      toast={{
        isPresented: toastVisible,
        onChanged: setToastVisible,
        message: toastMessage,
        duration: 3,
        position: "bottom",
        shadowRadius: 12,
      }}
      toolbar={modalRoot
        ? {
            topBarLeading: <Button title="Close" systemImage="xmark" action={dismiss} />,
            topBarTrailing: <EditButton />,
          }
        : { topBarTrailing: <EditButton /> }}
    >
      <Section
        header={<Text>Tabs</Text>}
        footer={
          <Text>
            {`The tab bar holds ${MAX_TABS}, Browse included. Tap a tab to set its name and icon. Use the filter button on any tab to edit and save its filter. Use Edit to rearrange or remove tabs. Browse is always last.`}
          </Text>
        }
      >
        <ForEach
          count={tabs.length}
          itemBuilder={(index) => {
            const tab = tabs[index]
            return (
              <NavigationLink key={tab.id} destination={<TabEditScreen tabId={tab.id} />}>
                <Label title={tab.title} systemImage={tab.icon} />
              </NavigationLink>
            )
          }}
          onDelete={onDelete}
          onMove={onMove}
        />
        <HStack>
          <Label title="Browse" systemImage="square.grid.2x2" />
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">
            fixed
          </Text>
        </HStack>
      </Section>

      <Section>
        <Button
          title={atLimit ? `Tab bar is full (${MAX_TABS})` : "Add Tab"}
          systemImage="plus"
          action={atLimit ? () => undefined : () => { HapticFeedback.lightImpact(); addTab(); showToast("Tab added") }}
        />
        <Button
          title="Reset to Unscheduled, Today, Later"
          systemImage="arrow.counterclockwise"
          role="destructive"
          action={async () => {
            HapticFeedback.lightImpact()
            const ok = await Dialog.confirm({
              message: "Replace your tabs with the defaults?",
              confirmLabel: "Reset",
            })
            if (ok) {
              setTabs(DEFAULT_TABS.map((t) => ({ ...t, filter: { ...t.filter } })))
              HapticFeedback.lightImpact()
              showToast("Tabs reset to Unscheduled, Today, and Later")
            }
          }}
        />
      </Section>
    </List>
  )
}

function TabEditScreen({ tabId }: { tabId: string }) {
  const s = useStore()
  const savedTab = s.settings.tabs.find((t) => t.id === tabId)
  const dismiss = Navigation.useDismiss()
  const [draft, setDraft] = useState<TabConfig>(() =>
    JSON.parse(JSON.stringify(savedTab ?? { id: tabId, title: "", icon: "star", filter: {} })),
  )
  const mapping = s.mapping
  if (!savedTab || !mapping) return <List navigationTitle="Tab" />

  function save() {
    updateTab(tabId, () => draft)
    dismiss()
  }

  return (
    <List
      navigationTitle={draft.title || "Tab"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{ confirmationAction: <Button title="Save" action={save} /> }}
    >
      <Section
        header={<Text>Tab</Text>}
        footer={<Text>Change this tab's name and icon here. Its filter is managed with the filter button on the tab.</Text>}
      >
        <TextField
          title="Name"
          prompt="Tab name"
          value={draft.title}
          onChanged={(title: string) => setDraft((t) => ({ ...t, title }))}
        />
        <NavigationLink
          destination={
            <IconPicker
              selected={draft.icon}
              onPick={(icon) => setDraft((t) => ({ ...t, icon }))}
            />
          }
        >
          <HStack>
            <Text>Icon</Text>
            <Spacer />
            <Image systemName={draft.icon} foregroundStyle={APP_ACCENT} />
          </HStack>
        </NavigationLink>
      </Section>

    </List>
  )
}

function IconPicker({ selected, onPick }: { selected: string; onPick: (icon: string) => void }) {
  const dismiss = Navigation.useDismiss()
  return (
    <List navigationTitle="Icon" navigationBarTitleDisplayMode="inline">
      <Section>
        {ICONS.map((name) => (
          <HStack key={name} contentShape="rect" onTapGesture={() => { onPick(name); dismiss() }}>
            <Label title={name} systemImage={name} />
            <Spacer />
            {name === selected ? <Image systemName="checkmark" foregroundStyle={APP_ACCENT} /> : null}
          </HStack>
        ))}
      </Section>
    </List>
  )
}
