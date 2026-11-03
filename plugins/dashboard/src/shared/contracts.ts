export type Currency = 'CNY' | 'USD'
export type RangeKey = '7d' | '30d' | 'month' | 'all'
export type TransactionType = 'income' | 'expense'
export type TransactionStatus = 'posted' | 'pending' | 'void'

export interface DashboardAccount {
  id: string
  source: string
  provider: string
  name: string
  kind: 'cloud' | 'llm' | 'bank' | 'other'
  currency: Currency
  status: 'active' | 'archived'
}

export interface DashboardEventAccount {
  kind: 'account'
  source: string
  externalId: string
  provider: string
  displayName: string
  accountKind?: 'cloud' | 'llm' | 'bank' | 'other'
  currency?: Currency
}

export interface DashboardEventBalance {
  kind: 'balance'
  source: string
  externalId: string
  accountExternalId: string
  amount: string
  currency?: Currency
  capturedAt?: string
}

export interface DashboardEventTransaction {
  kind: 'transaction'
  source: string
  externalId: string
  accountExternalId?: string
  type: TransactionType
  title: string
  amount: string
  currency?: Currency
  occurredAt: string
  status?: TransactionStatus
  metadata?: Record<string, unknown>
}

export type DashboardEvent = DashboardEventAccount | DashboardEventBalance | DashboardEventTransaction

export interface IngestResult {
  id: string
  duplicate: boolean
}

export interface FxInfo {
  base: Currency
  quote: Currency
  rate: string
  asOf: string
  source: 'frankfurter' | 'custom'
}

export interface BalanceAccountView {
  id: string
  provider: string
  name: string
  nativeAmount: string
  nativeCurrency: Currency
  amount: string
  asOf: string | null
}

export interface TransactionView {
  id: string
  title: string
  type: TransactionType
  amount: string
  nativeAmount: string
  nativeCurrency: Currency
  occurredAt: string
  source: string
  accountName: string | null
  status: TransactionStatus
}

export interface DashboardSummary {
  asOf: string
  displayCurrency: Currency
  fx: FxInfo | null
  range: { from: string | null; to: string; label: string }
  balance: {
    amount: string
    accountCount: number
    accounts: BalanceAccountView[]
  }
  invested: { amount: string }
  profit: { amount: string }
  series: Array<{ date: string; income: string; expense: string }>
  warnings: string[]
  recent: TransactionView[]
}

export interface TransactionPage {
  items: TransactionView[]
  nextCursor: string | null
}

export interface SummaryQuery {
  range: RangeKey
  currency: Currency
}

export interface TransactionQuery extends SummaryQuery {
  limit: number
  cursor?: string
  type?: TransactionType | 'all'
  source?: string
  accountId?: string
  status?: TransactionStatus | 'all'
}

export interface CsvImportError {
  line: number
  code: string
  detail: string
}

export interface CsvImportResult {
  imported: number
  duplicates: number
  failed: number
  errors: CsvImportError[]
}
