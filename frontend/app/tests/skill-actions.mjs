import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const baseUrl = process.env.SKILL_ACTIONS_BASE_URL ?? 'http://127.0.0.1:5175'

const summary = {
  slug: 'action-test',
  name: 'action-test',
  display_name: 'Action Display Name',
  description: 'Deterministic skill action fixture.',
  latest_version: 3,
  updated_at: '2026-08-31T10:00:00Z',
  content_hash: 'hash-action-test',
  git_export_status: 'exported',
  file_count: 1,
  file_paths: ['SKILL.md'],
  owner: null,
}

const detail = {
  slug: summary.slug,
  name: summary.name,
  display_name: summary.display_name,
  description: summary.description,
  latest_version: summary.latest_version,
  created_at: summary.updated_at,
  updated_at: summary.updated_at,
  owner: null,
  versions: [
    {
      slug: summary.slug,
      version: summary.latest_version,
      name: summary.name,
      display_name: summary.display_name,
      description: summary.description,
      files: { 'SKILL.md': '# Action test\n' },
      content_hash: summary.content_hash,
      created_at: summary.updated_at,
      author: null,
      git_export: { status: 'exported', commit_sha: 'abc123', error: null },
    },
  ],
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/api/setup/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, settings_path: '/settings' }),
    })
  )
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        auth_mode: 'none',
        email: 'local@example.test',
        display_name: 'Local operator',
      }),
    })
  )
  await page.route('**/api/skills', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ skills: [summary] }),
    })
  )
  await page.route('**/api/skills/action-test', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    })
  )

  await page.goto(`${baseUrl}/skills/action-test`, {
    waitUntil: 'networkidle',
  })
  await page
    .getByRole('heading', { name: 'Action Display Name', exact: true })
    .waitFor()

  const getForYourTool = page.getByRole('button', {
    name: 'Get for your tool',
    exact: true,
  })
  await getForYourTool.waitFor()

  if ((await getForYourTool.getAttribute('data-variant')) !== 'default')
    throw new Error('Get for your tool is not the primary action')
  if (
    (await page.getByRole('button', { name: 'Copy install path' }).count()) ||
    (await page.getByRole('button', { name: 'MCP download' }).count()) ||
    (await page.getByRole('button', { name: 'Download bundle' }).count()) ||
    (await page.getByRole('button', { name: 'Download ZIP' }).count())
  )
    throw new Error('A removed skill action is still visible')
  if (
    (await page.getByText('Usage not tracked', { exact: true }).count()) ||
    (await page.getByText(/calls in 30 days/i).count())
  )
    throw new Error('Usage tracking is still visible')

  await getForYourTool.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await page.getByRole('heading', { name: 'Get this skill' }).waitFor()
  const prompt = await dialog.getByTestId('mcp-prompt').innerText()
  if (
    !prompt.includes('Action Display Name') ||
    !prompt.includes('action-test') ||
    !prompt.includes('$skills-registry-guide') ||
    !prompt.includes('/skills-registry:guide') ||
    prompt.includes('Use the `skills-registry` MCP server')
  )
    throw new Error(`Unexpected companion prompt: ${prompt}`)
  await dialog
    .getByRole('button', { name: 'Close', exact: true })
    .first()
    .click()

} finally {
  await browser.close()
}
