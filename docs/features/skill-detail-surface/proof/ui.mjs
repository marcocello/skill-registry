import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const frontendDirectory = resolve(process.cwd());
const require = createRequire(resolve(frontendDirectory, "package.json"));
const { chromium } = require("playwright");
const baseUrl = process.env.PROOF_BASE_URL;

if (!baseUrl) throw new Error("PROOF_BASE_URL is required");

const summary = {
  slug: "surface-test",
  name: "surface-test",
  display_name: "Surface Display Name",
  description: "Deterministic skill detail surface fixture.",
  latest_version: 3,
  updated_at: "2026-08-31T10:00:00Z",
  content_hash: "hash-surface-test",
  git_export_status: "exported",
  file_count: 3,
  file_paths: ["SKILL.md", "agents/openai.yaml", "agents/prompts/review.md"],
  owner: null,
};

const detail = {
  slug: summary.slug,
  name: summary.name,
  display_name: summary.display_name,
  description: summary.description,
  latest_version: summary.latest_version,
  created_at: summary.updated_at,
  updated_at: summary.updated_at,
  owner: null,
  versions: [
    {
      slug: summary.slug,
      version: summary.latest_version,
      name: summary.name,
      display_name: summary.display_name,
      description: summary.description,
      files: {
        "SKILL.md": Array.from(
          { length: 104 },
          (_, index) => `Complete file line ${index + 1}`,
        ).join("\n"),
        "agents/openai.yaml":
          'interface:\n  display_name: "Surface test"\n  short_description: "Proof fixture."\n',
        "agents/prompts/review.md": "# Review prompt\nCheck the candidate carefully.\n",
      },
      content_hash: summary.content_hash,
      created_at: summary.updated_at,
      author: null,
      git_export: { status: "exported", commit_sha: "abc123", error: null },
    },
  ],
};

