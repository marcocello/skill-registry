import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const frontendDirectory = resolve(process.cwd());
const require = createRequire(resolve(frontendDirectory, "package.json"));
const { chromium } = require("playwright");
const baseUrl = process.env.PROOF_BASE_URL;

if (!baseUrl) throw new Error("PROOF_BASE_URL is required");

const skills = Array.from({ length: 80 }, (_, index) => ({
  slug: `motion-skill-${String(index + 1).padStart(2, "0")}`,
  name: `motion-skill-${String(index + 1).padStart(2, "0")}`,
  display_name: `Motion skill ${String(index + 1).padStart(2, "0")}`,
  description: "A catalogue row used to exercise real ReUI scrolling.",
  latest_version: 1,
  updated_at: "2026-08-31T10:00:00Z",
  content_hash: `motion-hash-${index + 1}`,
  git_export_status: "exported",
  file_count: 1,
  file_paths: ["SKILL.md"],
  owner: null,
}));

const detail = {
  slug: skills[0].slug,
  name: skills[0].name,
  display_name: skills[0].display_name,
  description: skills[0].description,
  latest_version: skills[0].latest_version,
  created_at: skills[0].updated_at,
  updated_at: skills[0].updated_at,
  owner: null,
  versions: [
    {
      slug: skills[0].slug,
      version: skills[0].latest_version,
      name: skills[0].name,
      description: skills[0].description,
      files: {
        "SKILL.md": [
          "# Motion proof skill",
          "",
          ...Array.from(
            { length: 120 },
            (_, index) => `Detail line ${index + 1} keeps the route vertically scrollable.`,
          ),
        ].join("\n"),
      },
      content_hash: skills[0].content_hash,
      created_at: skills[0].updated_at,
      author: null,
      git_export: { status: "exported", commit_sha: "abc123", error: null },
    },
  ],
};

