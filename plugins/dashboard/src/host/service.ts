import { randomUUID } from 'node:crypto'
import { convertMinor, decimalFromMinor, isCurrency, parseDecimal } from '../shared/amount.ts'
import type {
  BalanceAccountView,
  CsvImportError,
  CsvImportResult,
  Currency,
  DashboardEvent,
  DashboardSummary,
  FxInfo,
  IngestResult,
  RangeKey,
  SummaryQuery,
  TransactionPage,
  TransactionQuery,
  TransactionStatus,
  TransactionType,
  TransactionView,
} from '../shared/contracts.ts'

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>
}

export interface DashboardConfig {
  defaultCurrency: Currency
  timeZone: string
  fx: {
    provider: 'frankfurter' | 'custom'
    url: string
    apiKey?: string
    refreshSeconds: number
    timeoutMs: number
  }
}

export class DashboardError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.status = status
  }
}

interface AccountRow {
  id: string
  source: string
  provider: string
  display_name: string
  kind: 'cloud' | 'llm' | 'bank' | 'other'
  currency: Currency
  status: 'active' | 'archived'
}

interface BalanceRow {
  id: string
  amount_minor: string
  currency: Currency
  captured_at: Date
}

interface TransactionRow {
  id: string
  title: string
  kind: TransactionType
  amount_minor: string
  currency: Currency
  occurred_at: Date
  source: string
  status: TransactionStatus
  account_name: string | null
}

interface FxRow {
  base: Currency
  quote: Currency
  rate: string
  as_of: Date
  source: 'frankfurter' | 'custom'
}

const RANGE_LABEL: Record<RangeKey, string> = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  month: '本月',
  all: '全部',
}

export function isRange(value: unknown): value is RangeKey {
  return value === '7d' || value === '30d' || value === 'month' || value === 'all'
}

export function rangeBounds(range: RangeKey, now = new Date(), timeZone = 'Asia/Shanghai'): { from: Date | null; to: Date; label: string } {
  if (range === 'all') return { from: null, to: now, label: RANGE_LABEL[range] }
  if (range === 'month') {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const year = parts.find(part => part.type === 'year')?.value ?? '1970'
    const month = parts.find(part => part.type === 'month')?.value ?? '01'
    return { from: new Date(`${year}-${month}-01T00:00:00+08:00`), to: now, label: RANGE_LABEL[range] }
  }
  const days = range === '7d' ? 7 : 30
  return { from: new Date(now.getTime() - days * 86_400_000), to: now, label: RANGE_LABEL[range] }
}

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function cleanText(value: string, max: number): string {
  const text = value.trim()
  if (text === '' || text.length > max) throw new DashboardError('dashboard/invalid', '字段长度不合法')
  return text
}

function cleanCurrency(value: unknown): Currency {
  if (value === undefined) return 'CNY'
  if (!isCurrency(value)) throw new DashboardError('dashboard/currency', '只支持 CNY / USD')
  return value
}

function metadataJson(value: Record<string, unknown> | undefined): string {
  const text = JSON.stringify(value ?? {})
  if (text.length > 8192) throw new DashboardError('dashboard/metadata', 'metadata 过大', 413)
  return text
}

export class FxRateService {
  private readonly pool: Queryable
  private readonly config: DashboardConfig['fx']
  private readonly logger: { warn(error: unknown): void }
  private stopped = false
  private timer?: NodeJS.Timeout

  constructor(pool: Queryable, config: DashboardConfig['fx'], logger: { warn(error: unknown): void }) {
    this.pool = pool
    this.config = config
    this.logger = logger
  }

