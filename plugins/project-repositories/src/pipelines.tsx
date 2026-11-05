import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Build } from './shared.ts'
import { errorText, json, useLanguage } from './client-api.ts'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}
interface PageProps { locale: LocaleFace }
interface BuildRow extends Build { projectName: string }

const STATUS_TEXT: Record<string, { zh: string; en: string; tone: string }> = {
  WAITING: { zh: '排队中', en: 'Queued', tone: 'queued' },
  PENDING: { zh: '等待中', en: 'Pending', tone: 'queued' },
  RUNNING: { zh: '运行中', en: 'Running', tone: 'running' },
  SUCCESSFUL: { zh: '成功', en: 'Successful', tone: 'success' },
  FAILED: { zh: '失败', en: 'Failed', tone: 'failure' },
  CANCELLED: { zh: '已取消', en: 'Cancelled', tone: 'neutral' },
  TIMED_OUT: { zh: '超时', en: 'Timed out', tone: 'failure' },
}

function statusOf(status: string, zh: boolean): { text: string; tone: string } {
  const item = STATUS_TEXT[status] ?? { zh: status, en: status, tone: 'neutral' }
  return { text: zh ? item.zh : item.en, tone: item.tone }
}
const PILL_TONE: Record<string, string> = { success: 'succeeded', failure: 'failed', running: 'running', queued: 'queued', neutral: 'offline' }

