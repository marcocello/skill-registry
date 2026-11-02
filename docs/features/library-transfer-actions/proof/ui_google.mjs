import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "frontend/app/package.json"));
const { chromium } = require("playwright");
const JSZip = require("jszip");
const frontend = process.env.PROOF_FRONTEND_URL;
const provider = process.env.PROOF_PROVIDER_URL;
if (!frontend || !provider) throw new Error("Google proof browser URLs are required");

const openMenuItem = (page, label) =>
  page
    .locator('[data-slot="dropdown-menu-content"][data-state="open"]')
    .getByRole("menuitem", { name: label, exact: true });

async function bundle() {
  const zip = new JSZip();
  const folder = zip.folder("google-browser-transfer");
  folder.file(
    "SKILL.md",
    "---\nname: google-browser-transfer\ndescription: Authenticated browser proof.\n---\n\n# Google transfer\n",
  );
  folder.file(
    "agents/openai.yaml",
    'interface:\n  display_name: "Google browser transfer"\n',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const unauthenticated = await page.request.get(`${frontend}/api/skills/archive`);
  if (unauthenticated.status() !== 401) {
    throw new Error(`Unauthenticated Google archive leaked: ${unauthenticated.status()}`);
  }

  const authStart = `${frontend}/api/auth/google/start?return_to=${encodeURIComponent("/")}`;
  await page.goto(
    `${provider}/select/user?next=${encodeURIComponent(authStart)}`,
    { waitUntil: "networkidle" },
  );
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await openMenuItem(page, "ZIP archive").click();
  const uploader = page.getByTestId("zip-uploader");
  await uploader.getByLabel("Skill ZIP file").setInputFiles({
    name: "google-browser-transfer.zip",
    mimeType: "application/zip",
    buffer: await bundle(),
  });
  await uploader.getByRole("button", { name: "Upload skill" }).click({ clickCount: 2 });
  await uploader
    .getByText("google-browser-transfer submitted for review.", { exact: true })
    .waitFor();

  const skills = await page.request.get(`${frontend}/api/skills`);
  if (!skills.ok() || (await skills.json()).skills.length !== 0) {
    throw new Error("Pending Google browser upload appeared in the published catalogue");
  }
  console.log("Google browser ZIP upload: submitted-for-review=visible published=absent");
} finally {
  await browser.close();
}
