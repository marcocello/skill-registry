import { useMemo, useState } from 'react'
import type { SkillFile } from '@/registry/types'
import { ChevronRight, FileCode2, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

type BundleFileNode = {
  kind: 'file'
  name: string
  path: string
}

type BundleFolderNode = {
  kind: 'folder'
  name: string
  path: string
  children: BundleTreeNode[]
}

type BundleTreeNode = BundleFileNode | BundleFolderNode

function nodeOrder(left: BundleTreeNode, right: BundleTreeNode) {
  if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
  return left.name.localeCompare(right.name)
}

function sortTree(nodes: BundleTreeNode[]): BundleTreeNode[] {
  return nodes
    .map((node) =>
      node.kind === 'folder'
        ? { ...node, children: sortTree(node.children) }
        : node
    )
    .sort(nodeOrder)
}

function buildBundleFileTree(files: SkillFile[]): BundleTreeNode[] {
  const root: BundleFolderNode = {
    kind: 'folder',
    name: '',
    path: '',
    children: [],
  }

  files.forEach((file) => {
    const parts = file.path.split('/').filter(Boolean)
    if (!parts.length) return
    let parent = root

    parts.slice(0, -1).forEach((name) => {
      const path = parent.path ? `${parent.path}/${name}` : name
      let folder = parent.children.find(
        (node): node is BundleFolderNode =>
          node.kind === 'folder' && node.name === name
      )
      if (!folder) {
        folder = { kind: 'folder', name, path, children: [] }
        parent.children.push(folder)
      }
      parent = folder
    })

    parent.children.push({
      kind: 'file',
      name: parts[parts.length - 1],
      path: file.path,
    })
  })

  return sortTree(root.children)
}

function TreeItems({
  nodes,
  level,
  selectedPath,
  onSelect,
  collapsedPaths,
  onToggleFolder,
}: {
  nodes: BundleTreeNode[]
  level: number
  selectedPath: string
  onSelect: (path: string) => void
  collapsedPaths: ReadonlySet<string>
  onToggleFolder: (path: string) => void
}) {
  return nodes.map((node) => {
    const paddingLeft = 8 + (level - 1) * 12
    if (node.kind === 'file')
      return (
        <button
          key={node.path}
          type='button'
          role='treeitem'
          aria-level={level}
          aria-selected={selectedPath === node.path}
          onClick={() => onSelect(node.path)}
          style={{ paddingLeft }}
          className={cn(
            'portal-control-motion flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm transition-[background-color,color,box-shadow,transform]',
            selectedPath === node.path
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
          )}
        >
          <FileCode2 className='size-4 shrink-0' />
          <span className='truncate'>{node.name}</span>
        </button>
      )

    const collapsed = collapsedPaths.has(node.path)

    return (
      <div key={node.path} role='none'>
        <button
          type='button'
          role='treeitem'
          aria-level={level}
          aria-expanded={!collapsed}
          onClick={() => onToggleFolder(node.path)}
          style={{ paddingLeft }}
          className='portal-control-motion flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm font-medium text-muted-foreground transition-[background-color,color] hover:bg-background/70 hover:text-foreground'
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              !collapsed && 'rotate-90'
            )}
          />
          {collapsed ? (
            <Folder className='size-4 shrink-0 text-muted-foreground' />
          ) : (
            <FolderOpen className='size-4 shrink-0 text-muted-foreground' />
          )}
          <span className='truncate'>{node.name}</span>
        </button>
        {!collapsed && (
          <div role='group'>
            <TreeItems
              nodes={node.children}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              collapsedPaths={collapsedPaths}
              onToggleFolder={onToggleFolder}
            />
          </div>
        )}
      </div>
    )
  })
}

export function BundleFileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: SkillFile[]
  selectedPath: string
  onSelect: (path: string) => void
}) {
  const nodes = useMemo(() => buildBundleFileTree(files), [files])
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set()
  )

  const toggleFolder = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div role='tree' aria-label='Bundle files' className='space-y-0.5'>
      <TreeItems
        nodes={nodes}
        level={1}
        selectedPath={selectedPath}
        onSelect={onSelect}
        collapsedPaths={collapsedPaths}
        onToggleFolder={toggleFolder}
      />
    </div>
  )
}
