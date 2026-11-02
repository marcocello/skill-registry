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
    owner: {
      user_id: "owner-mia",
      email: "mia@example.test",
      display_name: "Mia",
    },
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
    owner: {
      user_id: "owner-zoe",
      email: "zoe@example.test",
      display_name: "Zoe",
    },
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
    owner: {
      user_id: "owner-ava",
      email: "ava@example.test",
      display_name: "Ava",
    },
  },
];

const expectedSlugs = skills.map((skill) => skill.slug);

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
  const table = page.getByTestId("registry-table-view");
  await table.getByText("zulu-skill", { exact: true }).waitFor();

  async function renderedSlugOrder() {
    return table
      .locator("tbody tr")
      .evaluateAll(
        (rows, slugs) =>
          rows
            .map((row) =>
              slugs.find((slug) => row.textContent?.includes(slug)),
            )
            .filter(Boolean),
        expectedSlugs,
      );
  }

  async function verifySort(title, ascending, descending) {
    const header = table.getByRole("columnheader", {
      name: title,
      exact: true,
    });
    const control = header.getByRole("button", { name: title, exact: true });
    await control.click();
    assert.equal(await header.getAttribute("aria-sort"), "ascending");
    assert.deepEqual(await renderedSlugOrder(), ascending);
    await control.click();
    assert.equal(await header.getAttribute("aria-sort"), "descending");
    assert.deepEqual(await renderedSlugOrder(), descending);
  }

  await verifySort(
    "Skill",
    ["alpha-skill", "mike-skill", "zulu-skill"],
    ["zulu-skill", "mike-skill", "alpha-skill"],
  );
  await verifySort(
    "Description",
    ["zulu-skill", "mike-skill", "alpha-skill"],
    ["alpha-skill", "mike-skill", "zulu-skill"],
  );
  await verifySort(
    "Owner",
    ["mike-skill", "zulu-skill", "alpha-skill"],
    ["alpha-skill", "zulu-skill", "mike-skill"],
  );
  await verifySort(
    "Files",
    ["alpha-skill", "mike-skill", "zulu-skill"],
    ["zulu-skill", "mike-skill", "alpha-skill"],
  );
  await verifySort(
    "Git export",
    ["alpha-skill", "mike-skill", "zulu-skill"],
    ["zulu-skill", "alpha-skill", "mike-skill"],
  );
  await verifySort(
    "Updated",
    ["alpha-skill", "mike-skill", "zulu-skill"],
    ["zulu-skill", "mike-skill", "alpha-skill"],
  );
} finally {
  await browser.close();
}
