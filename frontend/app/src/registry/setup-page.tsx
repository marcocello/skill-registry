import { useState, type FormEvent } from 'react'
import {
  createInstallation,
  disconnectSetupGithub,
  retrySetupGithubPush,
  startSetupGithub,
} from '@/registry/setup-api'
import {
  GithubMark,
  SetupMode as Mode,
  SetupReveal,
} from '@/registry/setup-controls'
import {
  ChevronDown,
  FolderGit2,
  GitBranch,
  Link2Off,
  LoaderCircle,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export function SetupPage({
  hostWorkspacePath,
  onComplete,
  verificationRequired = false,
  remoteVerificationRequired = false,
  githubRemotePending = false,
}: {
  hostWorkspacePath: string
  onComplete: () => void
  verificationRequired?: boolean
  remoteVerificationRequired?: boolean
  githubRemotePending?: boolean
}) {
  const [verification, setVerification] = useState(verificationRequired)
  const [editing, setEditing] = useState(
    !verificationRequired || remoteVerificationRequired
  )
  const [mode, setMode] = useState<'none' | 'google'>('none')
  const [publicUrl, setPublicUrl] = useState(window.location.origin)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [domains, setDomains] = useState('')
  const [admins, setAdmins] = useState('')
  const [repositoryName, setRepositoryName] = useState('registry-git')
  const [remoteProvider, setRemoteProvider] = useState<
    'none' | 'github' | 'manual'
  >('none')
  const [transport, setTransport] = useState<'https' | 'ssh'>('https')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('skills-registry')
  const [username, setUsername] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [knownHosts, setKnownHosts] = useState('')
  const [githubRepositoryName, setGithubRepositoryName] = useState(
    'skills-registry'
  )
  const [githubVisibility, setGithubVisibility] = useState<
    'private' | 'public'
  >('private')
  const [githubOptionsOpen, setGithubOptionsOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const configured = await createInstallation({
        auth_mode: mode,
        public_url: publicUrl,
        git_repository: { name: repositoryName },
        ...(mode === 'google'
          ? googlePayload(clientId, clientSecret, domains, admins)
          : {}),
        ...(remoteProvider === 'manual'
          ? {
              git_remote: {
                provider: 'manual',
                transport,
                remote_url: remoteUrl,
                branch,
                ...(transport === 'https'
                  ? { username, token: gitToken }
                  : { known_hosts: knownHosts }),
              },
            }
          : remoteProvider === 'github'
            ? {
                git_remote: {
                  provider: 'github',
                  repository_name: githubRepositoryName,
                  visibility: githubVisibility,
                  branch,
                },
              }
            : {}),
      })
      if (configured.github_start_required) {
        const redirect = await startSetupGithub({
          repository_name: githubRepositoryName,
          visibility: githubVisibility,
          branch,
        })
        window.location.assign(redirect)
      } else if (configured.setup_finalized) onComplete()
      else {
        setVerification(true)
        setEditing(false)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup failed.')
    } finally {
      setSaving(false)
    }
  }

  if (remoteVerificationRequired && githubRemotePending) {
    return (
      <SetupShell>
        <Card>
          <CardHeader>
            <CardTitle>Finish the GitHub connection</CardTitle>
            <CardDescription>
              The GitHub repository is connected, but the first export is still
              pending. Retry without creating another repository.
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-4'>
            <Button
              onClick={() =>
                void retrySetupGithubPush()
                  .then((result) => {
                    if (result.push_status === 'current')
                      window.location.reload()
                  })
                  .catch((caught) =>
                    setError(
                      caught instanceof Error ? caught.message : 'Retry failed.'
                    )
                  )
              }
            >
              Retry GitHub export
            </Button>
            <Button
              variant='outline'
              onClick={() =>
                void disconnectSetupGithub()
                  .then(() => window.location.reload())
                  .catch((caught) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : 'Disconnect failed.'
                    )
                  )
              }
            >
              Disconnect and choose again
            </Button>
            {error ? <p role='alert'>{error}</p> : null}
          </CardContent>
        </Card>
      </SetupShell>
    )
  }

  if (verification && !editing) {
    return (
      <SetupShell>
        <Card>
          <CardHeader>
            <CardTitle>Verify your Google administrator</CardTitle>
            <CardDescription>
              Setup remains provisional until one configured administrator signs
              in successfully. If the Google configuration is incorrect, edit
              setup before administrator verification.
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-4'>
            <a
              className='inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground'
              href='/api/auth/google/start?return_to=/setup'
            >
              Continue with Google
            </a>
            <Button variant='outline' onClick={() => setEditing(true)}>
              Edit setup
            </Button>
          </CardContent>
        </Card>
      </SetupShell>
    )
  }

  return (
    <SetupShell>
      <form className='grid gap-5' onSubmit={submit}>
        {remoteVerificationRequired ? (
          <div
            className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950'
            role='status'
          >
            The GitHub connection was not completed. Review setup and choose
            GitHub.com, Manual, or No remote again.
          </div>
        ) : null}
        <SetupCard
          step='1'
          id='portal-access-title'
          title='Who can use this instance'
          description='Sets whether the portal has accounts and roles at all.'
        >
          <div className='grid gap-5'>
            <RadioGroup
              aria-label='Access mode'
              value={mode}
              onValueChange={(value) => setMode(value as 'none' | 'google')}
              className='grid gap-3 sm:grid-cols-2'
            >
              <Mode
                id='none'
                title='No sign-in'
                accessibleLabel='Open full access'
                description='Anyone with the URL has full capability. No accounts or roles.'
                selected={mode === 'none'}
              />
              <Mode
                id='google'
                title='Google sign-in'
                accessibleLabel='Google OIDC'
                description='Domain users submit for review; listed admins approve and manage the repository.'
                selected={mode === 'google'}
                icon={<GoogleMark />}
              />
            </RadioGroup>
            <Field label='Public URL'>
              <Input
                className='font-mono'
                value={publicUrl}
                onChange={(event) => setPublicUrl(event.target.value)}
                required
              />
              <FieldHint>
                Used in MCP connector URLs and OIDC redirects.
              </FieldHint>
            </Field>
            <SetupReveal open={mode === 'google'} name='google'>
              <GoogleFields
                publicUrl={publicUrl}
                values={{ clientId, clientSecret, domains, admins }}
                setters={{
                  setClientId,
                  setClientSecret,
                  setDomains,
                  setAdmins,
                }}
              />
            </SetupReveal>
          </div>
        </SetupCard>

        <SetupCard
          step='2'
          id='git-repository-title'
          title='Where skills are stored'
          description='A new Git repository is created inside the mounted workspace and initialised with the registry layout.'
        >
          <div className='grid gap-4'>
            <Field label='New repository folder'>
              <Input
                aria-label='Repository name'
                className='font-mono'
                value={repositoryName}
                onChange={(event) => setRepositoryName(event.target.value)}
                placeholder='registry-git'
                pattern='[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9])?'
                maxLength={80}
                required
              />
              <FieldHint>
                Must not already exist. Initialised as a Git repository on
                branch <code>main</code>.
              </FieldHint>
            </Field>
            <RepositoryPaths
              hostWorkspacePath={hostWorkspacePath}
              name={repositoryName}
            />
          </div>
        </SetupCard>

        <SetupCard
          step='3'
          id='git-remote-title'
          title='Push remote'
          description='Where the repository is mirrored on every approved change. Optional — it can be added later from Git Settings.'
        >
          <div className='grid gap-4'>
            <RadioGroup
              aria-label='Remote'
              value={remoteProvider}
              onValueChange={(value) =>
                setRemoteProvider(value as 'none' | 'github' | 'manual')
              }
              className='grid gap-3 sm:grid-cols-3'
            >
              <Mode
                id='none-remote'
                value='none'
                title='No remote'
                description='Keep everything on this machine for now.'
                selected={remoteProvider === 'none'}
                kind='provider'
                icon={<Link2Off />}
              />
              <Mode
                id='github-remote'
                value='github'
                title='GitHub.com'
                description='One click — authorize and create the repository.'
                selected={remoteProvider === 'github'}
                kind='provider'
                icon={<GithubMark />}
              />
              <Mode
                id='manual-remote'
                value='manual'
                title='Manual'
                description='Any Git host over HTTPS or SSH.'
                selected={remoteProvider === 'manual'}
                kind='provider'
                icon={<span className='font-mono text-[15px]'>https://</span>}
              />
            </RadioGroup>
            <SetupReveal open={remoteProvider === 'github'} name='github'>
              <div className='grid gap-3 rounded-xl border bg-muted/25 p-4'>
                {saving ? (
                  <p
                    className='flex items-center gap-2.5 text-[13px] text-muted-foreground'
                    role='status'
                  >
                    <LoaderCircle className='size-4 animate-spin text-foreground' />
                    Opening GitHub for authorization…
                  </p>
                ) : (
                  <>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <p className='text-[13px] leading-5 text-muted-foreground'>
                        Choose the account or organization on GitHub. We create
                        the repository and push the Registry history after you
                        authorize it.
                      </p>
                      <Button
                        type='submit'
                        size='sm'
                        className='shrink-0 self-start sm:self-auto'
                      >
                        Connect GitHub
                      </Button>
                    </div>
                    <button
                      type='button'
                      aria-expanded={githubOptionsOpen}
                      className='flex w-full items-center gap-2 border-t pt-3 text-left text-xs text-muted-foreground transition-colors hover:text-foreground'
                      onClick={() => setGithubOptionsOpen((open) => !open)}
                    >
                      <GitBranch className='size-3.5' />
                      <span className='font-medium text-foreground'>
                        Repository options
                      </span>
                      <span className='min-w-0 truncate'>
                        {githubRepositoryName} · {githubVisibility} · {branch}
                      </span>
                      <ChevronDown
                        className={cn(
                          'ml-auto size-3.5 transition-transform duration-200',
                          githubOptionsOpen && 'rotate-180'
                        )}
                      />
                    </button>
                    <SetupReveal open={githubOptionsOpen} name='github-options'>
                      <div className='grid gap-4 pt-1'>
                        <Field label='GitHub repository name'>
                          <Input
                            value={githubRepositoryName}
                            onChange={(event) =>
                              setGithubRepositoryName(event.target.value)
                            }
                            required
                          />
                        </Field>
                        <Field label='Visibility'>
                          <RadioGroup
                            value={githubVisibility}
                            onValueChange={(value) =>
                              setGithubVisibility(value as 'private' | 'public')
                            }
                            className='flex gap-5'
                          >
                            <label className='flex items-center gap-2'>
                              <RadioGroupItem value='private' />
                              Private
                            </label>
                            <label className='flex items-center gap-2'>
                              <RadioGroupItem value='public' />
                              Public
                            </label>
                          </RadioGroup>
                        </Field>
                        <Field label='Export branch'>
                          <Input
                            value={branch}
                            onChange={(event) => setBranch(event.target.value)}
                            required
                          />
                        </Field>
                        <p className='text-xs text-muted-foreground'>
                          No PAT or pre-registered app is required.
                        </p>
                      </div>
                    </SetupReveal>
                  </>
                )}
              </div>
            </SetupReveal>
            <SetupReveal open={remoteProvider === 'manual'} name='manual'>
              <div className='grid gap-4 rounded-xl border bg-muted/25 p-4'>
                <RadioGroup
                  value={transport}
                  onValueChange={(value) =>
                    setTransport(value as 'https' | 'ssh')
                  }
                  className='flex flex-wrap gap-5'
                >
                  <label className='flex items-center gap-2'>
                    <RadioGroupItem value='https' />
                    HTTPS authentication
                  </label>
                  <label className='flex items-center gap-2'>
                    <RadioGroupItem value='ssh' />
                    SSH deploy key
                  </label>
                </RadioGroup>
                <Field label='Remote URL'>
                  <Input
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder={
                      transport === 'ssh'
                        ? 'git@github.com:org/repository.git'
                        : 'https://github.com/org/repository.git'
                    }
                    required
                  />
                </Field>
                <Field label='Export branch'>
                  <Input
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    required
                  />
                </Field>
                <SetupReveal open={transport === 'https'} name='https'>
                  <div className='grid gap-4'>
                    <Field label='HTTPS username'>
                      <Input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        required
                      />
                    </Field>
                    <Field label='HTTPS token'>
                      <Input
                        type='password'
                        value={gitToken}
                        onChange={(event) => setGitToken(event.target.value)}
                        required
                        autoComplete='new-password'
                      />
                    </Field>
                  </div>
                </SetupReveal>
                <SetupReveal open={transport === 'ssh'} name='ssh'>
                  <Field label='Verified known_hosts entry'>
                    <Input
                      value={knownHosts}
                      onChange={(event) => setKnownHosts(event.target.value)}
                      required
                    />
                  </Field>
                </SetupReveal>
              </div>
            </SetupReveal>
            {remoteProvider === 'none' ? (
              <p className='text-xs text-muted-foreground'>
                You can add a remote later from Git Settings.
              </p>
            ) : null}
          </div>
        </SetupCard>
        <div className='flex flex-col items-start gap-3 pt-1'>
          {error ? (
            <p className='text-sm text-destructive' role='alert'>
              {error}
            </p>
          ) : null}
          <Button
            className='h-10 rounded-[10px] px-5'
            disabled={saving || remoteProvider === 'github'}
          >
            <ShieldCheck />
            {saving ? 'Saving…' : 'Complete setup'}
          </Button>
        </div>
      </form>
    </SetupShell>
  )
}

function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <main className='h-svh overflow-y-auto overscroll-contain bg-[#fafafa] px-4 py-10 [scrollbar-gutter:stable] sm:py-14'>
      <div className='mx-auto mb-8 flex max-w-[720px] items-center gap-4'>
        <span className='grid size-11 shrink-0 place-items-center rounded-[12px] bg-[#18181b]'>
          <img
            src='/images/favicon.svg'
            alt='Skill Registry'
            className='size-6 brightness-0 invert'
          />
        </span>
        <h1 className='text-[21px] font-semibold tracking-[-0.02em]'>
          skills-registry
        </h1>
        <span className='rounded-full border bg-muted/50 px-2.5 py-1 text-[10px] font-medium tracking-[0.08em] text-muted-foreground'>
          SETUP
        </span>
      </div>
      <div className='mx-auto max-w-[720px]'>{children}</div>
    </main>
  )
}

