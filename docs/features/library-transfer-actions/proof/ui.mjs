import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const frontendDirectory = resolve(process.cwd(), "frontend/app");
const require = createRequire(resolve(frontendDirectory, "package.json"));
const { chromium } = require("playwright");
const JSZip = require("jszip");
const baseUrl = process.env.PROOF_BASE_URL;
if (!baseUrl) throw new Error("PROOF_BASE_URL is required");
const openMenuItem = (page, label) =>
  page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').getByRole("menuitem", { name: label, exact: true });
const encoded = (bytes) => ({ encoding: "base64", data: Buffer.from(bytes).toString("base64") });

function representativeMcpFiles() {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  const arbitrary = Buffer.from([0, 255, 16, 66, 73, 78]);
  const files = {
    "SKILL.md": "---\nname: mcp-complete-assets\n---\n\n# Complete MCP assets\n",
    "assets/page.html": "<!doctype html><title>Asset proof</title>",
    "assets/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "assets/one.png": encoded(png),
    "assets/two.png": encoded(Buffer.concat([png, Buffer.from([2])])),
    "assets/three.png": encoded(Buffer.concat([png, Buffer.from([3])])),
    "assets/model.bin": encoded(arbitrary),
    "reference/large.html": `<main>${"asset-content".repeat(260_000)}</main>`,
  };
  for (let index = 0; index < 145; index += 1) {
    files[`reference/part-${String(index).padStart(3, "0")}.md`] = `# Part ${index}\n`;
  }
  return { files, png, arbitrary };
}

async function bundle(slug, { id, description = "Browser transfer proof." } = {}) {
  const zip = new JSZip();
  const folder = zip.folder(slug);
  folder.file("SKILL.md", `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n`);
  folder.file("agents/openai.yaml", `interface:\n  display_name: "${slug}"\n`);
  if (id) folder.file(".skill_id", id);
  return zip.generateAsync({ type: "nodebuffer" });
}

