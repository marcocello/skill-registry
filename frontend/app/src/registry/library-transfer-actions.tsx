import { useRef, useState } from 'react'
import { copyText } from '@/registry/actions'
import { ClaudeMark, CodexMark } from '@/registry/connect-page'
import {
  downloadRegistryArchive,
  uploadRegistryArchive,
} from '@/registry/skill-transfer-api'
import type { Skill } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  LoaderCircle,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Assistant = 'codex' | 'claude'
type Direction = 'download' | 'upload'
type Guidance = { assistant: Assistant; direction: Direction }
type TransferSkill = Pick<Skill, 'slug' | 'name' | 'displayName'>

function selectedDownloadPrompt(command: string, skills: TransferSkill[]) {
  const targets = skills.map(
    (skill) =>
      `“${skill.displayName ?? skill.name}” (Registry slug \`${skill.slug}\`)`
  )
  if (targets.length === 1)
    return `${command} Download ${targets[0]} from this Skill Registry into this project. Save its complete bundle without changing its \`.skill_id\`, then confirm the downloaded skill.`
  return `${command} Download these selected skills from this Skill Registry into this project:\n${targets.map((target) => `- ${target}`).join('\n')}\nSave every complete bundle without changing its \`.skill_id\`, then confirm each downloaded skill.`
}

function selectedUploadPrompt(command: string, skills: TransferSkill[]) {
  const targets = skills.map(
    (skill) =>
      `“${skill.displayName ?? skill.name}” (Registry slug \`${skill.slug}\`)`
  )
  if (targets.length === 1)
    return `${command} Upload the complete local bundle for ${targets[0]} from this project to this Skill Registry. Search for the same \`.skill_id\` or slug first, use the write action available to my access level, and report the confirmed published or pending-review result.`
  return `${command} Upload the complete local bundles for these selected skills from this project to this Skill Registry:\n${targets.map((target) => `- ${target}`).join('\n')}\nSearch for each matching \`.skill_id\` or slug first, use the write action available to my access level, and report every confirmed published or pending-review result.`
}

function transferPrompt(
  { assistant, direction }: Guidance,
  selectedSkills: TransferSkill[]
) {
  const command =
    assistant === 'codex' ? '$skills-registry-guide' : '/skills-registry:guide'
  if (direction === 'upload')
    return selectedSkills.length
      ? selectedUploadPrompt(command, selectedSkills)
      : `${command} Upload the complete skill bundle in this project to this Skill Registry. Search for the same .skill_id or slug first, use the write action available to my access level, and report the confirmed published or pending-review result.`
  return selectedSkills.length
    ? selectedDownloadPrompt(command, selectedSkills)
    : `${command} Find the best skill for [task] in this Skill Registry, show me the options, then download the complete bundle I choose into this project without changing its .skill_id.`
}

function assistantName(assistant: Assistant) {
  return assistant === 'codex' ? 'Codex' : 'Claude'
}

