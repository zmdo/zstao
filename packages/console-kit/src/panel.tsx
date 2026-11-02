import type { ReactNode } from 'react'

/** Console card. Pages use this instead of copying the panel markup. */
export function Panel(props: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={props.className ? `panel ${props.className}` : 'panel'}>
      {props.title !== undefined && (
        <header className="panel-head">
          <h1><i className="mark" />{props.title}</h1>
          {props.extra}
        </header>
      )}
      <div className="panel-body">{props.children}</div>
    </section>
  )
}

/** Wraps a Harness settings section so it sits in the same card as Panel. */
export function Surface(props: { children: ReactNode }) {
  return <section className="panel smp-surface">{props.children}</section>
}