function SetupCard({
  step,
  id,
  title,
  description,
  children,
}: {
  step: string
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card
      aria-labelledby={id}
      className='gap-5 rounded-[14px] border-[#e4e4e7] bg-white py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
    >
      <CardHeader className='gap-2 px-6'>
        <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
          <span className='text-xs font-medium tracking-[0.04em] text-[#a1a1aa]'>
            STEP {step}
          </span>
          <h2 id={id} className='text-base leading-none font-semibold'>
            {title}
          </h2>
        </div>
        <CardDescription className='leading-5'>{description}</CardDescription>
      </CardHeader>
      <CardContent className='px-6'>{children}</CardContent>
    </Card>
  )
}
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Label className='grid gap-1.5'>
      <span className='text-[13px] font-medium'>{label}</span>
      {children}
    </Label>
  )
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <span className='text-xs font-normal text-muted-foreground'>
      {children}
    </span>
  )
}

function RepositoryPaths({
  hostWorkspacePath,
  name,
}: {
  hostWorkspacePath: string
  name: string
}) {
  const directory = name || 'repository-name'
  const hostRoot = hostWorkspacePath.replace(/\/+$/, '')
  const machinePath = hostRoot
    ? `${hostRoot}/${directory}`
    : 'Host workspace unavailable'
  return (
    <div className='grid gap-3 rounded-[10px] border bg-[#fafafa] p-4'>
      <div className='grid min-w-0 gap-2 sm:grid-cols-[96px_1fr] sm:items-center'>
        <span className='flex items-center gap-2 text-xs font-medium text-muted-foreground sm:block'>
          <Server className='inline size-3.5 sm:hidden' />
          In container
        </span>
        <code className='min-w-0 text-[13px] break-all'>
          /workspace/{directory}
        </code>
      </div>
      <div className='grid min-w-0 gap-2 sm:grid-cols-[96px_1fr] sm:items-center'>
        <span className='flex items-center gap-2 text-xs font-medium text-muted-foreground sm:block'>
          <FolderGit2 className='inline size-3.5 sm:hidden' />
          On this machine
        </span>
        <code className='min-w-0 text-[13px] break-all'>{machinePath}</code>
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg
      data-google-mark='official'
      viewBox='0 0 18 18'
      aria-hidden='true'
      className='size-4 shrink-0'
    >
      <path
        fill='#4285F4'
        d='M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.259h2.909c1.702-1.567 2.684-3.878 2.684-6.614Z'
      />
      <path
        fill='#34A853'
        d='M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z'
      />
      <path
        fill='#FBBC05'
        d='M3.963 10.705A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.705V4.963H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.037l3.007-2.332Z'
      />
      <path
        fill='#EA4335'
        d='M9 3.581c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.963l3.007 2.332C4.672 5.166 6.656 3.581 9 3.581Z'
      />
    </svg>
  )
}

