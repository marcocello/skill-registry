import { createHash, randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import process from "node:process"

const require = createRequire(resolve(process.cwd(), "frontend/app/package.json"))
const { chromium } = require("playwright")
const frontend = process.env.PROOF_FRONTEND_URL
const provider = process.env.PROOF_PROVIDER_URL
if (!frontend || !provider) throw new Error("Proof browser URLs are required")

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function signIn(page, persona, returnTo = "/") {
  const next = `${frontend}/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`
  return page.goto(`${provider}/select/${persona}?next=${encodeURIComponent(next)}`, { waitUntil: "networkidle" })
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url")
}

async function shellMetrics(page, cardSelector, actionSelector, headerSelector) {
  return page.evaluate(({ cardSelector, actionSelector, headerSelector }) => {
    const card = document.querySelector(cardSelector)
    const action = document.querySelector(actionSelector)
    const header = document.querySelector(headerSelector)
    if (!card || !action || !header) throw new Error("OAuth/login shell metric target is missing")
    const cardBox = card.getBoundingClientRect()
    const actionBox = action.getBoundingClientRect()
    const headerBox = header.getBoundingClientRect()
    const style = getComputedStyle(card)
    return {
      cardWidth: cardBox.width,
      actionWidth: actionBox.width,
      headerGap: cardBox.top - headerBox.bottom,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      fontFamily: style.fontFamily,
    }
  }, { cardSelector, actionSelector, headerSelector })
}

async function authorizeMcp(page, scopes, callbackPort, loginMetrics, expectedEmail) {
  const oauthClientName = `Production-${"x".repeat(89)}`
  const protectedResponse = await fetch(`${frontend}/.well-known/oauth-protected-resource/mcp`)
  const protectedMetadata = await protectedResponse.json()
  assert(
    protectedResponse.status === 200 &&
      protectedMetadata.resource === `${frontend}/mcp` &&
      protectedMetadata.authorization_servers?.length === 1,
    `protected-resource discovery is invalid: ${JSON.stringify(protectedMetadata)}`,
  )
  const issuer = protectedMetadata.authorization_servers[0]
  const serverResponse = await fetch(`${issuer}/.well-known/oauth-authorization-server`)
  const serverMetadata = await serverResponse.json()
  assert(
    serverResponse.status === 200 &&
      serverMetadata.issuer === frontend &&
      serverMetadata.authorization_endpoint &&
      serverMetadata.token_endpoint &&
      serverMetadata.registration_endpoint &&
      serverMetadata.revocation_endpoint,
    `authorization-server discovery is invalid: ${JSON.stringify(serverMetadata)}`,
  )
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`
  const registrationResponse = await fetch(serverMetadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: oauthClientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
  assert(registrationResponse.status === 201, `dynamic registration failed: ${registrationResponse.status}`)
  const registration = await registrationResponse.json()
  const verifier = randomBytes(48).toString("base64url")
  const state = randomBytes(16).toString("hex")
  const query = new URLSearchParams({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    scope: scopes,
    resource: `${frontend}/mcp`,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    state,
  })
  let callbackUrl = ""
  await page.route(`${redirectUri}**`, async (route) => {
    callbackUrl = route.request().url()
    await route.fulfill({ status: 200, contentType: "text/plain", body: "OAuth callback received" })
  })
  await page.goto(`${serverMetadata.authorization_endpoint}?${query}`, { waitUntil: "networkidle" })
  await page.getByRole("heading", { name: "Skill Registry", exact: true }).waitFor()
  await page.locator('svg[data-prefix="fas"][data-icon="folder-tree"]').waitFor()
  await page.getByRole("heading", { name: `Authorize ${oauthClientName}`, exact: true }).waitFor()
  await page
    .locator("#consent-description")
    .getByText(oauthClientName, { exact: true })
    .waitFor()
  await page.getByText(expectedEmail, { exact: true }).waitFor()
  const expectedPermissions = scopes.split(" ").sort().map((scope) => ({
    "skills.read": "View published skills",
    "skills.submit": "Submit skills for review",
    "skills.review": "Review and publish skill proposals",
  })[scope])
  for (const permission of expectedPermissions) {
    await page.getByText(permission, { exact: true }).waitFor()
  }
  const permissionItems = await page.locator('[data-ui="oauth-permissions"] li').allTextContents()
  assert(
    JSON.stringify(permissionItems) === JSON.stringify(expectedPermissions),
    `consent permissions do not match granted scopes: ${JSON.stringify(permissionItems)}`,
  )
  const consentMetrics = await shellMetrics(
    page,
    '[data-ui="oauth-consent-card"]',
    '[data-ui="oauth-consent-action"]',
    '[data-ui="oauth-lockup"]',
  )
  assert(Math.abs(consentMetrics.cardWidth - loginMetrics.cardWidth) <= 2, "consent card width differs from login")
  assert(Math.abs(consentMetrics.actionWidth - loginMetrics.actionWidth) <= 2, "consent action width differs from login")
  assert(Math.abs(consentMetrics.headerGap - loginMetrics.headerGap) <= 2, "consent shell spacing differs from login")
  assert(consentMetrics.borderRadius === loginMetrics.borderRadius, "consent card radius differs from login")
  assert(consentMetrics.borderWidth === loginMetrics.borderWidth, "consent card border differs from login")
  assert(consentMetrics.fontFamily === loginMetrics.fontFamily, "consent typography differs from login")
  await page.setViewportSize({ width: 360, height: 760 })
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "consent UI overflows a narrow viewport",
  )
  await page.setViewportSize({ width: 1280, height: 720 })
  let authorizationPosts = 0
  const countAuthorizationPost = (request) => {
    if (request.method() === "POST" && request.url().startsWith(serverMetadata.authorization_endpoint)) {
      authorizationPosts += 1
    }
  }
  page.on("request", countAuthorizationPost)
  await Promise.all([
    page.waitForURL(`${redirectUri}**`),
    page.evaluate(() => {
      const button = document.querySelector('[data-ui="oauth-consent-action"]')
      button.click()
      button.click()
    }),
  ])
  page.off("request", countAuthorizationPost)
  assert(authorizationPosts === 1, `duplicate consent issued ${authorizationPosts} authorization requests`)
  const callback = new URL(callbackUrl || page.url())
  assert(callback.searchParams.get("state") === state, "OAuth state did not round-trip")
  const tokenResponse = await fetch(serverMetadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") || "",
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      resource: `${frontend}/mcp`,
      code_verifier: verifier,
    }),
  })
  const tokens = await tokenResponse.json()
  assert(tokenResponse.status === 200 && tokens.access_token, `PKCE token exchange failed: ${JSON.stringify(tokens)}`)
  return { ...tokens, client_id: registration.client_id, serverMetadata }
}

async function refreshAndRevoke(tokens) {
  const refreshResponse = await fetch(tokens.serverMetadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: tokens.client_id,
    }),
  })
  const refreshed = await refreshResponse.json()
  assert(refreshResponse.status === 200 && refreshed.access_token, `production refresh failed: ${JSON.stringify(refreshed)}`)
  const tools = await mcp(refreshed.access_token, "tools/list", { _meta: { progressToken: "refresh" } }, 7)
  assert(tools.tools.length === 3, "refreshed access token lost the user tool surface")
  const revokeResponse = await fetch(tokens.serverMetadata.revocation_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshed.refresh_token }),
  })
  assert(revokeResponse.status === 200, "production revocation endpoint failed")
  const revokedAccess = await fetch(`${frontend}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshed.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list", params: {} }),
  })
  assert(revokedAccess.status === 401, "revoked OAuth family retained MCP access")
  const revokedRefresh = await fetch(tokens.serverMetadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshed.refresh_token,
      client_id: tokens.client_id,
    }),
  })
  assert(revokedRefresh.status === 401, "revoked OAuth family could still refresh")
}