export function LibraryTransferActions({
  selectedSkills = [],
  includeZip = true,
}: {
  selectedSkills?: TransferSkill[]
  includeZip?: boolean
}) {
  const { session, skills, refreshSkills, refreshProposals } = useRegistry()
  const inputRef = useRef<HTMLInputElement>(null)
  const [guidance, setGuidance] = useState<Guidance | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadRegistryArchive()
      toast.success('Registry ZIP downloaded')
    } catch (problem) {
      toast.error(
        problem instanceof Error ? problem.message : 'Download failed'
      )
    } finally {
      setDownloading(false)
    }
  }

  async function handleUpload() {
    if (!file || uploading) return
    setUploading(true)
    setError(null)
    setMessage(null)
    try {
      const result = await uploadRegistryArchive(file, session)
      if (result.outcome === 'published') {
        setMessage(`${result.skill?.slug ?? 'Skill'} published successfully.`)
        await refreshSkills()
      } else {
        setMessage(`${result.proposal?.slug ?? 'Skill'} submitted for review.`)
        await refreshProposals()
      }
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'The Registry could not accept this ZIP.'
      )
    } finally {
      setUploading(false)
    }
  }

  async function handleCopy() {
    if (!guidance) return
    await copyText(
      transferPrompt(guidance, selectedSkills),
      'Assistant prompt copied'
    )
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_400)
  }

  function openUploader() {
    setFile(null)
    setMessage(null)
    setError(null)
    setUploadOpen(true)
  }

  return (
    <>
      <div className='flex flex-wrap items-center gap-2'>
        <TransferMenu
          direction='download'
          disabled={downloading}
          includeZip={includeZip}
          zipDisabled={!skills.length || downloading}
          onAssistant={(assistant) =>
            setGuidance({ assistant, direction: 'download' })
          }
          onZip={() => void handleDownload()}
        />
        <TransferMenu
          direction='upload'
          disabled={uploading}
          includeZip={includeZip}
          onAssistant={(assistant) =>
            setGuidance({ assistant, direction: 'upload' })
          }
          onZip={openUploader}
        />
      </div>

      <Dialog
        open={guidance !== null}
        onOpenChange={(open) => !open && setGuidance(null)}
      >
        <DialogContent
          className='sm:max-w-xl'
          data-testid='assistant-transfer-dialog'
        >
          {guidance ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {guidance.direction === 'download' ? 'Download' : 'Upload'}{' '}
                  with {assistantName(guidance.assistant)}
                </DialogTitle>
                <DialogDescription>
                  Connect Skill Registry to {assistantName(guidance.assistant)}{' '}
                  first. Then copy this prompt into a new{' '}
                  {assistantName(guidance.assistant)} task.
                </DialogDescription>
              </DialogHeader>
              <div
                className='rounded-lg border bg-muted/35 p-4 font-mono text-sm leading-6 break-words whitespace-pre-wrap'
                data-testid='assistant-transfer-prompt'
              >
                {transferPrompt(guidance, selectedSkills)}
              </div>
              <DialogFooter className='sm:justify-between'>
                <Button variant='outline' asChild>
                  <a
                    href={`/connect?client=${guidance.assistant}`}
                    target='_blank'
                    rel='noreferrer'
                  >
                    Connect {assistantName(guidance.assistant)}
                    <ExternalLink />
                  </a>
                </Button>
                <Button onClick={() => void handleCopy()}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied' : 'Copy prompt'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className='sm:max-w-lg' data-testid='zip-uploader'>
          <DialogHeader>
            <DialogTitle>Upload a skill ZIP</DialogTitle>
            <DialogDescription>
              Choose one skill bundle. Registry downloads include the identity
              needed for safe updates.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={inputRef}
            type='file'
            accept='.zip,application/zip'
            className='sr-only'
            aria-label='Skill ZIP file'
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setError(null)
              setMessage(null)
            }}
          />
          <button
            type='button'
            className='flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 px-5 py-6 text-center transition-[border-color,background-color,transform] duration-180 ease-out hover:border-foreground/35 hover:bg-muted/35 active:scale-[0.995]'
            onClick={() => inputRef.current?.click()}
          >
            <FileArchive className='size-6 text-muted-foreground' />
            <span className='text-sm font-medium'>
              {file ? file.name : 'Choose a ZIP archive'}
            </span>
            <span className='text-xs text-muted-foreground'>
              {file
                ? `${Math.max(1, Math.ceil(file.size / 1024))} KB selected`
                : 'One bundle · up to 1,000 files / 20 MB contents'}
            </span>
          </button>
          <div aria-live='polite' className='min-h-5 text-sm'>
            {error ? <p className='text-destructive'>{error}</p> : null}
            {message ? <p className='text-emerald-700'>{message}</p> : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setUploadOpen(false)}>
              Close
            </Button>
            <Button
              disabled={!file || uploading || Boolean(message)}
              onClick={() => void handleUpload()}
            >
              {uploading ? (
                <LoaderCircle className='animate-spin' />
              ) : (
                <Upload />
              )}
              {uploading ? 'Uploading…' : 'Upload skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TransferMenu({
  direction,
  disabled,
  includeZip,
  zipDisabled,
  onAssistant,
  onZip,
}: {
  direction: Direction
  disabled?: boolean
  includeZip: boolean
  zipDisabled?: boolean
  onAssistant: (assistant: Assistant) => void
  onZip: () => void
}) {
  const label = direction === 'download' ? 'Download' : 'Upload'
  const Icon = direction === 'download' ? Download : Upload
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant={direction === 'download' ? 'outline' : 'default'}
          disabled={disabled}
        >
          <Icon />
          {label}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-52'>
        <DropdownMenuLabel>{label} with</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAssistant('codex')}>
          <span className='size-4'>
            <CodexMark />
          </span>
          Codex
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAssistant('claude')}>
          <span className='size-4'>
            <ClaudeMark />
          </span>
          Claude
        </DropdownMenuItem>
        {includeZip ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={zipDisabled} onSelect={onZip}>
              <FileArchive />
              ZIP archive
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
