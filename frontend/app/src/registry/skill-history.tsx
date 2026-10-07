import { useState } from 'react'
import { BundleComparison, SideBySideDiff } from '@/registry/bundle-diff'
import { restoreRegistrySkill } from '@/registry/registry-api'
import type { Skill } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import { GitCommitHorizontal, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function SkillHistory({ skill }: { skill: Skill }) {
  const { role, session, loadSkill, refreshSkills } = useRegistry()
  const [fromVersion, setFromVersion] = useState(
    skill.history[1]?.version ?? skill.version
  )
  const [toVersion, setToVersion] = useState(skill.version)
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const from =
    skill.history.find((item) => item.version === fromVersion) ??
    skill.history[0]
  const to =
    skill.history.find((item) => item.version === toVersion) ?? skill.history[0]
  const canRestore =
    skill.source === 'registry' && (role === 'Admin' || role === 'Open')

  async function restore() {
    if (!session || restoreVersion === null || restoring) return
    setRestoring(true)
    setError('')
    try {
      const result = await restoreRegistrySkill(
        skill.slug,
        restoreVersion,
        skill.version,
        session
      )
      setRestoreVersion(null)
      setToVersion(result.version)
      await refreshSkills()
      await loadSkill(skill.slug)
      if (result.git_export.status === 'pending')
        toast.warning(
          `Version ${result.version} is current; Git sync is pending.`
        )
      else toast.success(`Version ${result.version} is now current`)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Version restoration failed.'
      )
    } finally {
      setRestoring(false)
    }
  }

  if (!skill.history.length)
    return (
      <p className='rounded-lg border p-8 text-sm text-muted-foreground'>
        No published versions are available.
      </p>
    )
  return (
    <div className='space-y-4'>
      <div className='overflow-hidden rounded-lg border'>
        {skill.history.map((version) => (
          <article
            key={version.version}
            className='flex flex-wrap items-center gap-3 border-b p-4 last:border-b-0'
          >
            <span className='grid size-8 shrink-0 place-items-center rounded-full bg-muted'>
              <GitCommitHorizontal className='size-4' />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>Version {version.version}</span>
                <Badge variant='outline'>{version.date}</Badge>
                {version.version === skill.version ? (
                  <Badge>Current default</Badge>
                ) : null}
              </div>
              <p className='mt-1 text-sm text-muted-foreground'>
                {version.note}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                Published by {version.author}
              </p>
            </div>
            {canRestore && version.version !== skill.version ? (
              <Button
                variant='outline'
                size='sm'
                disabled={restoring}
                aria-label={`Make version ${version.version} default`}
                onClick={() => {
                  setError('')
                  setRestoreVersion(version.version)
                }}
              >
                <RotateCcw />
                Make default
              </Button>
            ) : null}
          </article>
        ))}
      </div>
      <div className='flex flex-wrap gap-4'>
        <label className='space-y-1 text-sm font-medium'>
          Compare from version
          <select
            aria-label='Compare from version'
            className='block h-9 rounded-md border bg-background px-3'
            value={from?.version ?? ''}
            onChange={(event) => setFromVersion(Number(event.target.value))}
          >
            {skill.history.map((version) => (
              <option key={version.version} value={version.version}>
                Version {version.version}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-sm font-medium'>
          Compare to version
          <select
            aria-label='Compare to version'
            className='block h-9 rounded-md border bg-background px-3'
            value={to?.version ?? ''}
            onChange={(event) => setToVersion(Number(event.target.value))}
          >
            {skill.history.map((version) => (
              <option key={version.version} value={version.version}>
                Version {version.version}
              </option>
            ))}
          </select>
        </label>
      </div>
      {from?.files && to?.files ? (
        <>
          {from.name !== to.name || from.description !== to.description ? (
            <div className='overflow-hidden rounded-lg border'>
              <div className='border-b px-3 py-2 text-sm font-medium'>
                Skill metadata
              </div>
              {from.name !== to.name ? (
                <SideBySideDiff
                  before={from.name ?? ''}
                  after={to.name ?? ''}
                  beforeLabel={`Name · version ${from.version}`}
                  afterLabel={`Name · version ${to.version}`}
                />
              ) : null}
              {from.description !== to.description ? (
                <SideBySideDiff
                  before={from.description ?? ''}
                  after={to.description ?? ''}
                  beforeLabel={`Description · version ${from.version}`}
                  afterLabel={`Description · version ${to.version}`}
                />
              ) : null}
            </div>
          ) : null}
          <BundleComparison
            before={from.files}
            after={to.files}
            beforeLabel={`Version ${from.version}`}
            afterLabel={`Version ${to.version}`}
          />
        </>
      ) : (
        <p className='rounded-lg border p-8 text-sm text-muted-foreground'>
          Bundle contents are unavailable for these historical versions.
        </p>
      )}
      <AlertDialog
        open={restoreVersion !== null}
        onOpenChange={(open) => {
          if (!open && !restoring) {
            setRestoreVersion(null)
            setError('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Make version {restoreVersion} the default?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This publishes version {restoreVersion}'s complete bundle and
              metadata as a new current version after version {skill.version}.
              Existing history is preserved. Downloads and connected tools will
              use the restored bundle.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <Button disabled={restoring} onClick={() => void restore()}>
              {restoring ? 'Restoring…' : 'Restore & publish'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
