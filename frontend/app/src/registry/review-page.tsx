import { useEffect, useMemo, useState } from 'react'
import { BundleComparison } from '@/registry/bundle-diff'
import { decideProposal, editProposal } from '@/registry/proposal-api'
import { getRegistrySkill } from '@/registry/registry-api'
import type { BundleFiles, RoutePath } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import { Check, GitPullRequest, Save, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function ReviewPage({
  navigate,
}: {
  navigate: (path: RoutePath) => void
}) {
  const { role, session, openProposals, replaceProposal, refreshSkills } =
    useRegistry()
  const [selectedId, setSelectedId] = useState(openProposals[0]?.id ?? '')
  const selected = useMemo(
    () =>
      openProposals.find((item) => item.id === selectedId) ?? openProposals[0],
    [openProposals, selectedId]
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<BundleFiles>({})
  const [baseline, setBaseline] = useState<{
    key: string
    files?: BundleFiles
    error?: string
  }>({ key: '' })
  const [retry, setRetry] = useState(0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (role !== 'Admin') navigate('/')
  }, [navigate, role])
  useEffect(() => {
    if (!selected) return
    // The selected proposal is the external source of truth for this edit form.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(selected.name)
    setDescription(selected.description)
    setFiles(selected.files)
  }, [selected])
  useEffect(() => {
    // A saved revision must not discard a reason entered during the save.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason('')
    setError('')
  }, [selected?.id])
  const baselineKey = selected
    ? `${selected.id}:${selected.base_version ?? 'new'}`
    : ''
  useEffect(() => {
    if (!selected) return
    if (selected.action === 'create') return
    const controller = new AbortController()
    void getRegistrySkill(selected.slug, controller.signal)
      .then((skill) => {
        const version = skill.history.find(
          (item) => item.version === selected.base_version
        )
        if (!version?.files)
          throw new Error('The proposal base version is unavailable.')
        setBaseline({ key: baselineKey, files: version.files })
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setBaseline({
            key: baselineKey,
            error:
              caught instanceof Error ? caught.message : 'Comparison failed.',
          })
      })
    return () => controller.abort()
  }, [baselineKey, retry, selected])
  if (role !== 'Admin' || !session) return null
  const dirty = Boolean(
    selected &&
    (name !== selected.name ||
      description !== selected.description ||
      JSON.stringify(files) !== JSON.stringify(selected.files))
  )
  const baseFiles =
    selected?.action === 'create'
      ? {}
      : baseline.key === baselineKey
        ? baseline.files
        : undefined

  async function save() {
    if (!selected) return
    setBusy(true)
    try {
      replaceProposal(
        await editProposal(session!, selected, { name, description, files })
      )
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (busy || (decision === 'approve' && dirty)) return
    if (!selected || !reason.trim()) {
      setError('A review reason is required.')
      return
    }
    setBusy(true)
    try {
      replaceProposal(
        await decideProposal(session!, selected, decision, reason.trim())
      )
      if (decision === 'approve') await refreshSkills()
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Decision failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='min-h-full'>
      <div className='mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6 md:py-6'>
        <div>
          <div className='mb-1 flex items-center gap-2 text-sm text-muted-foreground'>
            <GitPullRequest className='size-4' />
            Admin workspace
          </div>
          <h1 className='text-2xl font-semibold'>Proposal review</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Edit complete bundles and record a reason before approving or
            rejecting.
          </p>
        </div>
        {!openProposals.length ? (
          <div className='rounded-xl border border-dashed p-16 text-center'>
            <Check className='mx-auto size-8 text-emerald-600' />
            <h2 className='mt-3 font-semibold'>Review queue is clear</h2>
          </div>
        ) : (
          <div className='grid min-h-[620px] overflow-hidden rounded-xl border lg:grid-cols-[320px_minmax(0,1fr)]'>
            <aside className='border-b bg-muted/20 p-2 lg:border-r lg:border-b-0'>
              <div className='px-2 py-2 text-xs font-semibold text-muted-foreground uppercase'>
                Pending · {openProposals.length}
              </div>
              {openProposals.map((proposal) => (
                <button
                  key={proposal.id}
                  onClick={() => setSelectedId(proposal.id)}
                  className='w-full rounded-md p-3 text-left hover:bg-background'
                >
                  <span className='block text-sm font-medium'>
                    {proposal.name}
                  </span>
                  <span className='mt-1 block font-mono text-xs text-muted-foreground'>
                    {proposal.action} · {proposal.slug}
                  </span>
                </button>
              ))}
            </aside>
            {selected ? (
              <article className='min-w-0 space-y-4 p-5'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge>{selected.action}</Badge>
                  <Badge variant='outline'>revision {selected.revision}</Badge>
                  <span className='text-sm text-muted-foreground'>
                    by {selected.author}
                  </span>
                  <span className='text-sm text-muted-foreground'>
                    base {selected.base_version ?? 'new'} · submitted{' '}
                    {new Date(selected.created_at).toLocaleString()} · updated{' '}
                    {new Date(selected.updated_at).toLocaleString()}
                  </span>
                </div>
                <div className='grid gap-4 md:grid-cols-2'>
                  <label className='space-y-1 text-sm font-medium'>
                    Name
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className='space-y-1 text-sm font-medium'>
                    Description
                    <Input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                </div>
                {baseFiles ? (
                  <BundleComparison
                    key={selected.id}
                    before={baseFiles}
                    after={files}
                    beforeLabel={
                      selected.base_version
                        ? `Base version ${selected.base_version}`
                        : 'Empty bundle'
                    }
                    afterLabel='Proposed changes'
                    onEdit={(path, content) =>
                      setFiles((current) => ({ ...current, [path]: content }))
                    }
                  />
                ) : baseline.key === baselineKey && baseline.error ? (
                  <div role='alert' className='space-y-2 rounded-lg border p-4'>
                    <p className='text-sm text-destructive'>{baseline.error}</p>
                    <Button
                      variant='outline'
                      onClick={() => {
                        setBaseline({ key: '' })
                        setRetry((value) => value + 1)
                      }}
                    >
                      Retry comparison
                    </Button>
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    Loading base version…
                  </p>
                )}
                {dirty ? (
                  <p className='text-sm text-muted-foreground'>
                    Unsaved changes
                  </p>
                ) : null}
                <Button
                  variant='outline'
                  disabled={busy || !dirty}
                  onClick={() => void save()}
                >
                  <Save />
                  Save proposal edit
                </Button>
                <label className='block space-y-1 text-sm font-medium'>
                  Decision reason
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder='Why is this ready or not ready?'
                  />
                </label>
                {error ? (
                  <p className='text-sm text-destructive'>{error}</p>
                ) : null}
                <div className='flex justify-end gap-2'>
                  <Button
                    disabled={busy}
                    variant='destructive'
                    onClick={() => void decide('reject')}
                  >
                    <X />
                    Reject
                  </Button>
                  <Button
                    disabled={busy || dirty || !baseFiles}
                    onClick={() => void decide('approve')}
                  >
                    <Check />
                    Approve & publish
                  </Button>
                </div>
              </article>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
