import type { RegistrySession } from '@/registry/auth-api'
import type {
  BundleFiles,
  Skill,
  SkillFile,
  SkillVersion,
} from '@/registry/types'

type RegistryIdentity = {
  user_id: string
  email: string
  display_name: string
}

type RegistrySummary = {
  slug: string
  name: string
  display_name: string | null
  description: string
  latest_version: number
  updated_at: string
  content_hash: string
  git_export_status: string
  file_count: number
  file_paths: string[]
  owner: RegistryIdentity | null
}

type RegistryVersion = {
  slug: string
  version: number
  name: string
  description: string
  files: BundleFiles
  content_hash: string
  created_at: string
  author: RegistryIdentity | null
  git_export: {
    status: string
    commit_sha: string | null
    error: string | null
  }
}

type RegistryDetail = {
  slug: string
  name: string
  display_name: string | null
  description: string
  latest_version: number
  created_at: string
  updated_at: string
  owner: RegistryIdentity | null
  versions: RegistryVersion[]
}

export class RegistryApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export type SkillDeletionResult = {
  slug: string
  deleted_versions: number
  created_at: string
  git_export: {
    status: 'exported' | 'pending'
    commit_sha: string | null
    error: string | null
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok)
    throw new RegistryApiError(
      `Registry request failed with ${response.status}.`,
      response.status
    )
  return response.json() as Promise<T>
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function exportStatus(value: string): Skill['gitExportStatus'] {
  return value === 'exported' ? 'Exported' : 'Pending export'
}

function fileEntries(files: BundleFiles): SkillFile[] {
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) =>
      typeof content === 'string'
        ? { path, content }
        : { path, content: '', binary: true }
    )
}

function identityLabel(identity: RegistryIdentity | null) {
  if (!identity) return undefined
  return identity.display_name === identity.email
    ? identity.email
    : `${identity.display_name} · ${identity.email}`
}

export function summaryToSkill(summary: RegistrySummary): Skill {
  return {
    source: 'registry',
    slug: summary.slug,
    name: summary.name,
    displayName: summary.display_name ?? undefined,
    description: summary.description,
    owner: identityLabel(summary.owner),
    updated: formatDate(summary.updated_at),
    version: summary.latest_version,
    files: summary.file_paths.map((path) => ({ path, content: '' })),
    history: [],
    gitExportStatus: exportStatus(summary.git_export_status),
    detailLoaded: false,
  }
}

export function detailToSkill(detail: RegistryDetail): Skill {
  const latest = detail.versions.find(
    (version) => version.version === detail.latest_version
  )
  if (!latest)
    throw new RegistryApiError('Latest Registry version is missing.', 502)
  const history: SkillVersion[] = [...detail.versions]
    .reverse()
    .map((version) => ({
      version: version.version,
      date: formatDate(version.created_at),
      author: identityLabel(version.author) ?? 'Author not recorded',
      note: `Published version ${version.version}.`,
    }))
  return {
    source: 'registry',
    slug: detail.slug,
    name: latest.name,
    displayName: detail.display_name ?? undefined,
    description: latest.description,
    owner: identityLabel(detail.owner),
    updated: formatDate(detail.updated_at),
    version: detail.latest_version,
    files: fileEntries(latest.files),
    history,
    gitExportStatus: exportStatus(latest.git_export.status),
    detailLoaded: true,
  }
}

export async function listRegistrySkills(
  signal?: AbortSignal
): Promise<Skill[]> {
  const payload = await request<{ skills: RegistrySummary[] }>(
    '/api/skills',
    signal
  )
  return payload.skills.map(summaryToSkill)
}

export async function getRegistrySkill(
  slug: string,
  signal?: AbortSignal
): Promise<Skill> {
  const encoded = encodeURIComponent(slug)
  const payload = await request<RegistryDetail>(
    `/api/skills/${encoded}`,
    signal
  )
  return detailToSkill(payload)
}

export async function deleteRegistrySkill(
  slug: string,
  session: RegistrySession
): Promise<SkillDeletionResult> {
  const response = await fetch(`/api/skills/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      Origin: window.location.origin,
      'X-CSRF-Token': session.csrf_token ?? '',
    },
  })
  const payload = (await response.json()) as SkillDeletionResult & {
    message?: string
  }
  if (!response.ok)
    throw new RegistryApiError(
      payload.message ?? 'Skill deletion failed.',
      response.status
    )
  return payload
}
