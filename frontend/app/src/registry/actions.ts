import type { Skill } from '@/registry/types'
import JSZip from 'jszip'
import { toast } from 'sonner'

export async function copyText(text: string, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  toast.success(message)
}

export async function downloadSkill(skill: Skill) {
  const zip = new JSZip()
  const folder = zip.folder(skill.slug)
  if (!folder) throw new Error('Could not prepare skill bundle')

  skill.files.forEach((file) => folder.file(file.path, file.content))
  if (!skill.files.some((file) => file.path === '.skill_id')) {
    folder.file('.skill_id', `registry:${skill.slug}:v${skill.version}`)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${skill.slug}-v${skill.version}.zip`)
  toast.success(`${skill.name} downloaded`)
}

export async function downloadClaudePlugin(
  endpoint: string,
  companionUrl: string
) {
  const response = await fetch(companionUrl, { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`Could not load the companion skill (${response.status})`)
  }
  const companion = await response.text()
  if (!companion.includes('name: skills-registry-guide')) {
    throw new Error('The companion skill returned by this Registry is invalid')
  }

  const zip = new JSZip()
  zip.file(
    '.claude-plugin/plugin.json',
    `${JSON.stringify(
      {
        name: 'skills-registry',
        version: '1.0.0',
        description: 'Connect Claude to Skill Registry',
      },
      null,
      2
    )}\n`
  )
  zip.file(
    '.mcp.json',
    `${JSON.stringify(
      {
        mcpServers: {
          'skills-registry': { type: 'http', url: endpoint },
        },
      },
      null,
      2
    )}\n`
  )
  zip.file('skills/guide/SKILL.md', companion)

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, 'skills-registry-claude-plugin.zip')
  toast.success('Claude plugin downloaded')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function formatBytes(skill: Skill) {
  const bytes = skill.files.reduce(
    (total, file) => total + new Blob([file.content]).size,
    0
  )
  return bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

export function mcpPrompt(
  kind: 'download' | 'propose' | 'create' | 'edit',
  skill?: Pick<Skill, 'slug' | 'name' | 'displayName'>
) {
  const target = skill ? ` \`${skill.slug}\`` : ''
  const displayName = skill?.displayName ?? skill?.name
  const prompts = {
    download: skill
      ? `Use \`$skills-registry-guide\` in Codex or \`/skills-registry:guide\` in Claude to download “${displayName}” (Registry slug \`${skill.slug}\`) and save its complete bundle without changing \`.skill_id\`.`
      : 'Use the installed Skill Registry companion to download a skill and save its complete bundle without changing `.skill_id`.',
    propose: `Use the \`skills-registry\` MCP server to propose an edit to${target}. Explain the rationale, include every changed file, and do not publish directly.`,
    create: addSkillPrompt(),
    edit: `Use the \`skills-registry\` MCP server to submit a complete reviewed edit for${target}. Do not publish directly.`,
  }
  return prompts[kind]
}

export function addSkillPrompt() {
  return 'Use the `skills-registry` MCP server to add only `[skill-name]` from my existing local Codex skills to Skill Registry. Search the registry first, then use the write tool exposed for my access mode with the complete bundle. Do not modify `skills.toml`, install or remove local Codex skills, or change any other registry entry. If the result is pending review, report that instead of claiming publication. Confirm the returned Skill Registry record before reporting success.'
}
