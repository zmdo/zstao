import { useSyncExternalStore } from 'react'
import { serverCopy, type LocaleFace } from '../../shared/i18n.ts'
import { useActiveLocale } from '../shared/locale.ts'
import type { ServerPageState } from '../shared/server-page-state.ts'
export function UpgradesNavigation(props: { locale: LocaleFace; pageState: ServerPageState }) {
  const active = useActiveLocale(props.locale)
  const copy = serverCopy(active).upgrades
  const { tab } = useSyncExternalStore(props.pageState.subscribe, props.pageState.getSnapshot).upgradeView
  return (
    <nav className="tabs" aria-label={copy.title}>
      {(['suggestions', 'plans', 'records'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={`tab${tab === value ? ' is-on' : ''}`}
          aria-current={tab === value ? 'page' : undefined}
          onClick={() => props.pageState.selectUpgradeTab(value)}
        >
          {copy[value]}
        </button>
      ))}
    </nav>
  )
}
