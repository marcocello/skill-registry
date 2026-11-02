import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const require = createRequire(resolve('frontend/app/package.json'))
const { chromium } = require('playwright')
const base = process.env.PROOF_FRONTEND_URL
const provider = process.env.PROOF_PROVIDER_URL
const browser = await chromium.launch({ headless: true })
const oldFiles = {
  'SKILL.md': '---\nname: diff-proof\ndescription: Original description\n---\n\n# Original\nunchanged\nold line\n',
  'scripts/nested/check.sh': 'echo old\n',
  'references/removed.md': 'removed reference\n',
  'references/unchanged.md': 'same reference\n',
  'assets/icon.bin': { encoding: 'base64', data: 'AAEC' },
}
const newFiles = {
  'SKILL.md': oldFiles['SKILL.md'].replace('Original', 'Updated').replace('old line', 'new line'),
  'scripts/nested/check.sh': 'echo updated\n',
  'references/added.md': 'added reference\n',
  'references/unchanged.md': 'same reference\n',
  'assets/icon.bin': { encoding: 'base64', data: 'AwQF' },
}
async function signIn(page, persona, path = '/') {
  const next = `${base}/api/auth/google/start?return_to=${encodeURIComponent(path)}`
  await page.goto(`${provider}/select/${persona}?next=${encodeURIComponent(next)}`, { waitUntil: 'networkidle' })
}
async function mutate(page, path, body, method = 'POST', headers = {}) {
  const session = await (await page.request.get(`${base}/api/auth/session`)).json()
  return page.request.fetch(`${base}/api${path}`, { method, data: body,
    headers: { Origin: base, 'X-CSRF-Token': session.csrf_token ?? '', ...headers } })
}
async function detail(page) { return (await page.request.get(`${base}/api/skills/diff-proof`)).json() }
try {
  const admin = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  if (process.argv.includes('--reopen')) {
    await signIn(admin, 'admin', '/skills/diff-proof')
    await admin.getByRole('tab', { name: 'History', exact: true }).click()
    await admin.getByRole('article').getByText('Version 6', { exact: true }).waitFor()
    const reopened = await detail(admin)
    assert.equal(reopened.latest_version, 6)
    assert.deepEqual(reopened.versions[5].files, oldFiles)
    console.log('PASS restore: persisted after backend restart')
  } else {
    const setup = await admin.request.post(`${base}/api/setup`, { headers: { Origin: base }, data: {
      auth_mode: 'google', public_url: base, google_client_id: 'proof-client',
      google_client_secret: 'proof-secret-canary', allowed_google_domains: ['example.com'],
      admin_emails: ['admin@example.com'], git_repository: { name: 'registry-git' },
    } })
    assert.equal(setup.status(), 201, await setup.text())
    await signIn(admin, 'admin')
    const user = await browser.newPage()
    await signIn(user, 'user')
    const submitted = await mutate(user, '/proposals', { action: 'create', slug: 'diff-proof', base_version: null, name: 'diff-proof', description: 'Original description', files: oldFiles })
    assert.equal(submitted.status(), 201)
    const proposal = await submitted.json()
    await admin.goto(`${base}/review`, { waitUntil: 'networkidle' })
    await admin.getByRole('treeitem', { name: 'SKILL.md', exact: true }).click()
    await admin.getByText('Added', { exact: true }).first().waitFor()
    await admin.getByRole('treeitem', { name: 'nested', exact: true }).click()
    assert.equal(await admin.getByRole('treeitem', { name: 'check.sh', exact: true }).count(), 0)
    await admin.getByRole('treeitem', { name: 'nested', exact: true }).click()
    await admin.getByRole('treeitem', { name: 'check.sh', exact: true }).click()
    await admin.getByRole('button', { name: 'Edit file', exact: true }).click()
    assert.equal(await admin.getByRole('textbox', { name: 'File content: scripts/nested/check.sh', exact: true }).inputValue(), 'echo old\n')
    await admin.getByRole('treeitem', { name: 'icon.bin', exact: false }).click()
    await admin.getByText(/Binary.*preserved/).waitFor()
    await admin.getByRole('textbox', { name: 'Decision reason', exact: true }).fill('Original approved')
    await admin.getByRole('button', { name: 'Approve & publish', exact: true }).click()
    await admin.getByText('Review queue is clear', { exact: true }).waitFor()
    assert.deepEqual((await detail(admin)).versions[0].files, oldFiles)
    console.log('PASS review-file-tree AC1; review-file-diffs AC1 create baseline')
    const update = await mutate(user, '/proposals', { action: 'update', slug: 'diff-proof', base_version: 1, name: 'diff-proof', description: 'Updated description', files: newFiles })
    assert.equal(update.status(), 201)
    await admin.reload({ waitUntil: 'networkidle' })
    await admin.getByRole('treeitem', { name: 'SKILL.md', exact: false }).click()
    const diff = admin.getByTestId('side-by-side-diff')
    await diff.getByText('old line', { exact: true }).waitFor()
    await diff.getByText('new line', { exact: true }).waitFor()
    assert.equal(await diff.locator('[data-change="removed"]').count() > 0, true)
    assert.equal(await diff.locator('[data-change="added"]').count() > 0, true)
    await admin.getByRole('treeitem', { name: /unchanged.md/ }).click()
    await admin.getByText('No changes in this file.', { exact: true }).waitFor()
    await admin.getByRole('treeitem', { name: /removed.md/ }).click()
    await admin.getByText('Deleted', { exact: true }).first().waitFor()
    await diff.getByText('removed reference', { exact: true }).waitFor()
    assert.equal(await admin.getByRole('button', { name: 'Edit file', exact: true }).isDisabled(), true)
    await admin.getByRole('treeitem', { name: /icon.bin/ }).click()
    await admin.getByText(/Binary file changed/).waitFor()
    await admin.getByRole('treeitem', { name: /check.sh/ }).click()
    await admin.getByRole('button', { name: 'Edit file', exact: true }).click()
    await admin.getByRole('textbox', { name: 'File content: scripts/nested/check.sh', exact: true }).fill('echo reviewed\n')
    await admin.getByText('Unsaved changes', { exact: true }).waitFor()
    assert.equal(await admin.getByRole('button', { name: 'Approve & publish', exact: true }).isDisabled(), true)
    await admin.getByRole('button', { name: 'Differences', exact: true }).click()
    await diff.getByText('echo reviewed', { exact: true }).waitFor()
    const saved = admin.waitForResponse(response => response.url().includes('/api/proposals/') && response.request().method() === 'PUT')
    await admin.getByRole('button', { name: 'Save proposal edit', exact: true }).click()
    assert.equal((await saved).status(), 200)
    await admin.getByRole('textbox', { name: 'Decision reason', exact: true }).fill('Reviewed complete bundle')
    await admin.getByRole('button', { name: 'Approve & publish', exact: true }).click()
    await admin.getByText('Review queue is clear', { exact: true }).waitFor()
    const published = await detail(admin)
    assert.equal(published.latest_version, 2)
    assert.equal(published.versions[1].files['scripts/nested/check.sh'], 'echo reviewed\n')
    assert.deepEqual(published.versions[0].files, oldFiles)
    console.log('PASS review-file-tree AC2; review-file-diffs AC1/AC2 update/edit/binary/delete')
    await admin.goto(`${base}/skills/diff-proof`, { waitUntil: 'networkidle' })
    await admin.getByRole('tab', { name: 'History', exact: true }).click()
    await admin.getByRole('combobox', { name: 'Compare from version', exact: true }).selectOption('1')
    await admin.getByRole('combobox', { name: 'Compare to version', exact: true }).selectOption('2')
    await admin.getByRole('treeitem', { name: /check.sh/ }).click()
    await diff.getByText('echo old', { exact: true }).waitFor()
    await diff.getByText('echo reviewed', { exact: true }).waitFor()
    await admin.getByText('Original description', { exact: true }).waitFor()
    await admin.getByRole('combobox', { name: 'Compare from version', exact: true }).selectOption('2')
    await admin.getByRole('combobox', { name: 'Compare to version', exact: true }).selectOption('1')
    await admin.getByRole('treeitem', { name: /added.md/ }).click()
    await diff.getByText('added reference', { exact: true }).waitFor()
    await admin.getByRole('button', { name: 'Make version 1 default', exact: true }).click()
    await admin.getByRole('alertdialog').getByText(/new current version/).waitFor()
    await admin.getByRole('button', { name: 'Restore & publish', exact: true }).click()
    await admin.getByRole('article').getByText('Version 3', { exact: true }).waitFor()
    const restored = await detail(admin)
    assert.equal(restored.latest_version, 3)
    assert.deepEqual(restored.versions[2].files, oldFiles)
    assert.deepEqual(restored.versions.slice(0, 2), published.versions)
    assert.equal(restored.versions[2].description, 'Original description')
    assert.equal(restored.versions[2].author.email, 'admin@example.com')
    const zipResponse = await admin.request.get(`${base}/api/skills/archive`)
    const JSZip = require('jszip')
    const zip = await JSZip.loadAsync(await zipResponse.body())
    const restoredScript = Object.values(zip.files).find(f => f.name.endsWith('/scripts/nested/check.sh'))
    assert.equal(await restoredScript.async('string'), 'echo old\n')
    console.log('PASS skill-version-restore AC1/AC2 compare/restore/download')
    const outsider = await browser.newPage()
    assert.equal((await outsider.request.post(`${base}/api/skills/diff-proof/restore`, { data: { version: 1, expected_version: 3 }, headers: { Origin: base } })).status(), 401)
    await outsider.close()
    assert.equal((await mutate(user, '/skills/diff-proof/restore', { version: 1, expected_version: 3 })).status(), 403)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: 1, expected_version: 2 })).status(), 409)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: 999, expected_version: 3 })).status(), 404)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: true, expected_version: 3 })).status(), 400)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: 1, expected_version: 3 }, 'POST', { 'X-CSRF-Token': 'invalid' })).status(), 403)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: 1, expected_version: 3 }, 'POST', { Origin: 'https://elsewhere.invalid' })).status(), 403)
    assert.equal((await detail(admin)).latest_version, 3)
    await user.goto(`${base}/skills/diff-proof`, { waitUntil: 'networkidle' })
    await user.getByRole('tab', { name: 'History', exact: true }).click()
    assert.equal(await user.getByRole('button', { name: /Make version.*default/ }).count(), 0)
    // Fail a mutation without applying it, then retry through the real route.
    await admin.getByRole('button', { name: 'Make version 1 default', exact: true }).click()
    await admin.route('**/api/skills/diff-proof/restore', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Restore temporarily unavailable' }) }), { times: 1 })
    await admin.getByRole('button', { name: 'Restore & publish', exact: true }).click()
    await admin.getByRole('alert').getByText('Restore temporarily unavailable', { exact: true }).waitFor()
    assert.equal((await detail(admin)).latest_version, 3)
    await admin.getByRole('button', { name: 'Restore & publish', exact: true }).click()
    await admin.getByRole('article').getByText('Version 4', { exact: true }).waitFor()
    console.log('PASS skill-version-restore AC3 permission/stale/CSRF/validation/retry')
    await admin.getByRole('combobox', { name: 'Compare from version', exact: true }).selectOption('2')
    await admin.getByRole('combobox', { name: 'Compare to version', exact: true }).selectOption('4')
    await admin.getByRole('treeitem', { name: /check.sh/ }).click()
    await admin.getByTestId('side-by-side-diff').last().getByText('echo old', { exact: true }).waitFor()
    await admin.screenshot({ path: '/tmp/registry-skill-history.png', fullPage: true })
    await admin.getByTestId('side-by-side-diff').last().scrollIntoViewIfNeeded()
    await admin.screenshot({ path: '/tmp/registry-skill-history-diff.png', fullPage: true })
    await admin.setViewportSize({ width: 390, height: 844 })
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await admin.getByTestId('side-by-side-diff').last().scrollIntoViewIfNeeded()
    await admin.screenshot({ path: '/tmp/registry-skill-history-mobile.png', fullPage: true })
    await admin.setViewportSize({ width: 1440, height: 1100 })
    // A failed baseline must be surfaced, not compared against an empty bundle.
    const third = await mutate(user, '/proposals', { action: 'update', slug: 'diff-proof', base_version: 4, name: 'diff-proof', description: 'Next', files: newFiles })
    assert.equal(third.status(), 201)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: 2, expected_version: 4 })).status(), 201)
    await admin.route('**/api/skills/diff-proof', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }), { times: 1 })
    await admin.goto(`${base}/review`, { waitUntil: 'networkidle' })
    await admin.getByRole('alert').waitFor()
    await admin.getByRole('button', { name: 'Retry comparison', exact: true }).click()
    await admin.getByTestId('side-by-side-diff').waitFor()
    await admin.getByRole('treeitem', { name: /check.sh/ }).click()
    await admin.getByTestId('side-by-side-diff').getByText('echo old', { exact: true }).waitFor()
    assert.equal(await admin.getByRole('treeitem', { name: /check.sh/ }).getAttribute('aria-selected'), 'true')
    await admin.getByText('Base version 4', { exact: true }).waitFor()
    console.log('PASS review-file-diffs AC3 failed baseline/retry/immutable base while current version is newer')
    await admin.screenshot({ path: process.env.PROOF_SCREENSHOT ?? '/tmp/registry-review-diffs.png', fullPage: true })
    await admin.getByRole('textbox', { name: 'Decision reason', exact: true }).fill('Attempt stale approval')
    const staleApproval = admin.waitForResponse(response => response.url().endsWith('/approve') && response.request().method() === 'POST')
    await admin.getByRole('button', { name: 'Approve & publish', exact: true }).click()
    assert.equal((await staleApproval).status(), 409)
    await admin.getByText('Published skill changed after this proposal was submitted.', { exact: true }).waitFor()
    assert.equal((await detail(admin)).latest_version, 5)
    assert.equal((await mutate(admin, '/skills/diff-proof/restore', { version: 1, expected_version: 5 })).status(), 201)
  }
} catch (caught) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error('Browser failure URL:', page.url(), '\n', await page.locator('body').innerText().catch(() => 'Body unavailable'))
  }
  throw caught
} finally { await browser.close() }