const artifacts = await mkdtemp(join(tmpdir(), "registry-transfer-proof-"));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();

  const toolsResponse = await page.request.post(`${baseUrl}/mcp`, {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  const tools = (await toolsResponse.json()).result.tools;
  for (const name of ["skills.create", "skills.update"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    const variants = tool?.inputSchema?.properties?.files?.additionalProperties?.oneOf;
    if (!variants?.some((item) => item.type === "object")) throw new Error(`${name} remains text-only`);
  }

  const representative = representativeMcpFiles();
  const mcpResponse = await page.request.post(`${baseUrl}/mcp`, {
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "skills.create",
        arguments: {
          slug: "mcp-complete-assets",
          name: "MCP complete assets",
          description: "Production Nginx large binary proof.",
          files: representative.files,
        },
      },
    },
  });
  if (mcpResponse.status() !== 200) throw new Error(`Large MCP request failed with ${mcpResponse.status()}`);
  const mcpResult = (await mcpResponse.json()).result;
  if (mcpResult.isError) throw new Error(`Large MCP tool call failed: ${JSON.stringify(mcpResult.structuredContent)}`);
  const mcpDetail = await (await page.request.get(`${baseUrl}/api/skills/mcp-complete-assets`)).json();
  const stored = mcpDetail.versions[0].files;
  if (Object.keys(stored).length !== Object.keys(representative.files).length) throw new Error("Large MCP bundle was truncated");
  if (!Buffer.from(stored["assets/one.png"].data, "base64").equals(representative.png)) throw new Error("PNG Registry read-back changed bytes");
  if (!Buffer.from(stored["assets/model.bin"].data, "base64").equals(representative.arbitrary)) throw new Error("Arbitrary binary Registry read-back changed bytes");

  await page.getByRole("button", { name: "Download", exact: true }).click();
  await openMenuItem(page, "Claude").click();
  const dialog = page.getByTestId("assistant-transfer-dialog");
  await dialog.getByRole("heading", { name: "Download with Claude" }).waitFor();
  const guide = dialog.getByRole("link", { name: "Connect Claude" });
  if ((await guide.getAttribute("target")) !== "_blank") throw new Error("Claude guide does not open in a new tab");
  if (!(await guide.getAttribute("href"))?.endsWith("/connect?client=claude")) throw new Error("Claude guide does not preserve client selection");
  if (!(await dialog.getByTestId("assistant-transfer-prompt").textContent())?.startsWith("/skills-registry:guide")) throw new Error("Claude prompt uses the wrong companion command");
  await dialog.getByRole("button", { name: "Copy prompt" }).click();
  if (!(await page.evaluate(() => navigator.clipboard.readText())).startsWith("/skills-registry:guide")) throw new Error("Claude prompt was not copied");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await openMenuItem(page, "ZIP archive").click();
  const uploader = page.getByTestId("zip-uploader");
  await uploader.getByText("One bundle · up to 1,000 files / 20 MB contents", { exact: true }).waitFor();
  await uploader.getByLabel("Skill ZIP file").setInputFiles({
    name: "proof-transfer.zip",
    mimeType: "application/zip",
    buffer: await bundle("proof-transfer"),
  });
  await uploader.getByRole("button", { name: "Upload skill" }).click({ clickCount: 2 });
  await uploader.getByText("proof-transfer published successfully.").waitFor();

  const created = await page.request.get(`${baseUrl}/api/skills/proof-transfer`);
  if (!created.ok() || (await created.json()).latest_version !== 1) throw new Error("ZIP create was not durably readable or duplicate submission created another version");
  await uploader.getByRole("button", { name: "Close" }).first().click();
  await uploader.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Download", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await openMenuItem(page, "ZIP archive").click();
  const download = await downloadPromise;
  if (download.suggestedFilename() !== "skills-registry.zip") throw new Error("Catalogue ZIP filename is wrong");
  const downloadPath = join(artifacts, download.suggestedFilename());
  await download.saveAs(downloadPath);
  const catalogue = await JSZip.loadAsync(await readFile(downloadPath));
  const markdown = await catalogue.file("proof-transfer/SKILL.md")?.async("string");
  const identifier = await catalogue.file("proof-transfer/.skill_id")?.async("string");
  if (!markdown?.includes("# proof-transfer")) throw new Error("Catalogue ZIP contains empty or missing skill content");
  if (identifier !== "registry:proof-transfer:v1") throw new Error("Catalogue ZIP contains the wrong .skill_id");
  const downloadedPng = await catalogue.file("mcp-complete-assets/assets/one.png")?.async("nodebuffer");
  const downloadedBinary = await catalogue.file("mcp-complete-assets/assets/model.bin")?.async("nodebuffer");
  if (!downloadedPng?.equals(representative.png)) throw new Error("Catalogue PNG changed bytes");
  if (!downloadedBinary?.equals(representative.arbitrary)) throw new Error("Catalogue arbitrary binary changed bytes");

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await openMenuItem(page, "ZIP archive").click();
  await uploader.getByLabel("Skill ZIP file").setInputFiles({
    name: "proof-transfer-v2.zip",
    mimeType: "application/zip",
    buffer: await bundle("proof-transfer", { id: identifier, description: "Version two." }),
  });
  await uploader.getByRole("button", { name: "Upload skill" }).click();
  await uploader.getByText("proof-transfer published successfully.").waitFor();
  const updated = await page.request.get(`${baseUrl}/api/skills/proof-transfer`);
  const updatedBody = await updated.json();
  if (updatedBody.latest_version !== 2) throw new Error("Identified ZIP update did not create version two");
  if (".skill_id" in updatedBody.versions.at(-1).files) throw new Error("Transport .skill_id was published");
  await uploader.getByRole("button", { name: "Close" }).first().click();
  await uploader.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await openMenuItem(page, "ZIP archive").click();
  await uploader.getByLabel("Skill ZIP file").setInputFiles({
    name: "proof-transfer-stale.zip",
    mimeType: "application/zip",
    buffer: await bundle("proof-transfer", { id: identifier }),
  });
  await uploader.getByRole("button", { name: "Upload skill" }).click();
  await uploader.getByText(/download version 2 before updating/i).waitFor();
  if ((await (await page.request.get(`${baseUrl}/api/skills/proof-transfer`)).json()).latest_version !== 2) throw new Error("Stale ZIP mutated the skill");
} finally {
  await browser.close();
  await rm(artifacts, { recursive: true, force: true });
}
