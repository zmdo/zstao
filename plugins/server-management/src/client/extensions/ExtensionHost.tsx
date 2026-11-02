import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { serverCopy } from '../../shared/i18n.ts'
import type { SlotService } from './slots.ts'

export class ExtensionBoundary extends Component<
  { label: string; children: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidUpdate(prev: Readonly<{ resetKey?: string }>) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey)
      this.setState({ failed: false })
  }
  render() {
    if (this.state.failed) return <p className="banner error">{this.props.label}</p>
    return this.props.children
  }
}

export function useSlotEntries(slots: SlotService | undefined, name: string, key: string) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (slots === undefined) return
    return slots.subscribe(name, () => setVersion((value) => value + 1))
  }, [slots, name])
  return useMemo(() => {
    void version
    return (slots?.entriesOfSlot(name) ?? []).filter((entry) => entry.options.key === key)
  }, [slots, name, key, version])
}

export function ExtensionHost(props: {
  active: string
  slot: string
  entry: string
  owner: object
  renderSlot:
    | ((key: string, owner: never, options: { entryKey?: string; fallback?: ReactNode }) => ReactNode)
    | undefined
  slots: SlotService | undefined
}) {
  const copy = serverCopy(props.active).ui
  const entries = useSlotEntries(props.slots, props.slot, props.entry)
  const [slotVersion, setSlotVersion] = useState(0)
  useEffect(() => {
    if (props.slots === undefined) return
    return props.slots.subscribe(props.slot, () => setSlotVersion((value) => value + 1))
  }, [props.slots, props.slot])
  const conflicts = useMemo(() => {
    void slotVersion
    return (props.slots?.entries?.(props.slot) ?? []).filter((entry) => entry.options.key === props.entry).length
  }, [props.slots, props.slot, props.entry, slotVersion])
  const hadEntry = useRef(false)
  const lastEntry = useRef(props.entry)
  if (lastEntry.current !== props.entry) {
    lastEntry.current = props.entry
    hadEntry.current = false
  }
  useEffect(() => {
    if (entries.length > 0) hadEntry.current = true
  }, [entries.length])
  if (conflicts > 1) return <p className="banner error">{copy.extensionConflict}</p>
  if (entries.length === 0)
    return <p className="banner error">{hadEntry.current ? copy.extensionLoadFailed : copy.extensionUnavailable}</p>
  return (
    <ExtensionBoundary label={copy.extensionLoadFailed} resetKey={props.entry}>
      {props.renderSlot?.(props.slot, props.owner as never, {
        entryKey: props.entry,
        fallback: <p className="banner error">{copy.extensionUnavailable}</p>,
      }) ?? <p className="banner error">{copy.extensionUnavailable}</p>}
    </ExtensionBoundary>
  )
}
