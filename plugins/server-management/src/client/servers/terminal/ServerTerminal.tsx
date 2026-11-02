import { Panel } from '@smp/console-kit'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { ServerError } from '../../../shared/errors.ts'
import { displayError, serverCopy } from '../../../shared/i18n.ts'

const THEME = {
  background: '#1e1e1e',
  foreground: '#f2f3f5',
  cursor: '#f2f3f5',
  selectionBackground: '#264f78',
} as const

type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed'

export function ServerTerminal(props: {
  active: string
  id: string
  visible: boolean
  autoConnect?: boolean
  onBack: () => void
  embedded?: boolean
}) {
  const { active } = props
  const copy = serverCopy(active).ui
  const [status, setStatus] = useState<TerminalStatus>('idle')
  const [error, setError] = useState<ServerError | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const fitRef = useRef<FitAddon>()
  const observerRef = useRef<ResizeObserver>()
  const socketRef = useRef<WebSocket>()
  const connectRef = useRef<() => void>(() => {})
  const disconnectRef = useRef<() => void>(() => {})

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@smp/console-server-management/xterm'
    style.textContent = xtermCss
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      scrollback: 10000,
      theme: THEME,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit

    const sendResize = () => {
      const socket = socketRef.current
      if (socket?.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
    const fitVisible = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // The host can be between layout passes while a panel is opening.
      }
      sendResize()
    }
    const resize = terminal.onResize(sendResize)
    const input = terminal.onData((data) => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) socket.send(data)
    })
    const observer = new ResizeObserver(fitVisible)
    if (props.visible) observer.observe(host)
    observerRef.current = observer

    const connect = () => {
      if (socketRef.current !== undefined) return
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(
        `${proto}//${location.host}/console-api/servers/terminal?id=${encodeURIComponent(props.id)}`,
      )
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      setError(null)
      setStatus('connecting')
      socket.addEventListener('open', () => {
        if (socketRef.current !== socket) return
        setStatus('connected')
        fitVisible()
      })
      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return
        if (typeof event.data === 'string') terminal.write(event.data)
        else terminal.write(new Uint8Array(event.data as ArrayBuffer))
      }
      socket.onerror = () => {
        if (socketRef.current !== socket) return
        setError(new ServerError('terminal_failed'))
        setStatus('failed')
        socket.close()
      }
      socket.onclose = () => {
        if (socketRef.current !== socket) return
        socketRef.current = undefined
        setStatus((current) => (current === 'failed' ? 'failed' : 'disconnected'))
      }
    }
    const disconnect = () => {
      const socket = socketRef.current
      socketRef.current = undefined
      socket?.close()
      setStatus('disconnected')
    }
    connectRef.current = connect
    disconnectRef.current = disconnect
    if (props.autoConnect === false) setStatus('disconnected')
    else connect()

    return () => {
      observer.disconnect()
      resize.dispose()
      input.dispose()
      const socket = socketRef.current
      socketRef.current = undefined
      socket?.close()
      terminal.dispose()
      terminalRef.current = undefined
      fitRef.current = undefined
      observerRef.current = undefined
    }
  }, [props.id])

  useEffect(() => {
    const host = hostRef.current
    const terminal = terminalRef.current
    if (host === null || terminal === undefined) return
    if (!props.visible) {
      observerRef.current?.disconnect()
      terminal.blur()
      return
    }
    observerRef.current?.observe(host)
    const frame = requestAnimationFrame(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        fitRef.current?.fit()
      } catch {
        return
      }
      terminal.refresh(0, Math.max(0, terminal.rows - 1))
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [props.visible])

  const label =
    status === 'idle'
      ? copy.terminalStatusIdle
      : status === 'connecting'
        ? copy.terminalStatusConnecting
        : status === 'connected'
          ? copy.terminalStatusConnected
          : status === 'failed'
            ? copy.terminalStatusFailed
            : copy.terminalStatusDisconnected
  const canReconnect = status === 'idle' || status === 'disconnected' || status === 'failed'
  return (
    <Panel
      title={props.embedded ? undefined : copy.terminal}
      className={props.embedded ? 'smp-server-terminal-panel' : undefined}
      extra={
        props.embedded ? undefined : (
          <button className="link" type="button" onClick={props.onBack}>
            {copy.back}
          </button>
        )
      }
    >
      <div className="smp-terminal-toolbar">
        <span className={`smp-terminal-status ${status}`}>{label}</span>
        <button
          className="link"
          type="button"
          onClick={() => {
            if (canReconnect) connectRef.current()
            else disconnectRef.current()
          }}
        >
          {canReconnect
            ? status === 'idle'
              ? copy.terminalConnect
              : copy.terminalReconnect
            : copy.terminalDisconnect}
        </button>
      </div>
      {error !== null ? <p className="banner error">{displayError(active, error)}</p> : null}
      <div className="terminal-page">
        <div ref={hostRef} className="terminal-host" />
      </div>
    </Panel>
  )
}
