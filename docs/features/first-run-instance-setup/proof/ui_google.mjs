import { createRequire } from "node:module"
import { resolve } from "node:path"

const require = createRequire(resolve(process.cwd(), "package.json"))
const { chromium } = require("playwright")

const base = process.env.PROOF_BASE_URL
const secret = process.env.PROOF_GOOGLE_SECRET
const hostWorkspace = process.env.PROOF_HOST_WORKSPACE_PATH
if (!base || !secret || !hostWorkspace) throw new Error("Google setup proof environment is incomplete")

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`${base}/setup`, { waitUntil: "networkidle" })
  if (await page.getByLabel("Google client ID").count()) {
    throw new Error("Google fields are rendered before Google access is selected")
  }
  await page.getByLabel("Google OIDC").click()
  const googleReveal = page.locator('[data-setup-reveal="google"]')
  await googleReveal.waitFor()
  const motion = await googleReveal.evaluate((element) => {
    const style = getComputedStyle(element)
    return { name: style.animationName, duration: style.animationDuration }
  })
  if (!motion.name.includes("setup-fields-open") || motion.duration === "0s") {
    throw new Error(`Google fields did not use the setup reveal transition: ${JSON.stringify(motion)}`)
  }
  await page.getByLabel("Open full access").click()
  await googleReveal.waitFor({ state: "hidden" })
  if (await page.getByLabel("Google client ID").count()) {
    throw new Error("Collapsed Google fields remain in the form")
  }
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.getByLabel("Google OIDC").click()
  const reducedMotion = await googleReveal.evaluate((element) => getComputedStyle(element).animationName)
  if (reducedMotion !== "none") {
    throw new Error(`Reduced-motion setup reveal still animates: ${reducedMotion}`)
  }
  await page.getByLabel("Public URL").fill(base)
  await page.getByLabel("Google client ID").fill("rendered-google-client")
  await page.getByLabel("Google client secret").fill(secret)
  await page.getByLabel("Allowed domains").fill("example.com")
  await page.getByLabel("Administrator emails").fill("admin@example.com")
  await page.getByLabel("Repository name").fill("google-rendered-mirror")
  await page.getByText(`${hostWorkspace}/google-rendered-mirror`, { exact: true }).waitFor()
  await page.getByRole("button", { name: "Complete setup" }).click()
  await page.waitForTimeout(3000)
  if (!(await page.getByText("Verify your Google administrator", { exact: true }).count())) {
    const alert = await page.getByRole("alert").allInnerTexts()
    throw new Error(`Google setup did not become provisional: ${alert.join(" | ") || await page.locator("body").innerText()}`)
  }
  await page.getByText("Verify your Google administrator", { exact: true }).waitFor()
  await page.getByRole("link", { name: "Continue with Google" }).waitFor()
  if (new URL(page.url()).pathname !== "/setup") throw new Error("provisional setup left its verification page")
  console.log("browser google=provisional admin-verification=rendered repository=new")
} finally {
  await browser.close()
}
