import {
  Button,
  ForEach,
  Group,
  HStack,
  Image,
  List,
  Menu,
  NavigationLink,
  Section,
  Spacer,
  Text,
  useObservable,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { toDateValue } from "../lib/dateparse"
import { resolveDoneStatus } from "../lib/due"
import { advancedFilterWarning } from "../lib/advanced-filter"
import { activeFilterLabels, buildSections, filterTodos, relativeTime } from "../lib/filters"
import {
  changeStatus,
  CACHE_WINDOW_LIMIT,
  deleteDraft,
  filterHasUnsavedChanges,
  removeTodo,
  restoreActiveFilter,
  saveActiveFilter,
  syncNow,
  useStore,
  visibleTodos,
} from "../lib/store"
import { DatabaseMapping, Draft, SavedFilterState, TabConfig, Todo } from "../lib/types"
import { confirmDelete, DetailScreen, formatTodoAsText } from "./DetailScreen"
import { openFailed } from "./FailedScreen"
import { openFilters } from "./FilterScreen"
import { openSettings } from "./SettingsScreen"
import { openTodoForm } from "./TodoForm"
import { APP_ACCENT, orderedStatusOptions, TodoRow } from "./theme"
import type { VirtualNode } from "scripting"

/** Bound native row creation even if a Scripting/iOS List eagerly evaluates ForEach. */
const INITIAL_ROW_LIMIT = 50
const ROWS_PER_PAGE = 50

/** Prefer observable-backed ForEach so Scripting can diff and materialize rows lazily. */
function TodoRows({
  items,
  renderRow,
}: {
  items: Todo[]
  renderRow: (todo: Todo) => VirtualNode
}) {
  const data = useObservable<Todo[]>(() => items)
  useEffect(() => {
    if (data.value !== items) data.setValue(items)
  }, [items])
  return <ForEach data={data} builder={(todo) => renderRow(todo)} />
}

function DraftRows({ drafts, mapping }: { drafts: Draft[]; mapping: DatabaseMapping }) {
  const data = useObservable<Draft[]>(() => drafts)
  useEffect(() => {
    if (data.value !== drafts) data.setValue(drafts)
  }, [drafts])
  return (
    <ForEach
      data={data}
      builder={(draft) => (
        <HStack
          key={draft.id}
          contentShape="rect"
          onTapGesture={() => openTodoForm({ mapping, draft })}
          trailingSwipeActions={{
            actions: [
              <Button
                title="Delete"
                systemImage="trash"
                role="destructive"
                action={() => deleteDraft(draft.id)}
              />,
            ],
          }}
        >
          <Image systemName="square.and.pencil" foregroundStyle="systemOrange" />
          <Text lineLimit={1}>{draft.title.trim() || "Untitled draft"}</Text>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">
            {relativeTime(draft.updatedAt)}
          </Text>
        </HStack>
      )}
    />
  )
}

/** The app-accent + button, bottom right. */
function Fab({ onPress }: { onPress: () => void }) {
  return (
    <Button action={onPress} padding={20}>
      <Image
        systemName="plus"
        font={26}
        foregroundStyle="white"
        frame={{ width: 60, height: 60 }}
        background={{ style: APP_ACCENT, shape: "circle" }}
        shadow={{ color: "rgba(0,0,0,0.3)", radius: 8, y: 3 }}
      />
    </Button>
  )
}

function FilterActionsBar({ onRestore, onSave }: { onRestore: () => void; onSave: () => void }) {
  return (
    <HStack spacing={8} padding={{ horizontal: 16, vertical: 8 }}>
      <Button title="Restore filter" systemImage="arrow.uturn.backward" action={onRestore} />
      <Spacer />
      <Button title="Save filter" systemImage="bookmark" action={onSave} />
    </HStack>
  )
}

/** One list for every tab. A configured tab shows its own filters and grouping;
 *  `tab = null` is Browse: the full list with live filters, drafts, views and Settings.
 *  Render it inside a NavigationStack. */
export function ListScreen({
  tab,
  onExit,
  quickAddVisible,
  onOpenQuickAdd,
}: {
  tab: TabConfig | null
  onExit?: () => void
  quickAddVisible: boolean
  onOpenQuickAdd: (filters: SavedFilterState, due: string | null) => void
}) {
  const s = useStore()
  const [search, setSearch] = useState("")
  const [, setTick] = useState(0)
  const [pageState, setPageState] = useState<{ key: string; limit: number }>({ key: "", limit: INITIAL_ROW_LIMIT })
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const mapping = s.mapping
  const isBrowse = tab === null
  const filterKey = isBrowse ? "browse" : tab.id
  const filters: SavedFilterState = isBrowse ? s.filters : s.tabFilters[tab.id] ?? tab.filter
  const groupBy = filters.groupBy
  const pageKey = JSON.stringify([filterKey, search, filters])
  const rowLimit = pageState.key === pageKey ? pageState.limit : INITIAL_ROW_LIMIT
  const hasUnsavedFilter = filterHasUnsavedChanges(filterKey)

  function showToast(message: string) {
    setToastMessage(message)
    setToastVisible(true)
  }

  // Keeps "synced 3m ago" current.
  useEffect(() => {
    let timer: number | undefined
    let cancelled = false
    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return
        setTick((n) => n + 1)
        schedule()
      }, 30_000) as unknown as number
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  const todos = visibleTodos()
  const filtered = useMemo(
    () => (mapping ? filterTodos(todos, filters, mapping, search) : []),
    [todos, filters, mapping, search],
  )
  const sections = useMemo(
    () => (mapping && groupBy && groupBy.kind !== "none" ? buildSections(filtered, groupBy, mapping) : null),
    [filtered, groupBy, mapping],
  )
  const pendingIds = useMemo(
    () =>
      new Set(
        s.outbox
          .filter((o) => o.state === "pending")
          .map((o) => (o.kind === "create" ? o.localId : o.todoId)),
      ),
    [s.outbox],
  )
  const waitingCount = s.outbox.filter((o) => o.state === "pending").length
  const failedCount = s.outbox.filter((o) => o.state === "failed").length

  if (!mapping) return <List navigationTitle={tab?.title ?? "Browse"} />
  // Keep a non-null alias for renderRow's nested callbacks.
  const taskMapping: DatabaseMapping = mapping

  const labels = activeFilterLabels(filters)
  const filterWarning = isBrowse ? advancedFilterWarning(filters.advancedFilter, mapping) : null
  const doneStatus = resolveDoneStatus(mapping, s.settings)
  const todayValue = toDateValue(new Date())
  /** Todos added in a tab that only shows today's items start with today's date. */
  const tabDue = filters.due === "today" || filters.due === "todayOrOverdue" ? todayValue : null

  let remainingRows = rowLimit
  const displayedSections = sections
    ? sections
        .map((section) => {
          const items = section.items.slice(0, remainingRows)
          remainingRows -= items.length
          return { section, items, totalCount: section.items.length }
        })
        .filter(({ section, items }) => items.length > 0 || section.items.length === 0)
        .map(({ section, items, totalCount }) => ({ ...section, items, totalCount }))
    : null
  const displayedTodos = sections ? null : filtered.slice(0, rowLimit)
  const shownRows = displayedSections
    ? displayedSections.flatMap((section) => section.items)
    : displayedTodos ?? []
  const lastRenderedTodoId = shownRows[shownRows.length - 1]?.id
  const hasMoreRows = filtered.length > rowLimit

  function loadMoreRows() {
    if (!hasMoreRows) return
    setPageState((current) => {
      const currentLimit = current.key === pageKey ? current.limit : INITIAL_ROW_LIMIT
      return {
        key: pageKey,
        limit: Math.min(currentLimit + ROWS_PER_PAGE, filtered.length),
      }
    })
  }

  function renderRow(todo: Todo) {
    return (
      <NavigationLink
        key={todo.id}
        onAppear={hasMoreRows && todo.id === lastRenderedTodoId ? loadMoreRows : undefined}
        destination={<DetailScreen todoId={todo.id} />}
        leadingSwipeActions={{
          actions:
            doneStatus && todo.status !== doneStatus
              ? [
                  <Button
                    title="Done"
                    systemImage="checkmark"
                    tint="systemGreen"
                    action={() => changeStatus(todo, doneStatus)}
                  />,
                ]
              : [],
        }}
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button
              title="Delete"
              systemImage="trash"
              role="destructive"
              action={async () => {
                if (await confirmDelete(todo)) removeTodo(todo)
              }}
            />,
            <Button
              title="Edit"
              systemImage="pencil"
              tint="systemOrange"
              action={() => openTodoForm({ mapping: taskMapping, todo })}
            />,
          ],
        }}
        contextMenu={{
          menuItems: (
            <Group>
              <Menu title="Status" systemImage="circle.dashed">
                {orderedStatusOptions(taskMapping).map((option) => (
                  <Button key={option} title={option} action={() => changeStatus(todo, option)} />
                ))}
              </Menu>
              <Button title="Edit" systemImage="pencil" action={() => openTodoForm({ mapping: taskMapping, todo })} />
              <Button
                title="Open in Notion"
                systemImage="arrow.up.right.square"
                action={() => todo.url && Safari.openURL(todo.url)}
              />
              <Button title="Copy Title" systemImage="doc.on.doc" action={() => Pasteboard.setString(todo.title)} />
              <Button
                title="Copy Todo"
                systemImage="doc.on.doc.fill"
                action={() => Pasteboard.setString(formatTodoAsText(todo, taskMapping))}
              />
            </Group>
          ),
        }}
      >
        <TodoRow todo={todo} mapping={taskMapping} hasPendingChange={pendingIds.has(todo.id)} />
      </NavigationLink>
    )
  }

  const offline = s.error?.startsWith("Offline")
  const syncLabel = s.syncing
    ? "Syncing…"
    : `${offline ? "Offline · last sync" : "Last sync"} ${relativeTime(s.lastFetched)}${s.serverTodos.length >= CACHE_WINDOW_LIMIT ? " · latest 10,000" : ""}${waitingCount > 0 ? ` · ${waitingCount} waiting` : ""}`
  const emptyText = isBrowse
    ? labels.length > 0 || search
      ? "No todos match. Adjust the filters or search."
      : "No todos yet. Tap + to add one."
    : search
      ? "Nothing matches your search."
      : `Nothing in ${tab.title}.`

  return (
    <ZStack
      toast={{
        isPresented: toastVisible,
        onChanged: setToastVisible,
        message: toastMessage,
        duration: 2.5,
        position: "bottom",
        shadowRadius: 12,
      }}
      safeAreaInset={
        hasUnsavedFilter
          ? {
              top: {
                spacing: 0,
                content: (
                  <FilterActionsBar
                    onRestore={() => {
                      HapticFeedback.lightImpact()
                      restoreActiveFilter(filterKey)
                      showToast("Restored the last saved filter")
                    }}
                    onSave={() => {
                      HapticFeedback.lightImpact()
                      saveActiveFilter(filterKey)
                      showToast("Saved as this tab’s filter")
                    }}
                  />
                ),
              },
            }
          : undefined
      }
    >
      <List
        navigationTitle={tab?.title ?? "Browse"}
        navigationSubtitle={syncLabel}
        navigationBarTitleDisplayMode="large"
        refreshable={() => syncNow(true)}
        searchable={{
          value: search,
          onChanged: setSearch,
          placement: "navigationBarDrawer",
          prompt: "Search todos",
        }}
        overlay={
          quickAddVisible
            ? undefined
            : {
                alignment: "bottomTrailing",
                content: <Fab onPress={() => onOpenQuickAdd(filters, tabDue)} />,
              }
        }
        toolbar={{
          topBarLeading: (
            <Button action={() => void syncNow(true)}>
              <Image systemName="arrow.clockwise" />
            </Button>
          ),
          topBarTrailing: [
            <Button
              title="Filters"
              systemImage={
                labels.length > 0
                  ? "line.3.horizontal.decrease.circle.fill"
                  : "line.3.horizontal.decrease.circle"
              }
              action={() => openFilters(filterKey)}
            />,
            ...(isBrowse
              ? [
                  <Button action={openSettings}>
                    <Image systemName="gearshape" />
                  </Button>,
                  ...(onExit ? [<Button title="Exit" systemImage="xmark.circle" action={onExit} />] : []),
                ]
              : []),
          ],
        }}
      >
      {failedCount > 0 ? (
        <Section>
          <HStack contentShape="rect" onTapGesture={openFailed}>
            <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemRed" />
            <Text foregroundStyle="systemRed">
              {failedCount} failed action{failedCount > 1 ? "s" : ""}
            </Text>
            <Spacer />
            <Image systemName="chevron.right" foregroundStyle="secondaryLabel" />
          </HStack>
        </Section>
      ) : null}

      {filterWarning ? (
        <Section>
          <Text foregroundStyle="systemOrange">{filterWarning}</Text>
        </Section>
      ) : null}

      {isBrowse && s.drafts.length > 0 ? (
        <Section header={<Text>Drafts</Text>}>
          <DraftRows drafts={s.drafts} mapping={mapping} />
        </Section>
      ) : null}

      {displayedSections ? (
        displayedSections.map((section) => (
          <Section
            key={section.key}
            header={
              <HStack>
                <Text>{`${section.title} (${section.totalCount})`}</Text>
                <Spacer />
                {section.dateValue ? (
                  <Button action={() => onOpenQuickAdd(filters, section.dateValue as string)}>
                    <Image systemName="plus" />
                  </Button>
                ) : null}
              </HStack>
            }
          >
            <TodoRows items={section.items} renderRow={renderRow} />
          </Section>
        ))
      ) : (
        <Section>
          <TodoRows items={displayedTodos ?? []} renderRow={renderRow} />
        </Section>
      )}

      {filtered.length === 0 && !s.syncing ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">{emptyText}</Text>
        </Section>
      ) : null}
      </List>
    </ZStack>
  )
}
