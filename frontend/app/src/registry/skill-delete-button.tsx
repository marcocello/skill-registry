import { useState } from 'react'
import type { Skill } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function SkillDeleteButton({
  skill,
  compact = false,
  onDeleted,
}: {
  skill: Skill
  compact?: boolean
  onDeleted?: () => void
}) {
  const { role, deleteSkill } = useRegistry()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const displayName = skill.displayName ?? skill.name

  if (role !== 'Admin' && role !== 'Open') return null

  async function confirmDelete() {
    setDeleting(true)
    setError('')
    try {
      const result = await deleteSkill(skill.slug)
      setOpen(false)
      onDeleted?.()
      if (result.git_export.status === 'pending') {
        toast.warning(`${displayName} deleted; Git sync is pending.`)
      } else {
        toast.success(`${displayName} deleted`)
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Skill deletion failed.'
      setError(message)
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return
        setOpen(next)
        if (!next) setError('')
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type='button'
          variant={compact ? 'ghost' : 'outline'}
          size={compact ? 'icon-xs' : 'sm'}
          className='text-destructive hover:text-destructive'
          aria-label={`Delete ${displayName}`}
          title={compact ? `Delete ${displayName}` : undefined}
          onClick={(event) => event.stopPropagation()}
        >
          <Trash2 />
          {compact ? null : 'Delete'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove this skill and all of its versions.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className='text-sm text-destructive' role='alert'>
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            type='button'
            variant='destructive'
            disabled={deleting}
            onClick={() => void confirmDelete()}
          >
            {deleting ? 'Deleting…' : 'Delete skill'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SelectionBar({
  count,
  singleName,
  deleting,
  onClear,
}: {
  count: number
  singleName: string
  deleting: boolean
  onClear: () => void
}) {
  return (
    <div
      className='fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur-sm'
      data-testid='selection-delete-bar'
    >
      <div className='min-w-0'>
        <p className='text-sm font-medium tabular-nums'>
          {count} {count === 1 ? 'skill' : 'skills'} selected
        </p>
        <p className='truncate text-xs text-muted-foreground'>
          {count === 1
            ? singleName
            : 'Delete the selected skills from the Registry'}
        </p>
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={deleting}
          onClick={onClear}
          aria-label='Clear selection'
        >
          Clear
        </Button>
        <AlertDialogTrigger asChild>
          <Button
            type='button'
            variant='destructive'
            size='sm'
            aria-label={`Delete ${count} selected ${count === 1 ? 'skill' : 'skills'}`}
          >
            <Trash2 />
            Delete
          </Button>
        </AlertDialogTrigger>
      </div>
    </div>
  )
}

function SelectionDeleteDialog({
  title,
  description,
  deleting,
  onConfirm,
}: {
  title: string
  description: string
  deleting: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
        <Button
          type='button'
          variant='destructive'
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting ? 'Deleting…' : 'Delete selected'}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

export function SkillSelectionDeleteBar({
  skills,
  onClear,
}: {
  skills: Skill[]
  onClear: () => void
}) {
  const { role, deleteSkill, refreshSkills } = useRegistry()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const count = skills.length
  const singleName =
    count === 1 ? (skills[0].displayName ?? skills[0].name) : ''
  const title =
    count === 1 ? `Delete ${singleName}?` : `Delete ${count} selected skills?`
  const description =
    count === 1
      ? 'This will permanently remove this skill and all of its versions. This action cannot be undone.'
      : `This will permanently remove these ${count} skills and all of their versions. This action cannot be undone.`

  if ((role !== 'Admin' && role !== 'Open') || count === 0) return null

  async function confirmDelete() {
    setDeleting(true)
    const failures: string[] = []
    let deleted = 0
    let pendingGit = 0
    for (const skill of skills) {
      try {
        const result = await deleteSkill(skill.slug)
        deleted += 1
        if (result.git_export.status === 'pending') pendingGit += 1
      } catch {
        failures.push(skill.displayName ?? skill.name)
      }
    }
    if (failures.length) await refreshSkills()
    else onClear()
    setOpen(false)
    setDeleting(false)
    if (failures.length) {
      toast.error(
        `${deleted} deleted; ${failures.length} could not be deleted and remain selected.`
      )
    } else if (pendingGit) {
      toast.warning(`${deleted} deleted; Git sync is pending.`)
    } else {
      toast.success(`${deleted} ${deleted === 1 ? 'skill' : 'skills'} deleted`)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) setOpen(next)
      }}
    >
      <SelectionBar
        count={count}
        singleName={singleName}
        deleting={deleting}
        onClear={onClear}
      />
      <SelectionDeleteDialog
        title={title}
        description={description}
        deleting={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </AlertDialog>
  )
}
