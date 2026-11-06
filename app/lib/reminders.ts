import { Notification, Script } from "scripting"
import { dueColumn } from "./due"
import { findCompletedStatuses } from "./notion"
import { parseTime } from "./settings"
import { DatabaseMapping, Settings, Todo } from "./types"

// iOS keeps at most 64 pending local notifications per app.
const MAX_REMINDERS = 60

/** Replaces all pending reminders with one per open todo that has a date in
 *  the chosen column. A date with a time fires at that time; a date-only value
 *  fires at the default time from Settings. These are local notifications
 *  scheduled at the last sync, not pushes from Notion. Never throws. */
export async function rescheduleReminders(
  todos: Todo[],
  mapping: DatabaseMapping,
  settings: Settings,
): Promise<void> {
  try {
    await Notification.removeAllPendingsOfCurrentScript()
    if (!settings.notifications.enabled) return
    const columnName = settings.notifications.column ?? dueColumn(mapping)?.name
    if (!columnName) return

    const { hour, minute } = parseTime(settings.notifications.defaultTime)
    const completed = findCompletedStatuses(mapping)
    const now = Date.now()
    const due: { todo: Todo; at: Date }[] = []

    for (const todo of todos) {
      if (todo.status !== null && completed.includes(todo.status)) continue
      const cell = todo.columns[columnName]
      if (!cell || cell.type !== "date" || !cell.value) continue
      // ISO date-only strings parse as UTC in JavaScript. Construct them from
      // local calendar parts so a due date does not shift to the previous day.
      let at: Date
      if (cell.value.includes("T")) {
        at = new Date(cell.value)
      } else {
        const [year, month, day] = cell.value.slice(0, 10).split("-").map(Number)
        at = new Date(year, month - 1, day, hour, minute, 0, 0)
      }
      if (Number.isNaN(at.getTime()) || at.getTime() <= now) continue
      due.push({ todo, at })
    }

    due.sort((a, b) => a.at.getTime() - b.at.getTime())
    for (const { todo, at } of due.slice(0, MAX_REMINDERS)) {
      const scheduled = await Notification.schedule({
        title: todo.title,
        body: `${columnName}: ${todo.status ?? "No status"}`,
        threadIdentifier: "notion-todo-due",
        trigger: new CalendarNotificationTrigger({
          dateMatching: new DateComponents({
            year: at.getFullYear(),
            month: at.getMonth() + 1,
            day: at.getDate(),
            hour: at.getHours(),
            minute: at.getMinutes(),
          }),
          repeats: false,
        }),
        tapAction: { type: "runScript", scriptName: Script.name },
      })
      if (!scheduled) console.error(`Could not schedule due reminder for ${todo.title}`)
    }
  } catch (error) {
    console.error("Reminders failed:", error)
  }
}
