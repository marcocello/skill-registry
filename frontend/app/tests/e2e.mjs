import { createRequire } from "node:module"
import { resolve } from "node:path"

const require = createRequire(resolve(process.cwd(), "package.json"))
const { chromium } = require("playwright")

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route("**/api/setup/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ configured: true, settings_path: "/settings" }),
  }))
  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ code: "UNAUTHORIZED", message: "Authentication required." }),
  }))
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" })
  await page.getByRole("heading", { name: "Skill Registry", exact: true }).waitFor({ timeout: 5_000 })
  await page.locator('svg[data-icon="folder-tree"]').waitFor({ timeout: 5_000 })
  await page.getByRole("heading", { name: "Login", exact: true }).waitFor({ timeout: 5_000 })
  await page.getByText("Sign in with Google to access Skill Registry.", { exact: true }).waitFor({ timeout: 5_000 })
  await page.getByRole("link", { name: "Continue with Google", exact: true }).waitFor({ timeout: 5_000 })
  const card = page.locator('[data-slot="card"]')
  await card.waitFor({ timeout: 5_000 })
  const cardBox = await card.boundingBox()
  if (!cardBox || cardBox.width > 390) {
    throw new Error(`Login card is wider than the default shadcn size: ${cardBox?.width ?? "missing"}`)
  }
  if (await page.getByText(/ScaleUp Labs|ScaleUpLabs|Google Workspace|scaleuplabs\.vc/i).count()) {
    throw new Error("Organization-specific login copy is visible")
  }
} finally {
  await browser.close()
}
