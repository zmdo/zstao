import { Children, isValidElement } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { browseHash, repositoryUrl, resolveRepositoryLink } from './browser-state.ts'
import type { BrowseState } from './browser-state.ts'

function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '').join('')
}
function slug(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-') }
export function RepositoryMarkdown(props: { text: string; file: string; state: BrowseState; zh: boolean; navigate(state: BrowseState): void }) {
  const headings = new Map<string, number>()
  const headingId = (children: ReactNode) => {
    const base = slug(textOf(children))
    const count = headings.get(base) ?? 0
    headings.set(base, count + 1)
    return `smp-repo-heading-${base}${count ? `-${count}` : ''}`
  }
  const heading = (level: number, children: ReactNode) => {
    const id = headingId(children)
    switch (level) {
      case 1: return <h1 id={id}>{children}</h1>
      case 2: return <h2 id={id}>{children}</h2>
      case 3: return <h3 id={id}>{children}</h3>
      case 4: return <h4 id={id}>{children}</h4>
      case 5: return <h5 id={id}>{children}</h5>
      default: return <h6 id={id}>{children}</h6>
    }
  }
  return <div className="smp-repo-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    h1: ({ children }) => heading(1, children), h2: ({ children }) => heading(2, children), h3: ({ children }) => heading(3, children),
    h4: ({ children }) => heading(4, children), h5: ({ children }) => heading(5, children), h6: ({ children }) => heading(6, children),
    a: ({ href = '', children }) => {
      const link = resolveRepositoryLink(props.file, href)
      if (link.kind === 'blocked') return <span>{children}</span>
      if (link.kind === 'external') return <a href={link.url} target="_blank" rel="noopener noreferrer">{children}</a>
      const next: BrowseState = { ...props.state, path: link.path, kind: link.directory ? 'directory' : 'file', tab: 'code', anchor: link.anchor }
      return <a href={browseHash(next)} onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault(); props.navigate(next)
      }}>{children}</a>
    },
    img: ({ src = '', alt = '' }) => {
      const link = resolveRepositoryLink(props.file, src)
      if (link.kind === 'external') return <a href={link.url} target="_blank" rel="noopener noreferrer">{alt || (props.zh ? '外部图片' : 'External image')}</a>
      if (link.kind !== 'internal') return <span>{alt}</span>
      return <img src={repositoryUrl(props.state.id, 'asset', props.state.sha, link.path)} alt={alt} loading="lazy" />
    },
    pre: ({ children }) => {
      const child = Children.toArray(children)[0]
      if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return <pre>{children}</pre>
      const code = textOf(child.props.children).replace(/\n$/, '')
      const lang = /language-([\w+-]+)/.exec(child.props.className ?? '')?.[1]
      if (!lang || code.split('\n').some(line => line.length > 2000)) return <pre>{children}</pre>
      return <CodeBlock code={code} lang={lang} copyLabel={props.zh ? '复制' : 'Copy'} copiedLabel={props.zh ? '已复制' : 'Copied'} toolbarLabels={{ codeLabel: props.zh ? '代码' : 'Code', wrapLabel: props.zh ? '换行' : 'Wrap', unwrapLabel: props.zh ? '不换行' : 'Unwrap' }} />
    },
  }}>{props.text}</Markdown></div>
}
