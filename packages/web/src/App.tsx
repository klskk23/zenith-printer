import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from './api/client.ts'
import { copy } from './i18n/zh-CN.ts'
import { cn } from './lib/utils.ts'
import { EditorPage } from './editor/editor-page.tsx'
import { PrintersPage } from './features/printers/printers-page.tsx'
import { Button } from './components/ui/button.tsx'

type Tab = 'editor' | 'printers'

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('editor')
  const health = useQuery({ queryKey: ['health'], queryFn: () => request<{ status: string }>('/health') })

  const status = health.isPending
    ? copy.connection.connecting
    : health.isError
      ? copy.connection.disconnected
      : copy.connection.connected

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
          <div>
            <h1 className="text-lg font-bold">{copy.app.title}</h1>
            <p className="text-xs text-muted-foreground">{copy.app.subtitle}</p>
          </div>
          <nav className="flex items-center gap-2">
            <Button variant={tab === 'editor' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('editor')}>
              {copy.nav.editor}
            </Button>
            <Button variant={tab === 'printers' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('printers')}>
              {copy.nav.printers}
            </Button>
            <span className={cn('text-xs', health.isError ? 'text-destructive' : 'text-muted-foreground')}>
              {status}
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        {tab === 'editor' ? <EditorPage /> : <PrintersPage />}
      </main>
    </div>
  )
}
