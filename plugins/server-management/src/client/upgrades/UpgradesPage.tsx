import { Panel } from '@smp/console-kit'
import { useSyncExternalStore, type ReactNode } from 'react'
import { serverCopy, type LocaleFace } from '../../shared/i18n.ts'
import { ChangePlan } from '../changes/ChangePlan.tsx'
import { useActiveLocale } from '../shared/locale.ts'
import type { ServerPageState } from '../shared/server-page-state.ts'
import { UpgradePlans } from './plans/UpgradePlans.tsx'
import { UpgradeRecords } from './records/UpgradeRecords.tsx'
import { UpgradeSuggestions } from './suggestions/UpgradeSuggestions.tsx'
import { useUpgradeSuggestions } from './suggestions/useUpgradeSuggestions.ts'

export function UpgradesPage(props: {
  locale: LocaleFace
  pageState: ServerPageState
  openConsole?: (key: string) => void
}) {
  const active = useActiveLocale(props.locale),
    c = serverCopy(active).upgrades
  const snapshot = useSyncExternalStore(props.pageState.subscribe, props.pageState.getSnapshot)
  const context = snapshot.upgradeContext
  const { tab, page, planId: plan } = snapshot.upgradeView
  const setPage = (page: number) => props.pageState.setUpgradePage(page)
  const setPlan = (planId: string) => props.pageState.showUpgradePlan(planId)
  const suggestions = useUpgradeSuggestions({
    active,
    pageState: props.pageState,
    enabled: tab === 'suggestions' && !plan,
  })
  if (plan)
    return (
      <Panel className="smp-upgrade-page" title={c.plans}>
        <ChangePlan
          key={plan}
          active={active}
          id={plan}
          onNewPlan={setPlan}
          onClose={() => props.pageState.selectUpgradeTab('plans')}
        />
      </Panel>
    )
  const back: ReactNode = context?.serverId ? (
    <button
      className="link"
      onClick={() => {
        props.pageState.update({ screen: 'detail', serverId: context.serverId! })
        props.openConsole?.('servers')
      }}
    >
      {c.back}
    </button>
  ) : undefined
  if (tab === 'plans')
    return <UpgradePlans active={active} onPlan={setPlan} back={back} />
  if (tab === 'records')
    return (
      <UpgradeRecords
        active={active}
        page={page}
        onPage={setPage}
        onPlan={setPlan}
        back={back}
      />
    )
  return (
    <Panel className={`smp-upgrade-page${tab === 'records' ? ' smp-list-panel' : ''}`} title={c[tab]} extra={back}>
      {tab === 'suggestions' && <UpgradeSuggestions model={suggestions} />}
    </Panel>
  )
}
