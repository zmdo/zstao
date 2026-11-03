import { useEffect, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { compactMoney, formatAmount, money } from '../shared/amount.ts'
import type { Currency, DashboardSummary, RangeKey, TransactionPage, TransactionStatus, TransactionType, TransactionView } from '../shared/contracts.ts'
import { importCsv, summary, transactions } from './api.ts'
import styles from './dashboard.css'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

const RANGES: Array<{ key: RangeKey; zh: string; en: string }> = [
  { key: '7d', zh: '近 7 天', en: '7 days' },
  { key: '30d', zh: '近 30 天', en: '30 days' },
  { key: 'month', zh: '本月', en: 'This month' },
  { key: 'all', zh: '全部', en: 'All' },
]

function copyOf(active: string) {
  const zh = active !== 'en'
  return {
    title: zh ? '仪表盘' : 'Dashboard',
    balance: zh ? '账户余额' : 'Account balance',
    invested: zh ? '投入金额' : 'Spending',
    profit: zh ? '盈利金额' : 'Profit',
    accounts: zh ? '个账户' : 'accounts',
    asOf: zh ? '截至' : 'as of',
    range: zh ? '统计范围' : 'Range',
    refresh: zh ? '刷新' : 'Refresh',
    empty: zh ? '还没有数据，先从其他插件推送账户和单据吧。' : 'No data yet. Push accounts and receipts from another plugin.',
    recent: zh ? '最近单据' : 'Recent receipts',
    viewAll: zh ? '查看全部' : 'View all',
    transactions: zh ? '全部单据' : 'All receipts',
    back: zh ? '返回仪表盘' : 'Back to dashboard',
    import: zh ? '导入 CSV' : 'Import CSV',
    noReceipts: zh ? '还没有单据' : 'No receipts yet',
    noChart: zh ? '暂无趋势数据' : 'No trend data',
    income: zh ? '产出' : 'Income',
    expense: zh ? '投入' : 'Spending',
    net: zh ? '净额' : 'Net',
    loading: zh ? '正在加载…' : 'Loading…',
    filterAll: zh ? '全部' : 'All',
    incomeOption: zh ? '收入' : 'Income',
    expenseOption: zh ? '支出' : 'Spending',
    source: zh ? '来源' : 'Source',
    account: zh ? '账户' : 'Account',
    status: zh ? '状态' : 'Status',
    date: zh ? '时间' : 'Date',
    subject: zh ? '标题' : 'Title',
    type: zh ? '类型' : 'Type',
    amount: zh ? '金额' : 'Amount',
    loadMore: zh ? '加载更多' : 'Load more',
    imported: zh ? '导入完成' : 'Import complete',
    importHint: zh ? 'CSV 第一行需要表头：external_id,type,title,amount,currency,occurred_at' : 'CSV header: external_id,type,title,amount,currency,occurred_at',
    importFile: zh ? '选择 CSV 文件' : 'Choose CSV file',
    importRun: zh ? '开始导入' : 'Import',
    cancel: zh ? '取消' : 'Cancel',
    close: zh ? '关闭' : 'Close',
    fxMissing: zh ? '缺少汇率，部分金额未计入' : 'Missing FX rate; some amounts are excluded',
    fx: zh ? '汇率' : 'FX',
    sources: zh ? '来源' : 'Source',
    currency: zh ? '币种' : 'Currency',
    noTransactions: zh ? '没有符合条件的单据' : 'No matching receipts',
    failed: zh ? '失败' : 'failed',
    duplicate: zh ? '重复' : 'duplicates',
    success: zh ? '成功' : 'imported',
  }
}

function useDashboardCopy(locale: LocaleFace) {
  const [active, setActive] = useState(locale.getSnapshot().active)
  useEffect(() => {
    setActive(locale.getSnapshot().active)
    return locale.subscribe(() => setActive(locale.getSnapshot().active))
  }, [locale])
  return copyOf(active)
}

export function installDashboardStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-dashboard'
  tag.textContent = styles
  document.head.append(tag)
  return () => tag.remove()
}

