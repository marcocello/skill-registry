import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const frontendDirectory = resolve(process.cwd());
const require = createRequire(resolve(frontendDirectory, "package.json"));
const { chromium } = require("playwright");
const baseUrl = process.env.PROOF_BASE_URL;

if (!baseUrl) throw new Error("PROOF_BASE_URL is required");

const skills = [
  {
    slug: "zulu-skill",
    name: "zulu-skill",
    display_name: "Zulu skill",
    description: "Apple workflow description.",
    latest_version: 1,
    updated_at: "2026-08-30T10:00:00Z",
    content_hash: "hash-zulu",
    git_export_status: "pending",
    file_count: 3,
    file_paths: ["SKILL.md", "scripts/run.sh", "references/checks.md"],
    owner: null,
  },
  {
    slug: "alpha-skill",
    name: "alpha-skill",
    display_name: "Alpha skill",
    description: "Zebra workflow description.",
    latest_version: 1,
    updated_at: "2026-08-28T10:00:00Z",
    content_hash: "hash-alpha",
    git_export_status: "exported",
    file_count: 1,
    file_paths: ["SKILL.md"],
    owner: null,
  },
  {
    slug: "mike-skill",
    name: "mike-skill",
    display_name: "Mike skill",
    description: "Lime workflow description.",
    latest_version: 1,
    updated_at: "2026-08-29T10:00:00Z",
    content_hash: "hash-mike",
    git_export_status: "exported",
    file_count: 2,
    file_paths: ["SKILL.md", "agents/openai.yaml"],
    owner: null,
  },
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, settings_path: "/settings" }),
    }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        auth_mode: "none",
        email: "local@example.test",
        display_name: "Local operator",
      }),
    }),
  );
  await page.route("**/api/skills", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ skills }),
    }),
  );

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const table = page.getByTestId("registry-table-view");
  await table.getByText("alpha-skill", { exact: true }).waitFor();

  const alphaRow = table.locator('tbody tr[data-row-id="alpha-skill"]');
  const alphaSelectionCell = alphaRow.locator("td").first();
  const selectionCellBox = await alphaSelectionCell.boundingBox();
  assert.ok(selectionCellBox);
  await page.mouse.click(
    selectionCellBox.x + selectionCellBox.width - 3,
    selectionCellBox.y + selectionCellBox.height / 2,
  );
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await alphaRow.getAttribute("data-state"), null);

  await alphaRow.getByRole("checkbox", { name: "Select row" }).click();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await alphaRow.getAttribute("data-state"), "selected");
  await page.getByRole("status").getByText("1 skill selected").waitFor();

  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("menuitem", { name: "Claude", exact: true }).click();
  const dialog = page.getByTestId("assistant-transfer-dialog");
  const prompt = dialog.getByTestId("assistant-transfer-prompt");
  const claudePrompt = await prompt.innerText();
  assert.match(claudePrompt, /^\/skills-registry:guide/);
  assert.match(claudePrompt, /Alpha skill/);
  assert.match(claudePrompt, /alpha-skill/);
  assert.doesNotMatch(claudePrompt, /Zulu skill|zulu-skill/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  const skillHeader = table.getByRole("columnheader", {
    name: "Skill",
    exact: true,
  });
  await skillHeader.getByRole("button", { name: "Skill", exact: true }).click();
  assert.equal(await alphaRow.getAttribute("data-state"), "selected");

  const search = page.getByRole("textbox", { name: "Search skills" });
  await search.fill("zulu-skill");
  await table.getByText("zulu-skill", { exact: true }).waitFor();
  assert.equal(await alphaRow.count(), 0);
  await page.getByRole("status").getByText("1 skill selected").waitFor();

  await search.fill("");
  await table.getByText("alpha-skill", { exact: true }).waitFor();
  assert.equal(await alphaRow.getAttribute("data-state"), "selected");

  const selectAll = table.getByRole("checkbox", { name: "Select all" });
  assert.equal(await selectAll.getAttribute("data-state"), "indeterminate");
  await selectAll.click();
  await page.getByRole("status").getByText("3 skills selected").waitFor();
  assert.equal(await table.locator('tbody tr[data-state="selected"]').count(), 3);

  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
  const codexPrompt = await prompt.innerText();
  assert.match(codexPrompt, /^\$skills-registry-guide/);
  for (const skill of skills) {
    assert.match(codexPrompt, new RegExp(skill.display_name));
    assert.match(codexPrompt, new RegExp(skill.slug));
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await table.locator('tbody tr[data-state="selected"]').count(), 0);
  assert.equal(await page.getByRole("status").count(), 0);

  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
  const generalPrompt = await prompt.innerText();
  assert.match(generalPrompt, /Find the best skill for \[task\]/);
  assert.doesNotMatch(generalPrompt, /Alpha skill|alpha-skill/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  await alphaRow.click();
  await page.waitForURL("**/skills/alpha-skill");
} finally {
  await browser.close();
}
