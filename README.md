# Notion Todo for Scripting

An offline-first task app for iOS that uses a Notion database as its backend. It runs inside the [Scripting](https://apps.apple.com/app/id6479691128) app (free tier, no PRO features needed) and is written in TypeScript/TSX.

> Not affiliated with or endorsed by Notion Labs or the Scripting app.

## Features

- **Offline-first.** Tasks are cached on the device; changes made offline go through an outbox and sync when you are back online.
- **Quick Add.** A card above the keyboard with natural-language dates (`tomorrow`, `next friday`, `in 3 days`, `15 oct`, `at 5pm`; German phrases work too). **Add details** hands the draft to the full task form.
- **Editable tabs and filters.** Rename tabs, change icons, and give each tab its own filter. Saved views, advanced JSON filters (evaluated locally), and a fixed **Browse** tab with the full list.
- **Your columns.** Choose which Notion properties show in the list and in the detail view, and reorder them.
- **Reminders.** Due dates become local notifications.
- **Deep links** for Shortcuts and the Home Screen (see below).
- **Light on the phone.** Only the first 50 rows of a tab are rendered (more load as you scroll); search and filters use the whole local cache; page bodies are fetched only when a task is opened.

## Privacy and security

- The Notion token is typed into the app and stored in the **iOS Keychain**, only for this script. It is never written to this repository, to a config file, or to anything synced.
- The app talks only to `https://api.notion.com`. There is no analytics, no server of mine, and no other network access.
- Task data is cached on the device only.

## Install

Requires an iPhone with the Scripting app.

1. On your iPhone, open the [stable Scripting import link](scripting://import_scripts?urls=https%3A%2F%2Fgithub.com%2Fmatthias-hausberger%2Fscripting-notion-todo%2Ftree%2Fstable%2Fapp). It imports the `app/` script from the `stable` branch of the [public GitHub repository](https://github.com/matthias-hausberger/scripting-notion-todo). Stable receives official releases only.
2. To try a prerelease, use the [beta import link](scripting://import_scripts?urls=https%3A%2F%2Fgithub.com%2Fmatthias-hausberger%2Fscripting-notion-todo%2Ftree%2Fbeta%2Fapp), which tracks the `beta` branch. To try the latest development version, use the [edge import link](scripting://import_scripts?urls=https%3A%2F%2Fgithub.com%2Fmatthias-hausberger%2Fscripting-notion-todo%2Ftree%2Fmain%2Fapp), which tracks `main`.
3. To receive updates on a channel, set the matching GitHub URL as the script's remote source in Scripting's script settings. Scripting checks that branch for changes; its automatic-update setting controls whether it applies them automatically.
4. Open **Notion Todo** in Scripting and tap **Configure Notion**:
   1. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy its secret (a personal access token also works). If you use an integration, share your task database with it.
   2. Paste the token under **Settings → Notion**.
   3. Open **Task database**, pick your database, map the title and status columns, and choose the **Due date column** (Quick Add writes dates there).

## Using it

- **Tabs:** long-press a tab to rename it, change its icon, add tabs, or reorder. Defaults are *Unscheduled*, *Today*, *Later*, then *Browse*. Settings live behind the gear in Browse.
- **Filters:** the Filters button is available on every tab. Edits apply immediately; **Save filter** / **Restore filter** manage each tab's saved baseline. **Save current filter as view** creates a reusable preset.
- **Quick Add:** tap **+** in the tab bar. Tap anywhere outside the card to dismiss it.
- **View options** (Settings → Notion → Task database → Edit columns): per-column **List** and **Detail** visibility, with one shared order. The task form uses the Detail columns.
- **Swipe** right to set a status of your choice; configure it in Settings.

### Deep links

Replace `Notion%20Todo` with your script's name if you renamed it.

- `scripting://run/Notion%20Todo?view=Today` opens a saved view
- `scripting://run/Notion%20Todo?filter=<url-encoded filter JSON>` applies a filter
- `scripting://run/Notion%20Todo?action=new&title=Call%20Anna&status=Not%20started` opens Quick Add prefilled

The Filters screen can copy these links for the current filter.

## How syncing works

- The cache is a rolling window of the **10,000 most recently edited tasks**. The first sync (or **Clear Cache & Reload**) fetches the latest 10,000.
- Later syncs query only items edited since the stored Notion `last_edited_time` checkpoint, merge them by page ID, and drop the oldest-edited rows when the window is full. The checkpoint comes from Notion, not the phone clock.
- Older tasks reappear once they are edited. Tasks trashed or moved out of the database elsewhere are not detected incrementally; use **Clear Cache & Reload**.
- Changing the mapped title, status, or columns reloads the window.
- Uses Notion API version `2026-03-11` and its data-source endpoints. If a database has several data sources, you pick one.
- iOS cannot run the script in the background, so reminders are rescheduled at sync time and Notion changes are picked up the next time you open the app.

## Development

```
app/                 the Scripting script (what gets packaged)
  index.tsx          entry point
  script.json        script metadata
  lib/               Notion client, store, filters, date parsing
  ui/                screens and components
scripts/package.sh   build dist/Notion Todo.scripting
scripts/sync-dev.sh  copy app/ into a Scripting dev-server workspace
```

Live development uses the [Scripting CLI](https://github.com/ScriptingApp/scripting-app-development) dev server:

1. **Import the `.scripting` package first** (see Install). Do not create an empty script and then connect the dev server: file sync works both ways, and an empty app-side `index.tsx` can overwrite your desktop copy.
2. Start the server: `mkdir -p ~/Documents/scripting-dev/notion-todo && cd ~/Documents/scripting-dev/notion-todo && pnpm dlx scripting-cli start --editor=none --bonjour --no-auto-open`
3. In Scripting, connect to the server and select the already imported script.
4. Push changes with `scripts/sync-dev.sh` (it leaves the app's `script.json` alone). If your phone reconnects with an older copy, it can overwrite the server's files; re-run the sync while it is connected.

The app writes its current type declarations to `~/Documents/scripting-dev/notion-todo/dts`; type-check against those. Several Scripting globals (`Storage`, `Keychain`, `Dialog`, `Pasteboard`, `Safari`, `WebViewController`, `DateComponents`, `CalendarNotificationTrigger`, `TimeIntervalNotificationTrigger`) are not importable from `"scripting"`.

Bonjour discovery does not cross Tailscale or other VPNs. Enter the server address manually (for example `http://<tailscale-ip>:3000`) or scan a QR code for it.

## Status

Personal project, developed on an iPhone 16 Pro. There is no automated test suite; performance with very large databases has not been profiled thoroughly. Issues and pull requests are welcome.

## License

[MIT](LICENSE)
