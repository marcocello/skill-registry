import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { chromium } = require("playwright");
const frontend = process.env.PROOF_FRONTEND_URL;
const mode = process.env.PROOF_MODE;

if (!frontend || !mode) throw new Error("Proof browser environment is required");

async function signIn(context, page, persona) {
  const start = await context.request.get(
    `${frontend}/api/auth/google/start?return_to=/`,
    { maxRedirects: 0 },
  );
  assert.equal(start.status(), 302);
  const location = new URL(start.headers().location);
  const state = location.searchParams.get("state");
  assert.ok(state, "Google state is missing");
  await page.goto(
    `${frontend}/api/auth/google/callback?code=proof-${persona}&state=${encodeURIComponent(state)}`,
    { waitUntil: "networkidle" },
  );
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
}

async function confirmDeletion(page, { title, description, actionName }) {
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("heading", { name: title, exact: true })
    .waitFor();
  await dialog.getByText(description, { exact: true }).waitFor();
  await dialog.getByRole("button", { name: actionName, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

async function selectRow(page, name) {
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("checkbox", { name: "Select row", exact: true }).click();
}

async function openMode(browser) {
  const page = await browser.newPage();
  await page.goto(frontend, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.getByText("List Delete One", { exact: true }).waitFor();
  const survivingRow = page.getByRole("row").filter({ hasText: "List Delete Two" });
  await survivingRow.waitFor();
  assert.equal(await page.getByTestId("selection-delete-bar").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: /^Delete .*selected/ }).count(),
    0,
  );
  for (const name of ["List Delete One", "List Delete Two", "Detail Delete"]) {
    const row = page.getByRole("row").filter({ hasText: name });
    assert.equal(await row.getByRole("button", { name: /^Delete / }).count(), 0);
  }

  const missing = await page.context().request.delete(
    `${frontend}/api/skills/never-present`,
    { headers: { Origin: frontend } },
  );
  assert.equal(missing.status(), 404);
  const healthAfterMissing = await page.evaluate(async () =>
    fetch("/api/health").then((response) => response.json()),
  );
  assert.equal(healthAfterMissing.pending_git_exports, 0);

  const wrongOrigin = await page.context().request.delete(
    `${frontend}/api/skills/list-delete-one`,
    { headers: { Origin: "https://wrong-origin.example" } },
  );
  assert.equal(wrongOrigin.status(), 403);
  await page.getByText("List Delete One", { exact: true }).waitFor();

  await selectRow(page, "List Delete One");
  await selectRow(page, "List Delete Two");
  const selectionBar = page.getByTestId("selection-delete-bar");
  await selectionBar.waitFor();
  await selectionBar.getByText("2 skills selected", { exact: true }).waitFor();
  await selectionBar.getByRole("button", { name: "Clear selection", exact: true }).waitFor();
  const barGeometry = await selectionBar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      bottomGap: window.innerHeight - rect.bottom,
    };
  });
  assert.equal(barGeometry.position, "fixed");
  assert.ok(
    barGeometry.bottomGap >= 8 && barGeometry.bottomGap <= 32,
    `selection bar is not anchored to the viewport bottom: ${barGeometry.bottomGap}`,
  );
  for (const name of ["List Delete One", "List Delete Two"]) {
    const row = page.getByRole("row").filter({ hasText: name });
    assert.equal(await row.getByRole("button", { name: /^Delete / }).count(), 0);
  }
  const listDelete = selectionBar.getByRole("button", {
    name: "Delete 2 selected skills",
    exact: true,
  });
  await listDelete.click();
  const cancelled = page.getByRole("alertdialog");
  await cancelled
    .getByRole("heading", { name: "Delete 2 selected skills?", exact: true })
    .waitFor();
  await cancelled
    .getByText(
      "This will permanently remove these 2 skills and all of their versions. This action cannot be undone.",
      { exact: true },
    )
    .waitFor();
  await cancelled.getByRole("button", { name: "Cancel", exact: true }).click();
  await cancelled.waitFor({ state: "hidden" });
  await selectionBar.waitFor();
  assert.equal(await page.getByText("List Delete One", { exact: true }).count(), 1);
  assert.equal(await page.getByText("List Delete Two", { exact: true }).count(), 1);

  let injectedFailure = false;
  await page.route("**/api/skills/list-delete-two", async (route) => {
    if (route.request().method() === "DELETE" && !injectedFailure) {
      injectedFailure = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Injected second deletion failure." }),
      });
      return;
    }
    await route.continue();
  });
  await listDelete.click();
  await confirmDeletion(
    page,
    {
      title: "Delete 2 selected skills?",
      description:
        "This will permanently remove these 2 skills and all of their versions. This action cannot be undone.",
      actionName: "Delete selected",
    },
  );
  await page
    .getByText("List Delete One", { exact: true })
    .waitFor({ state: "hidden" });
  await survivingRow.waitFor();
  await selectionBar.getByText("1 skill selected", { exact: true }).waitFor();
  const retryDelete = selectionBar.getByRole("button", {
    name: "Delete 1 selected skill",
    exact: true,
  });
  await retryDelete.click();
  await confirmDeletion(page, {
    title: "Delete List Delete Two?",
    description:
      "This will permanently remove this skill and all of its versions. This action cannot be undone.",
    actionName: "Delete selected",
  });
  await survivingRow.waitFor({ state: "hidden" });
  await selectionBar.waitFor({ state: "hidden" });

  await page.getByText("Detail Delete", { exact: true }).click();
  await page.waitForURL("**/skills/detail-delete");
  await page
    .getByRole("heading", { name: "Detail Delete", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Delete Detail Delete", exact: true })
    .click();
  await confirmDeletion(page, {
    title: "Delete Detail Delete?",
    description:
      "This will permanently remove this skill and all of its versions. This action cannot be undone.",
    actionName: "Delete skill",
  });
  await page.waitForURL(`${frontend}/`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("No skills have been published yet.", { exact: true }).waitFor();

  for (const slug of ["list-delete-one", "list-delete-two", "detail-delete"]) {
    const response = await page.evaluate(async (selectedSlug) => {
      const result = await fetch(`/api/skills/${selectedSlug}`);
      return result.status;
    }, slug);
    assert.equal(response, 404);
  }
}

async function googleMode(browser) {
  const userContext = await browser.newContext();
  const user = await userContext.newPage();
  await signIn(userContext, user, "user");
  await user.getByText("Protected Skill", { exact: true }).waitFor();
  await selectRow(user, "Protected Skill");
  assert.equal(await user.getByTestId("selection-delete-bar").count(), 0);
  await user.getByText("Protected Skill", { exact: true }).click();
  await user.waitForURL("**/skills/protected-skill");
  await user
    .getByRole("heading", { name: "Protected Skill", exact: true })
    .waitFor();
  assert.equal(await user.getByRole("button", { name: /^Delete / }).count(), 0);
  const denied = await user.evaluate(async () => {
    const session = await fetch("/api/auth/session").then((response) => response.json());
    const response = await fetch("/api/skills/protected-skill", {
      method: "DELETE",
      headers: {
        Origin: window.location.origin,
        "X-CSRF-Token": session.csrf_token,
      },
    });
    return response.status;
  });
  assert.equal(denied, 403);
  const proposalSubmission = await user.evaluate(async () => {
    const session = await fetch("/api/auth/session").then((response) => response.json());
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: window.location.origin,
        "X-CSRF-Token": session.csrf_token,
      },
      body: JSON.stringify({
        action: "update",
        slug: "admin-list-delete",
        base_version: 2,
        name: "Admin List Delete Proposed",
        description: "Proposal must survive deletion.",
        files: {
          "SKILL.md": "---\nname: admin-list-delete\n---\n\n# Proposed update\n",
        },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(proposalSubmission.status, 201);
  const proposal = proposalSubmission.body;

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(adminContext, admin, "admin");
  await admin.getByText("Admin List Delete", { exact: true }).waitFor();
  assert.equal(await admin.getByTestId("selection-delete-bar").count(), 0);
  const adminSession = await admin.evaluate(async () =>
    fetch("/api/auth/session").then((response) => response.json()),
  );
  const missingCsrf = await adminContext.request.delete(
    `${frontend}/api/skills/admin-list-delete`,
    { headers: { Origin: frontend } },
  );
  assert.equal(missingCsrf.status(), 403);
  const invalidCsrf = await adminContext.request.delete(
    `${frontend}/api/skills/admin-list-delete`,
    { headers: { Origin: frontend, "X-CSRF-Token": "invalid" } },
  );
  assert.equal(invalidCsrf.status(), 403);
  const wrongOrigin = await adminContext.request.delete(
    `${frontend}/api/skills/admin-list-delete`,
    {
      headers: {
        Origin: "https://wrong-origin.example",
        "X-CSRF-Token": adminSession.csrf_token,
      },
    },
  );
  assert.equal(wrongOrigin.status(), 403);
  await selectRow(admin, "Admin List Delete");
  const adminSelectionBar = admin.getByTestId("selection-delete-bar");
  await adminSelectionBar.waitFor();
  await adminSelectionBar
    .getByRole("button", { name: "Delete 1 selected skill", exact: true })
    .click();
  await confirmDeletion(
    admin,
    {
      title: "Delete Admin List Delete?",
      description:
        "This will permanently remove this skill and all of its versions. This action cannot be undone.",
      actionName: "Delete selected",
    },
  );
  await adminSelectionBar.waitFor({ state: "hidden" });

  await admin.getByText("Admin Detail Delete", { exact: true }).click();
  await admin.waitForURL("**/skills/admin-detail-delete");
  await admin
    .getByRole("button", { name: "Delete Admin Detail Delete", exact: true })
    .click();
  await confirmDeletion(admin, {
    title: "Delete Admin Detail Delete?",
    description:
      "This will permanently remove this skill and all of its versions. This action cannot be undone.",
    actionName: "Delete skill",
  });
  await admin.waitForURL(`${frontend}/`);
  await admin.reload({ waitUntil: "networkidle" });
  assert.equal(await admin.getByText("Admin List Delete", { exact: true }).count(), 0);
  assert.equal(await admin.getByText("Admin Detail Delete", { exact: true }).count(), 0);
  await admin.getByText("Protected Skill", { exact: true }).waitFor();

  const missing = await admin.evaluate(async () => {
    const response = await fetch("/api/skills/admin-list-delete");
    return response.status;
  });
  assert.equal(missing, 404);
  const proposalReadBack = await admin.evaluate(async ({ proposalId }) => {
    const session = await fetch("/api/auth/session").then((response) => response.json());
    const listing = await fetch("/api/proposals").then((response) => response.json());
    const approval = await fetch(`/api/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: window.location.origin,
        "X-CSRF-Token": session.csrf_token,
      },
      body: JSON.stringify({ revision: 1, reason: "Should now be stale." }),
    });
    return {
      approvalStatus: approval.status,
      proposal: listing.proposals.find((item) => item.id === proposalId),
    };
  }, { proposalId: proposal.id });
  assert.equal(proposalReadBack.approvalStatus, 409);
  assert.equal(proposalReadBack.proposal.status, "pending");
  await user.reload({ waitUntil: "networkidle" });
  await user.getByText("Protected Skill", { exact: true }).waitFor();
  assert.equal(await user.getByText("Admin List Delete", { exact: true }).count(), 0);

  await userContext.close();
  await adminContext.close();
}

const browser = await chromium.launch({ headless: true });
try {
  if (mode === "open") await openMode(browser);
  else await googleMode(browser);
} finally {
  await browser.close();
}
