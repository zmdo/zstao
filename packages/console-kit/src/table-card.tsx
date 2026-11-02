import type { ReactNode } from 'react'

export function TableCard(props: {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  ariaLabel?: string
  className?: string
}) {
  return (
    <section
      className={`smp-table-card${props.className ? ` ${props.className}` : ''}`}
      aria-label={props.ariaLabel}
    >
      {props.title !== undefined && (
        <header>
          <h2>{props.title}</h2>
          {props.extra !== undefined && <span>{props.extra}</span>}
        </header>
      )}
      {props.children}
    </section>
  )
}
