import type { RegistrySession } from '@/registry/auth-api'
import type { Proposal } from '@/registry/types'

async function request<T>(
  path: string,
  session: RegistrySession,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  if (options.method && options.method !== 'GET') {
    headers.set('Origin', window.location.origin)
    headers.set('X-CSRF-Token', session.csrf_token ?? '')
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  })
  const payload = (await response.json()) as T & { message?: string }
  if (!response.ok)
    throw new Error(payload.message ?? 'Registry request failed.')
  return payload
}

export async function listProposals(session: RegistrySession) {
  const result = await request<{ proposals: Proposal[] }>('/proposals', session)
  return result.proposals
}

export function editProposal(
  session: RegistrySession,
  proposal: Proposal,
  fields: Pick<Proposal, 'name' | 'description' | 'files'>
) {
  return request<Proposal>(
    `/proposals/${encodeURIComponent(proposal.id)}`,
    session,
    {
      method: 'PUT',
      body: JSON.stringify({ revision: proposal.revision, ...fields }),
    }
  )
}

export function decideProposal(
  session: RegistrySession,
  proposal: Proposal,
  decision: 'approve' | 'reject',
  reason: string
) {
  return request<Proposal>(
    `/proposals/${encodeURIComponent(proposal.id)}/${decision}`,
    session,
    {
      method: 'POST',
      body: JSON.stringify({ revision: proposal.revision, reason }),
    }
  )
}
