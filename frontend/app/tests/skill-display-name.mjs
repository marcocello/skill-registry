import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const baseUrl = process.env.SKILL_DISPLAY_NAME_BASE_URL ?? 'http://127.0.0.1:5175'

const summary = {
  slug: 'coding-commit',
  name: 'coding-commit',
  display_name: 'CODING | Commit',
  description: 'Create coherent local commits.',
  latest_version: 1,
  updated_at: '2026-08-31T10:00:00Z',
  content_hash: 'hash-coding-commit',
  git_export_status: 'exported',
  file_count: 2,
  file_paths: ['SKILL.md', 'agents/openai.yaml'],
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
      description: summary.description,
      files: {
        'SKILL.md': '# Coding commit\n',
        'agents/openai.yaml':
          'interface:\n  display_name: "CODING | Commit"\n',
      },
      content_hash: summary.content_hash,
      created_at: summary.updated_at,
      author: null,
      git_export: { status: 'exported', commit_sha: 'abc123', error: null },
    },
  ],
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1574, height: 963 } })
  let mockedSession = {
    auth_mode: 'none',
    email: 'local@example.test',
    display_name: 'Local operator',
  }
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
      body: JSON.stringify(mockedSession),
    })
  )
  await page.route('**/api/skills', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ skills: [summary] }),
    })
  )
  await page.route('**/api/skills/coding-commit', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    })
  )

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const jumpButton = page.getByRole('button', { name: 'Jump to…' })
  assert.equal(await jumpButton.count(), 1, await page.locator('body').innerText())
  const jumpBox = await page
    .getByRole('button', { name: 'Jump to…' })
    .boundingBox()
  assert.ok(jumpBox)
  assert.ok(Math.abs(jumpBox.width - 176) <= 1)
  assert.equal(
    await page.getByRole('button', { name: 'Open profile menu' }).count(),
    0
  )
  const openAccessIdentity = page.getByTestId('open-access-identity')
  assert.equal(await openAccessIdentity.count(), 1)

  const table = page.getByTestId('registry-table-view')
  await table.getByText('CODING | Commit', { exact: true }).waitFor()
  await table.getByText('coding-commit', { exact: true }).waitFor()

  const [brandBox, gridBox, profileBox] = await Promise.all([
    page.getByRole('button', { name: 'Open skills library' }).boundingBox(),
    page.getByTestId('registry-grid').boundingBox(),
    openAccessIdentity.boundingBox(),
  ])
  assert.ok(brandBox && gridBox && profileBox)
  assert.ok(Math.abs(brandBox.x - gridBox.x) <= 2)
  assert.ok(
    Math.abs(profileBox.x + profileBox.width - (gridBox.x + gridBox.width)) <= 2
  )

  const [tableBox, descriptionBox, ownerBox, filesBox] = await Promise.all([
    table.getByRole('table').boundingBox(),
    table.getByRole('columnheader', { name: 'Description' }).boundingBox(),
    table.getByRole('columnheader', { name: 'Owner' }).boundingBox(),
    table.getByRole('columnheader', { name: 'Files' }).boundingBox(),
  ])
  assert.ok(tableBox && descriptionBox && ownerBox && filesBox)
  assert.ok(descriptionBox.width / tableBox.width >= 0.34)
  assert.ok(ownerBox.width / tableBox.width <= 0.17)
  assert.ok(filesBox.width / tableBox.width <= 0.07)

  await table.getByText('CODING | Commit', { exact: true }).click()
  await page.waitForURL('**/skills/coding-commit')
  await page
    .getByRole('heading', { name: 'CODING | Commit', exact: true })
    .waitFor()
  await page.getByText('coding-commit', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to Library' }).click()
  await page.waitForURL(baseUrl)
  await page
    .getByTestId('registry-table-view')
    .getByText('CODING | Commit', { exact: true })
    .waitFor()

  assert.equal(
    await page.getByRole('group', { name: 'Choose skills view' }).count(),
    0
  )
  assert.equal(await page.getByRole('button', { name: 'Card view' }).count(), 0)
  assert.equal(await page.getByTestId('skills-card-view').count(), 0)

  mockedSession = {
    auth_mode: 'google',
    email: 'teammate@example.test',
    display_name: 'Authenticated teammate',
    role: 'user',
    csrf_token: 'csrf-test',
  }
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(
    await page.getByRole('button', { name: 'Open profile menu' }).count(),
    1
  )
  assert.equal(await page.getByTestId('open-access-identity').count(), 0)
} finally {
  await browser.close()
}
