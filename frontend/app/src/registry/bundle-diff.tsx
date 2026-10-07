import { useMemo, useState } from 'react'
import { BundleFileTree } from '@/registry/bundle-file-tree'
import type { BundleFiles, FileContent } from '@/registry/types'
import { diffLines, diffWordsWithSpace } from 'diff'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export type FileChange = 'Added' | 'Deleted' | 'Modified' | 'Unchanged'

function sameContent(
  left: FileContent | undefined,
  right: FileContent | undefined
) {
  if (typeof left === 'string' || typeof right === 'string')
    return left === right
  return left?.data === right?.data
}

function fileChange(
  left: FileContent | undefined,
  right: FileContent | undefined
): FileChange {
  if (left === undefined) return 'Added'
  if (right === undefined) return 'Deleted'
  return sameContent(left, right) ? 'Unchanged' : 'Modified'
}

type DiffCell = {
  number: number
  text: string
  kind: 'added' | 'removed' | 'same'
}
type DiffRow = { left?: DiffCell; right?: DiffCell }

function lines(value: string) {
  const result = value.split('\n')
  if (result[result.length - 1] === '') result.pop()
  return result
}

function alignedRows(
  before: string,
  after: string
): { rows: DiffRow[]; limited: boolean } {
  // Bound comparison work for large, completely different bundles.
  const changes = diffLines(before, after, {
    timeout: 100,
    maxEditLength: 4000,
  })
  if (!changes) {
    const left = lines(before),
      right = lines(after)
    return {
      limited: true,
      rows: Array.from(
        { length: Math.max(left.length, right.length) },
        (_, i) => ({
          left:
            i < left.length
              ? { number: i + 1, text: left[i], kind: 'same' }
              : undefined,
          right:
            i < right.length
              ? { number: i + 1, text: right[i], kind: 'same' }
              : undefined,
        })
      ),
    }
  }
  const rows: DiffRow[] = []
  let leftNumber = 1,
    rightNumber = 1
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (!change.added && !change.removed) {
      for (const text of lines(change.value))
        rows.push({
          left: { number: leftNumber++, text, kind: 'same' },
          right: { number: rightNumber++, text, kind: 'same' },
        })
      continue
    }
    const removed: string[] = [],
      added: string[] = []
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      const part = changes[i]
      ;(part.removed ? removed : added).push(...lines(part.value))
      i++
    }
    i--
    for (let j = 0; j < Math.max(removed.length, added.length); j++)
      rows.push({
        left:
          j < removed.length
            ? { number: leftNumber++, text: removed[j], kind: 'removed' }
            : undefined,
        right:
          j < added.length
            ? { number: rightNumber++, text: added[j], kind: 'added' }
            : undefined,
      })
  }
  return { rows, limited: false }
}

function DiffText({ cell, other }: { cell: DiffCell; other?: DiffCell }) {
  const parts =
    cell.kind !== 'same' && other && other.kind !== 'same'
      ? diffWordsWithSpace(
          cell.kind === 'removed' ? cell.text : other.text,
          cell.kind === 'added' ? cell.text : other.text,
          { timeout: 10, maxEditLength: 1000 }
        )
      : undefined
  if (!parts) return <>{cell.text || ' '}</>
  return parts
    .filter((part) => (cell.kind === 'added' ? !part.removed : !part.added))
    .map((part, index) => (
      <span
        key={index}
        className={cn(
          (part.added || part.removed) && 'rounded-sm bg-foreground/15'
        )}
      >
        {part.value}
      </span>
    ))
}

function DiffSide({ cell, other }: { cell?: DiffCell; other?: DiffCell }) {
  return (
    <div
      data-change={cell?.kind}
      className={cn(
        'grid min-w-0 grid-cols-[3rem_1rem_minmax(0,1fr)] px-2',
        cell?.kind === 'removed' && 'bg-red-500/10',
        cell?.kind === 'added' && 'bg-emerald-500/10',
        !cell && 'bg-muted/30'
      )}
    >
      <span className='pr-2 text-right text-muted-foreground select-none'>
        {cell?.number}
      </span>
      <span
        aria-label={
          cell?.kind === 'removed'
            ? 'Deleted line'
            : cell?.kind === 'added'
              ? 'Added line'
              : undefined
        }
        className='text-muted-foreground select-none'
      >
        {cell?.kind === 'removed' ? '−' : cell?.kind === 'added' ? '+' : ' '}
      </span>
      <code className='min-w-0 break-words whitespace-pre-wrap'>
        {cell ? <DiffText cell={cell} other={other} /> : ' '}
      </code>
    </div>
  )
}

