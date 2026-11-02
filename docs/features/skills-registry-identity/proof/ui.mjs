import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const origin = process.env.PROOF_BASE_URL

if (!origin) throw new Error('PROOF_BASE_URL is required')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByText('Skill Registry', { exact: true }).waitFor()
  if ((await page.getByText('Agent Skills Portal', { exact: true }).count()) !== 0) {
    throw new Error('Rejected product name is still visible in the portal shell')
  }
  if ((await page.title()) !== 'Skill Registry') {
    throw new Error(`Unexpected document title: ${await page.title()}`)
  }

  await page.goto(`${origin}/connect`, { waitUntil: 'networkidle' })
  const codexCommand = page.getByTestId('codex-install-command')
  await codexCommand.waitFor()
  const codexText = await codexCommand.innerText()
  for (const expected of [
    `npx --yes '${origin}/companion/skills-registry-connect.tgz' '${origin}'`,
  ]) {
    if (!codexText.includes(expected)) {
      throw new Error(`Codex setup command is missing ${JSON.stringify(expected)}: ${codexText}`)
    }
  }
  const codexPrompt = page.getByTestId('codex-example-download')
  await codexPrompt.waitFor()
  if (!(await codexPrompt.innerText()).startsWith('$skills-registry-guide ')) {
    throw new Error('Codex example does not invoke the companion guide')
  }

  await page.getByRole('button', { name: /Claude/ }).click()
  await page.getByRole('button', { name: 'Download Claude plugin', exact: true }).waitFor()
  const claudePrompt = page.getByTestId('claude-example-download')
  await claudePrompt.waitFor()
  if (!(await claudePrompt.innerText()).startsWith('/skills-registry:guide ')) {
    throw new Error('Claude example does not invoke the companion guide')
  }
  console.log('browser=chromium identity=pass codex-companion=pass claude-companion=pass')
} finally {
  await browser.close()
}
