export type SetupResult = {
  auth_mode: 'none' | 'google'
  public_url: string
  google_client_id: string
  google_client_secret_configured: boolean
  allowed_google_domains: string[]
  admin_emails: string[]
  google_redirect_uri: string
  git_repository_path: string
  setup_finalized: boolean
  github_start_required?: boolean
}

export type GitSettings = {
  enabled: boolean
  provider?: 'manual' | 'github'
  remote_url?: string
  branch: string
  transport?: 'https' | 'ssh'
  username?: string
  credential_configured?: boolean
  public_key?: string | null
  push_status: 'disabled' | 'pending' | 'current'
  last_pushed_sha?: string | null
  last_error?: string | null
  account_login?: string | null
  account_type?: 'User' | 'Organization' | null
  repository_name?: string | null
  repository_url?: string | null
}

export async function getSetupStatus(): Promise<{
  configured: boolean
  verification_required?: boolean
  auth_mode?: 'google'
  host_workspace_path?: string
  remote_verification_required?: boolean
  github_remote_pending?: boolean
}> {
  const response = await fetch('/api/setup/status', {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Setup status is unavailable.')
  return response.json()
}

async function setupRequest(
  path: string,
  options: RequestInit = {}
): Promise<SetupResult> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${path}`, { ...options, headers })
  const payload = (await response.json()) as SetupResult & {
    message?: string
  }
  if (!response.ok) throw new Error(payload.message ?? 'Configuration failed.')
  return payload
}

export function createInstallation(body: Record<string, unknown>) {
  return setupRequest('/setup', {
    method: 'POST',
    headers: { Origin: window.location.origin },
    body: JSON.stringify(body),
  })
}

async function githubStartRequest(
  path: string,
  body: Record<string, unknown>,
  csrf?: string
) {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: window.location.origin,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as {
    redirect_url?: string
    message?: string
  }
  if (!response.ok || !payload.redirect_url)
    throw new Error(payload.message ?? 'GitHub connection could not start.')
  return payload.redirect_url
}

export const startSetupGithub = (body: Record<string, unknown>) =>
  githubStartRequest('/setup/github/start', body)

export const startSettingsGithub = (
  body: Record<string, unknown>,
  csrf?: string
) => githubStartRequest('/settings/git/github/start', body, csrf)

export const retrySetupGithubPush = () =>
  fetch('/api/setup/github/push', {
    method: 'POST',
    headers: { Accept: 'application/json', Origin: window.location.origin },
  }).then(async (response) => {
    const payload = (await response.json()) as GitSettings & { message?: string }
    if (!response.ok) throw new Error(payload.message ?? 'GitHub push failed.')
    return payload
  })

export const disconnectSetupGithub = () =>
  fetch('/api/setup/github', {
    method: 'DELETE',
    headers: { Accept: 'application/json', Origin: window.location.origin },
  }).then(async (response) => {
    const payload = (await response.json()) as GitSettings & { message?: string }
    if (!response.ok) throw new Error(payload.message ?? 'GitHub disconnect failed.')
    return payload
  })

async function gitRequest(
  path = '',
  options: RequestInit = {}
): Promise<GitSettings> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api/settings/git${path}`, {
    ...options,
    headers,
  })
  const payload = (await response.json()) as GitSettings & { message?: string }
  if (!response.ok) throw new Error(payload.message ?? 'Git operation failed.')
  return payload
}

export const getGitSettings = () => gitRequest()
export const saveGitSettings = (body: Record<string, unknown>, csrf?: string) =>
  gitRequest('', {
    method: 'PUT',
    headers: {
      Origin: window.location.origin,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body),
  })
export const testGitSettings = (csrf?: string) =>
  gitRequest('/test', {
    method: 'POST',
    headers: {
      Origin: window.location.origin,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
  })
export const pushGitSettings = (csrf?: string) =>
  gitRequest('/push', {
    method: 'POST',
    headers: {
      Origin: window.location.origin,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
  })
export const disconnectGit = (csrf?: string) =>
  gitRequest('', {
    method: 'DELETE',
    headers: {
      Origin: window.location.origin,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
  })
