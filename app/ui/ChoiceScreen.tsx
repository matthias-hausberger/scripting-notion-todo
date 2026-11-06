import {
  Button,
  Color,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  useState,
} from "scripting"
import { APP_ACCENT } from "./theme"

/** Pick one or several values from a list, with a checkmark on the selected rows.
 *  Pushed from a NavigationLink; changes are reported immediately via `onChange`. */
export function ChoiceScreen({
  title,
  options,
  selected,
  multi,
  onChange,
  colors,
}: {
  title: string
  options: string[]
  selected: string[]
  multi: boolean
  onChange: (next: string[]) => void
  colors?: Record<string, Color>
}) {
  const [current, setCurrent] = useState(selected)
  const [toastVisible, setToastVisible] = useState(false)

  function toggle(option: string) {
    let next: string[]
    if (multi) {
      next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option]
    } else {
      next = current.includes(option) ? [] : [option]
    }
    setCurrent(next)
    onChange(next)
  }

  return (
    <List
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toast={{
        isPresented: toastVisible,
        onChanged: setToastVisible,
        message: "Selection cleared",
        duration: 2,
        position: "bottom",
      }}
      toolbar={{
        topBarTrailing: (
          <Button
            title="Clear"
            action={() => {
              HapticFeedback.lightImpact()
              setCurrent([])
              onChange([])
              setToastVisible(true)
            }}
          />
        ),
      }}
    >
      <Section>
        {options.length === 0 ? <Text foregroundStyle="secondaryLabel">No options</Text> : null}
        {options.map((option) => (
          <HStack key={option} contentShape="rect" onTapGesture={() => toggle(option)}>
            <Text foregroundStyle={colors?.[option] ?? "label"}>{option}</Text>
            <Spacer />
            {current.includes(option) ? (
              <Image systemName="checkmark" foregroundStyle={APP_ACCENT} />
            ) : null}
          </HStack>
        ))}
      </Section>
    </List>
  )
}
