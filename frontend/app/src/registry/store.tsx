import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AuthApiError,
  getSession,
  logoutRegistry,
  type RegistrySession,
} from '@/registry/auth-api'
import { listProposals } from '@/registry/proposal-api'
import {
  deleteRegistrySkill,
  getRegistrySkill,
  listRegistrySkills,
  RegistryApiError,
} from '@/registry/registry-api'
import {
  RegistryContext,
  type RegistryContextValue,
} from '@/registry/registry-context'
import type { Proposal, Role, Skill } from '@/registry/types'

export function RegistryProvider({ children }: { children: ReactNode }) {
  const [authStatus, setAuthStatus] =
    useState<RegistryContextValue['authStatus']>('loading')
  const [session, setSession] = useState<RegistrySession | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [catalogueStatus, setCatalogueStatus] =
    useState<RegistryContextValue['catalogueStatus']>('loading')
  const [detailStatus, setDetailStatus] = useState<
    RegistryContextValue['detailStatus']
  >({})
  const [proposals, setProposals] = useState<Proposal[]>([])
  const mounted = useRef(true)

  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  const refreshSkills = useCallback(async () => {
    setCatalogueStatus('loading')
    try {
      const loaded = await listRegistrySkills()
      if (!mounted.current) return
      setSkills((current) =>
        loaded.map((summary) => {
          const existing = current.find((skill) => skill.slug === summary.slug)
          return existing?.detailLoaded && existing.version === summary.version
            ? existing
            : summary
        })
      )
      setCatalogueStatus('ready')
    } catch {
      if (mounted.current) setCatalogueStatus('error')
    }
  }, [])

  const refreshProposals = useCallback(async () => {
    if (!session || session.role !== 'admin') return
    setProposals(await listProposals(session))
  }, [session])

  useEffect(() => {
    void getSession()
      .then((loaded) => {
        if (!mounted.current) return
        setSession(loaded)
        setAuthStatus('authenticated')
      })
      .catch((error) => {
        if (!mounted.current) return
        setAuthStatus(
          error instanceof AuthApiError && error.status === 401
            ? 'unauthenticated'
            : 'unauthenticated'
        )
      })
  }, [])

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    void refreshSkills()
    if (session?.role === 'admin') void refreshProposals()
  }, [authStatus, refreshProposals, refreshSkills, session?.role])

  const loadSkill = useCallback(async (slug: string) => {
    setDetailStatus((current) => ({ ...current, [slug]: 'loading' }))
    try {
      const loaded = await getRegistrySkill(slug)
      if (!mounted.current) return
      setSkills((current) =>
        current.some((skill) => skill.slug === slug)
          ? current.map((skill) => (skill.slug === slug ? loaded : skill))
          : [...current, loaded]
      )
      setDetailStatus((current) => ({ ...current, [slug]: 'ready' }))
    } catch (error) {
      if (!mounted.current) return
      setDetailStatus((current) => ({
        ...current,
        [slug]:
          error instanceof RegistryApiError && error.status === 404
            ? 'not-found'
            : 'error',
      }))
    }
  }, [])

  const signOut = useCallback(async () => {
    if (session) await logoutRegistry(session)
    setSession(null)
    setSkills([])
    setProposals([])
    setAuthStatus('unauthenticated')
  }, [session])

  const deleteSkill = useCallback(
    async (slug: string) => {
      if (!session) throw new RegistryApiError('Authentication required.', 401)
      const result = await deleteRegistrySkill(slug, session)
      if (mounted.current) {
        setSkills((current) => current.filter((skill) => skill.slug !== slug))
        setDetailStatus((current) => {
          const next = { ...current }
          delete next[slug]
          return next
        })
      }
      return result
    },
    [session]
  )

  const replaceProposal = useCallback((proposal: Proposal) => {
    setProposals((current) =>
      current.map((item) => (item.id === proposal.id ? proposal : item))
    )
  }, [])

  const role: Role =
    session?.auth_mode === 'none'
      ? 'Open'
      : session?.role === 'admin'
        ? 'Admin'
        : 'User'
  const value = useMemo<RegistryContextValue>(
    () => ({
      authStatus,
      session,
      role,
      signOut,
      skills,
      catalogueStatus,
      refreshSkills,
      detailStatus,
      loadSkill,
      deleteSkill,
      proposals,
      openProposals: proposals.filter(
        (proposal) => proposal.status === 'pending'
      ),
      refreshProposals,
      replaceProposal,
    }),
    [
      authStatus,
      catalogueStatus,
      detailStatus,
      deleteSkill,
      loadSkill,
      proposals,
      refreshProposals,
      refreshSkills,
      replaceProposal,
      role,
      session,
      signOut,
      skills,
    ]
  )

  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  )
}