async function mcp(token, method, params, id = 1) {
  const response = await fetch(`${frontend}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })
  const body = await response.json()
  assert(response.status === 200 && !body.error, `MCP ${method} failed: HTTP ${response.status} ${JSON.stringify(body)}`)
  return body.result
}

const browser = await chromium.launch({ headless: true })
try {
  const anonymous = await browser.newPage()
  await anonymous.goto(frontend, { waitUntil: "networkidle" })
  await anonymous.getByRole("heading", { name: "Skill Registry", exact: true }).waitFor()
  await anonymous.locator('svg[data-icon="folder-tree"]').waitFor()
  await anonymous.getByRole("heading", { name: "Login", exact: true }).waitFor()
  await anonymous.getByText("Sign in with Google to access Skill Registry.", { exact: true }).waitFor()
  await anonymous.getByRole("link", { name: "Continue with Google", exact: true }).waitFor()
  const loginCard = anonymous.locator('[data-slot="card"]')
  await loginCard.waitFor()
  const loginCardBox = await loginCard.boundingBox()
  assert(loginCardBox && loginCardBox.width <= 390, "login card is wider than the default shadcn size")
  assert(
    (await anonymous.getByText(/ScaleUp Labs|Example Organization|Google Workspace|example\.vc/i).count()) === 0,
    "organization-specific login copy is visible",
  )
  assert(await anonymous.getByText(/shared token|admin password/i).count() === 0, "legacy authentication UI remains")
  const loginMetrics = await shellMetrics(
    anonymous,
    '[data-slot="card"]',
    '[data-slot="button"]',
    'section[aria-labelledby="login-title"] > header',
  )

  const userContext = await browser.newContext()
  const user = await userContext.newPage()
  const userTokens = await authorizeMcp(user, "skills.read skills.submit", 43191, loginMetrics, "user@example.com")
  await user.goto(frontend, { waitUntil: "networkidle" })
  await user.getByRole("heading", { name: "Library", exact: true }).waitFor()
  await user.getByText("Proof Existing", { exact: true }).waitFor()
  assert(await user.getByRole("button", { name: /review/i }).count() === 0, "user sees admin review navigation")
  const userSession = await user.evaluate(async () => (await fetch("/api/auth/session")).json())
  assert(userSession.email === "user@example.com" && userSession.role === "user", "user identity/role is wrong")
  const spoofedHttpOwner = await user.evaluate(async ({ csrf }) => {
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({
        action: "create",
        slug: "spoofed-http-owner",
        base_version: null,
        name: "Spoofed HTTP Owner",
        description: "Must be rejected before proposal persistence.",
        files: { "SKILL.md": "---\nname: spoofed-http-owner\n---\n" },
        owner: "attacker@example.test",
      }),
    })
    return { status: response.status, body: await response.json() }
  }, { csrf: userSession.csrf_token })
  assert(spoofedHttpOwner.status === 400, `HTTP accepted a client-supplied owner: ${JSON.stringify(spoofedHttpOwner)}`)
  const initialized = await mcp(userTokens.access_token, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "production-proof", version: "1.0.0" },
    _meta: { progressToken: "proof" },
  })
  assert(initialized.serverInfo.name === "skills-registry", "MCP initialize returned the wrong server")
  const userTools = await mcp(userTokens.access_token, "tools/list", { cursor: null, _meta: { progressToken: 1 } }, 2)
  assert(
    JSON.stringify(userTools.tools.map((tool) => tool.name).sort()) === JSON.stringify(["skills.get", "skills.list", "skills.submit"]),
    `user MCP tool surface is wrong: ${JSON.stringify(userTools.tools)}`,
  )
  const spoofedMcpOwner = await mcp(userTokens.access_token, "tools/call", {
    name: "skills.submit",
    arguments: {
      action: "create",
      slug: "spoofed-mcp-owner",
      base_version: null,
      name: "Spoofed MCP Owner",
      description: "Must be rejected before proposal persistence.",
      files: { "SKILL.md": "---\nname: spoofed-mcp-owner\n---\n" },
      owner: "attacker@example.test",
    },
  }, 3)
  assert(spoofedMcpOwner.isError, "MCP accepted a client-supplied owner")
  const mcpSubmission = await mcp(userTokens.access_token, "tools/call", {
    name: "skills.submit",
    arguments: {
      action: "create",
      slug: "mcp-production-pending",
      base_version: null,
      name: "MCP Production Pending",
      description: "Submitted through production OAuth and MCP.",
      files: {
        "SKILL.md": "---\nname: mcp-production-pending\n---\n\n# MCP production proposal\n",
        "references/proof.md": "# Complete MCP bundle\n",
      },
    },
  }, 4)
  assert(!mcpSubmission.isError && mcpSubmission.structuredContent.status === "pending", "MCP proposal was not accepted as pending")
  await refreshAndRevoke(userTokens)
  await user.goto(frontend, { waitUntil: "networkidle" })
  assert(await user.getByText("MCP Production Pending", { exact: true }).count() === 0, "MCP pending proposal leaked into Library")
  const submitted = await user.evaluate(async ({ csrf }) => {
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ action: "create", slug: "browser-reviewed", base_version: null, name: "Browser Reviewed", description: "Created by the production browser proof.", files: { "SKILL.md": "---\nname: browser-reviewed\n---\n\n# User proposal\n", "scripts/check.sh": "#!/usr/bin/env bash\necho user-version\n", "references/guide.md": "# User guide\n" } }),
    })
    return { status: response.status, body: await response.json() }
  }, { csrf: userSession.csrf_token })
  assert(submitted.status === 201 && submitted.body.status === "pending", "user proposal was not accepted as pending")
  await user.reload()
  assert(await user.getByText("Browser Reviewed", { exact: true }).count() === 0, "pending proposal leaked into Library")
  const sessionCookie = (await userContext.cookies()).find((cookie) => cookie.name === "registry_session")
  assert(sessionCookie?.httpOnly && sessionCookie.sameSite === "Lax", "browser session cookie is not protected")

  await user.getByRole("button", { name: "Connect", exact: true }).click()
  await user.getByText("codex mcp login skills-registry", { exact: true }).waitFor()
  const codexInstall = await user.getByTestId("codex-install-command").textContent()
  assert(codexInstall.includes(`${frontend}/companion/skills-registry-connect.tgz`), "Codex installer does not use the active Registry")
  await user.getByRole("button", { name: "Claude", exact: true }).click()
  await user.getByRole("button", { name: "Download Claude plugin", exact: true }).waitFor()
  await user.getByText("/skills-registry:guide", { exact: true }).waitFor()

  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, "admin", "/review")
  await admin.getByRole("heading", { name: "Proposal review", exact: true }).waitFor()
  const adminSession = await admin.evaluate(async () => (await fetch("/api/auth/session")).json())
  assert(adminSession.email === "admin@example.com" && adminSession.role === "admin", "admin allowlist role is wrong")
  const adminTokens = await authorizeMcp(admin, "skills.read skills.submit skills.review", 43192, loginMetrics, "admin@example.com")
  const adminTools = await mcp(adminTokens.access_token, "tools/list", { _meta: { progressToken: 2 } }, 4)
  const adminToolNames = new Set(adminTools.tools.map((tool) => tool.name))
  assert(adminToolNames.has("proposals.approve") && adminToolNames.has("skills.submit"), "admin review tools were not granted")
  const proposalListing = await mcp(adminTokens.access_token, "tools/call", { name: "proposals.list", arguments: {} }, 5)
  const mcpProposal = proposalListing.structuredContent.proposals.find((proposal) => proposal.slug === "mcp-production-pending")
  assert(mcpProposal?.status === "pending", "production MCP proposal is missing from review")
  const approvedByMcp = await mcp(adminTokens.access_token, "tools/call", {
    name: "proposals.approve",
    arguments: { id: mcpProposal.id, revision: mcpProposal.revision, reason: "Approved through production MCP OAuth proof." },
  }, 6)
  assert(!approvedByMcp.isError && approvedByMcp.structuredContent.status === "approved", "admin MCP approval failed")
  await admin.goto(`${frontend}/review`, { waitUntil: "networkidle" })
  await admin.getByText("Browser Reviewed", { exact: true }).waitFor()
  await admin.getByRole("textbox", { name: "Name", exact: true }).fill("Browser Reviewed by Admin")
  await admin.getByRole("button", { name: "scripts/check.sh", exact: true }).click()
  const scriptEditor = admin.getByRole("textbox", { name: "File content: scripts/check.sh", exact: true })
  assert((await scriptEditor.inputValue()).includes("user-version"), "admin could not inspect the submitted support file")
  await scriptEditor.fill("#!/usr/bin/env bash\necho admin-reviewed\n")
  await admin.getByRole("button", { name: "SKILL.md", exact: true }).click()
  await admin.getByRole("textbox", { name: "File content: SKILL.md", exact: true }).fill("---\nname: browser-reviewed\n---\n\n# Admin approved content\n")
  await admin.getByRole("button", { name: "Save proposal edit", exact: true }).click()
  await admin.getByText("revision 2", { exact: true }).waitFor()
  await admin.getByRole("textbox", { name: "Decision reason", exact: true }).fill("Reviewed through the production portal.")
  await admin.getByRole("button", { name: "Approve & publish", exact: true }).click()
  await admin.getByText("Review queue is clear", { exact: true }).waitFor()
  await admin.getByRole("button", { name: "Library", exact: true }).click()
  await admin.getByText("Browser Reviewed by Admin", { exact: true }).waitFor()
  await admin.getByText("MCP Production Pending", { exact: true }).waitFor()
  await admin.getByRole("columnheader", { name: "Owner", exact: true }).waitFor()
  await admin.getByText("Registry User · user@example.com", { exact: true }).first().waitFor()
  await admin.getByText("MCP Production Pending", { exact: true }).click()
  await admin.getByText("Owner", { exact: true }).waitFor()
  await admin.getByText("Registry User · user@example.com", { exact: true }).waitFor()

  const contributorContext = await browser.newContext()
  const contributor = await contributorContext.newPage()
  await signIn(contributor, "contributor")
  const contributorTokens = await authorizeMcp(
    contributor,
    "skills.read skills.submit",
    43193,
    loginMetrics,
    "contributor@example.com",
  )
  const existingSkill = await mcp(contributorTokens.access_token, "tools/call", {
    name: "skills.get",
    arguments: { slug: "mcp-production-pending" },
  }, 9)
  assert(
    existingSkill.structuredContent.owner?.email === "user@example.com" &&
      existingSkill.structuredContent.versions[0].author?.email === "user@example.com",
    `published MCP attribution is wrong: ${JSON.stringify(existingSkill.structuredContent)}`,
  )
  const skillListing = await mcp(contributorTokens.access_token, "tools/call", {
    name: "skills.list",
    arguments: {},
  }, 10)
  const listedSkill = skillListing.structuredContent.skills.find(
    (skill) => skill.slug === "mcp-production-pending",
  )
  assert(
    listedSkill?.owner?.email === "user@example.com",
    `MCP skills.list omitted the owner: ${JSON.stringify(skillListing.structuredContent)}`,
  )
  const updateSubmission = await mcp(contributorTokens.access_token, "tools/call", {
    name: "skills.submit",
    arguments: {
      action: "update",
      slug: "mcp-production-pending",
      base_version: 1,
      name: "MCP Production Pending",
      description: "Updated by a different authenticated Registry teammate.",
      files: {
        "SKILL.md": "---\nname: mcp-production-pending\n---\n\n# Contributor update\n",
        "references/proof.md": "# Complete contributor bundle\n",
      },
    },
  }, 11)
  assert(!updateSubmission.isError && updateSubmission.structuredContent.status === "pending", "contributor update was not accepted")
  const updatedProposalListing = await mcp(adminTokens.access_token, "tools/call", { name: "proposals.list", arguments: {} }, 12)
  const contributorProposal = updatedProposalListing.structuredContent.proposals.find(
    (proposal) => proposal.slug === "mcp-production-pending" && proposal.status === "pending",
  )
  assert(contributorProposal?.author === "contributor@example.com", "contributor proposal author is wrong")
  await mcp(adminTokens.access_token, "tools/call", {
    name: "proposals.approve",
    arguments: { id: contributorProposal.id, revision: contributorProposal.revision, reason: "Contributor update approved." },
  }, 13)
  const updatedSkill = await mcp(adminTokens.access_token, "tools/call", {
    name: "skills.get",
    arguments: { slug: "mcp-production-pending" },
  }, 14)
  assert(
    updatedSkill.structuredContent.owner?.email === "user@example.com" &&
      updatedSkill.structuredContent.versions[0].author?.email === "user@example.com" &&
      updatedSkill.structuredContent.versions[1].author?.email === "contributor@example.com",
    `owner changed or version author was lost: ${JSON.stringify(updatedSkill.structuredContent)}`,
  )
  await contributorContext.close()
  await admin.goto(`${frontend}/skills/mcp-production-pending`, { waitUntil: "networkidle" })
  await admin.getByText("Registry User · user@example.com", { exact: true }).waitFor()
  await admin.getByRole("tab", { name: "History", exact: true }).click()
  await admin.getByText("Published by Registry Contributor · contributor@example.com", { exact: true }).waitFor()

  const outsider = await (await browser.newContext()).newPage()
  const outsideResponse = await outsider.goto(`${provider}/select/outsider?next=${encodeURIComponent(`${frontend}/api/auth/google/start`)}`)
  assert(outsideResponse?.status() === 403, "outside Workspace identity was accepted")

  const legacy = await fetch(`${frontend}/mcp`, { method: "POST", headers: { Authorization: "Bearer sr_legacy", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) })
  assert(legacy.status === 401, "legacy bearer credential was accepted")
  for (const persona of ["unverified", "badnonce", "badaudience", "badissuer", "badsignature", "badalgorithm", "expired", "missinghd"]) {
    const negativeContext = await browser.newContext()
    const negative = await negativeContext.newPage()
    const response = await signIn(negative, persona)
    assert(response?.status() === 401, `${persona} ID token was accepted`)
    await negativeContext.close()
  }
  console.log("browser chromium=chromium oidc-user=pass oidc-admin=pass review=pass mcp-oauth=pass jwt-negatives=denied connect=pass outsider=denied")
} finally {
  await browser.close()
}
