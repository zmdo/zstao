import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface DialogProps {
  open: boolean
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  description?: string
  className?: string
  contentClassName?: string
}

/** Harness-style centered dialog: header close, scrollable body, action footer. */
export function Dialog(props: DialogProps) {
  useEffect(() => {
    if (!props.open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) props.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])

  if (!props.open) return null
  return createPortal(
    <div className="smp-dialog-root" role="presentation">
      <div className="smp-dialog-mask" aria-hidden="true" onClick={props.onClose} />
      <div
        className={`smp-dialog${props.className ? ` ${props.className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div className={`smp-dialog-content${props.contentClassName ? ` ${props.contentClassName}` : ''}`}>
          <div className="smp-dialog-header">
            <h2 className="smp-dialog-title">{props.title}</h2>
            <button className="smp-dialog-close" type="button" aria-label={props.closeLabel} onClick={props.onClose}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {props.description !== undefined && props.description !== '' && (
            <p className="smp-dialog-description">{props.description}</p>
          )}
          <div className="smp-dialog-body">{props.children}</div>
        </div>
        {props.footer !== undefined && <div className="smp-dialog-footer">{props.footer}</div>}
      </div>
    </div>,
    document.querySelector('.smp-console') ?? document.body,
  )
}

export function DialogButton(props: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  className?: string
}) {
  const variant = props.variant ?? 'ghost'
  return (
    <button
      type="button"
      className={`smp-dialog-button is-${variant}${props.className ? ` ${props.className}` : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
