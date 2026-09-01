import { spawnSync } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const output = resolve('dist/companion')
const target = resolve(output, 'skills-registry-connect.tgz')
const cache = resolve('node_modules/.cache/npm-pack')
await mkdir(output, { recursive: true })
await mkdir(cache, { recursive: true })
await rm(target, { force: true })

const packed = spawnSync(
  'npm',
  [
    'pack',
    './companion/codex-installer',
    '--pack-destination',
    output,
    '--cache',
    cache,
    '--json',
  ],
  { encoding: 'utf8' }
)
if (packed.status !== 0) {
  throw new Error(packed.stderr || 'Could not package the Codex installer.')
}
const [{ filename }] = JSON.parse(packed.stdout)
await rename(resolve(output, filename), target)
console.log('Built companion/skills-registry-connect.tgz')
