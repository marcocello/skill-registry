import { useState } from 'react'
import { copyText, downloadClaudePlugin } from '@/registry/actions'
import { useRegistry } from '@/registry/use-registry'
import {
  Cable,
  Clipboard,
  Download,
  ExternalLink,
  LoaderCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Client = 'Codex' | 'Claude'

const examples = [
  {
    id: 'download',
    title: 'Find and download',
    instruction:
      'Find the best skill for [task], show me the options, then download the complete bundle I choose into this project and preserve its .skill_id.',
  },
  {
    id: 'change',
    title: 'Propose an improvement',
    instruction:
      'Review [skill-slug], improve [what should change], and send the complete updated bundle using the write action available to my access level. Report whether it is published or pending review.',
  },
  {
    id: 'create',
    title: 'Create and upload',
    instruction:
      'Create a new skill named [skill-name] for [purpose]. Search for duplicates first, then send the complete bundle using the write action available to my access level and report the final state.',
  },
] as const

function Copy({
  value,
  label,
  testId,
}: {
  value: string
  label: string
  testId?: string
}) {
  return (
    <div className='flex items-center gap-2 rounded-md border bg-muted/30 p-2'>
      <code
        className='min-w-0 flex-1 overflow-x-auto text-sm whitespace-nowrap'
        data-testid={testId}
      >
        {value}
      </code>
      <Button
        size='icon-sm'
        variant='outline'
        aria-label={label}
        onClick={() => copyText(value, `${label} copied`)}
      >
        <Clipboard />
      </Button>
    </div>
  )
}

export function ConnectPage() {
  const { session } = useRegistry()
  const open = session?.auth_mode === 'none'
  const [client, setClient] = useState<Client>(() =>
    new URLSearchParams(window.location.search).get('client') === 'claude'
      ? 'Claude'
      : 'Codex'
  )
  const [downloadingClaude, setDownloadingClaude] = useState(false)
  const endpoint = `${window.location.origin}/mcp`
  const companionUrl = `${window.location.origin}/companion/skills-registry-guide/SKILL.md`
  const installerUrl = `${window.location.origin}/companion/skills-registry-connect.tgz`
  const codexCliInstall = 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
  const codexInstall = `npx --yes '${installerUrl}' '${window.location.origin}'`
  const hasPublicHttpsEndpoint = window.location.protocol === 'https:'

  async function handleClaudeDownload() {
    setDownloadingClaude(true)
    try {
      await downloadClaudePlugin(endpoint, companionUrl)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not create the plugin'
      toast.error(message)
    } finally {
      setDownloadingClaude(false)
    }
  }

  return (
    <section className='min-h-full'>
      <div className='mx-auto max-w-3xl space-y-4 px-4 py-5 md:px-6'>
        <div>
          <div className='mb-1 flex items-center gap-2 text-sm text-muted-foreground'>
            <Cable className='size-4' />
            MCP connection guide
          </div>
          <h1 className='text-2xl font-semibold'>Connect your assistant</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Add Skill Registry and its companion guide.
          </p>
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <ClientCard
            name='Codex'
            description='One terminal command'
            selected={client === 'Codex'}
            icon={<CodexMark />}
            onSelect={setClient}
          />
          <ClientCard
            name='Claude'
            description='Download a plugin'
            selected={client === 'Claude'}
            icon={<ClaudeMark />}
            onSelect={setClient}
          />
        </div>
        <div className='grid gap-3' data-testid='client-steps'>
          {client === 'Codex' ? (
            <>
              <StepCard title='1. Install Codex'>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Install the CLI, then download the desktop app. Step 2 also
                  needs Node.js/npm.
                </p>
                <div className='mt-3 grid gap-2'>
                  <Copy
                    label='Codex CLI install command'
                    value={codexCliInstall}
                    testId='codex-cli-install-command'
                  />
                  <Button size='sm' variant='outline' asChild>
                    <a
                      href='https://learn.chatgpt.com/docs/app'
                      target='_blank'
                      rel='noreferrer'
                    >
                      Download Codex desktop
                      <ExternalLink />
                    </a>
                  </Button>
                </div>
              </StepCard>
              <StepCard title='2. Connect Skill Registry'>
                <div className='mt-3'>
                  <Copy
                    label='Codex install command'
                    value={codexInstall}
                    testId='codex-install-command'
                  />
                </div>
                {!open ? (
                  <div className='mt-3'>
                    <p className='mb-2 text-xs font-medium'>Then sign in</p>
                    <Copy
                      label='Codex login command'
                      value='codex mcp login skills-registry'
                    />
                  </div>
                ) : null}
                <p className='mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground'>
                  Start a new Codex task. If the guide is not listed, restart
                  Codex.
                </p>
              </StepCard>
              <StepCard title='3. Try it'>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Replace the text in brackets, then paste a prompt into Codex.
                </p>
                <ExampleList client='codex' command='$skills-registry-guide' />
              </StepCard>
            </>
          ) : (
            <>
              <StepCard title='1. Install Claude Desktop'>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Available for macOS and Windows.
                </p>
                <Button className='mt-3' size='sm' variant='outline' asChild>
                  <a
                    href='https://claude.ai/download'
                    target='_blank'
                    rel='noreferrer'
                  >
                    Download Claude Desktop
                    <ExternalLink />
                  </a>
                </Button>
              </StepCard>
              <StepCard title='2. Connect Skill Registry'>
                <Button
                  className='mt-3 w-full sm:w-auto'
                  disabled={downloadingClaude}
                  onClick={handleClaudeDownload}
                >
                  {downloadingClaude ? (
                    <LoaderCircle className='animate-spin' />
                  ) : (
                    <Download />
                  )}
                  Download Claude plugin
                </Button>
                <div className='mt-3 rounded-lg bg-muted/40 px-3 py-3 text-sm'>
                  <p className='font-medium'>Then in Claude Desktop</p>
                  <p className='mt-1 text-muted-foreground'>
                    + → Plugins → Add plugin → Upload plugin → Approve
                  </p>
                </div>
                {!hasPublicHttpsEndpoint ? (
                  <p className='mt-3 text-xs text-amber-700'>
                    Local HTTP works locally. Claude cloud requires public
                    HTTPS.
                  </p>
                ) : null}
                {!open ? (
                  <p className='mt-3 text-xs text-muted-foreground'>
                    Claude will ask you to sign in when it first connects.
                  </p>
                ) : null}
              </StepCard>
              <StepCard title='3. Try it'>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Replace the text in brackets, then paste a prompt into Claude.
                </p>
                <ExampleList client='claude' command='/skills-registry:guide' />
              </StepCard>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function StepCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      className='rounded-xl border bg-white p-4 md:p-5'
      data-testid='client-step-card'
    >
      <h2 className='text-sm font-semibold'>{title}</h2>
      {children}
    </section>
  )
}

function ExampleList({
  client,
  command,
}: {
  client: 'codex' | 'claude'
  command: string
}) {
  return (
    <div className='mt-3 grid gap-2'>
      {examples.map((example) => (
        <ExamplePrompt
          key={example.id}
          title={example.title}
          value={`${command} ${example.instruction}`}
          testId={`${client}-example-${example.id}`}
        />
      ))}
    </div>
  )
}

function ExamplePrompt({
  title,
  value,
  testId,
}: {
  title: string
  value: string
  testId: string
}) {
  return (
    <div className='rounded-lg border bg-muted/20 p-3'>
      <div className='flex items-start justify-between gap-3'>
        <p className='text-xs font-semibold'>{title}</p>
        <Button
          size='icon-sm'
          variant='ghost'
          aria-label={`Copy ${title.toLowerCase()} example`}
          onClick={() => copyText(value, `${title} example copied`)}
        >
          <Clipboard />
        </Button>
      </div>
      <p
        className='mt-1 text-sm leading-5 text-muted-foreground'
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  )
}

function ClientCard({
  name,
  description,
  selected,
  icon,
  onSelect,
}: {
  name: Client
  description: string
  selected: boolean
  icon: React.ReactNode
  onSelect: (client: Client) => void
}) {
  return (
    <button
      type='button'
      aria-label={name}
      aria-pressed={selected}
      data-client-card='provider'
      className={cn(
        'flex min-h-[92px] cursor-pointer flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-[color,background-color,border-color,box-shadow,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.99]',
        selected
          ? 'border-[#18181b] bg-[#fafafa] shadow-[0_0_0_1px_#18181b]'
          : 'border-[#e4e4e7] bg-white hover:border-[#a1a1aa] hover:bg-[#fafafa]'
      )}
      onClick={() => onSelect(name)}
    >
      <span className='flex h-6 items-center text-[#18181b] [&_svg]:size-6'>
        {icon}
      </span>
      <span className='text-sm font-semibold'>{name}</span>
      <span className='text-xs leading-[1.5] text-muted-foreground'>
        {description}
      </span>
    </button>
  )
}

export function CodexMark() {
  return (
    <svg
      viewBox='0 0 24 24'
      aria-hidden='true'
      data-provider-mark='codex'
      fill='currentColor'
    >
      <path d='M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z' />
    </svg>
  )
}

export function ClaudeMark() {
  return (
    <svg
      viewBox='0 0 24 24'
      aria-hidden='true'
      data-provider-mark='claude'
      fill='currentColor'
      className='text-[#d97757]'
    >
      <path d='m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z' />
    </svg>
  )
}
