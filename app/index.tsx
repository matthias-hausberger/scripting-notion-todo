import { Navigation, Script } from "scripting"
import { getState, init } from "./lib/store"
import { AppTabs } from "./ui/AppTabs"

async function run() {
  init()
  // This preference is read before presenting the app; changes apply on next launch.
  const modalPresentationStyle = getState().settings.general.fullScreen ? "fullScreen" : "pageSheet"
  await Navigation.present({ element: <AppTabs />, modalPresentationStyle })
  Script.exit()
}

run()