function relativeLuminance(channels) {
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
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
      body: JSON.stringify({ skills: [summary] }),
    }),
  );
  await page.route("**/api/skills/surface-test", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail),
    }),
  );

  await page.goto(`${baseUrl}/skills/surface-test`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("heading", { name: "Surface Display Name", exact: true })
    .waitFor();

  const agentsFolder = page.getByRole("treeitem", {
    name: "agents",
    exact: true,
  });
  const promptsFolder = page.getByRole("treeitem", {
    name: "prompts",
    exact: true,
  });
  const openaiFile = page.getByRole("treeitem", {
    name: "openai.yaml",
    exact: true,
  });
  const reviewFile = page.getByRole("treeitem", {
    name: "review.md",
    exact: true,
  });
  assert.equal(await agentsFolder.evaluate((element) => element.tagName), "BUTTON");
  assert.equal(await agentsFolder.getAttribute("aria-expanded"), "true");
  assert.equal(await openaiFile.count(), 1);
  assert.equal(await reviewFile.count(), 1);

  await agentsFolder.click();
  assert.equal(await agentsFolder.getAttribute("aria-expanded"), "false");
  assert.equal(await openaiFile.count(), 0);
  assert.equal(await reviewFile.count(), 0);

  await agentsFolder.click();
  assert.equal(await agentsFolder.getAttribute("aria-expanded"), "true");
  assert.equal(await openaiFile.count(), 1);
  assert.equal(await promptsFolder.getAttribute("aria-expanded"), "true");
  await promptsFolder.click();
  assert.equal(await promptsFolder.getAttribute("aria-expanded"), "false");
  assert.equal(await openaiFile.count(), 1);
  assert.equal(await reviewFile.count(), 0);
  await promptsFolder.click();
  assert.equal(await reviewFile.count(), 1);
  await reviewFile.click();
  assert.equal(
    await page
      .getByTestId("file-viewer-shell")
      .getByText("agents/prompts/review.md", { exact: true })
      .count(),
    1,
  );

  await page.getByRole("treeitem", { name: "SKILL.md", exact: true }).click();
  const fileViewer = page.getByTestId("file-viewer");
  assert.equal(await fileViewer.locator("code").count(), 104);
  assert.equal(
    await fileViewer
      .getByText("Complete file line 104", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("button", { name: /Show all \d+ lines/ }).count(),
    0,
  );
  const viewerScroll = await fileViewer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert.equal(
    viewerScroll.scrollHeight,
    viewerScroll.clientHeight,
    "Expected the file viewer to grow with its content instead of creating a nested scrollbar",
  );
  const visibleBundleBottom = page.getByTestId("bundle-visible-bottom");
  assert.equal(await visibleBundleBottom.count(), 1);
  assert.equal(
    await visibleBundleBottom.evaluate((element) => {
      const route = element.closest('[data-testid="route-scroll-viewport"]');
      if (!route) return false;
      const bottomRect = element.getBoundingClientRect();
      const routeRect = route.getBoundingClientRect();
      return (
        bottomRect.top >= routeRect.bottom - 16 &&
        bottomRect.bottom <= routeRect.bottom + 1
      );
    }),
    true,
  );

  const routeScrollViewport = page.getByTestId("route-scroll-viewport");
  const portalHeader = page.getByTestId("portal-header");
  await routeScrollViewport.evaluate((element) => element.scrollTo(0, 160));
  await page.waitForTimeout(50);
  assert.ok(
    Math.abs(
      await portalHeader.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    ) < 1,
    "Expected the portal header to remain pinned while the page scrolls",
  );
  await routeScrollViewport.evaluate((element) => element.scrollTo(0, 0));

  await routeScrollViewport.evaluate((element) =>
    element.scrollTo(0, element.scrollHeight),
  );
  await page.waitForTimeout(50);
  const closedBundleBottom = await page
    .getByTestId("files-layout")
    .evaluate((element) => {
      const route = element.closest('[data-testid="route-scroll-viewport"]');
      if (!route) return null;
      const bundleRect = element.getBoundingClientRect();
      const routeRect = route.getBoundingClientRect();
      return {
        borderBottomWidth: getComputedStyle(element).borderBottomWidth,
        bottomVisible: bundleRect.bottom <= routeRect.bottom + 1,
      };
    });
  assert.deepEqual(closedBundleBottom, {
    borderBottomWidth: "1px",
    bottomVisible: true,
  });
  assert.equal(
    await fileViewer
      .getByText("Complete file line 104", { exact: true })
      .evaluate((element) => {
        const route = element.closest('[data-testid="route-scroll-viewport"]');
        if (!route) return false;
        const lineRect = element.getBoundingClientRect();
        const routeRect = route.getBoundingClientRect();
        return lineRect.top >= routeRect.top && lineRect.bottom <= routeRect.bottom;
      }),
    true,
  );
  await routeScrollViewport.evaluate((element) => element.scrollTo(0, 0));

  const downloadAction = page.getByRole("button", {
    name: "Download",
    exact: true,
  });
  const uploadAction = page.getByRole("button", {
    name: "Upload",
    exact: true,
  });
  await downloadAction.waitFor();
  await uploadAction.waitFor();
  assert.equal(await downloadAction.getAttribute("data-variant"), "outline");
  assert.equal(await uploadAction.getAttribute("data-variant"), "default");
  assert.equal(
    await page
      .getByRole("button", { name: "Get for your tool", exact: true })
      .count(),
    0,
  );

  await downloadAction.click();
  await page.getByRole("menuitem", { name: "Codex", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Claude", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("menuitem", { name: "ZIP archive", exact: true }).count(),
    0,
  );
  await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
  const downloadDialog = page.getByRole("dialog");
  await downloadDialog.waitFor();
  await page.getByRole("heading", { name: "Download with Codex" }).waitFor();
  const downloadPrompt = await downloadDialog
    .getByTestId("assistant-transfer-prompt")
    .innerText();
  assert.match(downloadPrompt, /Surface Display Name/);
  assert.match(downloadPrompt, /surface-test/);
  assert.match(downloadPrompt, /\$skills-registry-guide/);
  assert.doesNotMatch(downloadPrompt, /\/skills-registry:guide/);
  assert.doesNotMatch(downloadPrompt, /Use the `skills-registry` MCP server/);
  await downloadDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await downloadDialog.waitFor({ state: "hidden" });

  await uploadAction.click();
  await page.getByRole("menuitem", { name: "Codex", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Claude", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("menuitem", { name: "ZIP archive", exact: true }).count(),
    0,
  );
  await page.getByRole("menuitem", { name: "Claude", exact: true }).click();
  const uploadDialog = page.getByRole("dialog");
  await uploadDialog.waitFor();
  await page.getByRole("heading", { name: "Upload with Claude" }).waitFor();
  const uploadPrompt = await uploadDialog
    .getByTestId("assistant-transfer-prompt")
    .innerText();
  assert.match(uploadPrompt, /Surface Display Name/);
  assert.match(uploadPrompt, /surface-test/);
  assert.match(uploadPrompt, /\/skills-registry:guide/);
  assert.doesNotMatch(uploadPrompt, /\$skills-registry-guide/);
  assert.doesNotMatch(uploadPrompt, /Use the `skills-registry` MCP server/);
  await uploadDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await uploadDialog.waitFor({ state: "hidden" });

  await page
    .getByRole("treeitem", { name: "openai.yaml", exact: true })
    .click();
  const viewer = page.getByTestId("file-viewer-shell");
  await viewer.waitFor();
  assert.equal(
    await viewer.getByText("agents/openai.yaml", { exact: true }).count(),
    1,
  );
  const colors = await viewer.evaluate((element) => {
    const styles = getComputedStyle(element);
    const toChannels = (color) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context is unavailable");
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    return {
      background: styles.backgroundColor,
      backgroundChannels: toChannels(styles.backgroundColor),
      foreground: styles.color,
      foregroundChannels: toChannels(styles.color),
    };
  });
  const backgroundLuminance = relativeLuminance(colors.backgroundChannels);
  const foregroundLuminance = relativeLuminance(colors.foregroundChannels);
  const contrast =
    (Math.max(backgroundLuminance, foregroundLuminance) + 0.05) /
    (Math.min(backgroundLuminance, foregroundLuminance) + 0.05);
  assert.ok(
    backgroundLuminance > 0.9,
    `Expected a light viewer background, received ${colors.background}`,
  );
  assert.ok(
    contrast >= 7,
    `Expected viewer contrast >= 7:1, received ${contrast.toFixed(2)}:1`,
  );

  await page.setViewportSize({ width: 390, height: 760 });
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
    false,
  );
  assert.ok(await downloadAction.isVisible());
  assert.ok(await uploadAction.isVisible());
  assert.ok(await viewer.isVisible());
} finally {
  await browser.close();
}