function googlePayload(
  clientId: string,
  clientSecret: string,
  domains: string,
  admins: string
) {
  return {
    google_client_id: clientId,
    google_client_secret: clientSecret,
    allowed_google_domains: csv(domains),
    admin_emails: csv(admins),
  }
}
function csv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
function GoogleFields({
  publicUrl,
  values,
  setters,
}: {
  publicUrl: string
  values: {
    clientId: string
    clientSecret: string
    domains: string
    admins: string
  }
  setters: {
    setClientId: (value: string) => void
    setClientSecret: (value: string) => void
    setDomains: (value: string) => void
    setAdmins: (value: string) => void
  }
}) {
  return (
    <div className='grid gap-4 rounded-lg border p-4'>
      <Field label='Google client ID'>
        <Input
          value={values.clientId}
          onChange={(event) => setters.setClientId(event.target.value)}
          required
        />
      </Field>
      <Field label='Google client secret'>
        <Input
          type='password'
          value={values.clientSecret}
          onChange={(event) => setters.setClientSecret(event.target.value)}
          required
          autoComplete='new-password'
        />
      </Field>
      <Field label='Allowed domains'>
        <Input
          placeholder='example.com'
          value={values.domains}
          onChange={(event) => setters.setDomains(event.target.value)}
          required
        />
      </Field>
      <Field label='Administrator emails'>
        <Input
          placeholder='admin@example.com'
          value={values.admins}
          onChange={(event) => setters.setAdmins(event.target.value)}
          required
        />
      </Field>
      <p className='text-xs text-muted-foreground'>
        Google redirect URI:{' '}
        <code className='break-all'>
          {publicUrl.replace(/\/$/, '')}/api/auth/google/callback
        </code>
      </p>
    </div>
  )
}
