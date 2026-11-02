import { createRequire } from "node:module"
import { resolve } from "node:path"

const require = createRequire(resolve(process.cwd(), "package.json"))
const { chromium } = require("playwright")

const base = process.env.PROOF_BASE_URL
const hostWorkspace = process.env.PROOF_HOST_WORKSPACE_PATH
const github = process.env.PROOF_GITHUB_URL
if (!base || !hostWorkspace || !github) throw new Error("proof browser environment is incomplete")

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`${base}/setup`, { waitUntil: "networkidle" })
  await page.getByRole("heading", { name: "skills-registry" }).waitFor()
  const setupShell = page.locator("main")
  const shellGutter = await setupShell.evaluate(
    (element) => getComputedStyle(element).scrollbarGutter,
  )
  if (shellGutter !== "stable") {
    throw new Error(`setup scroll geometry is not stable: ${shellGutter}`)
  }
  await page.getByText("SETUP", { exact: true }).waitFor()
  const logo = page.getByRole("img", { name: "Skill Registry" })
  await logo.waitFor()
  if (!(await logo.getAttribute("src"))?.endsWith("/images/favicon.svg")) {
    throw new Error("setup header does not use the real Skill Registry logo")
  }
  for (const step of [
    "Who can use this instance",
    "Where skills are stored",
    "Push remote",
  ]) {
    await page.getByRole("heading", { name: step, level: 2 }).waitFor()
  }
  const noSignInCard = page.locator("label").filter({
    has: page.getByText("No sign-in", { exact: true }),
  })
  const accessCardBox = await noSignInCard.boundingBox()
  if (!accessCardBox || accessCardBox.height > 108) {
    throw new Error(`access choice is too tall: ${accessCardBox?.height}`)
  }
  const googleMark = page.locator('[data-google-mark="official"]')
  if ((await googleMark.locator("path").count()) !== 4) {
    throw new Error("Google sign-in does not use the four-color Google mark")
  }
  for (const label of ["No remote", "GitHub.com", "Manual"]) {
    await page.getByText(label, { exact: true }).waitFor()
  }
  if (await page.getByText("GitLab", { exact: false }).count()) throw new Error("GitLab one-click is rendered")
  await page.getByLabel("Public URL").fill(base)
  await page.getByLabel("Repository name").fill("github-local-mirror")
  await page.getByText(`${hostWorkspace}/github-local-mirror`, { exact: true }).waitFor()
  await page.getByText("GitHub.com", { exact: true }).click()
  const reveal = page.locator('[data-setup-reveal="github"]')
  await reveal.waitFor()
  const connectGithub = page.getByRole("button", { name: "Connect GitHub" })
  await connectGithub.waitFor()
  const [revealBox, connectBox] = await Promise.all([
    reveal.boundingBox(),
    connectGithub.boundingBox(),
  ])
  if (!revealBox || !connectBox || connectBox.x < revealBox.x + revealBox.width / 2) {
    throw new Error("Connect GitHub action is not aligned to the right of the panel")
  }
  if (await page.getByLabel("GitHub repository name").count()) {
    throw new Error("GitHub repository options are expanded before they are requested")
  }
  const completeSetup = page.getByRole("button", { name: "Complete setup" })
  if (!(await completeSetup.isDisabled())) {
    throw new Error("Complete setup remains active before GitHub authorization")
  }
  await page.getByRole("button", { name: "Repository options" }).click()
  await page.locator('[data-setup-reveal="github-options"]').waitFor()
  if (!(await reveal.evaluate((element) => getComputedStyle(element).animationName)).includes("setup-fields-open")) {
    throw new Error("GitHub fields did not use setup reveal motion")
  }
  const revealFrames = await reveal.evaluate((element) =>
    element.getAnimations().flatMap((animation) =>
      animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [],
    ),
  )
  if (revealFrames.some((frame) => frame.filter && frame.filter !== "none")) {
    throw new Error("GitHub reveal uses a repaint-heavy filter transition")
  }
  if ((await page.getByLabel("HTTPS token").count()) || (await page.getByLabel("GitHub client ID").count())) {
    throw new Error("GitHub flow asks for pre-created credentials")
  }
  await page.getByLabel("GitHub repository name").fill("github-created-remote")
  let releaseGithubStart
  const githubStartGate = new Promise((resolve) => {
    releaseGithubStart = resolve
  })
  await page.route("**/api/setup/github/start", async (route) => {
    await githubStartGate
    await route.continue()
  })
  await connectGithub.click()
  await page
    .getByRole("status")
    .getByText("Opening GitHub for authorization…", { exact: true })
    .waitFor()
  releaseGithubStart()
  await page.getByRole("heading", { name: "Confirm GitHub App" }).waitFor()
  await page.getByRole("link", { name: "Create GitHub App" }).click()
  await page.getByRole("heading", { name: "Install GitHub App" }).waitFor()
  await page.getByRole("link", { name: "Install app" }).click()
  await page.getByRole("heading", { name: "Authorize repository" }).waitFor()
  await page.getByRole("link", { name: "Authorize repository" }).click()
  try {
    await page.getByText("Finish the GitHub connection", { exact: true }).waitFor({ timeout: 10_000 })
  } catch (error) {
    throw new Error(`pending GitHub card missing at ${page.url()} title=${await page.title()} body=${(await page.locator("body").innerText()).slice(0, 1200)} cause=${error}`)
  }
  const materialized = await page.request.get(`${github}/materialize-git`)
  if (!materialized.ok()) throw new Error("proof Git remote could not be materialized")
  await page.getByRole("button", { name: "Retry GitHub export" }).click()
  await page.waitForURL(`${base}/`, { timeout: 20_000 })
  await page.goto(`${base}/settings`, { waitUntil: "networkidle" })
  await page.getByText("GitHub.com", { exact: true }).waitFor()
  await page.getByText("proof-owner", { exact: true }).waitFor()
  await page.getByText("github-created-remote", { exact: true }).waitFor()
  const branchDetail = page.getByText("Export branch", { exact: true }).locator("..")
  await branchDetail.getByText("skills-registry", { exact: true }).waitFor()
  const credentialDetail = page.getByText("Credential", { exact: true }).locator("..")
  await credentialDetail.getByText("Configured", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Disconnect" }).click()
  const settingsRemote = page.getByRole("radiogroup", { name: "Remote" })
  await settingsRemote.waitFor()
  for (const label of ["No remote", "GitHub.com", "Manual"]) {
    await settingsRemote.getByRole("radio", { name: label }).waitFor()
  }
  if (!(await settingsRemote.getByRole("radio", { name: "No remote" }).isChecked())) {
    throw new Error("disconnected Git Settings does not select No remote")
  }
  await settingsRemote.getByText("GitHub.com", { exact: true }).click()
  await page.locator('[data-setup-reveal="settings-github"]').waitFor()
  await page.getByRole("button", { name: "Continue to GitHub.com" }).waitFor()
  await settingsRemote.getByText("Manual", { exact: true }).click()
  await page.locator('[data-setup-reveal="settings-manual"]').waitFor()
  await page.getByLabel("Remote URL").fill("https://git.example/proof/manual.git")
  await page.getByLabel("HTTPS username").fill("manual-proof")
  await page.getByLabel("HTTPS token").fill("manual-proof-token-canary")
  await page.getByRole("button", { name: "Save Manual settings" }).click()
  await page.getByRole("button", { name: "Disconnect" }).waitFor()
  console.log("browser providers=github.com+manual gitlab=absent manifest=confirmed installation=confirmed oauth=confirmed failed-push=retry disconnect=local-only switch=manual")
} finally {
  await browser.close()
}
