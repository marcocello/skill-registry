#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const serverName = 'skills-registry'
const skillName = 'skills-registry-guide'

try {
  const origin = registryOrigin(process.argv[2])
  const endpoint = `${origin}/mcp`
  const skillUrl = `${origin}/companion/${skillName}/SKILL.md`
  const skill = await downloadSkill(skillUrl)
  const target = join(homedir(), '.agents', 'skills', skillName)
  await assertSafeSkillTarget(target, origin, skill)
  assertCodexInstalled()
  const current = currentMcp()
  if (current && current.transport?.url !== endpoint) {
    throw new Error(
      `Codex already has ${serverName} connected to ${current.transport?.url ?? 'another target'}. Remove it first with: codex mcp remove ${serverName}`
    )
  }
  if (!current) runCodex(['mcp', 'add', serverName, '--url', endpoint])
  await installSkill(target, origin, skill)
  console.log(`Connected ${serverName} and installed $${skillName}.`)
  console.log(`Start a new Codex task. If $${skillName} is not listed, restart Codex.`)
} catch (error) {
  console.error(`Skill Registry setup failed: ${error.message}`)
  process.exitCode = 1
}

function registryOrigin(value) {
  if (!value) throw new Error('Missing Registry URL.')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Registry URL must use HTTP or HTTPS.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Registry URL must be an origin without credentials, path, query, or fragment.')
  }
  return url.origin
}

async function downloadSkill(url) {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error(`Could not download the companion skill (${response.status}).`)
  const content = await response.text()
  if (!content.includes('name: skills-registry-guide')) {
    throw new Error('The downloaded companion skill is invalid.')
  }
  return content
}

function assertCodexInstalled() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Codex CLI is not installed or not available on PATH.')
}

function currentMcp() {
  const result = spawnSync('codex', ['mcp', 'get', serverName, '--json'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`Could not read the existing ${serverName} MCP configuration.`)
  }
}

function runCodex(args) {
  const result = spawnSync('codex', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `codex ${args.join(' ')} failed.`)
  }
}

async function assertSafeSkillTarget(target, origin, content) {
  const marker = await readOptional(join(target, '.registry-source'))
  const existing = await readOptional(join(target, 'SKILL.md'))
  if (marker && marker.trim() !== origin) {
    throw new Error(`$${skillName} belongs to ${marker.trim()}; remove it before switching Registry.`)
  }
  if (existing && !marker && existing !== content) {
    throw new Error(`$${skillName} already exists and was not installed by Skill Registry.`)
  }
}

async function installSkill(target, origin, content) {
  await mkdir(target, { recursive: true })
  const temporary = join(target, '.SKILL.md.tmp')
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, join(target, 'SKILL.md'))
  await writeFile(join(target, '.registry-source'), `${origin}\n`, { mode: 0o600 })
  await rm(temporary, { force: true })
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
