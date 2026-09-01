export type RegistrySession = {
  auth_mode: 'none' | 'google'
  user_id?: string
  email: string
  display_name: string
  picture_url?: string | null
  role?: 'user' | 'admin'
  csrf_token?: string
}

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function getSession(): Promise<RegistrySession> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok)
    throw new AuthApiError(response.status, 'Authentication required.')
  return response.json() as Promise<RegistrySession>
}

export async function logoutRegistry(session: RegistrySession): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Origin: window.location.origin,
      'X-CSRF-Token': session.csrf_token ?? '',
    },
  })
  if (!response.ok) throw new AuthApiError(response.status, 'Logout failed.')
}