async function installRoutes(page) {
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
  await page.route(`**/api/skills/${detail.slug}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail),
    }),
  );
}

async function waitForLibrary(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByTestId("registry-table-view").waitFor();
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await installRoutes(page);
  await waitForLibrary(page);

  await page.evaluate(() => {
    const documentWithTransitions = document;
    const original = documentWithTransitions.startViewTransition?.bind(document);
    window.__routeSnapshotCalls = 0;
    if (!original) return;
    documentWithTransitions.startViewTransition = (update) => {
      window.__routeSnapshotCalls += 1;
      return original(update);
    };
  });

  const viewport = page
    .locator('[data-slot="data-grid-table-viewport"]')
    .first();
  await viewport.hover();
  await page.mouse.wheel(0, 420);
  await page
    .locator('[data-testid="portal-header"][data-scrolled="true"]')
    .waitFor();
  await page
    .locator('[data-testid="portal-header"][data-scrolling="false"]')
    .waitFor({ timeout: 1000 });

  const connect = page.getByRole("button", { name: "Connect" });
  const connectBox = await connect.boundingBox();
  assert.ok(connectBox);
  await page.mouse.move(
    connectBox.x + connectBox.width / 2,
    connectBox.y + connectBox.height / 2,
  );
  await page.mouse.down();
  const pressedTransform = await connect.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  assert.notEqual(pressedTransform, "none");
  await page.mouse.up();

  await page.waitForURL(`${baseUrl}/connect`);
  await page
    .getByRole("heading", { name: "Connect your assistant" })
    .waitFor();
  assert.equal(
    await page.locator("html").getAttribute("data-navigation-direction"),
    "forward",
  );

  await page
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await page.waitForURL(`${baseUrl}/`);
  await page.getByTestId("registry-table-view").waitFor();
  assert.equal(
    await page.locator("html").getAttribute("data-navigation-direction"),
    "backward",
  );
  assert.equal(
    await page.getByTestId("portal-header").getAttribute("data-scrolled"),
    "false",
  );
  assert.equal(
    await page
      .getByTestId("scroll-progress")
      .evaluate((element) => getComputedStyle(element).transform),
    "matrix(0, 0, 0, 1, 0, 0)",
  );

  await page.getByText("Motion skill 01", { exact: true }).click();
  await page.waitForURL(`${baseUrl}/skills/${detail.slug}`);
  const detailHeading = page.getByRole("heading", {
    name: "Motion skill 01",
    exact: true,
  });
  await detailHeading.waitFor();
  const routeReveal = page.getByTestId("route-reveal");
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="route-reveal"]');
    return element?.getAnimations().every((animation) => animation.playState === "finished");
  });
  assert.equal(
    await routeReveal.evaluate((element) => getComputedStyle(element).clipPath),
    "none",
    "Expected the completed route reveal to release its clipping boundary",
  );
  await detailHeading.hover();
  await page.mouse.wheel(0, 720);
  await page.waitForTimeout(100);

  const scrollOwnership = await page.evaluate(() => {
    const main = document.querySelector("#main-content");
    if (!(main instanceof HTMLElement)) throw new Error("Missing main viewport");
    const nestedOwners = [...main.querySelectorAll("section, [data-route-scroll-owner]")]
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const overflowY = getComputedStyle(element).overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 2
        );
      })
      .length;
    return {
      mainOverflowY: getComputedStyle(main).overflowY,
      mainScrollTop: main.scrollTop,
      nestedOwners,
      routeSnapshotCalls: window.__routeSnapshotCalls,
    };
  });

  await detailHeading.hover();
  await page.mouse.wheel(0, 10000);
  await page.waitForTimeout(100);
  const finalLine = page.getByText(
    "Detail line 120 keeps the route vertically scrollable.",
    { exact: true },
  );
  assert.equal(
    await finalLine.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return hit === element || element.contains(hit);
    }),
    true,
    "Expected the final detail line to remain painted and hit-testable after scrolling",
  );

  await page.getByRole("button", { name: "Back to Library" }).click();
  await page.waitForURL(`${baseUrl}/`);
  await page.getByTestId("registry-table-view").waitFor();
  const postNavigationScrollTops = await page.evaluate(async () => {
    const main = document.querySelector("#main-content");
    if (!(main instanceof HTMLElement)) throw new Error("Missing main viewport");
    const samples = [main.scrollTop];
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(main.scrollTop);
    }
    return samples;
  });

  assert.deepEqual(scrollOwnership, {
    mainOverflowY: "auto",
    mainScrollTop: scrollOwnership.mainScrollTop,
    nestedOwners: 0,
    routeSnapshotCalls: 0,
  });
  assert.ok(scrollOwnership.mainScrollTop > 40);
  assert.ok(postNavigationScrollTops.every((value) => value <= 1));

  await viewport.hover();
  await page.mouse.wheel(0, 420);
  await page.locator('[data-testid="portal-header"][data-scrolled="true"]').waitFor();
  await page
    .locator('[data-testid="portal-header"][data-scrolling="true"]')
    .waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="scroll-progress"]');
    if (!element) return false;
    const transform = getComputedStyle(element).transform;
    return transform !== "none" && transform !== "matrix(0, 0, 0, 1, 0, 0)";
  });
  const progressTransform = await page
    .getByTestId("scroll-progress")
    .evaluate((element) => getComputedStyle(element).transform);
  assert.notEqual(progressTransform, "none");
  assert.notEqual(progressTransform, "matrix(0, 0, 0, 1, 0, 0)");
  await page
    .locator('[data-testid="portal-header"][data-scrolling="false"]')
    .waitFor({ timeout: 1000 });

  const hasDesktopOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  assert.equal(hasDesktopOverflow, false);

  await page.setViewportSize({ width: 390, height: 760 });
  const hasMobileOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  assert.equal(hasMobileOverflow, false);

  const reducedContext = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 390, height: 760 },
  });
  const reducedPage = await reducedContext.newPage();
  await installRoutes(reducedPage);
  await waitForLibrary(reducedPage);
  assert.equal(
    await reducedPage
      .getByTestId("route-reveal")
      .evaluate((element) => getComputedStyle(element).animationName),
    "none",
  );
  await reducedPage.getByRole("button", { name: "Connect" }).click();
  await reducedPage.waitForURL(`${baseUrl}/connect`);
  await reducedPage
    .getByRole("heading", { name: "Connect your assistant" })
    .waitFor();
  assert.equal(
    await reducedPage.locator("html").getAttribute("data-route-transitioning"),
    null,
  );
  await reducedContext.close();
  await context.close();
} finally {
  await browser.close();
}
