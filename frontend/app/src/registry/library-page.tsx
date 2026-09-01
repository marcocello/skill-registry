import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createColumnHelper,
  useTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import { demoDataEnabled } from '@/registry/demo-data'
import { LibraryTransferActions } from '@/registry/library-transfer-actions'
import { SkillSelectionDeleteBar } from '@/registry/skill-delete-button'
import type { RoutePath, Skill, SkillStatus } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import { BookOpen, GitPullRequest, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
} from '@/components/reui/data-grid/data-grid'
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header'
import {
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from '@/components/reui/data-grid/data-grid-table'
import { DataGridTableVirtual } from '@/components/reui/data-grid/data-grid-table-virtual'

const PAGE_SIZE = 24
const skillPurposes: string[] = []
const columnHelper = createColumnHelper<typeof dataGridFeatures, Skill>()

function skillDisplayName(skill: Skill) {
  return skill.displayName ?? skill.name
}

function useFilteredSkills() {
  const { skills } = useRegistry()
  const [query, setQuery] = useState('')
  const [purpose, setPurpose] = useState('all')
  const [status, setStatus] = useState<SkillStatus | 'all'>('all')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return skills.filter((skill) => {
      const searchable =
        `${skillDisplayName(skill)} ${skill.name} ${skill.slug} ${skill.description} ${skill.owner ?? ''} ${skill.files.map((file) => file.path).join(' ')}`.toLowerCase()
      const matchesQuery = !needle || searchable.includes(needle)
      const matchesPurpose =
        !demoDataEnabled || purpose === 'all' || skill.purpose === purpose
      const matchesStatus =
        !demoDataEnabled || status === 'all' || skill.status === status
      return matchesQuery && matchesPurpose && matchesStatus
    })
  }, [purpose, query, skills, status])

  return {
    query,
    setQuery,
    purpose,
    setPurpose,
    status,
    setStatus,
    filtered,
  }
}

