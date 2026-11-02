import type { ReactNode } from 'react'
import { GroupClient, type ClientContext } from './client-api.ts'
import { GroupSidebar, SIDEBAR_STYLE, type RenderSidebarSlot } from './Sidebar.tsx'
import type { Slots } from './bridge.ts'
import { installPicker } from './Picker.tsx'

interface ClientCtx extends ClientContext {
  slots: Slots
  effect(run: () => (() => void | Promise<void>)): void
  reflect: { provide(name: string, service: unknown): () => void }
}

export const inject = ['slots', 'workspaces', 'uiWorkspace', 'locale', 'sessions', 'layout']

export function apply(ctx: ClientCtx): void {
  const client = new GroupClient(ctx)
  const service = {
    subscribe: client.subscribe,
    getSnapshot: client.getSnapshot,
    selectedId: client.selectedId,
    labelOf: client.labelOf,
    hiddenPages: client.hiddenPages,
    select: client.select,
    refresh: () => client.refresh(),
    renderSidebar: (renderSlot: RenderSidebarSlot): ReactNode => <GroupSidebar client={client} slots={ctx.slots} renderSlot={renderSlot} />,
  }
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('workspaceGroups', service)
    void client.start().catch(cause => client.report(cause))
    return async () => { dispose(); await client.close() }
  })
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@smp/console-workspace-groups'
    style.textContent = SIDEBAR_STYLE
    document.head.append(style)
    return () => style.remove()
  })
  installPicker(ctx.slots, client)
}
