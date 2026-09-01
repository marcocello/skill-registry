import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react'
import { RegistryCommandPalette } from '@/registry/command-palette'
import type { RoutePath } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import {
  BookOpen,
  Cable,
  ChevronDown,
  Command,
  GitPullRequest,
  LibraryBig,
  LogOut,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ScrollState = {
  navigationId: number
  progress: number
  scrolled: boolean
  scrolling: boolean
}

const restingScrollState: ScrollState = {
  navigationId: -1,
  progress: 0,
  scrolled: false,
  scrolling: false,
}

function NavButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      variant='ghost'
      size='sm'
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'h-8 gap-1.5 px-3 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        active && 'bg-muted text-foreground'
      )}
    >
      {children}
    </Button>
  )
}

export function AppShell({
  path,
  navigationId,
  navigate,
  children,
}: {
  path: string
  navigationId: number
  navigate: (path: RoutePath) => void
  children: ReactNode
}) {
  const { role, session, signOut, openProposals } = useRegistry()
  const [commandOpen, setCommandOpen] = useState(false)
  const [scrollState, setScrollState] = useState(restingScrollState)
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollSettleRef = useRef<number | null>(null)
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  useEffect(
    () => () => {
      if (scrollFrameRef.current)
        window.cancelAnimationFrame(scrollFrameRef.current)
      if (scrollSettleRef.current) window.clearTimeout(scrollSettleRef.current)
    },
    []
  )

  useLayoutEffect(() => {
    mainScrollRef.current?.scrollTo({ behavior: 'auto', left: 0, top: 0 })
  }, [navigationId])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const maximum = target.scrollHeight - target.clientHeight
      if (maximum <= 1) return

      const progress = Math.min(1, Math.max(0, target.scrollTop / maximum))
      if (scrollFrameRef.current)
        window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        setScrollState({
          navigationId,
          progress,
          scrolled: target.scrollTop > 2,
          scrolling: true,
        })
        scrollFrameRef.current = null
      })

      if (scrollSettleRef.current) window.clearTimeout(scrollSettleRef.current)
      scrollSettleRef.current = window.setTimeout(() => {
        setScrollState((current) => ({ ...current, scrolling: false }))
        scrollSettleRef.current = null
      }, 180)
    },
    [navigationId]
  )
  const initials =
    session?.display_name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'AP'
  const visibleScrollState =
    scrollState.navigationId === navigationId ? scrollState : restingScrollState
  const identitySummary = (
    <>
      <Avatar className='size-8'>
        {session?.picture_url ? (
          <AvatarImage src={session.picture_url} />
        ) : null}
        <AvatarFallback className='bg-slate-900 text-xs font-semibold text-white'>
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className='hidden min-w-0 text-left leading-tight sm:block'>
        <span className='block max-w-44 truncate text-sm font-medium'>
          {session?.display_name}
        </span>
        <span className='block text-xs text-muted-foreground'>
          {role === 'Open' ? 'No authentication' : role}
        </span>
      </span>
    </>
  )

  return (
    <div className='flex h-svh min-h-0 flex-col overflow-hidden bg-background'>
      <header
        className='portal-shell-header z-40 shrink-0 border-b bg-background/95 backdrop-blur'
        data-testid='portal-header'
        data-scrolled={visibleScrollState.scrolled}
        data-scrolling={visibleScrollState.scrolling}
      >
        <div className='mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-2 md:h-16 md:flex-nowrap md:px-6 md:py-0'>
          <button
            className='flex items-center gap-2.5 rounded-md text-left'
            onClick={() => navigate('/')}
            aria-label='Open skills library'
          >
            <span className='grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground'>
              <LibraryBig className='size-4' />
            </span>
            <span className='hidden leading-tight sm:block'>
              <span className='block text-sm font-semibold'>
                Skill Registry
              </span>
              <span className='block text-xs text-muted-foreground'>
                Team library
              </span>
            </span>
          </button>
          <nav
            className='order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto'
            aria-label='Primary navigation'
          >
            <NavButton
              active={path === '/' || path.startsWith('/skills/')}
              onClick={() => navigate('/')}
            >
              <BookOpen />
              Library
            </NavButton>
            <NavButton
              active={path === '/connect'}
              onClick={() => navigate('/connect')}
            >
              <Cable />
              Connect
            </NavButton>
            {role === 'Admin' ? (
              <NavButton
                active={path === '/review'}
                onClick={() => navigate('/review')}
              >
                <GitPullRequest />
                Review<Badge variant='secondary'>{openProposals.length}</Badge>
              </NavButton>
            ) : null}
            {role === 'Admin' || role === 'Open' ? (
              <NavButton
                active={path === '/settings'}
                onClick={() => navigate('/settings')}
              >
                <Settings />
                Settings
              </NavButton>
            ) : null}
          </nav>
          <div className='ml-auto flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='hidden h-8 w-88 justify-start gap-2 text-muted-foreground md:flex'
              onClick={() => setCommandOpen(true)}
            >
              <Command />
              Jump to…
            </Button>
            {role === 'Open' ? (
              <div
                className='flex h-10 items-center gap-2 px-1.5 sm:px-2'
                data-testid='open-access-identity'
              >
                {identitySummary}
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    className='group h-10 gap-2 px-1.5 sm:px-2'
                    aria-label='Open profile menu'
                  >
                    {identitySummary}
                    <ChevronDown className='size-3.5 text-muted-foreground' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-64'>
                  <DropdownMenuLabel className='font-normal'>
                    <span className='block text-sm font-medium'>
                      {session?.display_name}
                    </span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {session?.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOut()}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div
          key={navigationId}
          aria-hidden='true'
          className='portal-scroll-progress'
          data-testid='scroll-progress'
          style={{ transform: `scaleX(${visibleScrollState.progress})` }}
        />
      </header>
      <main
        ref={mainScrollRef}
        id='main-content'
        className='min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]'
        data-testid='route-scroll-viewport'
        onScrollCapture={handleScroll}
      >
        {children}
      </main>
      <RegistryCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        navigate={navigate}
      />
    </div>
  )
}
