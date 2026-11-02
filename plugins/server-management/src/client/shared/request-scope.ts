/** Each editor owns a scope; superseded and unmounted requests cannot publish state. */
export class RequestScope {
  private current?: AbortController

  begin() {
    this.cancel()
    const controller = new AbortController()
    this.current = controller
    return {
      signal: controller.signal,
      current: () => this.current === controller && !controller.signal.aborted,
    }
  }

  cancel(): void {
    this.current?.abort()
    this.current = undefined
  }
}