  start(): () => void {
    this.stopped = false
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, Math.max(60, this.config.refreshSeconds) * 1000)
    return () => {
      this.stopped = true
      if (this.timer !== undefined) clearInterval(this.timer)
    }
  }

  async refresh(): Promise<void> {
    if (this.stopped) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await fetch(this.config.url, {
        signal: controller.signal,
        headers: this.config.apiKey === undefined ? {} : { authorization: `Bearer ${this.config.apiKey}` },
      })
      if (!response.ok) throw new Error(`fx_status_${response.status}`)
      const body = await response.json() as Record<string, unknown>
      const parsed = this.parse(body)
      await this.pool.query(
        `insert into dashboard_fx_rates(base, quote, rate, as_of, fetched_at, source)
         values ($1, $2, $3, $4, now(), $5)
         on conflict (base, quote) do update set rate=excluded.rate, as_of=excluded.as_of, fetched_at=now(), source=excluded.source`,
        [parsed.base, parsed.quote, parsed.rate, parsed.asOf, parsed.source],
      )
    } catch (cause) {
      if (!controller.signal.aborted) this.logger.warn(cause)
    } finally {
      clearTimeout(timer)
    }
  }

  private parse(body: Record<string, unknown>): { base: Currency; quote: Currency; rate: string; asOf: Date; source: 'frankfurter' | 'custom' } {
    if (this.config.provider === 'frankfurter') {
      const rates = body.rates
      const cny = typeof rates === 'object' && rates !== null ? (rates as Record<string, unknown>).CNY : undefined
      if (typeof cny !== 'number' || !Number.isFinite(cny) || cny <= 0) throw new Error('fx_payload')
      const date = typeof body.date === 'string' ? new Date(`${body.date}T00:00:00Z`) : new Date()
      return { base: 'USD', quote: 'CNY', rate: String(cny), asOf: date, source: 'frankfurter' }
    }
    const base = body.base
    const quote = body.quote
    const rate = body.rate
    const asOf = body.asOf
    if (!isCurrency(base) || !isCurrency(quote) || typeof rate !== 'string' || typeof asOf !== 'string') throw new Error('fx_payload')
    const parsed = Number(rate)
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('fx_payload')
    return { base, quote, rate, asOf: new Date(asOf), source: 'custom' }
  }

  async info(display: Currency): Promise<FxInfo | null> {
    if (display === 'CNY') {
      return this.pair('USD', 'CNY')
    }
    return this.pair('USD', 'CNY')
  }

  private async pair(base: Currency, quote: Currency): Promise<FxInfo | null> {
    const result = await this.pool.query<FxRow>(
      'select base,quote,rate::text,as_of,source from dashboard_fx_rates where (base=$1 and quote=$2) or (base=$2 and quote=$1) order by fetched_at desc limit 1',
      [base, quote],
    )
    const row = result.rows[0]
    if (row === undefined) return null
    const direct = row.base === base && row.quote === quote
    const rate = direct ? row.rate : String(1 / Number(row.rate))
    return { base, quote, rate, asOf: row.as_of.toISOString(), source: row.source }
  }

  async rate(from: Currency, to: Currency): Promise<number | null> {
    if (from === to) return 1
    const info = await this.pair(from, to)
    return info === null ? null : Number(info.rate)
  }
}

export class DashboardService {
  private readonly pool: Queryable
  private readonly config: DashboardConfig
  private readonly fx: FxRateService

  constructor(pool: Queryable, config: DashboardConfig, fx: FxRateService) {
    this.pool = pool
    this.config = config
    this.fx = fx
  }

  async ingestMany(events: readonly DashboardEvent[]): Promise<IngestResult[]> {
    if (events.length > 100) throw new DashboardError('dashboard/batch', '单次最多 100 条', 413)
    const results: IngestResult[] = []
    for (const event of events) results.push(await this.ingest(event))
    return results
  }

  async ingest(event: DashboardEvent): Promise<IngestResult> {
    if (event.kind === 'account') return this.account(event)
    if (event.kind === 'balance') return this.balance(event)
    return this.transaction(event)
  }

  private async account(event: Extract<DashboardEvent, { kind: 'account' }>): Promise<IngestResult> {
    const source = cleanText(event.source, 128)
    const externalId = cleanText(event.externalId, 200)
    const provider = cleanText(event.provider, 100)
    const name = cleanText(event.displayName, 200)
    const currency = cleanCurrency(event.currency)
    const kind = event.accountKind ?? 'other'
    const result = await this.pool.query<{ id: string }>(
      `insert into dashboard_accounts(id,source,external_id,provider,display_name,kind,currency)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (source,external_id) do update set provider=excluded.provider,display_name=excluded.display_name,kind=excluded.kind,currency=excluded.currency,updated_at=now()
       returning id`,
      [randomUUID(), source, externalId, provider, name, kind, currency],
    )
    return { id: result.rows[0]?.id ?? '', duplicate: false }
  }

