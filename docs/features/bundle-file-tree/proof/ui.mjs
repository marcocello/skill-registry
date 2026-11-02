import { createRequire } from "node:module";
import { resolve } from "node:path";

const frontendDirectory = resolve(process.cwd());
const require = createRequire(resolve(frontendDirectory, "package.json"));
const { chromium } = require("playwright");
const baseUrl = process.env.PROOF_BASE_URL;

if (!baseUrl) throw new Error("PROOF_BASE_URL is required");

const summary = {
  slug: "nested-bundle",
  name: "Nested bundle",
  description: "A deterministic bundle for folder-tree proof.",
  latest_version: 1,
  updated_at: "2026-08-31T10:00:00Z",
  content_hash: "hash-nested-bundle",
  git_export_status: "exported",
  file_count: 4,
  file_paths: [
    "agents/openai.yaml",
    "SKILL.md",
    "references/guide.md",
    "references/examples/demo.md",
  ],
  owner: null,
};

const detail = {
  slug: summary.slug,
  name: summary.name,
  description: summary.description,
  latest_version: 1,
  created_at: "2026-08-31T10:00:00Z",
  updated_at: "2026-08-31T10:00:00Z",
  owner: null,
  versions: [
    {
      slug: summary.slug,
      version: 1,
      name: summary.name,
      description: summary.description,
      files: {
        "agents/openai.yaml": "interface:\n  display_name: Nested bundle\n",
        "SKILL.md": "# Nested bundle\n",
        "references/guide.md": "# Guide\n",
        "references/examples/demo.md": "# Demo\n",
      },
      content_hash: summary.content_hash,
      created_at: summary.created_at,
      author: null,
      git_export: { status: "exported", commit_sha: "abc123", error: null },
    },
  ],
};

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
  await page.route("**/api/skills/nested-bundle", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail),
    }),
  );

  await page.goto(`${baseUrl}/skills/nested-bundle`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Nested bundle", exact: true }).waitFor();

  const tree = page.getByRole("tree", { name: "Bundle files" });
  await tree.waitFor();
  const rootFile = tree.getByRole("treeitem", { name: "SKILL.md", exact: true });
  const agentsFolder = tree.getByRole("treeitem", { name: "agents", exact: true });
  const agentFile = tree.getByRole("treeitem", { name: "openai.yaml", exact: true });
  const referencesFolder = tree.getByRole("treeitem", { name: "references", exact: true });
  const examplesFolder = tree.getByRole("treeitem", { name: "examples", exact: true });
  const demoFile = tree.getByRole("treeitem", { name: "demo.md", exact: true });

  await rootFile.waitFor();
  await agentFile.waitFor();
  await demoFile.waitFor();
  if ((await rootFile.getAttribute("aria-selected")) !== "true")
    throw new Error("Root SKILL.md is not selected when the skill opens");
  const visualFindings = [];
  const rootClasses = (await rootFile.getAttribute("class")) ?? "";
  const rootClassTokens = rootClasses.split(/\s+/);
  if (!["bg-accent", "text-accent-foreground", "font-medium"].every((name) => rootClasses.includes(name)))
    visualFindings.push("the selected root file lacks the quiet ReUI accent treatment");
  if (rootClassTokens.some((name) => name.startsWith("shadow")))
    visualFindings.push("the selected root file still has visual elevation");
  const folderClasses = (await referencesFolder.getAttribute("class")) ?? "";
  if (!folderClasses.includes("text-muted-foreground"))
    visualFindings.push("folder labels are not visually muted");
  if ((await agentFile.evaluate((element) => element.style.paddingLeft)) !== "20px")
    visualFindings.push("level-two files do not use the compact 20-pixel inset");
  if ((await demoFile.evaluate((element) => element.style.paddingLeft)) !== "32px")
    visualFindings.push("level-three files do not use the compact 32-pixel inset");
  if (visualFindings.length)
    throw new Error(`Bundle-tree visual contract failed: ${visualFindings.join("; ")}`);
  await page
    .getByTestId("file-viewer-shell")
    .getByText("SKILL.md", { exact: true })
    .waitFor();
  await page.getByText("# Nested bundle", { exact: true }).waitFor();
  if ((await agentsFolder.getAttribute("aria-expanded")) !== null)
    throw new Error("The agents folder still exposes disclosure state");
  if ((await agentsFolder.evaluate((element) => element.tagName)) === "BUTTON")
    throw new Error("The agents folder is still rendered as an interactive button");
  if ((await tree.locator("svg.lucide-chevron-right").count()) !== 0)
    throw new Error("The permanently expanded tree still renders disclosure chevrons");
  if ((await examplesFolder.getAttribute("aria-level")) !== "2")
    throw new Error("The nested examples folder does not expose its tree depth");
  if ((await demoFile.getAttribute("aria-level")) !== "3")
    throw new Error("The deeply nested file does not expose its tree depth");

  await agentsFolder.click();
  if (!(await agentFile.isVisible()))
    throw new Error("Clicking a folder label hid its nested file");
  await agentFile.click();
  if ((await agentFile.getAttribute("aria-selected")) !== "true")
    throw new Error("The selected nested file is not exposed as selected");
  const agentClasses = (await agentFile.getAttribute("class")) ?? "";
  const agentClassTokens = agentClasses.split(/\s+/);
  if (!["bg-accent", "text-accent-foreground", "font-medium"].every((name) => agentClasses.includes(name)))
    throw new Error("The selected treatment did not transfer to the nested file");
  if (agentClassTokens.some((name) => name.startsWith("shadow")))
    throw new Error("The nested selected file gained visual elevation");
  if (((await rootFile.getAttribute("class")) ?? "").includes("bg-accent"))
    throw new Error("The previous file retained the selected treatment");
  await page.getByText("agents/openai.yaml", { exact: true }).waitFor();
  await page.getByText("display_name: Nested bundle", { exact: false }).waitFor();

  await referencesFolder.click();
  if (!(await examplesFolder.isVisible()) || !(await demoFile.isVisible()))
    throw new Error("Clicking a folder label hid its nested subtree");
} finally {
  await browser.close();
}
