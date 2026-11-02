import { createRequire } from "node:module"
import { resolve } from "node:path"

const require = createRequire(resolve(process.cwd(), "package.json"))
const { chromium } = require("playwright")

const base = process.env.PROOF_BASE_URL
const gitToken = process.env.PROOF_HTTPS_TOKEN
const hostWorkspace = process.env.PROOF_HOST_WORKSPACE_PATH
if (!base || !gitToken || !hostWorkspace) throw new Error("proof browser environment is incomplete")

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`${base}/setup`, { waitUntil: "networkidle" })
  await page.getByRole("heading", { name: "skills-registry" }).waitFor()
  await page.getByRole("img", { name: "Skill Registry" }).waitFor()
  if (await page.getByLabel("Bootstrap token").count()) throw new Error("obsolete bootstrap field is rendered")
  if (
    (await page.getByLabel("Use existing repository").count()) ||
    (await page.getByLabel("Create new repository").count()) ||
    (await page.getByLabel("Repository path").count())
  ) {
    throw new Error("repository mode or path controls are still rendered")
  }
  const portalCard = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Who can use this instance", level: 2 }),
  })
  const repositoryCard = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Where skills are stored", level: 2 }),
  })
  if ((await portalCard.count()) !== 1 || (await repositoryCard.count()) !== 1) {
    throw new Error("Access and repository setup are not separate numbered cards")
  }
  const ordered = await page.evaluate(() => {
    const exact = (value) => [...document.querySelectorAll("*")].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === value,
    )
    const access = exact("Who can use this instance")
    const publicUrl = exact("Public URL")
    const repository = exact("Where skills are stored")
    if (!access || !publicUrl || !repository) return false
    const after = Node.DOCUMENT_POSITION_FOLLOWING
    return Boolean(access.compareDocumentPosition(publicUrl) & after)
      && Boolean(publicUrl.compareDocumentPosition(repository) & after)
  })
  if (!ordered) throw new Error("setup controls are not ordered access, public URL, repository")
  await page.getByLabel("Public URL").fill(base)
  await page.getByLabel("Repository name").fill("compose-mirror")
  await page.getByText(`${hostWorkspace}/compose-mirror`, { exact: true }).waitFor()
  await page.getByText("/workspace/compose-mirror", { exact: true }).waitFor()
  await page.getByText("Manual", { exact: true }).click()
  const remoteReveal = page.locator('[data-setup-reveal="manual"]')
  await remoteReveal.waitFor()
  const remoteMotion = await remoteReveal.evaluate((element) => getComputedStyle(element).animationName)
  if (!remoteMotion.includes("setup-fields-open")) {
    throw new Error(`Remote fields did not use the setup reveal transition: ${remoteMotion}`)
  }
  await page.getByLabel("Remote URL").fill("https://git.example/operator/registry.git")
  await page.getByLabel("HTTPS username").fill("registry-proof")
  await page.getByLabel("HTTPS token").fill(gitToken)
  await page.getByRole("button", { name: "Complete setup" }).click()
  await page.getByRole("button", { name: "Open skills library" }).waitFor({ timeout: 15_000 })

  await page.getByRole("button", { name: "Download", exact: true }).waitFor()
  await page.getByRole("button", { name: "Upload", exact: true }).waitFor()
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await page.waitForURL(`${base}/connect`)
  await page.getByRole("button", { name: "Library", exact: true }).click()
  await page.waitForURL(`${base}/`)
  if (await page.getByRole("button", { name: "Submit with MCP", exact: true }).count()) {
    throw new Error("Library still renders the old Submit with MCP action")
  }
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await page.waitForURL(`${base}/connect`)
  await page.getByRole("heading", { name: "Connect your assistant", exact: true }).waitFor()
  const codexCard = page.getByRole("button", { name: "Codex", exact: true })
  const claudeCard = page.getByRole("button", { name: "Claude", exact: true })
  for (const [name, card] of [["codex", codexCard], ["claude", claudeCard]]) {
    await card.waitFor()
    if ((await card.getAttribute("data-client-card")) !== "provider") {
      throw new Error(`${name} selection does not use the provider-card treatment`)
    }
    if ((await card.locator(`[data-provider-mark="${name}"] path`).count()) !== 1) {
      throw new Error(`${name} provider mark is missing`)
    }
  }
  if ((await codexCard.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Codex provider card does not expose its selected state")
  }
  await page.getByRole("heading", { name: "2. Connect Skill Registry", exact: true }).waitFor()
  const codexInstall = page.getByTestId("codex-install-command")
  await codexInstall.waitFor()
  if (!(await codexInstall.innerText()).includes("skills-registry-connect.tgz")) {
    throw new Error("Codex setup does not use the self-hosted Registry installer")
  }
  await page.getByTestId("codex-example-download").getByText("$skills-registry-guide", { exact: false }).waitFor()
  await claudeCard.click()
  if ((await claudeCard.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Claude provider card does not expose its selected state")
  }
  await page.getByText(
    "Local HTTP works locally. Claude cloud requires public HTTPS.",
    { exact: true },
  ).waitFor()
  await page.getByRole("button", { name: "Download Claude plugin", exact: true }).waitFor()
  await page.getByTestId("claude-example-download").getByText("/skills-registry:guide", { exact: false }).waitFor()

  await page.goto(`${base}/setup`, { waitUntil: "networkidle" })
  await page.waitForURL(`${base}/`)
  await page.goto(`${base}/settings`, { waitUntil: "networkidle" })
  await page.getByText("Git remote", { exact: true }).waitFor()
  if ((await page.getByLabel("Remote URL").inputValue()) !== "https://git.example/operator/registry.git") {
    throw new Error("setup remote was not read back through Git settings")
  }
  if (await page.getByText("Instance settings", { exact: true }).count()) {
    throw new Error("sealed authentication settings remain visible")
  }
  console.log("browser setup=no-bootstrap cards=access+git repository=new-only mount-paths=rendered sealed=true")
} finally {
  await browser.close()
}
