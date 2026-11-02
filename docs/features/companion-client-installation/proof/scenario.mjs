import { spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "../../../..")
const frontendRoot = join(repoRoot, "frontend/app")
const distRoot = join(frontendRoot, "dist")
const tarballPath = join(distRoot, "companion/skills-registry-connect.tgz")
const require = createRequire(join(frontendRoot, "package.json"))
const { chromium } = require("playwright")
const JSZip = require("jszip")
const work = await mkdtemp(join(tmpdir(), "skills-registry-install-proof-"))
const port = 4199
const origin = `http://127.0.0.1:${port}`
const preview = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: frontendRoot,
  stdio: ["ignore", "pipe", "pipe"],
})

try {
  await waitForPreview(origin)
  const browser = await chromium.launch({ headless: true })
  try {
    await proveConnectPage(browser)
  } finally {
    await browser.close()
  }
  await proveCodexInstaller()
  process.stdout.write(`node=${process.version} npm=${version("npm")} npx=${version("npx")} claude=${version("claude")}\n`)
  process.stdout.write(`frontend_origin=${origin} codex_outer=fake claude_artifact=browser-download\n`)
} finally {
  if (preview.exitCode === null) {
    preview.kill("SIGTERM")
    await new Promise((resolveExit) => preview.once("exit", resolveExit))
  }
  await rm(work, { recursive: true, force: true })
}

async function proveConnectPage(browser) {
  const page = await browser.newPage({ acceptDownloads: true })
  await page.route("**/api/setup/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ configured: true }),
  }))
  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ auth_mode: "none", display_name: "Open access", email: "" }),
  }))
  await page.route("**/api/skills**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ skills: [], next_cursor: null }),
  }))
  await page.goto(`${origin}/connect`, { waitUntil: "networkidle" })
  await assertThreeStepCards(page, "Codex")
  assert(await page.getByRole("heading", { name: "Add Skill Registry", exact: true }).count() === 0, "Redundant inner title is still rendered")
  assert(await page.getByText("Safe to run again.", { exact: true }).count() === 0, "Redundant installer reassurance is still rendered")
  assert(await page.getByTestId("client-steps").getByText("Open", { exact: true }).count() === 0, "Redundant access badge is still rendered")
  assert(await page.getByTestId("client-steps").getByText("Codex", { exact: true }).count() === 0, "Redundant provider badge is still rendered")
  const cliInstall = await page.getByTestId("codex-cli-install-command").textContent()
  assert(cliInstall === "curl -fsSL https://chatgpt.com/codex/install.sh | sh", "Codex CLI install command is not the official command")
  const command = await page.getByTestId("codex-install-command").textContent()
  assert(command?.includes(`${origin}/companion/skills-registry-connect.tgz`), "Codex command does not use this Registry's tarball")
  assert(command?.includes(origin), "Codex command does not pass this Registry origin")
  assert(!command?.includes("curl") && !command?.includes("mkdir"), "Codex command still exposes manual shell installation")
  await page.getByRole("heading", { name: "1. Install Codex", exact: true }).waitFor()
  await page.getByRole("heading", { name: "2. Connect Skill Registry", exact: true }).waitFor()
  await page.getByRole("heading", { name: "3. Try it", exact: true }).waitFor()
  assert(await page.getByRole("link", { name: "Download Codex desktop", exact: true }).getAttribute("href") === "https://learn.chatgpt.com/docs/app", "Desktop guidance is not official")
  const downloadExample = await page.getByTestId("codex-example-download").textContent()
  const changeExample = await page.getByTestId("codex-example-change").textContent()
  const createExample = await page.getByTestId("codex-example-create").textContent()
  for (const example of [downloadExample, changeExample, createExample]) {
    assert(example?.startsWith("$skills-registry-guide"), "A Codex example does not invoke the companion")
  }
  assert(downloadExample?.includes("complete bundle") && downloadExample.includes(".skill_id"), "Download example loses bundle identity")
  assert(changeExample?.includes("published or pending review"), "Change example overclaims publication")
  assert(createExample?.includes("write action available to my access level"), "Create example hard-codes one access mode")
  await page.getByText("Start a new Codex task. If the guide is not listed, restart Codex.", { exact: true }).waitFor()

  await page.getByRole("button", { name: "Claude", exact: true }).click()
  await assertThreeStepCards(page, "Claude")
  await page.getByRole("heading", { name: "1. Install Claude Desktop", exact: true }).waitFor()
  await page.getByRole("heading", { name: "2. Connect Skill Registry", exact: true }).waitFor()
  await page.getByRole("heading", { name: "3. Try it", exact: true }).waitFor()
  assert(await page.getByRole("link", { name: "Download Claude Desktop", exact: true }).getAttribute("href") === "https://claude.ai/download", "Claude Desktop guidance is not official")
  const claudeExamples = await page.locator('[data-testid^="claude-example-"]').allTextContents()
  assert(claudeExamples.length === 3, `Expected three Claude examples, got ${claudeExamples.length}`)
  for (const example of claudeExamples) {
    assert(example.startsWith("/skills-registry:guide"), "A Claude example does not invoke the companion")
  }
  assert(claudeExamples[1].includes("published or pending review"), "Claude change example overclaims publication")
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download Claude plugin", exact: true }).click()
  const download = await downloadPromise
  assert(download.suggestedFilename() === "skills-registry-claude-plugin.zip", "Claude filename is wrong")
  const saved = join(work, download.suggestedFilename())
  await download.saveAs(saved)
  await validateClaudePlugin(saved)
}

