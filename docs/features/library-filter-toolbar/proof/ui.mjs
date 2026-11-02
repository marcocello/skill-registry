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
    slug: "scripts-exported",
    name: "scripts-exported",
    display_name: "Scripts exported",
    description: "Contains a script and is exported.",
    latest_version: 1,
    updated_at: "2026-08-30T10:00:00Z",
    content_hash: "hash-scripts",
    git_export_status: "exported",
    file_count: 2,
    file_paths: ["SKILL.md", "scripts/run.sh"],
    owner: null,
  },
  {
    slug: "references-pending",
    name: "references-pending",
    display_name: "References pending",
    description: "Contains a reference and is pending export.",
    latest_version: 1,
    updated_at: "2026-08-29T10:00:00Z",
    content_hash: "hash-references",
    git_export_status: "pending",
    file_count: 2,
    file_paths: ["SKILL.md", "references/guide.md"],
    owner: null,
  },
  {
    slug: "plain-exported",
    name: "plain-exported",
    display_name: "Plain exported",
    description: "Contains only the required skill file.",
    latest_version: 1,
    updated_at: "2026-08-28T10:00:00Z",
    content_hash: "hash-plain",
    git_export_status: "exported",
    file_count: 1,
    file_paths: ["SKILL.md"],
    owner: null,
  },
  {
    slug: "both-pending",
    name: "both-pending",
    display_name: "Both pending",
    description: "Contains scripts and references and is pending export.",
    latest_version: 1,
    updated_at: "2026-08-27T10:00:00Z",
    content_hash: "hash-both",
    git_export_status: "pending",
    file_count: 3,
    file_paths: ["SKILL.md", "scripts/check.sh", "references/checks.md"],
    owner: null,
  },
];

const skillSlugs = skills.map((skill) => skill.slug);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
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
  const toolbar = page.getByTestId("library-toolbar");
  const grid = page.getByTestId("registry-grid");
  await toolbar.waitFor();

  assert.equal(await grid.getByTestId("library-toolbar").count(), 0);
  const [toolbarBox, gridBox] = await Promise.all([
    toolbar.boundingBox(),
    grid.boundingBox(),
  ]);
  assert.ok(toolbarBox && gridBox);
  assert.ok(toolbarBox.y + toolbarBox.height < gridBox.y);
  assert.equal(await page.getByTestId("load-status").count(), 0);
  assert.equal(await page.getByText(/^\d+ of \d+ loaded$/).count(), 0);

  const table = page.getByTestId("registry-table-view");

  async function visibleSlugs(scope = table) {
    return scope
      .locator("tbody tr")
      .evaluateAll(
        (rows, slugs) =>
          rows
            .map((row) => slugs.find((slug) => row.textContent?.includes(slug)))
            .filter(Boolean),
        skillSlugs,
      );
  }

  assert.deepEqual(await visibleSlugs(), skillSlugs);

  assert.equal(
    await page.getByRole("button", { name: /^Filter by contents/ }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Filter by Git export/ }).count(),
    0,
  );
  assert.equal(await page.getByRole("menuitemcheckbox").count(), 0);

  const search = page.getByRole("textbox", { name: "Search skills" });
  await search.fill("plain-exported");
  assert.deepEqual(await visibleSlugs(), ["plain-exported"]);
  await search.clear();
  assert.deepEqual(await visibleSlugs(), skillSlugs);
  assert.equal(
    await page.getByRole("group", { name: "Choose skills view" }).count(),
    0,
  );
  assert.equal(await page.getByRole("button", { name: "Card view" }).count(), 0);
  assert.equal(await page.getByTestId("skills-card-view").count(), 0);

  await page.setViewportSize({ width: 390, height: 760 });
  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  assert.equal(hasHorizontalOverflow, false);
  assert.ok(await search.isVisible());
} finally {
  await browser.close();
}