function LibraryHeader({
  navigate,
  selectedSkills,
}: {
  navigate: (path: RoutePath) => void
  selectedSkills: Skill[]
}) {
  const { role, skills, openProposals, catalogueStatus } = useRegistry()
  const fileCount = skills.reduce((sum, skill) => sum + skill.files.length, 0)

  return (
    <div className='mx-auto w-full max-w-7xl shrink-0 space-y-3 px-4 pt-5 md:px-6 md:pt-6'>
      <div className='flex flex-col justify-between gap-3 md:flex-row md:items-end'>
        <div>
          <div className='mb-1 flex items-center gap-2 text-sm text-muted-foreground'>
            <BookOpen className='size-4' />
            Team library
          </div>
          <h1
            id='library-title'
            className='text-2xl font-semibold tracking-tight'
          >
            Library
          </h1>
          {demoDataEnabled ? (
            <p className='mt-1 text-sm text-muted-foreground'>
              {skills.length} skills across 6 purposes · {fileCount} files ·{' '}
              {openProposals.length} open proposals
            </p>
          ) : (
            <p className='mt-1 text-sm text-muted-foreground'>
              {catalogueStatus === 'loading'
                ? 'Loading Registry catalogue…'
                : catalogueStatus === 'error'
                  ? 'Registry catalogue unavailable.'
                  : `${skills.length} registered ${skills.length === 1 ? 'skill' : 'skills'} · ${fileCount} files`}
            </p>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <LibraryTransferActions selectedSkills={selectedSkills} />
          {role === 'Admin' ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => navigate('/review')}
            >
              <GitPullRequest />
              Review {openProposals.length}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FilterBar({
  query,
  setQuery,
  purpose,
  setPurpose,
  status,
  setStatus,
}: ReturnType<typeof useFilteredSkills>) {
  return (
    <div
      className='flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center'
      data-testid='library-toolbar'
    >
      <div className='relative min-w-0 flex-1 lg:max-w-md'>
        <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search skills or file paths'
          className='h-10 pl-9 text-sm sm:h-8'
          aria-label='Search skills'
        />
      </div>
      {demoDataEnabled ? (
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <Select value={purpose} onValueChange={setPurpose}>
            <SelectTrigger
              size='sm'
              className='h-10 sm:h-8'
              aria-label='Filter by purpose'
            >
              <SelectValue placeholder='Purpose' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All purposes</SelectItem>
              {skillPurposes.map((item) => (
                <SelectItem value={item} key={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as SkillStatus | 'all')}
          >
            <SelectTrigger
              size='sm'
              className='h-10 sm:h-8'
              aria-label='Filter by status'
            >
              <SelectValue placeholder='Status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Any status</SelectItem>
              <SelectItem value='Current'>Current</SelectItem>
              <SelectItem value='Stale'>Stale</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}

export function LibraryPage({
  navigate,
}: {
  navigate: (path: RoutePath) => void
}) {
  const { proposals, skills, catalogueStatus, refreshSkills } = useRegistry()
  const filters = useFilteredSkills()
  const [loadedCount, setLoadedCount] = useState(PAGE_SIZE)
  const [fetching, setFetching] = useState(false)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    []
  )

  const loadedRows = filters.filtered.slice(0, loadedCount)
  const activeRowSelection = useMemo(() => {
    const availableSkillIds = new Set(skills.map((skill) => skill.slug))
    return Object.fromEntries(
      Object.keys(rowSelection)
        .filter((id) => availableSkillIds.has(id))
        .map((id) => [id, true] as const)
    )
  }, [rowSelection, skills])
  const selectedSkills = useMemo(
    () => skills.filter((skill) => activeRowSelection[skill.slug]),
    [activeRowSelection, skills]
  )

  const proposalCounts = useMemo(
    () =>
      proposals.reduce<Record<string, number>>((counts, proposal) => {
        if (proposal.status === 'pending')
          counts[proposal.slug] = (counts[proposal.slug] ?? 0) + 1
        return counts
      }, {}),
    [proposals]
  )

  const columns = useMemo(() => {
    const selection = columnHelper.display({
      id: 'select',
      header: () => <DataGridTableRowSelectAll />,
      cell: ({ row }) => <DataGridTableRowSelect row={row} />,
      enableSorting: false,
      enableResizing: false,
      size: 44,
      meta: {
        headerTitle: 'Select skills',
        headerClassName: 'w-11',
        cellClassName: 'w-11',
        preventRowClick: true,
      },
    })
    const name = columnHelper.accessor((skill) => skillDisplayName(skill), {
      id: 'name',
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title='Skill' />
      ),
      size: 185,
      cell: ({ row, getValue }) => (
        <div className='min-w-0'>
          <div className='truncate font-medium'>{getValue()}</div>
          <div className='truncate font-mono text-xs text-muted-foreground'>
            {row.original.slug}
          </div>
        </div>
      ),
      meta: { headerTitle: 'Skill', cellClassName: 'min-w-[185px]' },
    })
    const description = columnHelper.accessor('description', {
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title='Description' />
      ),
      size: 360,
      cell: ({ getValue }) => (
        <p className='line-clamp-2 text-sm leading-5 text-muted-foreground'>
          {getValue()}
        </p>
      ),
      meta: {
        headerTitle: 'Description',
        autoSize: true,
        cellClassName: 'min-w-[230px]',
      },
    })
    if (demoDataEnabled)
      return columnHelper.columns([
        selection,
        name,
        description,
        columnHelper.accessor('purpose', {
          header: ({ column }) => (
            <DataGridColumnHeader column={column} title='Purpose' />
          ),
          size: 110,
          cell: ({ getValue }) => (
            <Badge variant='outline' className='font-normal'>
              {getValue()}
            </Badge>
          ),
          meta: { headerTitle: 'Purpose' },
        }),
        columnHelper.accessor((skill) => proposalCounts[skill.slug] ?? 0, {
          id: 'proposals',
          header: ({ column }) => (
            <DataGridColumnHeader column={column} title='Proposals' />
          ),
          size: 90,
          cell: ({ getValue }) =>
            getValue() ? (
              <Badge variant='secondary'>{getValue()}</Badge>
            ) : (
              <span className='text-muted-foreground'>—</span>
            ),
          meta: { headerTitle: 'Proposals', cellClassName: 'text-center' },
        }),
        columnHelper.accessor('status', {
          header: ({ column }) => (
            <DataGridColumnHeader column={column} title='Status' />
          ),
          size: 90,
          cell: ({ getValue }) => (
            <span className='inline-flex items-center gap-1.5'>
              <span
                className={
                  getValue() === 'Current'
                    ? 'size-1.5 rounded-full bg-emerald-500'
                    : 'size-1.5 rounded-full bg-amber-500'
                }
              />
              {getValue()}
            </span>
          ),
          meta: { headerTitle: 'Status' },
        }),
        columnHelper.accessor((skill) => Date.parse(skill.updated), {
          id: 'updated',
          header: ({ column }) => (
            <DataGridColumnHeader column={column} title='Updated' />
          ),
          size: 110,
          sortFn: 'basic',
          cell: ({ row }) => row.original.updated,
          meta: { headerTitle: 'Updated' },
        }),
      ])
    return columnHelper.columns([
      selection,
      name,
      description,
      columnHelper.accessor((skill) => skill.owner ?? 'Not recorded', {
        id: 'owner',
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title='Owner' />
        ),
        size: 150,
        cell: ({ getValue, row }) =>
          row.original.owner ? (
            <span className='truncate'>{getValue()}</span>
          ) : (
            <span className='text-muted-foreground'>Not recorded</span>
          ),
        meta: { headerTitle: 'Owner', cellClassName: 'min-w-[140px]' },
      }),
      columnHelper.accessor((skill) => skill.files.length, {
        id: 'files',
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title='Files' />
        ),
        size: 60,
        sortFn: 'basic',
        cell: ({ getValue }) => (
          <span className='tabular-nums'>{getValue()}</span>
        ),
        meta: { headerTitle: 'Files', cellClassName: 'text-right' },
      }),
      columnHelper.accessor('gitExportStatus', {
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title='Git export' />
        ),
        size: 120,
        cell: ({ getValue }) => (
          <span className='inline-flex items-center gap-1.5'>
            <span
              className={
                getValue() === 'Exported'
                  ? 'size-1.5 rounded-full bg-emerald-500'
                  : 'size-1.5 rounded-full bg-amber-500'
              }
            />
            {getValue()}
          </span>
        ),
        meta: { headerTitle: 'Git export' },
      }),
      columnHelper.accessor((skill) => Date.parse(skill.updated), {
        id: 'updated',
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title='Updated' />
        ),
        size: 120,
        sortFn: 'basic',
        cell: ({ row }) => row.original.updated,
        meta: { headerTitle: 'Updated' },
      }),
    ])
  }, [proposalCounts])

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: loadedRows,
    getRowId: (row) => row.slug,
    enableRowSelection: true,
    manualPagination: true,
    state: { rowSelection: activeRowSelection },
    onRowSelectionChange: setRowSelection,
  })

  function fetchMore() {
    if (fetching || loadedCount >= filters.filtered.length) return
    setFetching(true)
    timerRef.current = window.setTimeout(() => {
      setLoadedCount((count) =>
        Math.min(count + PAGE_SIZE, filters.filtered.length)
      )
      setFetching(false)
    }, 320)
  }

  const emptyMessage =
    !demoDataEnabled && skills.length === 0
      ? 'No skills have been published yet.'
      : 'No skills match these filters.'

  return (
    <section
      className='flex h-full min-h-0 flex-col'
      aria-labelledby='library-title'
    >
      <LibraryHeader navigate={navigate} selectedSkills={selectedSkills} />
      <div className='mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 px-4 pt-4 md:px-6'>
        <FilterBar {...filters} />
        <div
          className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border-x border-t'
          data-testid='registry-grid'
        >
          <div className='min-h-0 flex-1'>
            {!demoDataEnabled && catalogueStatus === 'loading' ? (
              <div className='grid h-full place-items-center text-sm text-muted-foreground'>
                Loading Registry skills…
              </div>
            ) : !demoDataEnabled && catalogueStatus === 'error' ? (
              <div className='grid h-full place-items-center p-6 text-center'>
                <div>
                  <p className='text-sm font-medium'>
                    Could not load Registry skills.
                  </p>
                  <Button
                    variant='outline'
                    size='sm'
                    className='mt-3'
                    onClick={() => void refreshSkills()}
                    aria-label='Retry loading skills'
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div className='h-full' data-testid='registry-table-view'>
                <DataGrid
                  table={table}
                  recordCount={filters.filtered.length}
                  onRowClick={(skill) => navigate(`/skills/${skill.slug}`)}
                  fetchingMoreMessage='Loading more skills…'
                  allRowsLoadedMessage={`All ${filters.filtered.length} matching skills loaded`}
                  emptyMessage={emptyMessage}
                  tableLayout={{
                    dense: true,
                    rowBorder: true,
                    headerBorder: true,
                    headerBackground: true,
                    headerSticky: true,
                    width: 'fixed',
                  }}
                  tableClassNames={{
                    base: `${demoDataEnabled ? 'min-w-[984px]' : 'min-w-[994px]'} text-sm`,
                    header: 'text-sm',
                    headerSticky: 'sticky top-0 z-40 bg-muted/95 backdrop-blur',
                    bodyRow: 'h-10',
                  }}
                >
                  <DataGridContainer className='h-full rounded-none'>
                    <DataGridTableVirtual
                      height='100%'
                      estimateSize={40}
                      overscan={2}
                      onFetchMore={fetchMore}
                      isFetchingMore={fetching}
                      hasMore={loadedCount < filters.filtered.length}
                      fetchMoreOffset={1}
                    />
                  </DataGridContainer>
                </DataGrid>
              </div>
            )}
          </div>
        </div>
      </div>
      <SkillSelectionDeleteBar
        skills={selectedSkills}
        onClear={() => setRowSelection({})}
      />
    </section>
  )
}
