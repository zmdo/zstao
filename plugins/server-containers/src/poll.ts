/** Sequential polling keeps one request in flight and stops publishing after unmount. */
export function pollSnapshots<T>(options: {
  read(signal: AbortSignal): Promise<T>
  publish(value: T): void
  failed(cause: unknown): void
  intervalMs: number
}): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  async function check() {
    try {
      const value = await options.read(controller.signal)
      if (!controller.signal.aborted) options.publish(value)
    } catch (cause) {
      if (!controller.signal.aborted) options.failed(cause)
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(check, options.intervalMs)
    }
  }
  void check()
  return () => { controller.abort(); clearTimeout(timer) }
}
