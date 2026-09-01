import type { RegistrySession } from '@/registry/auth-api'

export type ArchiveUploadResult = {
  outcome: 'published' | 'submitted'
  skill?: { slug: string; version: number }
  proposal?: { slug: string; id: string }
}

export async function downloadRegistryArchive() {
  const response = await fetch('/api/skills/archive', {
    credentials: 'same-origin',
    headers: { Accept: 'application/zip' },
  })
  if (!response.ok)
    throw await transferError(response, 'Could not download the Registry ZIP.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'skills-registry.zip'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function uploadRegistryArchive(
  file: File,
  session: RegistrySession | null
): Promise<ArchiveUploadResult> {
  const data = new FormData()
  data.set('file', file)
  const headers = new Headers({ Accept: 'application/json' })
  if (session?.auth_mode === 'google')
    headers.set('X-CSRF-Token', session.csrf_token ?? '')
  const response = await fetch('/api/skills/archive', {
    method: 'POST',
    body: data,
    headers,
    credentials: 'same-origin',
  })
  if (!response.ok)
    throw await transferError(response, 'Could not upload this ZIP.')
  return response.json() as Promise<ArchiveUploadResult>
}

async function transferError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { message?: string }
    return new Error(payload.message || fallback)
  } catch {
    return new Error(fallback)
  }
}
