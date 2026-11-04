import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@smp/console-kit'
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
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(() => hashBuild())
  const [build, setBuild] = useState<BuildRow | null>(null)
  const [logs, setLogs] = useState('')
  const [logsOpen, setLogsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [project, setProject] = useState('')
  const [job, setJob] = useState('')
  const [status, setStatus] = useState('')
  const [branch, setBranch] = useState('')
  const [query, setQuery] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let stopped = false
    setLoading(true)
    setError('')
    json<{ builds: BuildRow[]; nextOffset: number | null }>(`/pipelines?offset=${offset}&count=50`)
      .then(value => { if (!stopped) { setRows(value.builds); setNextOffset(value.nextOffset) } })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [offset, zh, refresh])

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
    if (build === null || !logsOpen) return
    let stopped = false
    json<{ text: string }>(`/pipelines/${build.id}/logs`)
      .then(value => { if (!stopped) setLogs(value.text) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
    return () => { stopped = true }
  }, [build, logsOpen, zh])

  useEffect(() => {
    if (build === null || !['WAITING', 'PENDING', 'RUNNING'].includes(build.status)) return
    const timer = window.setInterval(() => {
      json<BuildRow>(`/pipelines/${build.id}`).then(value => setBuild(value)).catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [build])

  const projects = useMemo(() => [...new Set(rows.map(row => row.projectName))].sort(), [rows])
  const jobs = useMemo(() => [...new Set(rows.map(row => row.jobName))].sort(), [rows])
  const visible = useMemo(() => rows.filter(row => {
    if (project !== '' && row.projectName !== project) return false
    if (job !== '' && row.jobName !== job) return false
    if (status !== '' && row.status !== status) return false
    if (branch !== '' && !row.refName.toLowerCase().includes(branch.toLowerCase())) return false
    if (query !== '') {
      const haystack = `${row.projectName} ${row.jobName} ${row.refName} ${row.commitHash} ${row.submitReason ?? ''}`.toLowerCase()
      if (!haystack.includes(query.toLowerCase())) return false
    }
    return true
  }), [rows, project, job, status, branch, query])

  const open = (id: number): void => { setSelected(id); setHashBuild(id) }
  const back = (): void => { setSelected(null); setHashBuild(null) }

  if (selected !== null) {
    return (
      <Panel className="smp-list-panel smp-pipeline-detail" title={zh ? '流水线详情' : 'Pipeline details'}>
        <button type="button" className="smp-pipeline-back" onClick={back}>← {zh ? '返回流水线列表' : 'Back to pipelines'}</button>
        {detailLoading && <p className="smp-project-muted">{zh ? '正在读取…' : 'Loading…'}</p>}
        {error !== '' && <p className="smp-project-notice error">{error}</p>}
        {build !== null && <>
          <header className="smp-pipeline-header">
            <div><span className={`smp-build-status ${statusOf(build.status, zh).tone}`}><i />{statusOf(build.status, zh).text}</span><h2>{build.projectName} / {build.jobName} <span>#{build.number}</span></h2></div>
            <div className="smp-pipeline-duration">{duration(build.runningDuration)}</div>
          </header>
          <dl className="smp-pipeline-meta">
            <dt>{zh ? '项目' : 'Project'}</dt><dd>{build.projectName}</dd>
            <dt>{zh ? '分支 / Tag' : 'Ref'}</dt><dd><code>{refLabel(build.refName) || '—'}</code></dd>
            <dt>Commit</dt><dd><code>{shortSha(build.commitHash) || '—'}</code></dd>
            <dt>{zh ? '触发' : 'Trigger'}</dt><dd>{build.submitReason ?? '—'}</dd>
            <dt>{zh ? '提交时间' : 'Submitted'}</dt><dd>{dateTime(build.submitDate, zh)}</dd>
            <dt>{zh ? '结束时间' : 'Finished'}</dt><dd>{dateTime(build.finishDate, zh)}</dd>
            <dt>Agent</dt><dd>{build.agentId === null ? '—' : `#${build.agentId}`}</dd>
          </dl>
          <section className="smp-pipeline-steps"><h3>{zh ? '运行步骤' : 'Steps'}</h3>{build.steps.length === 0 ? <p className="smp-project-muted">{zh ? '暂无步骤信息' : 'No step information'}</p> : <ol>{build.steps.map(step => <li key={step.name}><span className={`smp-step-dot ${statusOf(step.status === 'RUNNING' ? 'RUNNING' : step.status === 'FAILED' ? 'FAILED' : step.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : 'CANCELLED', zh).tone}`} /> <strong>{stepLabel(step.name)}</strong> <span className="smp-project-muted">{step.status.toLowerCase()} · {duration(step.duration)}</span></li>)}</ol>}</section>
          <section className="smp-pipeline-logs"><div className="smp-pipeline-logs-head"><h3>{zh ? '日志' : 'Logs'}</h3><button type="button" className="secondary" onClick={() => setLogsOpen(value => !value)}>{logsOpen ? (zh ? '收起' : 'Hide') : (zh ? '查看日志' : 'Show logs')}</button></div>{logsOpen && <pre>{logs || (zh ? '正在读取日志…' : 'Loading logs…')}</pre>}</section>
        </>}
      </Panel>
    )
  }

  return (
    <Panel className="smp-list-panel" title={zh ? '部署流水线' : 'Deploy pipelines'}>
      <div className="smp-pipeline-toolbar">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索项目、Job、Commit' : 'Search project, job, commit'} />
        <select value={project} onChange={event => setProject(event.target.value)}><option value="">{zh ? '全部项目' : 'All projects'}</option>{projects.map(value => <option key={value}>{value}</option>)}</select>
        <select value={job} onChange={event => setJob(event.target.value)}><option value="">{zh ? '全部 Job' : 'All jobs'}</option>{jobs.map(value => <option key={value}>{value}</option>)}</select>
        <select value={status} onChange={event => setStatus(event.target.value)}><option value="">{zh ? '全部状态' : 'All statuses'}</option>{Object.entries(STATUS_TEXT).map(([key, value]) => <option key={key} value={key}>{zh ? value.zh : value.en}</option>)}</select>
        <input value={branch} onChange={event => setBranch(event.target.value)} placeholder={zh ? '分支 / Tag' : 'Branch / tag'} />
        <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</button>
      </div>
      {loading && <p className="smp-project-muted">{zh ? '正在读取…' : 'Loading…'}</p>}
      {error !== '' && <p className="smp-project-notice error">{error}</p>}
      {!loading && error === '' && visible.length === 0 && <p className="smp-project-muted">{rows.length === 0 ? (zh ? '还没有流水线运行。' : 'No pipeline runs yet.') : (zh ? '没有匹配的流水线。' : 'No matching pipelines.')}</p>}
      {visible.length > 0 && <div className="smp-pipeline-table"><table><thead><tr><th>{zh ? '状态' : 'Status'}</th><th>{zh ? '项目' : 'Project'}</th><th>Job</th><th>{zh ? '分支 / Tag' : 'Ref'}</th><th>Commit</th><th>{zh ? '触发' : 'Trigger'}</th><th>{zh ? '时间' : 'Started'}</th><th>{zh ? '耗时' : 'Duration'}</th></tr></thead><tbody>{visible.map(row => <tr key={row.id} onClick={() => open(row.id)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') open(row.id) }}><td><span className={`smp-build-status ${statusOf(row.status, zh).tone}`}><i />{statusOf(row.status, zh).text}</span></td><td>{row.projectName}</td><td><code>{row.jobName}</code></td><td><code>{refLabel(row.refName) || '—'}</code></td><td><code>{shortSha(row.commitHash)}</code></td><td>{row.submitReason ?? '—'}</td><td>{dateTime(row.runningDate ?? row.submitDate, zh)}</td><td>{duration(row.runningDuration)}</td></tr>)}</tbody></table></div>}
      <div className="smp-pipeline-pager"><button type="button" className="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>{zh ? '上一页' : 'Previous'}</button><span>{zh ? `第 ${offset + 1} 项起` : `From ${offset + 1}`}</span><button type="button" className="secondary" disabled={nextOffset === null || loading} onClick={() => setOffset(nextOffset ?? offset)}>{zh ? '下一页' : 'Next'}</button></div>
    </Panel>
  )
}
