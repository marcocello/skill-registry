import { createContext } from 'react'
import type { RegistrySession } from '@/registry/auth-api'
import type { SkillDeletionResult } from '@/registry/registry-api'
import type { Proposal, Role, Skill } from '@/registry/types'

export type RegistryContextValue = {
  authStatus: 'loading' | 'authenticated' | 'unauthenticated'
  session: RegistrySession | null
  role: Role
  signOut: () => Promise<void>
  skills: Skill[]
  catalogueStatus: 'loading' | 'ready' | 'error'
  refreshSkills: () => Promise<void>
  detailStatus: Record<
    string,
    'idle' | 'loading' | 'ready' | 'not-found' | 'error'
  >
  loadSkill: (slug: string) => Promise<void>
  deleteSkill: (slug: string) => Promise<SkillDeletionResult>
  proposals: Proposal[]
  openProposals: Proposal[]
  refreshProposals: () => Promise<void>
  replaceProposal: (proposal: Proposal) => void
}

export const RegistryContext = createContext<RegistryContextValue | null>(null)
