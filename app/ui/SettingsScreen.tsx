import {
  Button,
  DatePicker,
  EditButton,
  ForEach,
  Group,
  HStack,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  SecureField,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { dueColumn, resolveDoneStatus } from "../lib/due"
import {
  SUPPORTED_COLUMN_TYPES,
  clearToken,
  errorMessage,
  getDatabaseSchema,
  searchDatabases,
  setToken,
} from "../lib/notion"
import { msToTime, timeToMs } from "../lib/settings"
import {
  clearCache,
  refreshTokenState,
  switchDatabase,
  updateSettings,
  useStore,
} from "../lib/store"
import {
  ColumnConfig,
  ColumnType,
  DatabaseMapping,
  NotionDatabaseSchema,
  NotionDatabaseSummary,
} from "../lib/types"
import { QuickAddSettings } from "./QuickAddSettings"
import { TabsEditor } from "./TabsEditor"
import { orderedStatusOptions } from "./theme"

export function openSettings(): Promise<void> {
  return Navigation.present({ element: <SettingsScreen />, modalPresentationStyle: "pageSheet" })
}

/** Fold legacy Form visibility into Detail, then discard the old third-view field. */
function normalizeColumnViews(column: ColumnConfig): ColumnConfig {
  const legacy = column as ColumnConfig & { showInForm?: boolean }
  const { showInForm, ...current } = legacy
  return { ...current, showInDetail: current.showInDetail || showInForm === true }
}

/** Settings home: each topic gets a small page, so dependent controls stay together. */
export function SettingsScreen() {
  const s = useStore()
  const dismiss = Navigation.useDismiss()
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const settings = s.settings

  function showToast(message: string) {
    setToastMessage(message)
    setToastVisible(true)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Settings"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <Button title="Close" systemImage="xmark" action={dismiss} /> }}
        toast={{
          isPresented: toastVisible,
          onChanged: setToastVisible,
          message: toastMessage,
          duration: 3,
          position: "bottom",
          shadowRadius: 12,
        }}
      >
        <Section header={<Text>Preferences</Text>}>
          <NavigationLink destination={<GeneralSettingsScreen />}>
            <HStack><Text>General</Text><Spacer /><Text foregroundStyle="secondaryLabel">Full screen</Text></HStack>
          </NavigationLink>
          <NavigationLink destination={<TabsEditor />}>
            <HStack><Text>Tab bar</Text><Spacer /><Text foregroundStyle="secondaryLabel">{`${settings.tabs.length + 1} tabs`}</Text></HStack>
          </NavigationLink>
          <NavigationLink destination={<TaskSettingsScreen />}>
            <HStack><Text>Task behavior</Text><Spacer /><Text foregroundStyle="secondaryLabel">Swipe right</Text></HStack>
          </NavigationLink>
        </Section>

        <Section header={<Text>Connections</Text>}>
          <NavigationLink destination={<NotionSettingsScreen />}>
            <HStack><Text>Notion</Text><Spacer /><Text foregroundStyle="secondaryLabel">{s.hasToken ? (s.mapping?.databaseTitle ?? "Choose database") : "Add token"}</Text></HStack>
          </NavigationLink>
        </Section>

        <Section header={<Text>Automation</Text>}>
          <NavigationLink destination={<NotificationSettingsScreen />}>
            <HStack><Text>Notifications</Text><Spacer /><Text foregroundStyle="secondaryLabel">{settings.notifications.enabled ? "On" : "Off"}</Text></HStack>
          </NavigationLink>
          {s.mapping ? (
            <NavigationLink destination={<QuickAddSettings />}>
              <HStack><Text>Quick add</Text><Spacer /><Text foregroundStyle="secondaryLabel">Chips and date phrases</Text></HStack>
            </NavigationLink>
          ) : null}
        </Section>

        <Section
          header={<Text>Data</Text>}
          footer={<Text>Clearing the cache downloads a fresh copy from Notion. Pending offline changes are kept.</Text>}
        >
          <Button
            title="Clear Cache & Reload"
            systemImage="arrow.clockwise"
            action={async () => {
              HapticFeedback.lightImpact()
              if (await Dialog.confirm({
                title: "Clear local cache?",
                message: "Delete the local copy and fetch everything again? Pending offline changes are kept.",
                confirmLabel: "Clear Cache",
              })) {
                clearCache()
                HapticFeedback.lightImpact()
                showToast("Cache cleared · reloading from Notion")
              }
            }}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

function GeneralSettingsScreen() {
  const settings = useStore().settings.general
  return (
    <List navigationTitle="General" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>Launch</Text>}
        footer={<Text>Full screen applies the next time the script starts. In full screen, leave with Exit in the Browse tab.</Text>}
      >
        <Toggle
          title="Open full screen"
          value={settings.fullScreen}
          onChanged={(on: boolean) => updateSettings((cur) => ({ ...cur, general: { ...cur.general, fullScreen: on } }))}
        />
      </Section>
    </List>
  )
}

function NotionSettingsScreen() {
  const s = useStore()
  const [token, setTokenText] = useState("")

  function save() {
    if (!token.trim()) return
    setToken(token.trim())
    setTokenText("")
    refreshTokenState()
  }

  return (
    <List navigationTitle="Notion" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>API token</Text>}
        footer={<Text>An integration secret from notion.so/my-integrations (share each database with it) or a personal access token. It is stored in the iOS Keychain, only for this script.</Text>}
      >
        <Text foregroundStyle="secondaryLabel">{s.hasToken ? "A token is saved." : "No token yet."}</Text>
        <SecureField title="Token" prompt={s.hasToken ? "Paste a new token to replace it" : "secret_… or ntn_…"} value={token} onChanged={setTokenText} />
        <Button title="Save Token" systemImage="key" action={save} />
        {s.hasToken ? (
          <Button title="Remove Token" role="destructive" systemImage="trash" action={() => { clearToken(); refreshTokenState() }} />
        ) : null}
      </Section>

      <Section header={<Text>Task database</Text>}>
        {s.hasToken ? (
          <NavigationLink destination={<DatabaseSettingsScreen />}>
            <HStack>
              <Text>{s.mapping?.databaseTitle ?? "Choose database"}</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{s.mapping ? "Change or configure" : "Choose"}</Text>
            </HStack>
          </NavigationLink>
        ) : (
          <Text foregroundStyle="secondaryLabel">Save a token before choosing a database.</Text>
        )}
      </Section>
    </List>
  )
}

function DatabaseSettingsScreen() {
  const s = useStore()
  const mapping = s.mapping
  return (
    <List navigationTitle="Task database" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>Selected database</Text>}
        footer={<Text>Changing databases clears saved filters and views that use this database, along with the local task cache and pending offline changes.</Text>}
      >
        <Text>{mapping?.databaseTitle ?? "No database selected"}</Text>
        <Button
          title={mapping ? "Choose another database" : "Choose database"}
          systemImage="arrow.triangle.2.circlepath"
          action={() => { void openDatabasePicker() }}
        />
        <Button
          title="Edit columns"
          systemImage="slider.horizontal.3"
          action={() => {
            if (mapping) {
              void Navigation.present({
                element: <NavigationStack><MapColumnsScreen database={{ databaseId: mapping.databaseId, dataSourceId: mapping.dataSourceId ?? "", title: mapping.databaseTitle }} existing={mapping} /></NavigationStack>,
                modalPresentationStyle: "pageSheet",
              })
            }
          }}
          disabled={!mapping}
        />
      </Section>
    </List>
  )
}

