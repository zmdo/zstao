import serversStyle from './servers.css'

export function installServersStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-server-management'
  tag.textContent = serversStyle
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
