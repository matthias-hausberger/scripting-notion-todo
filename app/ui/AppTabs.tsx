import {
  Button,
  Label,
  List,
  Navigation,
  NavigationStack,
  Rectangle,
  Section,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import { toDateValue } from "../lib/dateparse"
import { filterTodos } from "../lib/filters"
import { clearIntent, useStore, visibleTodos } from "../lib/store"
import type { NewTodoContext, SavedFilterState } from "../lib/types"
import { ListScreen } from "./ListScreen"
import { QuickAdd } from "./QuickAdd"
import { openSettings } from "./SettingsScreen"
import { openTabsEditor } from "./TabsEditor"
import { APP_ACCENT } from "./theme"

type QuickAddLaunch = {
  id: number
  filters: SavedFilterState
  due: string | null
  prefill?: NewTodoContext
  closing: boolean
}

const QUICK_ADD_OPEN = Animation.easeOut(0.24)
const QUICK_ADD_CLOSE = Animation.easeOut(0.16)
const QUICK_ADD_TRANSITION = Transition.asymmetric(
  Transition.move("bottom").combined(Transition.opacity()),
  Transition.identity(),
).animation(QUICK_ADD_OPEN)

/** The app: your tabs, then Browse, in a bottom tab bar (a floating bar on iOS 26). */
export function AppTabs() {
  const s = useStore()
  const [quickAdd, setQuickAdd] = useState<QuickAddLaunch | null>(null)
  const closeSequence = useRef(0)

  function openQuickAdd(
    filters: SavedFilterState,
    due: string | null,
    prefill?: NewTodoContext,
    giveHaptic = true,
  ) {
    const id = ++closeSequence.current
    if (giveHaptic) HapticFeedback.lightImpact()
    void withAnimation(QUICK_ADD_OPEN, () => setQuickAdd({ id, filters, due, prefill, closing: false }))
  }

  function closeQuickAdd() {
    if (!quickAdd || quickAdd.closing) return
    const sequence = ++closeSequence.current
    // Use Scripting's keyboard API to dismiss immediately, then fade the capture UI out.
    Keyboard.hide()
    setQuickAdd({ ...quickAdd, closing: true })
    setTimeout(() => {
      if (closeSequence.current === sequence) setQuickAdd(null)
    }, 210)
  }
  /** Dismissing the root ends the script (see index.tsx). */
  const exitApp = Navigation.useDismiss()
  const tabs = s.settings.tabs
  const browseIndex = tabs.length
  const [tab, setTab] = useState(() => Math.min(Math.max(tabs.findIndex((t) => t.id === "today"), 0), tabs.length))
  const mapping = s.mapping

  // Deep links arrive as an intent: `action=new` opens Quick Add, a view or filter shows Browse.
  useEffect(() => {
    if (!s.intent || !mapping) return
    const intent = s.intent
    clearIntent()
    if (intent.kind === "new") openQuickAdd({}, null, intent.prefill, false)
    else setTab(browseIndex)
  }, [s.intent, mapping])

  // Stay on a valid tab when tabs are removed.
  useEffect(() => {
    if (tab > browseIndex) setTab(browseIndex)
  }, [browseIndex])

  const todos = visibleTodos()
  /** A count badge for tabs that list what is due today. */
  const badges = useMemo(() => {
    if (!mapping) return []
    return tabs.map((t) => {
      const filter = s.tabFilters[t.id] ?? t.filter
      return filter.due === "todayOrOverdue" || filter.due === "overdue" || filter.due === "today"
        ? filterTodos(todos, filter, mapping, "").length
        : 0
    })
  }, [todos, tabs, s.tabFilters, mapping, toDateValue(new Date())])

  if (!s.hasToken || !mapping) {
    return (
      <NavigationStack>
        <List
          navigationTitle="Notion Todo"
          toolbar={{
            topBarLeading: <Button title="Exit" systemImage="xmark.circle" action={exitApp} />,
          }}
        >
          <Section footer={<Text>Add your Notion token and pick the database that holds your todos.</Text>}>
            <Button
              title="Configure Notion"
              systemImage="externaldrive.connected.to.line.below"
              action={openSettings}
            />
          </Section>
        </List>
      </NavigationStack>
    )
  }

  const attention = s.drafts.length + s.outbox.filter((o) => o.state === "failed").length

  // Long-pressing any custom tab opens the tab editor directly.
  const openEditorOnLongPress = () => void openTabsEditor()

  return (
    <ZStack
      tint={APP_ACCENT}
      safeAreaInset={
        quickAdd && mapping
          ? {
              bottom: {
                spacing: 0,
                content: (
                  <VStack
                    frame={{ maxWidth: "infinity" }}
                    opacity={quickAdd.closing ? 0 : 1}
                    animation={{ animation: QUICK_ADD_CLOSE, value: quickAdd.closing }}
                    transition={QUICK_ADD_TRANSITION}
                  >
                    <QuickAdd
                      key={quickAdd.id}
                      mapping={mapping}
                      filters={quickAdd.filters}
                      people={s.people}
                      defaultDue={quickAdd.due}
                      prefill={quickAdd.prefill}
                      closing={quickAdd.closing}
                      autofocus
                      onClose={closeQuickAdd}
                    />
                  </VStack>
                ),
              },
            }
          : undefined
      }
    >
      <TabView tabIndex={tab} onTabIndexChanged={setTab}>
        {tabs.map((t, index) => (
          <NavigationStack
            key={t.id}
            tag={index}
            tabItem={
              <Label
                title={t.title || "Untitled"}
                systemImage={t.icon}
                onLongPressGesture={openEditorOnLongPress}
              />
            }
            badge={badges[index] > 0 ? badges[index] : undefined}
          >
            <ListScreen
              tab={t}
              quickAddVisible={quickAdd !== null}
              onOpenQuickAdd={openQuickAdd}
            />
          </NavigationStack>
        ))}
        <NavigationStack
          key="browse"
          tag={browseIndex}
          tabItem={
            <Label
              title="Browse"
              systemImage="square.grid.2x2"
              onLongPressGesture={openEditorOnLongPress}
            />
          }
          badge={attention > 0 ? attention : undefined}
        >
          <ListScreen
            tab={null}
            onExit={exitApp}
            quickAddVisible={quickAdd !== null}
            onOpenQuickAdd={openQuickAdd}
          />
        </NavigationStack>
      </TabView>
      {quickAdd ? (
        <Rectangle
          fill="clear"
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          ignoresSafeArea
          contentShape="rect"
          onTapGesture={closeQuickAdd}
        />
      ) : null}
    </ZStack>
  )
}