function openDatabasePicker(): Promise<void> {
  return Navigation.present({
    element: <NavigationStack><DatabasePickerScreen /></NavigationStack>,
    modalPresentationStyle: "pageSheet",
  })
}

function DatabasePickerScreen() {
  const s = useStore()
  const dismiss = Navigation.useDismiss()
  const [databases, setDatabases] = useState<NotionDatabaseSummary[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedDatabase, setSelectedDatabase] = useState<NotionDatabaseSummary | null>(null)

  async function load() {
    setLoading(true)
    setError("")
    try {
      setDatabases(await searchDatabases())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  const filtered = databases.filter((db) => db.title.toLowerCase().includes(query.trim().toLowerCase()))

  if (selectedDatabase) {
    return (
      <MapColumnsScreen
        database={selectedDatabase}
        existing={
          s.mapping?.databaseId === selectedDatabase.databaseId &&
          s.mapping?.dataSourceId === selectedDatabase.dataSourceId
            ? s.mapping
            : undefined
        }
        onBack={() => setSelectedDatabase(null)}
      />
    )
  }

  return (
    <List
      navigationTitle="Choose database"
      navigationBarTitleDisplayMode="inline"
      searchable={{ value: query, onChanged: setQuery, prompt: "Search databases" }}
      toolbar={{
        topBarLeading: <Button title="Close" systemImage="xmark" action={dismiss} />,
        topBarTrailing: <Button title="Refresh" systemImage="arrow.clockwise" action={load} />,
      }}
    >
      {error ? <Section><Text foregroundStyle="systemRed">{error}</Text><Button title="Try again" systemImage="arrow.clockwise" action={load} /></Section> : null}
      {loading ? <Section><Text foregroundStyle="secondaryLabel">Loading databases…</Text></Section> : null}
      {!loading && !error && databases.length === 0 ? (
        <Section><Text foregroundStyle="secondaryLabel">No databases found. In Notion open the database, tap ••• → Connections and add your integration.</Text></Section>
      ) : null}
      {!loading && !error && databases.length > 0 && filtered.length === 0 ? (
        <Section><Text foregroundStyle="secondaryLabel">No database names match “{query}”.</Text></Section>
      ) : null}
      {filtered.length > 0 ? (
        <Section header={<Text>{`${filtered.length} data source${filtered.length === 1 ? "" : "s"}`}</Text>}>
          {filtered.map((db) => (
            <Button key={`${db.databaseId}:${db.dataSourceId}`} action={async () => {
              const switching = !!s.mapping && (
                s.mapping.databaseId !== db.databaseId ||
                s.mapping.dataSourceId !== db.dataSourceId
              )
              if (switching) {
                const confirmed = await Dialog.confirm({
                  title: "Change task database?",
                  message: "Saved filters for Browse and every tab, plus saved views, may use columns from the current database, so they will be cleared. The local task cache and pending offline changes will also be cleared when you save the new database.",
                  cancelLabel: "Keep current database",
                  confirmLabel: "Continue",
                })
                if (!confirmed) return
              }
              setSelectedDatabase(db)
            }}>
              <HStack>
                <Text>{db.title}</Text>
                <Spacer />
                {s.mapping?.databaseId === db.databaseId && s.mapping?.dataSourceId === db.dataSourceId ? <Text foregroundStyle="secondaryLabel">Selected</Text> : null}
              </HStack>
            </Button>
          ))}
        </Section>
      ) : null}
    </List>
  )
}

function TaskSettingsScreen() {
  const s = useStore()
  const mapping = s.mapping
  if (!mapping) return <List navigationTitle="Task behavior" />
  return (
    <List navigationTitle="Task behavior" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>Swipe right</Text>}
        footer={<Text>Swiping a task to the right sets it to this status. Notion databases can have several statuses in the Complete group, so choose the exact one.</Text>}
      >
        <Picker
          title="Set status to"
          pickerStyle="menu"
          value={resolveDoneStatus(mapping, s.settings) ?? ""}
          onChanged={(v: string) => updateSettings((cur) => ({ ...cur, database: { ...cur.database, doneStatus: v || undefined } }))}
        >
          {orderedStatusOptions(mapping).map((option) => <Text key={option} tag={option}>{option}</Text>)}
        </Picker>
      </Section>
    </List>
  )
}

function NotificationSettingsScreen() {
  const s = useStore()
  const mapping = s.mapping
  const settings = s.settings.notifications
  const dateColumns = mapping?.columns.filter((c) => c.type === "date") ?? []
  const notifyColumn = settings.column ?? (mapping ? dueColumn(mapping)?.name : undefined)
  return (
    <List navigationTitle="Notifications" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>Due dates</Text>}
        footer={<Text>Local notifications are scheduled at each sync. A date with a time notifies then; a date without a time uses the default time below. Changes made in Notion arrive at the next sync.</Text>}
      >
        <Toggle
          title="Notify for due dates"
          value={settings.enabled}
          onChanged={(on: boolean) => updateSettings((cur) => ({ ...cur, notifications: { ...cur.notifications, enabled: on } }))}
        />
        {settings.enabled ? (
          mapping && dateColumns.length > 0 ? (
            <Group>
              <Picker title="Date column" pickerStyle="menu" value={notifyColumn ?? dateColumns[0].name} onChanged={(v: string) => updateSettings((cur) => ({ ...cur, notifications: { ...cur.notifications, column: v } }))}>
                {dateColumns.map((c) => <Text key={c.name} tag={c.name}>{c.name}</Text>)}
              </Picker>
              <DatePicker
                title="Time if no time is set"
                value={timeToMs(settings.defaultTime)}
                onChanged={(ms: number) => updateSettings((cur) => ({ ...cur, notifications: { ...cur.notifications, defaultTime: msToTime(ms) } }))}
                displayedComponents={["hourAndMinute"]}
              />
            </Group>
          ) : <Text foregroundStyle="secondaryLabel">Choose a date column under Notion → Task database → Edit columns first.</Text>
        ) : null}
      </Section>
    </List>
  )
}