export function SideBySideDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: string
  after: string
  beforeLabel: string
  afterLabel: string
}) {
  const { rows, limited } = useMemo(
    () => alignedRows(before, after),
    [before, after]
  )
  return (
    <div data-testid='side-by-side-diff' className='overflow-x-auto'>
      <div className='min-w-[520px]'>
        <div className='grid grid-cols-2 border-b bg-muted/20 text-xs font-medium text-muted-foreground'>
          <div className='border-r px-3 py-2'>{beforeLabel}</div>
          <div className='px-3 py-2'>{afterLabel}</div>
        </div>
        {before === after ? (
          <p className='p-3 text-sm text-muted-foreground'>
            No changes in this file.
          </p>
        ) : null}
        {limited ? (
          <p className='p-3 text-sm text-muted-foreground'>
            Detailed highlighting is unavailable for this large change. Both
            full files are shown.
          </p>
        ) : null}
        <div className='max-h-[600px] overflow-y-auto py-2 font-mono text-xs leading-6'>
          {rows.map((row, index) => (
            <div
              key={index}
              className='grid grid-cols-2 [&>div:first-child]:border-r'
            >
              <DiffSide cell={row.left} other={row.right} />
              <DiffSide cell={row.right} other={row.left} />
            </div>
          ))}
        </div>
        <div className='grid grid-cols-2 text-xs text-muted-foreground'>
          <div className='px-3'>
            {before && !before.endsWith('\n')
              ? 'No newline at end of file'
              : null}
          </div>
          <div className='px-3'>
            {after && !after.endsWith('\n')
              ? 'No newline at end of file'
              : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function BundleComparison({
  before,
  after,
  beforeLabel,
  afterLabel,
  onEdit,
}: {
  before: BundleFiles
  after: BundleFiles
  beforeLabel: string
  afterLabel: string
  onEdit?: (path: string, content: string) => void
}) {
  const [selectedPath, setSelectedPath] = useState('SKILL.md')
  const [mode, setMode] = useState<'diff' | 'edit'>('diff')
  const paths = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort()
  const path = paths.includes(selectedPath) ? selectedPath : (paths[0] ?? '')
  const left = before[path],
    right = after[path]
  const status = fileChange(left, right)
  const binary =
    (left !== undefined && typeof left !== 'string') ||
    (right !== undefined && typeof right !== 'string')
  const files = paths.map((path) => ({ path, content: '', binary: false }))
  const statuses = Object.fromEntries(
    paths.map((path) => [path, fileChange(before[path], after[path])])
  )
  const editable = typeof right === 'string'
  return (
    <div className='grid overflow-hidden rounded-lg border lg:grid-cols-[200px_minmax(0,1fr)]'>
      <aside className='border-b bg-muted/20 p-2 lg:border-r lg:border-b-0'>
        <div className='px-2 py-2 text-xs font-semibold text-muted-foreground uppercase'>
          Bundle files · {paths.length}
        </div>
        <BundleFileTree
          files={files}
          selectedPath={path}
          onSelect={setSelectedPath}
          statuses={statuses}
        />
      </aside>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 p-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate font-mono text-sm' title={path}>
              {path}
            </span>
            <Badge variant='outline'>{status}</Badge>
          </div>
          {onEdit ? (
            <div className='flex gap-1'>
              <Button
                size='xs'
                variant={mode === 'diff' ? 'secondary' : 'ghost'}
                onClick={() => setMode('diff')}
              >
                Differences
              </Button>
              <Button
                size='xs'
                variant={mode === 'edit' ? 'secondary' : 'ghost'}
                disabled={!editable}
                onClick={() => setMode('edit')}
              >
                Edit file
              </Button>
            </div>
          ) : null}
        </div>
        {mode === 'edit' && onEdit && editable ? (
          <div className='p-3'>
            <label className='block space-y-1 text-sm font-medium'>
              File content: {path}
              <Textarea
                aria-label={`File content: ${path}`}
                className='min-h-72 font-mono'
                value={right}
                onChange={(event) => onEdit(path, event.target.value)}
              />
            </label>
          </div>
        ) : binary ? (
          <div className='p-8 text-sm text-muted-foreground'>
            {status === 'Modified'
              ? 'Binary file changed. '
              : `Binary file ${status.toLowerCase()}. `}
            Binary assets are preserved; text differences are unavailable.
          </div>
        ) : path ? (
          <SideBySideDiff
            before={typeof left === 'string' ? left : ''}
            after={typeof right === 'string' ? right : ''}
            beforeLabel={beforeLabel}
            afterLabel={afterLabel}
          />
        ) : (
          <p className='p-8 text-sm text-muted-foreground'>
            This bundle has no files.
          </p>
        )}
      </div>
    </div>
  )
}
