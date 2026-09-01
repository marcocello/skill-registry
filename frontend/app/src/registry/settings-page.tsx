import { useEffect, useState, type FormEvent } from 'react'
import {
  disconnectGit,
  getGitSettings,
  pushGitSettings,
  saveGitSettings,
  startSettingsGithub,
  testGitSettings,
  type GitSettings,
} from '@/registry/setup-api'
import { GithubMark, SetupMode, SetupReveal } from '@/registry/setup-controls'
import { useRegistry } from '@/registry/use-registry'
import { ChevronDown, GitBranch, Link2Off } from 'lucide-react'
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

export function SettingsPage() {
  const { session } = useRegistry()
  const [git, setGit] = useState<GitSettings | null>(null)
  const [connectMode, setConnectMode] = useState<'github' | 'manual' | null>(
    null
  )
  const [gitToken, setGitToken] = useState('')
  const [knownHosts, setKnownHosts] = useState('')
  const [githubName, setGithubName] = useState('skills-registry')
  const [githubVisibility, setGithubVisibility] = useState<
    'private' | 'public'
  >('private')
  const [branch, setBranch] = useState('skills-registry')
  const [githubOptionsOpen, setGithubOptionsOpen] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getGitSettings()
      .then(setGit)
      .catch((error) => setMessage(error.message))
  }, [])

  async function saveManual(event: FormEvent) {
    event.preventDefault()
    if (!git) return
    try {
      const updated = await saveGitSettings(
        {
          transport: git.transport ?? 'https',
          remote_url: git.remote_url,
          branch: git.branch,
          ...(git.transport === 'ssh'
            ? { known_hosts: knownHosts }
            : {
                username: git.username,
                ...(gitToken ? { token: gitToken } : {}),
              }),
        },
        session?.csrf_token
      )
      setGit(updated)
      setConnectMode(null)
      setGitToken('')
      setKnownHosts('')
      setMessage('Manual Git settings saved. Test the remote, then push.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Git save failed.')
    }
  }

  async function connectGithub(event: FormEvent) {
    event.preventDefault()
    try {
      const redirect = await startSettingsGithub(
        {
          repository_name: githubName,
          visibility: githubVisibility,
          branch,
        },
        session?.csrf_token
      )
      window.location.assign(redirect)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'GitHub connection failed.'
      )
    }
  }

  async function gitAction(action: 'test' | 'push' | 'disconnect') {
    try {
      if (action === 'test') {
        await testGitSettings(session?.csrf_token)
        setMessage('Git remote is reachable and branch-compatible.')
      } else if (action === 'push') {
        setGit(await pushGitSettings(session?.csrf_token))
        setMessage('Git mirror pushed.')
      } else {
        setGit(await disconnectGit(session?.csrf_token))
        setConnectMode(null)
        setMessage(
          'Git remote disconnected. Local and provider repositories were preserved.'
        )
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Git operation failed.'
      )
    }
  }

  if (!git)
    return (
      <div className='p-8 text-sm text-muted-foreground'>
        {message || 'Loading Git settings…'}
      </div>
    )

  const selectManual = () => {
    setConnectMode('manual')
    setGit({
      enabled: false,
      provider: 'manual',
      transport: 'https',
      remote_url: '',
      username: '',
      branch: 'skills-registry',
      push_status: 'disabled',
    })
  }

  const selectRemote = (value: 'none' | 'github' | 'manual') => {
    if (value === 'manual') selectManual()
    else {
      setConnectMode(value === 'github' ? 'github' : null)
      if (value === 'none') setGithubOptionsOpen(false)
    }
  }

  return (
    <div className='min-h-full p-4 md:p-8'>
      <div className='mx-auto max-w-3xl'>
        <Card className='gap-5 rounded-[14px] border-[#e4e4e7] bg-white py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]'>
          <CardHeader className='gap-2 px-6'>
            <CardTitle className='text-base leading-none'>Git remote</CardTitle>
            <CardDescription>
              Connect GitHub.com with a guided flow or configure HTTPS/SSH
              manually. Disconnect before switching; local and provider
              repositories are preserved.
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-4 px-6'>
            {!git.enabled ? (
              <>
                <RemoteSelector mode={connectMode} onChange={selectRemote} />
                <SetupReveal
                  open={connectMode === 'github'}
                  name='settings-github'
                >
                  <form
                    className='grid gap-3 rounded-xl border bg-muted/25 p-4'
                    onSubmit={connectGithub}
                  >
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <p className='text-[13px] leading-5 text-muted-foreground'>
                        Choose the account or organization on GitHub. We create
                        the repository and push the portal history after you
                        authorize it.
                      </p>
                      <Button
                        type='submit'
                        size='sm'
                        className='shrink-0 self-start sm:self-auto'
                      >
                        Continue to GitHub.com
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
                        {githubName} · {githubVisibility} · {branch}
                      </span>
                      <ChevronDown
                        className={cn(
                          'ml-auto size-3.5 transition-transform duration-200',
                          githubOptionsOpen && 'rotate-180'
                        )}
                      />
                    </button>
                    <SetupReveal
                      open={githubOptionsOpen}
                      name='settings-github-options'
                    >
                      <div className='grid gap-4 pt-1'>
                        <Field label='GitHub repository name'>
                          <Input
                            value={githubName}
                            onChange={(event) =>
                              setGithubName(event.target.value)
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
                  </form>
                </SetupReveal>
                <SetupReveal
                  open={connectMode === 'manual'}
                  name='settings-manual'
                >
                  <ManualForm
                    git={git}
                    setGit={setGit}
                    gitToken={gitToken}
                    setGitToken={setGitToken}
                    knownHosts={knownHosts}
                    setKnownHosts={setKnownHosts}
                    onSubmit={saveManual}
                    reveal
                  />
                </SetupReveal>
              </>
            ) : git.provider === 'github' ? (
              <GithubConnected git={git} />
            ) : (
              <ManualForm
                git={git}
                setGit={setGit}
                gitToken={gitToken}
                setGitToken={setGitToken}
                knownHosts={knownHosts}
                setKnownHosts={setKnownHosts}
                onSubmit={saveManual}
              />
            )}

            {git.enabled ? (
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => void gitAction('test')}
                >
                  Test
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => void gitAction('push')}
                >
                  Retry push
                </Button>
                <Button
                  type='button'
                  variant='destructive'
                  onClick={() => void gitAction('disconnect')}
                >
                  Disconnect
                </Button>
              </div>
            ) : null}
            <p className='text-xs text-muted-foreground'>
              Status: {git.push_status}
              {git.last_error ? ` — ${git.last_error}` : ''}
            </p>
            <p className='text-sm text-muted-foreground' role='status'>
              {message}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function RemoteSelector({
  mode,
  onChange,
}: {
  mode: 'github' | 'manual' | null
  onChange: (value: 'none' | 'github' | 'manual') => void
}) {
  return (
    <RadioGroup
      aria-label='Remote'
      value={mode ?? 'none'}
      onValueChange={(value) => onChange(value as 'none' | 'github' | 'manual')}
      className='grid gap-3 sm:grid-cols-3'
    >
      <SetupMode
        id='settings-none-remote'
        value='none'
        title='No remote'
        description='Keep everything on this machine for now.'
        selected={mode === null}
        accessibleLabel='No remote'
        kind='provider'
        icon={<Link2Off />}
      />
      <SetupMode
        id='settings-github-remote'
        value='github'
        title='GitHub.com'
        description='One click — authorize and create the repository.'
        selected={mode === 'github'}
        accessibleLabel='GitHub.com'
        kind='provider'
        icon={<GithubMark />}
      />
      <SetupMode
        id='settings-manual-remote'
        value='manual'
        title='Manual'
        description='Any Git host over HTTPS or SSH.'
        selected={mode === 'manual'}
        accessibleLabel='Manual'
        kind='provider'
        icon={<span className='font-mono text-[15px]'>https://</span>}
      />
    </RadioGroup>
  )
}

function GithubConnected({ git }: { git: GitSettings }) {
  return (
    <div className='grid gap-3 rounded-lg border p-4'>
      <div>
        <span className='text-xs text-muted-foreground'>Provider</span>
        <p className='font-medium'>GitHub.com</p>
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div>
          <span className='text-xs text-muted-foreground'>Account</span>
          <p>{git.account_login}</p>
        </div>
        <div>
          <span className='text-xs text-muted-foreground'>Repository</span>
          <p>{git.repository_name}</p>
        </div>
        <div>
          <span className='text-xs text-muted-foreground'>Export branch</span>
          <p className='font-mono text-sm'>{git.branch}</p>
        </div>
        <div>
          <span className='text-xs text-muted-foreground'>Credential</span>
          <p>{git.credential_configured ? 'Configured' : 'Not configured'}</p>
        </div>
      </div>
      <a
        href={git.repository_url ?? '#'}
        target='_blank'
        rel='noreferrer'
        className='text-sm underline underline-offset-4'
      >
        Open repository on GitHub.com
      </a>
    </div>
  )
}

function ManualForm({
  git,
  setGit,
  gitToken,
  setGitToken,
  knownHosts,
  setKnownHosts,
  onSubmit,
  reveal = false,
}: {
  git: GitSettings
  setGit: (git: GitSettings) => void
  gitToken: string
  setGitToken: (value: string) => void
  knownHosts: string
  setKnownHosts: (value: string) => void
  onSubmit: (event: FormEvent) => void
  reveal?: boolean
}) {
  return (
    <form
      className={cn(
        'grid gap-5 rounded-lg border p-4',
        reveal && 'rounded-xl bg-muted/25'
      )}
      onSubmit={onSubmit}
    >
      <Field label='Transport'>
        <RadioGroup
          value={git.transport ?? 'https'}
          onValueChange={(value) =>
            setGit({ ...git, transport: value as 'https' | 'ssh' })
          }
          className='flex gap-5'
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
      </Field>
      <Field label='Remote URL'>
        <Input
          value={git.remote_url ?? ''}
          onChange={(event) =>
            setGit({ ...git, remote_url: event.target.value })
          }
          required
        />
      </Field>
      <Field label='Export branch'>
        <Input
          value={git.branch}
          onChange={(event) => setGit({ ...git, branch: event.target.value })}
          required
        />
      </Field>
      {git.transport === 'ssh' ? (
        <>
          <Field label='Verified known_hosts entry'>
            <Input
              value={knownHosts}
              onChange={(event) => setKnownHosts(event.target.value)}
              required={!git.credential_configured}
            />
          </Field>
          {git.public_key ? (
            <code className='rounded-md bg-muted p-3 text-xs break-all'>
              {git.public_key}
            </code>
          ) : null}
        </>
      ) : (
        <>
          <Field label='HTTPS username'>
            <Input
              value={git.username ?? ''}
              onChange={(event) =>
                setGit({ ...git, username: event.target.value })
              }
              required
            />
          </Field>
          <Field label='HTTPS token'>
            <Input
              type='password'
              value={gitToken}
              onChange={(event) => setGitToken(event.target.value)}
              placeholder={
                git.credential_configured
                  ? 'Configured — leave blank to preserve'
                  : 'Required'
              }
              required={!git.credential_configured}
            />
          </Field>
        </>
      )}
      <Button>Save Manual settings</Button>
    </form>
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
    <Label className='grid gap-2'>
      <span>{label}</span>
      {children}
    </Label>
  )
}
