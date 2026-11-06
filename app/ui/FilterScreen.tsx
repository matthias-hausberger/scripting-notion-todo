import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  ZStack,
  useState,
} from "scripting"
import {
  activeFilterLabels,
  filterDeepLink,
  filterToNewTodoContext,
  newTodoDeepLink,
  viewDeepLink,
} from "../lib/filters"
import {
  activeFilterFor,
  deleteView,
  filterHasUnsavedChanges,
  restoreActiveFilter,
  saveActiveFilter,
  saveView,
  setActiveFilter,
  useStore,
} from "../lib/store"
import { FilterEditor } from "./FilterEditor"

export function openFilters(filterKey: string): Promise<void> {
  return Navigation.present({ element: <FilterScreen filterKey={filterKey} /> })
}

/** Edits are reflected in the active tab immediately. Save filter updates its
 *  restore point; Restore filter discards the unsaved edits. */
export function FilterScreen({ filterKey }: { filterKey: string }) {
  const s = useStore()
  const dismiss = Navigation.useDismiss()
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const mapping = s.mapping
  const filters = activeFilterFor(filterKey)
  const hasUnsavedFilter = filterHasUnsavedChanges(filterKey)
  const tabTitle = filterKey === "browse"
    ? "Browse"
    : s.settings.tabs.find((tab) => tab.id === filterKey)?.title || "Tab"
  if (!mapping) return <List navigationTitle="Filters" />

  function showToast(message: string) {
    setToastMessage(message)
    setToastVisible(true)
  }

  async function saveCurrentAsView() {
    HapticFeedback.lightImpact()
    const name = await Dialog.prompt({
      title: "Save view",
      message: "Create a named filter preset. It will appear under Saved views and can be applied to any tab; it will not change this tab's Restore filter point.",
      placeholder: "e.g. Today",
      confirmLabel: "Save",
    })
    if (name?.trim()) {
      saveView(name.trim(), activeFilterFor(filterKey))
      showToast(`Saved view “${name.trim()}”`)
    }
  }

  async function copy(text: string, what: string) {
    HapticFeedback.lightImpact()
    try {
      await Pasteboard.setString(text)
      showToast(`${what} copied · paste it into Shortcuts or Safari`)
    } catch (error) {
      console.error("Unable to copy deep link", error)
      const detail = error instanceof Error ? error.message : String(error)
      showToast(`Could not copy link: ${detail}`)
    }
  }

  return (
    <NavigationStack>
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
                    <HStack spacing={8} padding={{ horizontal: 16, vertical: 8 }}>
                      <Button
                        title="Restore filter"
                        systemImage="arrow.uturn.backward"
                        action={() => {
                          HapticFeedback.lightImpact()
                          restoreActiveFilter(filterKey)
                          showToast("Restored the last saved filter")
                        }}
                      />
                      <Spacer />
                      <Button
                        title="Save filter"
                        systemImage="bookmark"
                        action={() => {
                          HapticFeedback.lightImpact()
                          saveActiveFilter(filterKey)
                          showToast("Saved as this tab’s filter")
                        }}
                      />
                    </HStack>
                  ),
                },
              }
            : undefined
        }
      >
        <List
          navigationTitle={`${tabTitle} filter`}
          navigationBarTitleDisplayMode="large"
          toolbar={{ topBarLeading: <Button title="Close" systemImage="xmark" action={dismiss} /> }}
        >
          <FilterEditor
            mapping={mapping}
            filters={filters}
            onChange={(next) => setActiveFilter(filterKey, next)}
            people={s.people}
            todos={s.serverTodos}
            showAdvanced={filterKey === "browse"}
          />

          <Section
            header={<Text>Views and links</Text>}
            footer={<Text>A saved view is a named filter preset. Tap one below to apply it to this tab; it is separate from this tab's saved filter used by Restore filter.</Text>}
          >
            <Button title="Save current filter as view…" systemImage="bookmark" action={saveCurrentAsView} />
            <Button
              title="Copy link to this filter"
              systemImage="link"
              action={() => copy(filterDeepLink(activeFilterFor(filterKey)), "Filter link")}
            />
            <Button
              title={'Copy "Quick-Add" link to this filter'}
              systemImage="plus.circle"
              action={() =>
                copy(
                  newTodoDeepLink(filterToNewTodoContext(activeFilterFor(filterKey), mapping)),
                  "Quick Add link",
                )
              }
            />
          </Section>

          {s.views.length > 0 ? (
            <Section header={<Text>Saved views</Text>}>
              {s.views.map((view) => (
                <HStack
                  key={view.id}
                  contentShape="rect"
                  onTapGesture={() => {
                    HapticFeedback.lightImpact()
                    setActiveFilter(filterKey, view.filter)
                    showToast(`Applied “${view.name}” to ${tabTitle}`)
                  }}
                  trailingSwipeActions={{
                    actions: [
                      <Button
                        role="destructive"
                        title="Delete"
                        systemImage="trash"
                        action={() => {
                          HapticFeedback.lightImpact()
                          deleteView(view.id)
                          showToast(`Deleted view “${view.name}”`)
                        }}
                      />,
                    ],
                  }}
                  contextMenu={{
                    menuItems: (
                      <Button
                        title="Copy Deep Link"
                        systemImage="link"
                        action={() => copy(viewDeepLink(view.name), `Link to "${view.name}"`)}
                      />
                    ),
                  }}
                >
                  <Text>{view.name}</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel" font="caption" lineLimit={1}>
                    {activeFilterLabels(view.filter).join(" · ") || "No filters"}
                  </Text>
                  <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
                </HStack>
              ))}
            </Section>
          ) : null}
        </List>
      </ZStack>
    </NavigationStack>
  )
}