async function assertThreeStepCards(page, client) {
  const cards = page.getByTestId("client-step-card")
  assert(await cards.count() === 3, `${client} should render three separate step cards`)
}

async function validateClaudePlugin(zipPath) {
  const archive = await JSZip.loadAsync(await readFile(zipPath))
  const manifest = JSON.parse(await requiredZipText(archive, ".claude-plugin/plugin.json"))
  const mcp = JSON.parse(await requiredZipText(archive, ".mcp.json"))
  const skill = await requiredZipText(archive, "skills/guide/SKILL.md")
  assert(manifest.name === "skills-registry", "Claude plugin name is wrong")
  assert(mcp.mcpServers?.["skills-registry"]?.type === "http", "Claude MCP transport is wrong")
  assert(mcp.mcpServers?.["skills-registry"]?.url === `${origin}/mcp`, "Claude MCP URL is wrong")
  assert(skill.includes("name: skills-registry-guide"), "Claude companion skill is missing")

  const extracted = join(work, "claude-plugin")
  for (const [name, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue
    assert(!name.includes("..") && !name.startsWith("/"), `Unsafe ZIP entry: ${name}`)
    const target = join(extracted, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await entry.async("nodebuffer"))
  }
  const validation = spawnSync("claude", ["plugin", "validate", extracted], { encoding: "utf8" })
  assert(validation.status === 0, `Claude plugin validation failed: ${validation.stdout}${validation.stderr}`)
}

async function proveCodexInstaller() {
  await readFile(tarballPath)
  const fakeBin = join(work, "bin")
  const fakeState = join(work, "codex-state.json")
  const fakeLog = join(work, "codex-log.ndjson")
  const userHome = join(work, "home")
  const npmCache = join(work, "npm-cache")
  await mkdir(fakeBin, { recursive: true })
  await mkdir(userHome, { recursive: true })
  const fakeCodex = join(fakeBin, "codex")
  await writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CODEX_FAKE_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "mcp" && args[1] === "get") {
  if (!fs.existsSync(process.env.CODEX_FAKE_STATE)) process.exit(1);
  process.stdout.write(fs.readFileSync(process.env.CODEX_FAKE_STATE, "utf8"));
  process.exit(0);
}
if (args[0] === "mcp" && args[1] === "add") {
  const url = args[args.indexOf("--url") + 1];
  fs.writeFileSync(process.env.CODEX_FAKE_STATE, JSON.stringify({ name: "skills-registry", transport: { type: "streamable_http", url } }));
  process.exit(0);
}
process.exit(args[0] === "--version" ? 0 : 1);
`)
  await chmod(fakeCodex, 0o755)
  const env = {
    ...process.env,
    HOME: userHome,
    PATH: `${fakeBin}:${process.env.PATH}`,
    CODEX_FAKE_STATE: fakeState,
    CODEX_FAKE_LOG: fakeLog,
    npm_config_cache: npmCache,
  }
  const packageUrl = `${origin}/companion/skills-registry-connect.tgz`
  run("npx", ["--yes", packageUrl, origin], env)
  run("npx", ["--yes", packageUrl, origin], env)
  const installed = await readFile(join(userHome, ".agents/skills/skills-registry-guide/SKILL.md"), "utf8")
  const source = await readFile(join(userHome, ".agents/skills/skills-registry-guide/.registry-source"), "utf8")
  const calls = (await readFile(fakeLog, "utf8")).trim().split("\n").map(JSON.parse)
  const adds = calls.filter((args) => args[0] === "mcp" && args[1] === "add")
  assert(installed.includes("name: skills-registry-guide"), "Codex companion was not installed")
  assert(source.trim() === origin, "Codex companion source marker is wrong")
  assert(adds.length === 1, `Expected one MCP add across two runs, got ${adds.length}`)
  assert(adds[0].join(" ") === `mcp add skills-registry --url ${origin}/mcp`, "Codex MCP argv is wrong")

  const otherOrigin = "https://other-registry.example"
  await writeFile(fakeState, JSON.stringify({ name: "skills-registry", transport: { type: "streamable_http", url: `${otherOrigin}/mcp` } }))
  runFailure("npx", ["--yes", packageUrl, origin], env, "codex mcp remove skills-registry")
  const preservedMcp = JSON.parse(await readFile(fakeState, "utf8"))
  assert(preservedMcp.transport.url === `${otherOrigin}/mcp`, "Conflicting MCP configuration was changed")

  const skillRoot = join(userHome, ".agents/skills/skills-registry-guide")
  await writeFile(join(skillRoot, ".registry-source"), `${otherOrigin}\n`)
  runFailure("npx", ["--yes", packageUrl, origin], env, `belongs to ${otherOrigin}`)
  assert((await readFile(join(skillRoot, ".registry-source"), "utf8")).trim() === otherOrigin, "Conflicting source marker was changed")

  const unmanagedHome = join(work, "unmanaged-home")
  const unmanagedSkill = join(unmanagedHome, ".agents/skills/skills-registry-guide/SKILL.md")
  await mkdir(dirname(unmanagedSkill), { recursive: true })
  await writeFile(unmanagedSkill, "---\nname: local-guide\n---\n")
  runFailure("npx", ["--yes", packageUrl, origin], { ...env, HOME: unmanagedHome }, "was not installed by Skill Registry")
  assert((await readFile(unmanagedSkill, "utf8")).includes("name: local-guide"), "Unmanaged skill was overwritten")
}

async function requiredZipText(zip, path) {
  const entry = zip.file(path)
  assert(entry, `Claude ZIP is missing ${path}`)
  return entry.async("text")
}

async function waitForPreview(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error("Frontend preview did not become ready")
}

function run(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: "utf8" })
  assert(result.status === 0, `${command} failed: ${result.stdout}${result.stderr}`)
}

function runFailure(command, args, env, expectedMessage) {
  const result = spawnSync(command, args, { env, encoding: "utf8" })
  assert(result.status !== 0, `${command} unexpectedly succeeded`)
  assert(result.stderr.includes(expectedMessage), `${command} failure was not actionable: ${result.stderr}`)
}

function version(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : "unavailable"
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