  private async accountId(source: string, externalId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      'select id from dashboard_accounts where source=$1 and external_id=$2',
      [source, externalId],
    )
    return result.rows[0]?.id ?? null
  }

  private async balance(event: Extract<DashboardEvent, { kind: 'balance' }>): Promise<IngestResult> {
    const source = cleanText(event.source, 128)
    const externalId = cleanText(event.externalId, 200)
    const accountId = await this.accountId(source, event.accountExternalId)
    if (accountId === null) throw new DashboardError('dashboard/account', '未知账户', 404)
    const currency = cleanCurrency(event.currency)
    const amount = parseDecimal(event.amount, currency)
    if (amount < 0n) throw new DashboardError('dashboard/amount', '余额不能为负')
    const capturedAt = event.capturedAt === undefined ? new Date() : new Date(event.capturedAt)
    if (Number.isNaN(capturedAt.getTime())) throw new DashboardError('dashboard/time', 'capturedAt 不是有效时间')
    const inserted = await this.pool.query<{ id: string }>(
      `insert into dashboard_balance_snapshots(id,account_id,source,external_id,amount_minor,currency,captured_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (source,external_id) do nothing returning id`,
      [randomUUID(), accountId, source, externalId, amount.toString(), currency, capturedAt],
    )
    if (inserted.rows[0] !== undefined) return { id: inserted.rows[0].id, duplicate: false }
    const existing = await this.pool.query<{ id: string }>('select id from dashboard_balance_snapshots where source=$1 and external_id=$2', [source, externalId])
    return { id: existing.rows[0]?.id ?? '', duplicate: true }
  }

  private async transaction(event: Extract<DashboardEvent, { kind: 'transaction' }>): Promise<IngestResult> {
    const source = cleanText(event.source, 128)
    const externalId = cleanText(event.externalId, 200)
    const title = cleanText(event.title, 200)
    const currency = cleanCurrency(event.currency)
    const amount = parseDecimal(event.amount, currency)
    if (amount <= 0n) throw new DashboardError('dashboard/amount', '金额必须大于 0')
    const occurredAt = new Date(event.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) throw new DashboardError('dashboard/time', 'occurredAt 不是有效时间')
    const accountId = event.accountExternalId === undefined ? null : await this.accountId(source, event.accountExternalId)
    if (event.accountExternalId !== undefined && accountId === null) throw new DashboardError('dashboard/account', '未知账户', 404)
    const inserted = await this.pool.query<{ id: string }>(
      `insert into dashboard_transactions(id,source,external_id,account_id,kind,title,amount_minor,currency,occurred_at,status,metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (source,external_id) do nothing returning id`,
      [randomUUID(), source, externalId, accountId, event.type, title, amount.toString(), currency, occurredAt, event.status ?? 'posted', metadataJson(event.metadata)],
    )
    if (inserted.rows[0] !== undefined) return { id: inserted.rows[0].id, duplicate: false }
    const existing = await this.pool.query<{ id: string }>('select id from dashboard_transactions where source=$1 and external_id=$2', [source, externalId])
    return { id: existing.rows[0]?.id ?? '', duplicate: true }
  }

  async summary(query: SummaryQuery): Promise<DashboardSummary> {
    const display = query.currency
    const bounds = rangeBounds(query.range, new Date(), this.config.timeZone)
    const fx = await this.fx.info(display)
    const warnings: string[] = []
    const accounts = await this.pool.query<AccountRow>(
      `select a.id,a.source,a.provider,a.display_name,a.kind,a.currency,a.status,
              s.amount_minor,s.currency as snapshot_currency,s.captured_at
       from dashboard_accounts a
       left join lateral (
         select amount_minor,currency,captured_at from dashboard_balance_snapshots
         where account_id=a.id order by captured_at desc,id desc limit 1
       ) s on true
       where a.status='active'
       order by a.provider,a.display_name`,
    )
    const accountViews: BalanceAccountView[] = []
    let balanceMinor = 0n
    let asOf = 0
    for (const row of accounts.rows) {
      const amountRaw = (row as AccountRow & { amount_minor?: string; snapshot_currency?: Currency; captured_at?: Date }).amount_minor
      const nativeCurrency = (row as AccountRow & { snapshot_currency?: Currency }).snapshot_currency ?? row.currency
      if (amountRaw === undefined) {
        accountViews.push({ id: row.id, provider: row.provider, name: row.display_name, nativeAmount: '0.00', nativeCurrency, amount: '0.00', asOf: null })
        continue
      }
      const native = BigInt(amountRaw)
      const rate = await this.fx.rate(nativeCurrency, display)
      const converted = rate === null ? undefined : convertMinor(native, nativeCurrency, display, rate)
      if (converted === undefined) warnings.push(`missing_fx:${nativeCurrency}`)
      else balanceMinor += converted
      const captured = (row as AccountRow & { captured_at?: Date }).captured_at
      if (captured !== undefined) asOf = Math.max(asOf, captured.getTime())
      accountViews.push({
        id: row.id,
        provider: row.provider,
        name: row.display_name,
        nativeAmount: decimalFromMinor(native, nativeCurrency),
        nativeCurrency,
        amount: converted === undefined ? '0.00' : decimalFromMinor(converted, display),
        asOf: captured?.toISOString() ?? null,
      })
    }

    const rows = await this.transactionsInRange(bounds.from, bounds.to)
    let investedMinor = 0n
    let incomeMinor = 0n
    const daily = new Map<string, { income: bigint; expense: bigint }>()
    for (const row of rows) {
      const rate = await this.fx.rate(row.currency, display)
      if (rate === null) {
        warnings.push(`missing_fx:${row.currency}`)
        continue
      }
      const amount = convertMinor(BigInt(row.amount_minor), row.currency, display, rate)
      const key = dateKey(row.occurred_at, this.config.timeZone)
      const bucket = daily.get(key) ?? { income: 0n, expense: 0n }
      if (row.kind === 'expense') {
        investedMinor += amount
        bucket.expense += amount
      } else {
        incomeMinor += amount
        bucket.income += amount
      }
      daily.set(key, bucket)
    }
    const series = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({
        date,
        income: decimalFromMinor(values.income, display),
        expense: decimalFromMinor(values.expense, display),
      }))
    const recent = rows.slice(0, 8).map(row => this.toView(row, display, fx))

    return {
      asOf: new Date(asOf || Date.now()).toISOString(),
      displayCurrency: display,
      fx,
      range: { from: bounds.from?.toISOString() ?? null, to: bounds.to.toISOString(), label: bounds.label },
      balance: { amount: decimalFromMinor(balanceMinor, display), accountCount: accountViews.length, accounts: accountViews },
      invested: { amount: decimalFromMinor(investedMinor, display) },
      profit: { amount: decimalFromMinor(incomeMinor - investedMinor, display) },
      series,
      warnings: [...new Set(warnings)],
      recent,
    }
  }

  private async transactionsInRange(from: Date | null, to: Date): Promise<TransactionRow[]> {
    const params: unknown[] = [to]
    let sql = `select t.id,t.title,t.kind,t.amount_minor,t.currency,t.occurred_at,t.source,t.status,a.display_name as account_name
      from dashboard_transactions t left join dashboard_accounts a on a.id=t.account_id
      where t.status='posted' and t.occurred_at <= $1`
    if (from !== null) {
      params.push(from)
      sql += ' and t.occurred_at >= $2'
    }
    sql += ' order by t.occurred_at desc,t.id desc'
    const result = await this.pool.query<TransactionRow>(sql, params)
    return result.rows
  }

  async transactions(query: TransactionQuery): Promise<TransactionPage> {
    const bounds = rangeBounds(query.range, new Date(), this.config.timeZone)
    const fx = await this.fx.info(query.currency)
    const params: unknown[] = []
    const where: string[] = []
    if (query.status !== undefined && query.status !== 'all') where.push(`t.status = $${params.push(query.status)}`)
    if (query.type !== undefined && query.type !== 'all') where.push(`t.kind = $${params.push(query.type)}`)
    if (query.source !== undefined && query.source !== '') where.push(`t.source = $${params.push(query.source)}`)
    if (query.accountId !== undefined && query.accountId !== '') where.push(`t.account_id = $${params.push(query.accountId)}`)
    if (bounds.from !== null) where.push(`t.occurred_at >= $${params.push(bounds.from)}`)
    where.push(`t.occurred_at <= $${params.push(bounds.to)}`)
    if (query.cursor !== undefined) where.push(`(t.occurred_at, t.id) < ($${params.push(new Date(query.cursor))}, $${params.push(query.cursor)})`)
    const limit = Math.min(100, Math.max(1, query.limit))
    const rows = await this.pool.query<TransactionRow>(
      `select t.id,t.title,t.kind,t.amount_minor,t.currency,t.occurred_at,t.source,t.status,a.display_name as account_name
       from dashboard_transactions t left join dashboard_accounts a on a.id=t.account_id
       where ${where.join(' and ')} order by t.occurred_at desc,t.id desc limit ${limit + 1}`,
      params,
    )
    const items = rows.rows.slice(0, limit).map(row => this.toView(row, query.currency, fx))
    return { items, nextCursor: rows.rows.length > limit ? rows.rows[limit - 1]?.occurred_at.toISOString() ?? null : null }
  }

  private toView(row: TransactionRow, display: Currency, fx: FxInfo | null): TransactionView {
    const native = BigInt(row.amount_minor)
    const rate = fx === null
      ? null
      : row.currency === display
        ? 1
        : fx.base === row.currency && fx.quote === display
          ? Number(fx.rate)
          : fx.base === display && fx.quote === row.currency
            ? 1 / Number(fx.rate)
            : null
    const converted = rate === null ? 0n : convertMinor(native, row.currency, display, rate)
    return {
      id: row.id,
      title: row.title,
      type: row.kind,
      amount: decimalFromMinor(converted, display),
      nativeAmount: decimalFromMinor(native, row.currency),
      nativeCurrency: row.currency,
      occurredAt: row.occurred_at.toISOString(),
      source: row.source,
      accountName: row.account_name,
      status: row.status,
    }
  }

  async importCsv(text: string): Promise<CsvImportResult> {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
    const errors: CsvImportError[] = []
    let imported = 0
    let duplicates = 0
    if (lines.length === 0) return { imported, duplicates, failed: 0, errors }
    const header = splitCsv(lines[0]!).map(cell => cell.trim())
    const index = (name: string) => header.indexOf(name)
    for (let i = 1; i < lines.length; i += 1) {
      const cells = splitCsv(lines[i]!)
      const field = (name: string) => cells[index(name)]?.trim() ?? ''
      try {
        const event: DashboardEvent = {
          kind: 'transaction',
          source: '@smp/console-dashboard:csv',
          externalId: cleanText(field('external_id'), 200),
          type: field('type') === 'income' ? 'income' : field('type') === 'expense' ? 'expense' : (() => { throw new DashboardError('dashboard/csv', 'type 必须是 income/expense') })(),
          title: cleanText(field('title'), 200),
          amount: field('amount'),
          currency: cleanCurrency(field('currency')),
          occurredAt: field('occurred_at'),
          status: 'posted',
        }
        const result = await this.ingest(event)
        if (result.duplicate) duplicates += 1
        else imported += 1
      } catch (cause) {
        errors.push({ line: i + 1, code: cause instanceof DashboardError ? cause.code : 'dashboard/csv', detail: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    return { imported, duplicates, failed: errors.length, errors }
  }
}

function splitCsv(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1 }
      else quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells
}
