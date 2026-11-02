import { createElement, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type RefObject, type ReactNode } from 'react'
import type { GroupClient } from './client-api.ts'
import type { Workspace, WorkspaceSnapshot } from './contract.ts'
import type { Slots } from './bridge.ts'
import { PickerController, pickerGroup, pickerWorkspaces } from './picker-controller.ts'
import { GROUP_FLOW_SLOT, NATIVE_FLOW_SLOT, PICKER_SLOT, mirrorPickerFlow } from './picker-flow.ts'
import { UNASSIGNED_GROUP_ID } from './rules.ts'

interface PickerProps {
  open: boolean
  anchorRef?: RefObject<HTMLElement | null>
  selectedId?: string
  onPick(workspaceId: string): void
  onClose(): void
  renderSlot(name: string, owner: object): ReactNode
  t(key: string, params?: object): string
  useWorkspaces<T>(select: (state: WorkspaceSnapshot) => T): T
  useDirectoryFlow<T>(select: (occupied: boolean) => T): T
  createWorkspace(input: { path: string }): Promise<Workspace>
}

export function installPicker(slots: Slots, client: GroupClient): void {
  slots.inject(PICKER_SLOT, () => {
    const dispose = slots.register({
      name: PICKER_SLOT, priority: -100, locale: 'workspace',
      children: { [GROUP_FLOW_SLOT]: { kind: 'single', scope: 'root' } },
    }, (props: PickerProps) => <GroupPicker {...props} slots={slots} client={client} />)
    const stopFlow = slots.inject(NATIVE_FLOW_SLOT, () => slots.inject(GROUP_FLOW_SLOT, () => mirrorPickerFlow(slots)))
    return () => { stopFlow(); dispose() }
  })
}

function GroupPicker(props: PickerProps & { slots: Slots; client: GroupClient }) {
  const { slots, client } = props
  useSyncExternalStore(client.subscribe, client.store.getRevision)
  const entries = useSyncExternalStore(listener => slots.subscribe(PICKER_SLOT, listener), () => slots.entries(PICKER_SLOT))
  const native = entries.find(entry => (entry.options.priority ?? 0) === 0)
  const controller = useMemo(() => new PickerController(client), [client])
  const groupId = pickerGroup(client)
  const available = groupId !== undefined && groupId !== UNASSIGNED_GROUP_ID
  const previousGroup = useRef(groupId)
  controller.observeOpen(props.open)
  useEffect(() => {
    const changed = previousGroup.current !== groupId
    previousGroup.current = groupId
    if (props.open && (!available || changed)) props.onClose()
  }, [groupId, props.open, available, props.onClose])
  const hooks = useMemo(() => ({
    useWorkspaces: <T,>(select: (state: WorkspaceSnapshot) => T) => {
      const revision = useSyncExternalStore(client.subscribe, client.store.getRevision)
      const snapshot = useMemo(() => pickerWorkspaces(client), [revision])
      return select(snapshot)
    },
    useDirectoryFlow: <T,>(select: (occupied: boolean) => T) => {
      useSyncExternalStore(client.subscribe, client.store.getRevision)
      const entries = useSyncExternalStore(listener => slots.subscribe(GROUP_FLOW_SLOT, listener), () => slots.entries(GROUP_FLOW_SLOT))
      const group = pickerGroup(client)
      return select(entries.length > 0 && group !== undefined && group !== UNASSIGNED_GROUP_ID)
    },
  }), [client, slots])
  // Reading the native registration reuses its component and menu keyboard behavior, without patching it.
  if (native === undefined) return null
  return createElement(native.component as ComponentType<PickerProps>, {
    ...props, ...hooks,
    open: props.open && available,
    createWorkspace: input => controller.create(input.path),
    onPick: id => { props.onClose(); void controller.pick(id).catch(cause => client.report(cause)) },
    renderSlot: (name, owner) => {
      if (name !== NATIVE_FLOW_SLOT) throw new Error(`Unexpected workspace picker slot: ${name}`)
      return props.renderSlot(GROUP_FLOW_SLOT, owner)
    },
  })
}
