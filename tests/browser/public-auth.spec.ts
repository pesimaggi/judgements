import { test, expect, type Page } from "@playwright/test";

const hit = { id: "doc_1", source: "haestirettur", court: "Hæstiréttur Íslands", title: "Uppsögn tímabundins ráðningarsamnings",
  caseName: null, caseNumber: "1/2026", date: "2026-01-01", year: 2026, language: "is", subjectTags: [],
  officialUrl: "https://example.test/judgment", pdfUrl: null, isSample: true, snippet: "Uppsögn ráðningarsamnings.",
  fullText: "Uppsögn tímabundins ráðningarsamnings. Þetta eru sýnigögn fyrir prófun.", summary: null };

async function fixtures(page: Page) {
  await page.route("**/api/search", async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { hits: [hit], total: 45, totalPages: 3, page: body.page ?? 1, pageSize: 15 } });
  });
  await page.route("**/api/search/acts?*", route => route.fulfill({ json: { acts: [], provisions: [] } }));
  await page.route("**/api/documents/doc_1", route => route.fulfill({ json: { document: hit, related: [] } }));
  await page.route("**/api/progress", route => route.fulfill({ json: { ingested: 1, total: 1, knownGaps: 0, groups: [] } }));
  await page.route("**/api/tags?*", route => route.fulfill({ json: { tags: [] } }));
  await page.route("**/api/acts?*", route => route.fulfill({ json: { acts: [], totals: { is: 0, eu: 0 }, total: 0, totalPages: 1 } }));
}

test("anonymous search, filters, reading and navigation remain public; login is contextual and cancellable", async ({ page, request }) => {
  await fixtures(page);
  await page.goto("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skrá inn", exact: true })).toBeVisible();
  const search = page.getByPlaceholder("Leitaðu að úrlausnum, lögum eða málsnúmeri");
  await search.fill("uppsögn tímabundins ráðningarsamnings");
  await page.getByRole("button", { name: "Leita", exact: true }).click();
  await expect(page.getByRole("heading", { name: hit.title })).toBeVisible();
  await page.getByLabel("Frá dagsetningu").fill("2020-01-01");
  await page.getByLabel("Raða eftir").selectOption("newest");
  await expect(page.getByLabel("Raða eftir")).toHaveValue("newest");
  const location = page.url();
  await page.getByRole("button", { name: "Vista", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Skrá inn til að vista" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Frá dagsetningu")).toHaveValue("2020-01-01");
  await expect(page.getByLabel("Raða eftir")).toHaveValue("newest");
  expect(page.url()).toBe(location);
  expect(await page.evaluate(() => sessionStorage.getItem("logbrunnur.auth.continuation.v1"))).toBeNull();
  await page.getByRole("link", { name: hit.title, exact: true }).click();
  await expect(page.getByText("Þetta eru sýnigögn fyrir prófun.", { exact: false })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Vista", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Loka", exact: true }).click();
  await expect(page).toHaveURL(/\/document\/doc_1\?q=/);
  await page.getByRole("link", { name: "Lög", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // These hit real route handlers, without a database or a session. Public
  // search validates its input normally, rather than redirecting to login.
  expect((await request.get("/api/sources")).status()).toBe(200);
  expect((await request.post("/api/search", { data: { query: "test", sources: [] } })).status()).toBe(400);
  expect((await request.put("/api/saved-documents", { data: { documentId: "doc_1", userId: "forged" } })).status()).toBe(503);
});

test("authentication return restores search filters, selection, draft and page after a full reload", async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("logbrunnur.auth.continuation.v1", JSON.stringify({ version: 1, id: "resume", createdAt: Date.now(),
      returnTo: "/?q=uppsogn", action: { type: "save-document", documentId: "doc_1" }, userId: null, scrollY: 0,
      views: { search: { selected: ["haestirettur"], queryInput: "óinnsend drög", dateFrom: "2020-01-01", dateTo: "2026-01-01",
        year: "", sort: "oldest", activeTags: [], legal: [], page: 3 } } }));
  });
  const calls: Record<string, unknown>[] = [];
  page.on("request", request => { if (request.url().endsWith("/api/search")) calls.push(request.postDataJSON()); });
  await page.goto("/?q=uppsogn");
  await expect(page.getByRole("heading", { name: hit.title })).toBeVisible();
  await expect(page.getByLabel("Frá dagsetningu")).toHaveValue("2020-01-01");
  await expect(page.getByLabel("Raða eftir")).toHaveValue("oldest");
  await expect(page.getByPlaceholder("Leitaðu að úrlausnum, lögum eða málsnúmeri")).toHaveValue("óinnsend drög");
  expect(calls.at(-1)).toMatchObject({ page: 3, sources: ["haestirettur"], sort: "oldest", dateFrom: "2020-01-01" });
  await expect(page.getByRole("dialog", { name: "Skrá inn til að vista" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("mobile header and login dialog fit the viewport and return keyboard focus", async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Skrá inn", exact: true });
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});