function duration(milliseconds: number | null): string {
  if (milliseconds === null || milliseconds < 0) return '—'
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
function dateTime(value: string | null, zh: boolean): string {
  if (value === null) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
function shortSha(value: string): string {
  return value.length > 10 ? value.slice(0, 8) : value
}
function refLabel(value: string): string {
  return value.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '')
}
function stepLabel(name: string): string {
  const match = /^step-(\d+)$/.exec(name)
  return match ? `Step ${Number(match[1]) + 1}` : name
}
function hashBuild(): number | null {
  const value = new URLSearchParams(window.location.hash.slice(1)).get('build')
  return value !== null && /^[1-9]\d*$/.test(value) ? Number(value) : null
}
function setHashBuild(id: number | null): void {
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (id === null) params.delete('build')
  else params.set('build', String(id))
  const next = `#${params.toString()}`
  if (next !== window.location.hash) window.history.pushState(null, '', next)
}

export function PipelinesPage(props: PageProps): JSX.Element {
  const zh = useLanguage(props.locale)
  const [rows, setRows] = useState<BuildRow[]>([])
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(() => hashBuild())
  const [build, setBuild] = useState<BuildRow | null>(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let stopped = false
    setLoading(true)
    setError('')
    json<{ builds: BuildRow[]; nextOffset: number | null }>(`/pipelines?offset=${offset}&count=${pageSize}`)
      .then(value => { if (!stopped) { setRows(value.builds); setNextOffset(value.nextOffset) } })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [offset, pageSize, zh])

  useEffect(() => {
    const onHash = () => setSelected(hashBuild())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (selected === null) { setBuild(null); setLogs(''); return }
    let stopped = false
    setDetailLoading(true)
    setError('')
    json<BuildRow>(`/pipelines/${selected}`)
      .then(value => { if (!stopped) setBuild(value) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setDetailLoading(false) })
    return () => { stopped = true }
  }, [selected, zh])

  useEffect(() => {
    if (build === null) return
    let stopped = false
    json<{ text: string }>(`/pipelines/${build.id}/logs`)
      .then(value => { if (!stopped) setLogs(value.text) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
    return () => { stopped = true }
  }, [build?.id, zh])

  useEffect(() => {
    if (build === null || !['WAITING', 'PENDING', 'RUNNING'].includes(build.status)) return
    const timer = window.setInterval(() => {
      json<BuildRow>(`/pipelines/${build.id}`).then(value => setBuild(value)).catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [build])

  const visible = useMemo(() => rows.filter(row => {
    if (status !== '' && row.status !== status) return false
    if (query !== '') {
      const haystack = `${row.projectName} ${row.jobName} ${row.refName} ${row.commitHash} ${row.submitReason ?? ''}`.toLowerCase()
      if (!haystack.includes(query.toLowerCase())) return false
    }
    return true
  }), [rows, status, query])

  const open = (id: number): void => { setSelected(id); setHashBuild(id) }
  const back = (): void => { setSelected(null); setHashBuild(null) }

  if (selected !== null) {
    return (
      <Panel className="smp-list-panel smp-pipeline-detail" title={
        <span className="smp-pipeline-titlebar">
          <button type="button" className="smp-repo-back" aria-label={zh ? '返回流水线列表' : 'Back to pipelines'} title={zh ? '返回流水线列表' : 'Back to pipelines'} onClick={back}><IconChevronLeftOutlineRegular /></button>
          <strong>{zh ? '流水线详情' : 'Pipeline details'}</strong>
        </span>
      }>
        {detailLoading && <p className="muted">{zh ? '正在读取…' : 'Loading…'}</p>}
        {error !== '' && <p className="banner error">{error}</p>}
        {build !== null && <>
          <div className="smp-pipeline-info-bar">
            <div className="smp-pipeline-summary">
              <span className={`pill ${PILL_TONE[statusOf(build.status, zh).tone] ?? 'offline'}`}>{statusOf(build.status, zh).text}</span>
              <strong>{build.projectName} / {build.jobName} <span>#{build.number}</span></strong>
            </div>
            <div className="smp-pipeline-facts">
              <div className="smp-pipeline-fact"><span>{zh ? '分支 / Tag' : 'Ref'}</span><strong>{refLabel(build.refName) || '—'}</strong></div>
              <div className="smp-pipeline-fact"><span>Commit</span><strong className="mono">{shortSha(build.commitHash) || '—'}</strong></div>
              <div className="smp-pipeline-fact"><span>{zh ? '触发' : 'Trigger'}</span><strong>{build.submitReason ?? '—'}</strong></div>
              <div className="smp-pipeline-fact"><span>{zh ? '开始时间' : 'Started'}</span><strong>{dateTime(build.runningDate ?? build.submitDate, zh)}</strong></div>
              <div className="smp-pipeline-fact"><span>{zh ? '耗时' : 'Duration'}</span><strong>{duration(build.runningDuration)}</strong></div>
              <div className="smp-pipeline-fact"><span>Agent</span><strong>{build.agentId === null ? '—' : `#${build.agentId}`}</strong></div>
            </div>
          </div>
          <div className="smp-pipeline-body">
            <aside className="smp-pipeline-steps">
              <h3>{zh ? '运行步骤' : 'Steps'}</h3>
              {build.steps.length === 0 ? <p className="muted">{zh ? '暂无步骤信息' : 'No step information'}</p> : <ol>{build.steps.map(step => <li key={step.name}><span className={`smp-step-dot ${statusOf(step.status === 'RUNNING' ? 'RUNNING' : step.status === 'FAILED' ? 'FAILED' : step.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : 'CANCELLED', zh).tone}`} /> <div><strong>{stepLabel(step.name)}</strong><span className="muted">{step.status.toLowerCase()} · {duration(step.duration)}</span></div></li>)}</ol>}
            </aside>
            <section className="smp-pipeline-logs">
              <div className="smp-pipeline-logs-head"><h3>{zh ? '日志' : 'Logs'}</h3></div>
              <pre>{logs || (zh ? '正在读取日志…' : 'Loading logs…')}</pre>
            </section>
          </div>
        </>}
      </Panel>
    )
  }

  const page = Math.floor(offset / pageSize) + 1
  const pages = nextOffset === null ? page : page + 1
  return (
    <Panel className="smp-list-panel" title={zh ? '部署流水线' : 'Deploy pipelines'} extra={
      <div className="row smp-plugins-head-extra">
        <select className="smp-status-filter" aria-label={zh ? '状态' : 'Status'} value={status} onChange={event => setStatus(event.target.value)}><option value="">{zh ? '全部' : 'All'}</option>{Object.entries(STATUS_TEXT).map(([key, value]) => <option key={key} value={key}>{zh ? value.zh : value.en}</option>)}</select>
        <input className="search" type="search" aria-label={zh ? '搜索流水线' : 'Search pipelines'} value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索项目、Job、Commit' : 'Search project, job, commit'} />
      </div>
    }>
      {loading && <p className="muted">{zh ? '正在读取…' : 'Loading…'}</p>}
      {error !== '' && <p className="banner error">{error}</p>}
      {!loading && error === '' && visible.length === 0 && <p className="empty">{rows.length === 0 ? (zh ? '还没有流水线运行。' : 'No pipeline runs yet.') : (zh ? '没有匹配的流水线。' : 'No matching pipelines.')}</p>}
      {visible.length > 0 && <div className="table-wrap smp-list-scroll"><table className="smp-plugins smp-table"><thead><tr><th>{zh ? '状态' : 'Status'}</th><th>{zh ? '项目' : 'Project'}</th><th>Job</th><th>{zh ? '分支 / Tag' : 'Ref'}</th><th>Commit</th><th>{zh ? '触发' : 'Trigger'}</th><th>{zh ? '时间' : 'Started'}</th><th>{zh ? '耗时' : 'Duration'}</th></tr></thead><tbody>{visible.map(row => <tr key={row.id} className="smp-plugin-row smp-pipeline-row" role="button" tabIndex={0} onClick={() => open(row.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(row.id) } }}><td><span className={`pill ${PILL_TONE[statusOf(row.status, zh).tone] ?? 'offline'}`}>{statusOf(row.status, zh).text}</span></td><td>{row.projectName}</td><td>{row.jobName}</td><td>{refLabel(row.refName) || '—'}</td><td>{shortSha(row.commitHash)}</td><td>{row.submitReason ?? '—'}</td><td>{dateTime(row.runningDate ?? row.submitDate, zh)}</td><td>{duration(row.runningDuration)}</td></tr>)}</tbody></table></div>}
      {visible.length > 0 && <div className="smp-plugins-pager smp-list-pager"><span className="muted">{zh ? `共 ${rows.length} 个` : `${rows.length} builds`}</span><div className="row"><label>{zh ? '每页' : 'Per page'}<select className="smp-page-size" value={pageSize} onChange={event => { const next = Number(event.target.value); setPageSize(next); setOffset(0) }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" className="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>{zh ? '上一页' : 'Previous'}</button><span>{zh ? `第 ${page} / ${pages} 页` : `Page ${page} of ${pages}`}</span><button type="button" className="secondary" disabled={nextOffset === null || loading} onClick={() => setOffset(nextOffset ?? offset)}>{zh ? '下一页' : 'Next'}</button></div></div>}
    </Panel>
  )
}
