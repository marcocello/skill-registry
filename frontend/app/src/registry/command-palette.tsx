import type { RoutePath } from '@/registry/types'
import { useRegistry } from '@/registry/use-registry'
import {
  BookOpen,
  Cable,
  FileCode2,
  GitPullRequest,
  LayoutGrid,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'

export function RegistryCommandPalette({
  open,
  onOpenChange,
  navigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  navigate: (path: RoutePath) => void
}) {
  const { role, skills, openProposals } = useRegistry()

  function choose(path: RoutePath) {
    navigate(path)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Registry commands'
    >
      <CommandInput placeholder='Search skills, files, proposals, or destinations…' />
      <CommandList>
        <CommandEmpty>No registry result found.</CommandEmpty>
        <CommandGroup heading='Go to'>
          <CommandItem onSelect={() => choose('/')}>
            <LayoutGrid />
            Library<CommandShortcut>G L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => choose('/connect')}>
            <Cable />
            Connect<CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          {role === 'Admin' ? (
            <CommandItem onSelect={() => choose('/review')}>
              <GitPullRequest />
              Review {openProposals.length} proposals
              <CommandShortcut>G R</CommandShortcut>
            </CommandItem>
          ) : null}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading='Skills'>
          {skills.map((skill) => (
            <CommandItem
              key={skill.slug}
              value={`${skill.name} ${skill.slug} ${skill.description} ${skill.files.map((file) => file.path).join(' ')}`}
              onSelect={() => choose(`/skills/${skill.slug}`)}
            >
              <BookOpen />
              <span className='min-w-0 flex-1 truncate'>{skill.name}</span>
              <CommandShortcut>
                {skill.purpose ?? skill.gitExportStatus}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        {role === 'Admin' ? (
          <CommandGroup heading='Open proposals'>
            {openProposals.map((proposal) => (
              <CommandItem
                key={proposal.id}
                value={`${proposal.name} ${proposal.author}`}
                onSelect={() => choose('/review')}
              >
                <GitPullRequest />
                <span className='min-w-0 flex-1 truncate'>{proposal.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading='Files'>
          {skills.flatMap((skill) =>
            skill.files.map((file) => (
              <CommandItem
                key={`${skill.slug}:${file.path}`}
                value={`${file.path} ${skill.name} ${skill.slug}`}
                onSelect={() => choose(`/skills/${skill.slug}`)}
              >
                <FileCode2 />
                <span className='min-w-0 flex-1 truncate'>{file.path}</span>
                <CommandShortcut>{skill.slug}</CommandShortcut>
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
