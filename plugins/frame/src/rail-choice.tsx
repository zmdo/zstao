import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { PageRoute } from './pages.ts'

interface RailChoiceProps {
  label: string
  icon: ReactNode
  active: boolean
  pages: readonly PageRoute[]
  current: string
  expanded: boolean
  onShow(): void
  onHide(): void
  onOpen(): void
  onSelect(key: string): void
}

/** The portal escapes sidebar clipping; its transparent padding bridges the pointer into the panel. */
export function RailChoice(props: RailChoiceProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const focusPending = useRef(false)
  const id = useId()
  const [position, setPosition] = useState<{ left: number; top: number }>()
  const hasPages = props.pages.length > 0
  const open = props.expanded && hasPages

  function cancelClose() {
    clearTimeout(timer.current)
  }
  function show() {
    cancelClose()
    if (hasPages) props.onShow()
  }
  function hide(returnFocus = false) {
    cancelClose()
    props.onHide()
    if (returnFocus) trigger.current?.focus({ preventScroll: true })
  }
  function leave() {
    cancelClose()
    timer.current = setTimeout(() => props.onHide(), 150)
  }
  function blur(next: EventTarget | null) {
    if (next instanceof Node && (trigger.current?.contains(next) || panel.current?.contains(next))) return
    hide()
  }

  useEffect(() => () => clearTimeout(timer.current), [open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(undefined)
      return
    }
    const anchor = trigger.current
    const surface = panel.current
    if (!anchor || !surface) return
    const place = () => {
      const target = anchor.getBoundingClientRect()
      const bounds = surface.getBoundingClientRect()
      const left = Math.max(8, Math.min(target.right, window.innerWidth - bounds.width - 8))
      const top = Math.max(8, Math.min(target.top, window.innerHeight - bounds.height - 8))
      setPosition((previous) => (previous?.left === left && previous.top === top ? previous : { left, top }))
    }
    place()
    const resize = new ResizeObserver(place)
    resize.observe(anchor)
    resize.observe(surface)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, props.pages])

  useLayoutEffect(() => {
    if (!open || !position || !focusPending.current) return
    focusPending.current = false
    const selected = panel.current?.querySelector<HTMLButtonElement>('button[aria-current="page"]')
    const button = selected ?? panel.current?.querySelector<HTMLButtonElement>('button')
    button?.focus()
  }, [open, position])

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        props.onHide()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      props.onHide()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, props.onHide])

  function keyDown(event: ReactKeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hide(true)
      return
    }
    const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const current = buttons.findIndex((button) => button === document.activeElement)
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % buttons.length
        : event.key === 'ArrowUp'
          ? (current - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1
    if (next >= 0 && buttons.length) {
      event.preventDefault()
      buttons[next]?.focus()
    }
  }

  return (
    <>
      <button
        ref={trigger}
        className={`rail-item${props.active ? ' is-on' : ''}`}
        type="button"
        aria-label={props.label}
        title={hasPages ? undefined : props.label}
        aria-expanded={hasPages ? open : undefined}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show()
        }}
        onPointerLeave={leave}
        onBlur={(event) => blur(event.relatedTarget)}
        onClick={() => {
          hide()
          props.onOpen()
        }}
        onKeyDown={(event) => {
          if (hasPages && ['ArrowRight', 'ArrowDown'].includes(event.key)) {
            event.preventDefault()
            if (open) panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
            else {
              focusPending.current = true
              show()
            }
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            hide()
          }
        }}
      >
        {props.icon}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            className="smp-sidebar-flyout"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? undefined : 'hidden',
            }}
            onPointerEnter={show}
            onPointerLeave={leave}
            onBlur={(event) => blur(event.relatedTarget)}
            onKeyDown={keyDown}
          >
            <nav className="smp-sidebar-flyout-panel" aria-label={props.label}>
              <div className="smp-sidebar-flyout-title" aria-hidden="true">
                {props.label}
              </div>
              {props.pages.map((page) => (
                <button
                  key={page.key}
                  type="button"
                  className={`smp-sidebar-flyout-item${page.key === props.current ? ' is-on' : ''}`}
                  aria-current={page.key === props.current ? 'page' : undefined}
                  onClick={() => {
                    hide()
                    props.onSelect(page.key)
                  }}
                >
                  {page.label}
                </button>
              ))}
            </nav>
          </div>,
          document.body,
        )}
    </>
  )
}
