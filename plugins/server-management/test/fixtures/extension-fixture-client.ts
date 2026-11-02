import { registerServerPanel, registerSettingsSection, type ExtensionSlotOwner, type SlotService } from '@smp/console-server-management/client-api'

export function FixtureDatabasePanel(_props: ExtensionSlotOwner) {
  return null
}

export function FixtureDatabaseSettings(_props: ExtensionSlotOwner) {
  return null
}

/** Uses only the public client registration helpers. */
export function registerFixtureClient(slots: SlotService): void {
  registerServerPanel({ slots }, 'database-panel', FixtureDatabasePanel)
  registerSettingsSection({ slots }, 'database-settings', FixtureDatabaseSettings)
}