// ---------------------------------------------------------------- column mapping

function guess(schema: NotionDatabaseSchema, type: string, hint: string): string {
  return (
    schema.properties.find((p) => p.type === type && p.name.toLowerCase().includes(hint))?.name ??
    schema.properties.find((p) => p.type === type)?.name ??
    ""
  )
}

function MapColumnsScreen({
  database,
  existing,
  onBack,
}: {
  database: { databaseId: string; dataSourceId: string; title: string }
  existing?: DatabaseMapping
  onBack?: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const leadingAction = (
    <Button
      title={onBack ? "Databases" : "Close"}
      systemImage={onBack ? "chevron.left" : "xmark"}
      action={onBack ?? dismiss}
    />
  )
  const [schema, setSchema] = useState<NotionDatabaseSchema | null>(null)
  const [error, setError] = useState("")
  const [titleProp, setTitleProp] = useState(existing?.titleProp ?? "")
  const [statusProp, setStatusProp] = useState(existing?.statusProp ?? "")
  const [dueProp, setDueProp] = useState(existing?.dueProp ?? "")
  const [columnConfigs, setColumnConfigs] = useState<DatabaseMapping["columns"]>(
    existing?.columns ?? [],
  )

  useEffect(() => {
    getDatabaseSchema(database.databaseId, database.dataSourceId || undefined)
      .then((result) => {
        setSchema(result)
        const resolvedTitle = existing?.titleProp ?? result.properties.find((p) => p.type === "title")?.name ?? ""
        const resolvedStatus = existing?.statusProp ?? (guess(result, "status", "status") || guess(result, "select", "status"))
        const resolvedDue = existing?.dueProp ?? guess(result, "date", "due")
        setTitleProp(resolvedTitle)
        setStatusProp(resolvedStatus)
        setDueProp(resolvedDue)
        const oldColumns = new Map((existing?.columns ?? []).map((column) => [column.name, column]))
        setColumnConfigs(
          result.properties
            .filter((p) => SUPPORTED_COLUMN_TYPES.includes(p.type as ColumnType) && p.name !== resolvedTitle && p.name !== resolvedStatus)
            .map((p) => {
              const old = oldColumns.get(p.name)
              if (old) return normalizeColumnViews(old)
              const showByDefault = !existing && (
                p.name === resolvedDue ||
                (p.type === "multi_select" && p.name.toLowerCase().includes("tag")) ||
                (p.type === "people" && p.name.toLowerCase().includes("assign"))
              )
              return {
                name: p.name,
                type: p.type as ColumnType,
                options: p.options?.map((o) => o.name),
                optionColors: p.options
                  ? Object.fromEntries(p.options.map((o) => [o.name, o.color ?? "default"]))
                  : undefined,
                showInList: showByDefault,
                showInDetail: showByDefault,
              }
            }),
        )
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  if (!schema) {
    return (
      <List
        navigationTitle={database.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: leadingAction }}
      >
        <Text foregroundStyle="secondaryLabel">{error || "Loading columns…"}</Text>
      </List>
    )
  }

  const titles = schema.properties.filter((p) => p.type === "title")
  const statuses = schema.properties.filter((p) => p.type === "status" || p.type === "select")
  const dates = schema.properties.filter((p) => p.type === "date")
  const configByName = new Map(columnConfigs.map((column, index) => [column.name, { column, index }]))
  const candidates = schema.properties
    .filter((p) => SUPPORTED_COLUMN_TYPES.includes(p.type as ColumnType) && p.name !== titleProp && p.name !== statusProp)
    .map((p) => {
      const configured = configByName.get(p.name)?.column
      if (configured) return normalizeColumnViews(configured)
      return {
        name: p.name,
        type: p.type as ColumnType,
        options: p.options?.map((o) => o.name),
        optionColors: p.options
          ? Object.fromEntries(p.options.map((o) => [o.name, o.color ?? "default"]))
          : undefined,
        showInList: false,
        showInDetail: false,
      }
    })
    .sort((a, b) => (configByName.get(a.name)?.index ?? Number.MAX_SAFE_INTEGER) - (configByName.get(b.name)?.index ?? Number.MAX_SAFE_INTEGER))
  const unsupported = schema.properties.filter(
    (p) => !SUPPORTED_COLUMN_TYPES.includes(p.type as ColumnType) && p.type !== "title" && p.name !== statusProp,
  )

  function setColumnView(name: string, view: "showInList" | "showInDetail", value: boolean) {
    const candidate = candidates.find((column) => column.name === name)
    if (!candidate) return
    setColumnConfigs((current) => {
      const found = current.some((column) => column.name === name)
      return found
        ? current.map((column) => column.name === name ? { ...column, [view]: value } : column)
        : [...current, { ...candidate, [view]: value }]
    })
  }

  function moveColumns(indices: number[], newOffset: number) {
    const moving = indices.map((index) => candidates[index])
    const rest = candidates.filter((_, index) => !indices.includes(index))
    rest.splice(newOffset, 0, ...moving)
    setColumnConfigs(rest)
  }

  function save() {
    if (!schema || !titleProp || !statusProp) return
    const statusProperty = schema.properties.find((p) => p.name === statusProp)
    const dueProperty = schema.properties.find((p) => p.name === dueProp && p.type === "date")
    const mapping: DatabaseMapping = {
      databaseId: database.databaseId,
      dataSourceId: schema.id,
      databaseTitle: database.title,
      titleProp,
      statusProp,
      statusType: statusProperty?.type === "status" ? "status" : "select",
      statusOptions: statusProperty?.options?.map((o) => o.name) ?? [],
      statusGroups: statusProperty?.statusGroups ?? [],
      dueProp: dueProperty?.name,
      columns: candidates.map((column) => ({
        ...column,
        showInList: column.showInList,
        showInDetail: column.showInDetail,
      })),
    }
    switchDatabase(mapping)
    dismiss()
  }

  const label = (p: { name: string; type: string }) => `${p.name} (${p.type})`

  return (
    <List
      navigationTitle={database.title}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: leadingAction,
        topBarTrailing: <EditButton />,
        confirmationAction: <Button title="Save" action={save} />,
      }}
    >
      <Section header={<Text>Required</Text>}>
        <Picker title="Title column" pickerStyle="menu" value={titleProp} onChanged={setTitleProp}>
          {titles.map((p) => (
            <Text key={p.name} tag={p.name}>
              {p.name}
            </Text>
          ))}
        </Picker>
        <Picker title="Status column" pickerStyle="menu" value={statusProp} onChanged={setStatusProp}>
          {statuses.map((p) => (
            <Text key={p.name} tag={p.name}>
              {label(p)}
            </Text>
          ))}
        </Picker>
        <Picker title="Due date column" pickerStyle="menu" value={dueProp} onChanged={setDueProp}>
          <Text tag="">None</Text>
          {dates.map((p) => (
            <Text key={p.name} tag={p.name}>
              {p.name}
            </Text>
          ))}
        </Picker>
      </Section>

      <Section
        header={<Text>View options</Text>}
        footer={<Text>Choose where each column appears. Tap Edit to rearrange the columns.</Text>}
      >
        <HStack spacing={12}>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">List</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">Detail</Text>
        </HStack>
        <ForEach
          count={candidates.length}
          itemBuilder={(index) => {
            const column = candidates[index]
            return (
              <VStack key={column.name} alignment="leading" spacing={6}>
                <HStack>
                  <Text>{column.name}</Text>
                  <Spacer />
                  <Toggle title="List" value={column.showInList} toggleStyle="button" onChanged={(value) => setColumnView(column.name, "showInList", value)} />
                  <Toggle title="Detail" value={column.showInDetail} toggleStyle="button" onChanged={(value) => setColumnView(column.name, "showInDetail", value)} />
                </HStack>
                <Text font="caption" foregroundStyle="secondaryLabel">{column.type.replace(/_/g, " ")}</Text>
              </VStack>
            )
          }}
          onMove={moveColumns}
        />
      </Section>

      {unsupported.length > 0 ? (
        <Section header={<Text>Not supported yet</Text>}>
          <Text foregroundStyle="secondaryLabel">{unsupported.map(label).join(", ")}</Text>
        </Section>
      ) : null}
    </List>
  )
}
