import { useEffect, useMemo, useState } from 'react'
import { copyText, formatBytes, mcpPrompt } from '@/registry/actions'
import { BundleFileTree } from '@/registry/bundle-file-tree'
import { demoDataEnabled } from '@/registry/demo-data'
import { LibraryTransferActions } from '@/registry/library-transfer-actions'
import { PromptAction } from '@/registry/prompt-action'
import { SkillDeleteButton } from '@/registry/skill-delete-button'
import type { RoutePath, Skill } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import {
  ArrowLeft,
  Clipboard,
  FolderTree,
  GitCommitHorizontal,
  GitPullRequest,
  Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function SkillMetadata({ skill }: { skill: Skill }) {
  const values = [
    ['Owner', skill.owner ?? 'Owner not recorded'],
    ['Bundle', `${skill.files.length} files · ${formatBytes(skill)}`],
    ['Updated', skill.updated],
  ]
  return (
    <dl className='grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3'>
      {values.map(([label, value]) => (
        <div key={label} className='bg-background px-4 py-3'>
          <dt className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
            {label}
          </dt>
          <dd className='mt-1 text-sm font-medium'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function FilesTab({ skill }: { skill: Skill }) {
  const [selectedPath, setSelectedPath] = useState(
    () =>
      skill.files.find((file) => file.path === 'SKILL.md')?.path ??
      skill.files[0]?.path ??
      ''
  )
  const file =
    skill.files.find((item) => item.path === selectedPath) ?? skill.files[0]
  const lines = file?.content.split('\n') ?? []

  return (
    <div
      className='grid min-h-[430px] overflow-clip rounded-lg border lg:grid-cols-[240px_minmax(0,1fr)]'
      data-testid='files-layout'
    >
      <div className='border-b bg-muted/20 p-2 lg:border-r lg:border-b-0'>
        <div className='px-2 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
          Bundle files
        </div>
        <BundleFileTree
          files={skill.files}
          selectedPath={file?.path ?? ''}
          onSelect={setSelectedPath}
        />
      </div>
      <div
        className='min-w-0 bg-background text-foreground'
        data-testid='file-viewer-shell'
      >
        <div className='flex h-11 items-center justify-between border-b bg-muted/20 px-4 text-sm'>
          <span className='truncate font-mono'>{file?.path}</span>
          <Button
            variant='ghost'
            size='xs'
            className='text-muted-foreground hover:bg-muted hover:text-foreground'
            disabled={file?.binary}
            onClick={() =>
              file && copyText(file.content, 'File content copied')
            }
          >
            <Clipboard />
            Copy
          </Button>
        </div>
        {file?.binary ? (
          <div className='grid min-h-80 place-items-center p-8 text-center text-sm text-muted-foreground'>
            Binary preview is not available. Use the skill action above to
            retrieve this file with your connected tool.
          </div>
        ) : (
          <div
            className='p-4 pb-6 font-mono text-sm leading-6'
            data-testid='file-viewer'
          >
            {lines.map((line, index) => (
              <div
                className='grid grid-cols-[2.5rem_minmax(0,1fr)]'
                key={`${index}-${line}`}
              >
                <span className='pr-4 text-right text-muted-foreground/70 select-none'>
                  {index + 1}
                </span>
                <code className='break-words whitespace-pre-wrap'>
                  {line || ' '}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        aria-hidden='true'
        className='pointer-events-none sticky bottom-0 z-10 col-span-full h-2 border-t bg-background/95 backdrop-blur-sm'
        data-testid='bundle-visible-bottom'
      />
    </div>
  )
}

function ProposalsTab({ skill }: { skill: Skill }) {
  const { proposals } = useRegistry()
  const matching = proposals.filter((proposal) => proposal.slug === skill.slug)
  if (!matching.length)
    return (
      <div className='rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground'>
        No proposals have been submitted for this skill.
      </div>
    )
  return (
    <div className='space-y-3'>
      {matching.map((proposal) => (
        <article key={proposal.id} className='rounded-lg border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-2'>
            <div>
              <h3 className='font-medium'>{proposal.name}</h3>
              <p className='mt-1 text-sm text-muted-foreground'>
                {proposal.author} · {Object.keys(proposal.files).length} files
              </p>
            </div>
            <Badge
              variant={proposal.status === 'pending' ? 'secondary' : 'outline'}
            >
              {proposal.status}
            </Badge>
          </div>
          <p className='mt-3 text-sm leading-6'>{proposal.description}</p>
          <div className='mt-3 flex flex-wrap gap-2'>
            {Object.keys(proposal.files).map((file) => (
              <Badge
                variant='outline'
                key={file}
                className='font-mono font-normal'
              >
                {file}
              </Badge>
            ))}
          </div>
          <pre className='mt-3 overflow-auto rounded-md bg-slate-950 p-3 text-sm leading-6 text-slate-100'>
            {typeof proposal.files['SKILL.md'] === 'string'
              ? proposal.files['SKILL.md']
              : ''}
          </pre>
        </article>
      ))}
    </div>
  )
}

function HistoryTab({ skill }: { skill: Skill }) {
  return (
    <div className='overflow-hidden rounded-lg border'>
      {skill.history.map((version, index) => (
        <div
          key={`${version.version}-${version.date}`}
          className={cn('flex gap-3 p-4', index > 0 && 'border-t')}
        >
          <span className='grid size-8 shrink-0 place-items-center rounded-full bg-muted'>
            <GitCommitHorizontal className='size-4' />
          </span>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>Version {version.version}</span>
              <Badge variant='outline'>{version.date}</Badge>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>{version.note}</p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Published by {version.author}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkillPage({
  slug,
  navigate,
}: {
  slug: string
  navigate: (path: RoutePath) => void
}) {
  const { role, skills, proposals, detailStatus, loadSkill } = useRegistry()
  const skill = skills.find((item) => item.slug === slug)
  const liveStatus = detailStatus[slug] ?? 'idle'

  useEffect(() => {
    if (!demoDataEnabled) void loadSkill(slug)
  }, [loadSkill, slug])
  const proposalCount = useMemo(
    () =>
      proposals.filter(
        (proposal) => proposal.slug === slug && proposal.status === 'pending'
      ).length,
    [proposals, slug]
  )

  if (!demoDataEnabled && (liveStatus === 'idle' || liveStatus === 'loading'))
    return (
      <div className='grid h-full place-items-center text-sm text-muted-foreground'>
        Loading skill…
      </div>
    )

  if (!demoDataEnabled && liveStatus === 'error')
    return (
      <div className='grid h-full place-items-center'>
        <div className='text-center'>
          <h1 className='text-xl font-semibold'>Could not load this skill.</h1>
          <Button
            className='mt-4'
            variant='outline'
            onClick={() => void loadSkill(slug)}
            aria-label='Retry loading skill'
          >
            Retry
          </Button>
        </div>
      </div>
    )

  if (!skill || (!demoDataEnabled && liveStatus === 'not-found'))
    return (
      <div className='grid h-full place-items-center'>
        <div className='text-center'>
          <h1 className='text-xl font-semibold'>Skill not found</h1>
          <Button className='mt-4' onClick={() => navigate('/')}>
            Back to Library
          </Button>
        </div>
      </div>
    )

  return (
    <section className='min-h-full' aria-labelledby='skill-title'>
      <div className='mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6 md:py-6'>
        <Button
          variant='ghost'
          size='sm'
          className='-ml-2'
          onClick={() => navigate('/')}
        >
          <ArrowLeft />
          Back to Library
        </Button>
        <div className='flex flex-col justify-between gap-4 lg:flex-row lg:items-start'>
          <div className='min-w-0'>
            <div className='mb-2 flex flex-wrap items-center gap-2'>
              <Badge>
                {demoDataEnabled ? 'Current' : skill.gitExportStatus}
              </Badge>
              <Badge variant='outline'>Version {skill.version}</Badge>
              {skill.purpose ? (
                <Badge variant='outline'>{skill.purpose}</Badge>
              ) : null}
              {slug.includes('-variant') ? (
                <Badge variant='secondary'>Fork</Badge>
              ) : null}
            </div>
            <h1
              id='skill-title'
              className='text-2xl font-semibold tracking-tight'
            >
              {skill.displayName ?? skill.name}
            </h1>
            <p className='mt-2 max-w-3xl text-sm leading-6 text-muted-foreground'>
              {skill.description}
            </p>
            <p className='mt-2 font-mono text-xs text-muted-foreground'>
              {skill.slug}
            </p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <LibraryTransferActions
              selectedSkills={[skill]}
              includeZip={false}
            />
            {demoDataEnabled ? (
              <PromptAction
                title='Propose an edit'
                description='Users submit a reviewable proposal through a connected MCP client.'
                prompt={mcpPrompt('propose', skill)}
              >
                <Button variant='outline' size='sm'>
                  <GitPullRequest />
                  Propose edit
                </Button>
              </PromptAction>
            ) : null}
            {role === 'Admin' ? (
              <PromptAction
                title='Edit as administrator'
                description='Direct edit remains an MCP action and asks for confirmation before publishing.'
                prompt={mcpPrompt('edit', skill)}
              >
                <Button variant='outline' size='sm' data-testid='admin-edit'>
                  <Pencil />
                  Edit with MCP
                </Button>
              </PromptAction>
            ) : null}
            <SkillDeleteButton skill={skill} onDeleted={() => navigate('/')} />
          </div>
        </div>
        <SkillMetadata skill={skill} />
        <Tabs defaultValue='files'>
          <TabsList>
            <TabsTrigger value='files'>
              <FolderTree />
              Files
            </TabsTrigger>
            {demoDataEnabled ? (
              <TabsTrigger value='proposals'>
                <GitPullRequest />
                Proposals{' '}
                {proposalCount ? (
                  <Badge variant='secondary' className='ml-1 h-5 px-1.5'>
                    {proposalCount}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value='history'>
              <GitCommitHorizontal />
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value='files' className='mt-4'>
            <FilesTab skill={skill} />
          </TabsContent>
          {demoDataEnabled ? (
            <TabsContent value='proposals' className='mt-4'>
              <ProposalsTab skill={skill} />
            </TabsContent>
          ) : null}
          <TabsContent value='history' className='mt-4'>
            <HistoryTab skill={skill} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  )
}
