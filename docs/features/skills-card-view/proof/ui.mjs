import { createRequire } from "node:module";
import { resolve } from "node:path";

const frontendDirectory = resolve(process.cwd());
const require = createRequire(resolve(frontendDirectory, "package.json"));
const { chromium } = require("playwright");
const baseUrl = process.env.PROOF_BASE_URL;

if (!baseUrl) throw new Error("PROOF_BASE_URL is required");

const skills = [
  {
    slug: "ops-automation",
    name: "Ops automation",
    description: "Run safe operational routines with explicit checkpoints.",
    latest_version: 4,
    updated_at: "2026-08-30T10:00:00Z",
    content_hash: "hash-ops",
    git_export_status: "exported",
    file_count: 3,
    file_paths: ["SKILL.md", "scripts/run.sh", "references/checks.md"],
    owner: {
      user_id: "owner-1",
      email: "ops@example.test",
      display_name: "Ops Team",
    },
  },
  {
    slug: "clear-writing",
    name: "Clear writing",
    description: "Turn product evidence into concise release notes.",
    latest_version: 2,
    updated_at: "2026-08-29T10:00:00Z",
    content_hash: "hash-writing",
    git_export_status: "pending",
    file_count: 1,
    file_paths: ["SKILL.md"],
    owner: null,
  },
];

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
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();

  const tableButton = page.getByRole("button", { name: "Table view" });
  const cardsButton = page.getByRole("button", { name: "Card view" });
  await tableButton.waitFor();
  if ((await tableButton.getAttribute("aria-pressed")) !== "true")
    throw new Error("Table view is not active by default");

  await cardsButton.click();
  if ((await cardsButton.getAttribute("aria-pressed")) !== "true")
    throw new Error("Card view did not become active");

  const cards = page.getByTestId("skills-card-view");
  await cards.waitFor();
  if ((await cards.locator('[data-slot="frame"]').count()) !== 2)
    throw new Error("Card view did not render both Registry skills");
  await cards.getByRole("heading", { name: "Ops automation" }).waitFor();
  await cards
    .getByText("Run safe operational routines with explicit checkpoints.")
    .waitFor();
  await cards.getByText("3 files").waitFor();

  await page.setViewportSize({ width: 390, height: 760 });
  const cardBoxes = await cards
    .locator('[data-slot="frame"]')
    .evaluateAll((frames) =>
      frames.map((frame) => {
        const box = frame.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    );
  if (
    cardBoxes.length !== 2 ||
    Math.abs(cardBoxes[0].left - cardBoxes[1].left) > 1
  )
    throw new Error("Cards do not collapse to one column on a narrow viewport");
  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  if (hasHorizontalOverflow)
    throw new Error("Card view overflows the narrow viewport horizontally");
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("textbox", { name: "Search skills" }).fill("writing");
  await cards.getByRole("heading", { name: "Clear writing" }).waitFor();
  if (await cards.getByRole("heading", { name: "Ops automation" }).count())
    throw new Error("Search did not filter the card view");

  await tableButton.click();
  await page.getByTestId("registry-table-view").waitFor();

  await cardsButton.click();
  await page.getByRole("textbox", { name: "Search skills" }).fill("ops");
  await cards.getByRole("link", { name: /Ops automation/ }).click();
  await page.waitForURL("**/skills/ops-automation");
} finally {
  await browser.close();
}
