import { useCallback, useEffect, useState } from 'react'
import { ConnectPage } from '@/registry/connect-page'
import { LibraryPage } from '@/registry/library-page'
import { LoginPage } from '@/registry/login-page'
import { ReviewPage } from '@/registry/review-page'
import { SettingsPage } from '@/registry/settings-page'
import { getSetupStatus } from '@/registry/setup-api'
import { SetupPage } from '@/registry/setup-page'
import { AppShell } from '@/registry/shell'
import { SkillPage } from '@/registry/skill-page'
import { RegistryProvider } from '@/registry/store'
import type { RoutePath } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import { flushSync } from 'react-dom'
import { Toaster } from '@/components/ui/sonner'

function normalizePath(pathname: string): RoutePath {
  if (
    pathname === '/connect' ||
    pathname === '/review' ||
    pathname === '/settings' ||
    pathname.startsWith('/skills/')
  )
    return pathname as RoutePath
  return '/'
}

function routePosition(path: RoutePath) {
  if (path === '/') return 0
  if (path.startsWith('/skills/')) return 0.5
  if (path === '/connect') return 1
  if (path === '/review') return 2
  return 3
}

function RegistryRouter() {
  const { authStatus, role } = useRegistry()
  const [path, setPath] = useState<RoutePath>(() =>
    normalizePath(window.location.pathname)
  )
  const [navigationId, setNavigationId] = useState(0)

  const transitionTo = useCallback(
    (next: RoutePath, historyMode: 'push' | 'pop') => {
      if (path === next) return

      const root = document.documentElement
      root.dataset.navigationDirection =
        routePosition(next) >= routePosition(path) ? 'forward' : 'backward'

      const commit = () => {
        if (historyMode === 'push') window.history.pushState({}, '', next)
        flushSync(() => {
          setPath(next)
          setNavigationId((current) => current + 1)
        })
      }
      commit()
    },
    [path]
  )

  useEffect(() => {
    const handlePopState = () =>
      transitionTo(normalizePath(window.location.pathname), 'pop')
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [transitionTo])

  const navigate = useCallback(
    (next: RoutePath) => transitionTo(next, 'push'),
    [transitionTo]
  )

  let page = <LibraryPage navigate={navigate} />
  if (path === '/connect') page = <ConnectPage />
  if (path === '/review' && role === 'Admin')
    page = <ReviewPage navigate={navigate} />
  if (path === '/settings' && (role === 'Admin' || role === 'Open'))
    page = <SettingsPage />
  if (path.startsWith('/skills/'))
    page = (
      <SkillPage slug={path.slice('/skills/'.length)} navigate={navigate} />
    )

  if (authStatus === 'loading')
    return (
      <main className='grid min-h-svh place-items-center text-sm text-muted-foreground'>
        Checking your session…
      </main>
    )
  if (authStatus === 'unauthenticated') return <LoginPage />

  return (
    <AppShell path={path} navigationId={navigationId} navigate={navigate}>
      <div
        key={path}
        className='portal-route-reveal h-full min-h-0'
        data-testid='route-reveal'
      >
        {page}
      </div>
    </AppShell>
  )
}

export function RegistryApp() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [hostWorkspacePath, setHostWorkspacePath] = useState('')
  const [remoteVerificationRequired, setRemoteVerificationRequired] =
    useState(false)
  const [githubRemotePending, setGithubRemotePending] = useState(false)
  useEffect(() => {
    void getSetupStatus()
      .then((status) => {
        setConfigured(status.configured)
        setVerificationRequired(status.verification_required === true)
        setHostWorkspacePath(status.host_workspace_path ?? '')
        setRemoteVerificationRequired(
          status.remote_verification_required === true
        )
        setGithubRemotePending(status.github_remote_pending === true)
        if (status.configured && window.location.pathname === '/setup')
          window.history.replaceState({}, '', '/')
      })
      .catch(() => setConfigured(false))
  }, [])
  if (configured === null)
    return (
      <main className='grid min-h-svh place-items-center text-sm text-muted-foreground'>
        Checking instance setup…
      </main>
    )
  if (!configured)
    return (
      <SetupPage
        hostWorkspacePath={hostWorkspacePath}
        verificationRequired={verificationRequired}
        remoteVerificationRequired={remoteVerificationRequired}
        githubRemotePending={githubRemotePending}
        onComplete={() => {
          setConfigured(true)
          window.history.replaceState({}, '', '/')
        }}
      />
    )
  return (
    <RegistryProvider>
      <RegistryRouter />
      <Toaster position='bottom-right' richColors />
    </RegistryProvider>
  )
}
