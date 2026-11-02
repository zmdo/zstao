import { format, serverCopy } from '../../shared/i18n.ts'

export function Pager(props: {
  active: string
  page: number
  total: number
  onPage: (page: number) => void
  className?: string
  pageSize?: number
  onPageSize?: (size: number) => void
}) {
  const c = serverCopy(props.active).upgrades
  return (
    <footer className={`smp-server-pager${props.className ? ` ${props.className}` : ''}`}>
      <span>{format(c.page, { page: props.page, count: props.total })}</span>
      <div className="row">
        {props.pageSize !== undefined && props.onPageSize !== undefined && (
          <label>
            {serverCopy(props.active).ui.perPage}
            <select
              aria-label={serverCopy(props.active).ui.perPage}
              value={props.pageSize}
              onChange={(event) => props.onPageSize!(Number(event.target.value))}
            >
              {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        )}
        <button className="secondary" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>
          {c.previous}
        </button>
        <button
          className="secondary"
          disabled={props.page * (props.pageSize ?? 20) >= props.total}
          onClick={() => props.onPage(props.page + 1)}
        >
          {c.next}
        </button>
      </div>
    </footer>
  )
}
