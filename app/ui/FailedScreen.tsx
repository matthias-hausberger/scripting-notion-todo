import {
  Button,
  Group,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
} from "scripting"
import { relativeTime } from "../lib/filters"
import {
  discardAllFailed,
  discardOp,
  retryAllFailed,
  retryOp,
  useStore,
} from "../lib/store"
import { APP_ACCENT } from "./theme"

export function openFailed(): Promise<void> {
  return Navigation.present({ element: <FailedScreen /> })
}

/** Operations Notion rejected (not just offline). They are not applied to the
 *  list; retry them or throw them away. */
export function FailedScreen() {
  const s = useStore()
  const dismiss = Navigation.useDismiss()
  const failed = s.outbox.filter((o) => o.state === "failed")

  return (
    <NavigationStack>
      <List
        navigationTitle="Failed Actions"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <Button title="Close" systemImage="xmark" action={dismiss} /> }}
      >
        {failed.length === 0 ? (
          <Text foregroundStyle="secondaryLabel">Nothing failed.</Text>
        ) : (
          <Group>
            <Section>
              <Button title="Retry All" systemImage="arrow.clockwise" action={retryAllFailed} />
              <Button
                title="Discard All"
                systemImage="trash"
                role="destructive"
                action={discardAllFailed}
              />
            </Section>
            <Section>
              {failed.map((op) => (
                <VStack
                  key={op.id}
                  alignment="leading"
                  spacing={4}
                  leadingSwipeActions={{
                    actions: [
                      <Button
                        title="Retry"
                        systemImage="arrow.clockwise"
                        tint={APP_ACCENT}
                        action={() => retryOp(op.id)}
                      />,
                    ],
                  }}
                  trailingSwipeActions={{
                    actions: [
                      <Button
                        title="Discard"
                        systemImage="trash"
                        role="destructive"
                        action={() => discardOp(op.id)}
                      />,
                    ],
                  }}
                >
                  <HStack>
                    <Text>{op.label}</Text>
                    <Spacer />
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {op.kind} · {relativeTime(op.timestamp)}
                    </Text>
                  </HStack>
                  <Text font="caption" foregroundStyle="systemRed" lineLimit={4}>
                    {op.error ?? "Unknown error"}
                  </Text>
                </VStack>
              ))}
            </Section>
          </Group>
        )}
      </List>
    </NavigationStack>
  )
}