export function DashboardPage(props: { locale: LocaleFace }) {
  const copy = useDashboardCopy(props.locale)
  const [range, setRange] = useState<RangeKey>(() => {
    const saved = localStorage.getItem('smp-dashboard-range')
    return saved === '7d' || saved === '30d' || saved === 'month' || saved === 'all' ? saved : '30d'
  })
  const [currency, setCurrency] = useState<Currency>(() => localStorage.getItem('smp-dashboard-currency') === 'USD' ? 'USD' : 'CNY')
  const [data, setData] = useState<DashboardSummary>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<'overview' | 'transactions'>('overview')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    summary({ range, currency }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setData(next) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [range, currency, reload])

  useEffect(() => {
    const timer = window.setInterval(() => setReload(value => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => { localStorage.setItem('smp-dashboard-range', range) }, [range])
  useEffect(() => { localStorage.setItem('smp-dashboard-currency', currency) }, [currency])

  const changeRange = (next: RangeKey) => { setRange(next); setView('overview') }
  const setRangeOnly = (next: RangeKey) => setRange(next)
  const setCurrencyOnly = (next: Currency) => setCurrency(next)
  const changeCurrency = (next: Currency) => { setCurrency(next); setView('overview') }

  if (view === 'transactions') {
    return <TransactionsPage copy={copy} locale={props.locale} range={range} currency={currency} onBack={() => setView('overview')} onRange={setRangeOnly} onCurrency={setCurrencyOnly} />
  }

  return (
    <div className="smp-dashboard">
      <header className="smp-dashboard-head">
        <div>
          <p className="smp-dashboard-eyebrow">CES · {copy.title}</p>
          <h1>{copy.title}</h1>
        </div>
        <div className="smp-dashboard-actions">
          <div className="smp-dashboard-segment" role="group" aria-label={copy.currency}>
            {(['CNY', 'USD'] as const).map(value => (
              <button key={value} type="button" className={currency === value ? 'is-on' : ''} onClick={() => changeCurrency(value)}>{value}</button>
            ))}
          </div>
          <div className="smp-dashboard-segment" role="group" aria-label={copy.range}>
            {RANGES.map(item => <button key={item.key} type="button" className={range === item.key ? 'is-on' : ''} onClick={() => changeRange(item.key)}>{item[props.locale.getSnapshot().active === 'en' ? 'en' : 'zh']}</button>)}
          </div>
          <button type="button" className="smp-dashboard-btn" onClick={() => setReload(value => value + 1)} disabled={loading}>{copy.refresh}</button>
        </div>
      </header>
      {error !== '' && <div className="smp-dashboard-banner is-error">{error}</div>}
      {data?.warnings?.some(item => item.startsWith('missing_fx:')) ? <div className="smp-dashboard-banner">{copy.fxMissing} · {data.fx === null ? copy.fxMissing : `${copy.fx} ${data.fx.rate}`}</div> : null}
      {data === undefined && loading ? <div className="smp-dashboard-loading">{copy.loading}</div> : data === undefined ? <div className="smp-dashboard-empty">{copy.empty}</div> : (
        <>
          <section className="smp-dashboard-kpis" aria-label={copy.title}>
            <Kpi label={copy.balance} value={formatAmount(data.balance.amount, data.displayCurrency)} hint={`${data.balance.accountCount} ${copy.accounts} · ${copy.asOf} ${new Date(data.asOf).toLocaleTimeString(props.locale.getSnapshot().active === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}`} tone="balance" />
            <Kpi label={copy.invested} value={formatAmount(data.invested.amount, data.displayCurrency)} hint={data.range.label} tone="expense" />
            <Kpi label={copy.profit} value={formatAmount(data.profit.amount, data.displayCurrency)} hint={`${data.range.label} · ${data.fx === null ? '' : `${copy.fx} ${data.fx.rate}`}`} tone={data.profit.amount.startsWith('-') ? 'loss' : 'profit'} />
          </section>
          {data.balance.accounts.length === 0 && data.recent.length === 0 ? <div className="smp-dashboard-empty">{copy.empty}</div> : (
            <div className="smp-dashboard-grid">
              <Panel className="smp-dashboard-chart-panel" title={copy.invested + ' / ' + copy.income} extra={<span className="smp-dashboard-legend"><i className="is-expense" />{copy.expense}<i className="is-income" />{copy.income}</span>}>
                <TrendChart data={data} copy={copy} locale={props.locale} />
              </Panel>
              <Panel className="smp-dashboard-recent-panel" title={copy.recent} extra={<button type="button" className="link" onClick={() => setView('transactions')}>{copy.viewAll}</button>}>
                <RecentReceipts items={data.recent} copy={copy} locale={props.locale} currency={data.displayCurrency} />
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Kpi(props: { label: string; value: string; hint: string; tone: 'balance' | 'expense' | 'profit' | 'loss' }) {
  return (
    <article className={`smp-dashboard-kpi is-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.hint}</small>
    </article>
  )
}

function TrendChart(props: { data: DashboardSummary; copy: ReturnType<typeof copyOf>; locale: LocaleFace }) {
  const width = 720
  const height = 240
  const padding = { left: 48, right: 12, top: 16, bottom: 28 }
  const series = props.data.series
  const values = series.flatMap(point => [Number(point.expense), Number(point.income)])
  const max = Math.max(1, ...values)
  const x = (index: number) => padding.left + (series.length <= 1 ? 0 : index * ((width - padding.left - padding.right) / (series.length - 1)))
  const y = (value: number) => height - padding.bottom - (value / max) * (height - padding.top - padding.bottom)
  const path = (key: 'expense' | 'income') => series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(Number(point[key]))}`).join(' ')
  const last = series[series.length - 1]
  return (
    <div className="smp-dashboard-chart">
      {series.length === 0 ? <div className="smp-dashboard-chart-empty">{props.copy.noChart}</div> : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.copy.invested + ' / ' + props.copy.income}>
          {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const lineY = padding.top + ratio * (height - padding.top - padding.bottom)
            const value = max * (1 - ratio)
            return (
              <g key={ratio}>
                <line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} className="smp-dashboard-gridline" />
                <text x={padding.left - 8} y={lineY + 3} textAnchor="end" className="smp-dashboard-axis">{compactMoney(String(Math.round(value * 100)), props.data.displayCurrency)}</text>
              </g>
            )
          })}
          {series.map((point, index) => index % Math.max(1, Math.ceil(series.length / 5)) === 0 ? <text key={point.date} x={x(index)} y={height - 8} textAnchor="middle" className="smp-dashboard-axis">{point.date.slice(5)}</text> : null)}
          <path d={path('expense')} className="smp-dashboard-line is-expense" />
          <path d={path('income')} className="smp-dashboard-line is-income" />
          {last !== undefined && <circle cx={x(series.length - 1)} cy={y(Number(last.expense))} r="3" className="smp-dashboard-dot is-expense" />}
          {last !== undefined && <circle cx={x(series.length - 1)} cy={y(Number(last.income))} r="3" className="smp-dashboard-dot is-income" />}
        </svg>
      )}
    </div>
  )
}

function RecentReceipts(props: { items: TransactionView[]; copy: ReturnType<typeof copyOf>; locale: LocaleFace; currency: Currency }) {
  if (props.items.length === 0) return <p className="smp-dashboard-empty-small">{props.copy.noReceipts}</p>
  return (
    <div className="smp-dashboard-receipts">
      {props.items.map(item => (
        <article key={item.id} className="smp-dashboard-receipt">
          <div className="smp-dashboard-receipt-main">
            <strong>{item.title}</strong>
            <small>{item.accountName ?? item.source} · {new Date(item.occurredAt).toLocaleString(props.locale.getSnapshot().active === 'en' ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit' })}</small>
          </div>
          <span className={`smp-dashboard-amount is-${item.type}`}>{item.type === 'income' ? '+' : '-'}{formatAmount(item.amount, props.currency, props.locale.getSnapshot().active === 'en' ? 'en-US' : 'zh-CN')}</span>
        </article>
      ))}
    </div>
  )
}

function TransactionsPage(props: {
  copy: ReturnType<typeof copyOf>
  locale: LocaleFace
  range: RangeKey
  currency: Currency
  onBack(): void
  onRange(range: RangeKey): void
  onCurrency(currency: Currency): void
}) {
  const [type, setType] = useState<TransactionType | 'all'>('all')
  const [status, setStatus] = useState<TransactionStatus | 'all'>('all')
  const [source, setSource] = useState('')
  const [page, setPage] = useState<TransactionPage>({ items: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [importing, setImporting] = useState(false)
  const active = props.locale.getSnapshot().active === 'en' ? 'en' : 'zh'

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    transactions({ range: props.range, currency: props.currency, limit: 50, type, status, source }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setPage(next) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [props.range, props.currency, type, status, source, reload])

  const more = async () => {
    if (page.nextCursor === null) return
    try {
      const next = await transactions({ range: props.range, currency: props.currency, limit: 50, type, status, source, cursor: page.nextCursor })
      setPage(current => ({ items: [...current.items, ...next.items], nextCursor: next.nextCursor }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="smp-dashboard smp-dashboard-transactions">
      <header className="smp-dashboard-head">
        <div>
          <button type="button" className="link" onClick={props.onBack}>← {props.copy.back}</button>
          <h1>{props.copy.transactions}</h1>
        </div>
        <div className="smp-dashboard-actions">
          <div className="smp-dashboard-segment">
            {(['CNY', 'USD'] as const).map(value => <button key={value} type="button" className={props.currency === value ? 'is-on' : ''} onClick={() => props.onCurrency(value)}>{value}</button>)}
          </div>
          <div className="smp-dashboard-segment">
            {RANGES.map(item => <button key={item.key} type="button" className={props.range === item.key ? 'is-on' : ''} onClick={() => props.onRange(item.key)}>{item[active]}</button>)}
          </div>
          <button type="button" className="smp-dashboard-btn" onClick={() => setImporting(true)}>{props.copy.import}</button>
        </div>
      </header>
      {error !== '' && <div className="smp-dashboard-banner is-error">{error}</div>}
      <div className="smp-dashboard-filters">
        <label>{props.copy.type}<select value={type} onChange={event => setType(event.target.value as TransactionType | 'all')}><option value="all">{props.copy.filterAll}</option><option value="income">{props.copy.incomeOption}</option><option value="expense">{props.copy.expenseOption}</option></select></label>
        <label>{props.copy.status}<select value={status} onChange={event => setStatus(event.target.value as TransactionStatus | 'all')}><option value="all">{props.copy.filterAll}</option><option value="posted">posted</option><option value="pending">pending</option><option value="void">void</option></select></label>
        <label>{props.copy.source}<input value={source} onChange={event => setSource(event.target.value)} placeholder="source" /></label>
        <button type="button" className="smp-dashboard-btn" onClick={() => setReload(value => value + 1)} disabled={loading}>{props.copy.refresh}</button>
      </div>
      <div className="smp-dashboard-table-wrap">
        <table className="smp-dashboard-table">
          <thead><tr><th>{props.copy.date}</th><th>{props.copy.subject}</th><th>{props.copy.source}</th><th>{props.copy.type}</th><th>{props.copy.amount}</th></tr></thead>
          <tbody>
            {page.items.map(item => (
              <tr key={item.id}>
                <td>{new Date(item.occurredAt).toLocaleDateString(active === 'en' ? 'en-US' : 'zh-CN')}</td>
                <td>{item.title}</td>
                <td>{item.accountName ?? item.source}</td>
                <td>{item.type === 'income' ? props.copy.incomeOption : props.copy.expenseOption}</td>
                <td className={`smp-dashboard-amount is-${item.type}`}>{item.type === 'income' ? '+' : '-'}{formatAmount(item.amount, props.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && page.items.length === 0 ? <p className="smp-dashboard-empty-small">{props.copy.noTransactions}</p> : null}
      </div>
      <div className="smp-dashboard-pager">
        <button type="button" className="smp-dashboard-btn" disabled={loading || page.nextCursor === null} onClick={() => { void more() }}>{props.copy.loadMore}</button>
      </div>
      {importing ? <ImportDialog copy={props.copy} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setReload(value => value + 1) }} /> : null}
    </div>
  )
}

function ImportDialog(props: { copy: ReturnType<typeof copyOf>; onClose(): void; onDone(): void }) {
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ imported: number; duplicates: number; failed: number }>()
  const run = async () => {
    if (file === undefined) return
    setBusy(true)
    setError('')
    try {
      const text = await file.text()
      const next = await importCsv(text)
      setResult(next)
      if (next.failed === 0) props.onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="smp-dashboard-modal" role="dialog" aria-modal="true" aria-label={props.copy.import} onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
      <div className="smp-dashboard-modal-card">
        <header><h2>{props.copy.import}</h2><button type="button" className="link" onClick={props.onClose}>{props.copy.close}</button></header>
        <p className="smp-dashboard-muted">{props.copy.importHint}</p>
        <input type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0])} />
        {error !== '' && <p className="smp-dashboard-banner is-error">{error}</p>}
        {result !== undefined && <p className="smp-dashboard-banner">{props.copy.imported}: {result.imported} · {props.copy.duplicate}: {result.duplicates} · {props.copy.failed}: {result.failed}</p>}
        <footer><button type="button" className="smp-dashboard-btn" onClick={props.onClose}>{props.copy.cancel}</button><button type="button" className="smp-dashboard-btn is-primary" disabled={file === undefined || busy} onClick={() => { void run() }}>{props.copy.importRun}</button></footer>
      </div>
    </div>
  )
}
