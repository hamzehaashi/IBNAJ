import { expect, test, type Page } from "@playwright/test";

const money = (s: string | null) => Number((s ?? "").replace(/[$,()]/g, ""));

async function setInput(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill(value);
  await input.press("Enter");
}

test("search for DHR and land on the labeled demo workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").or(page.getByLabel("Search companies by ticker or name")).first().fill("DHR");
  await page.getByRole("option", { name: /DHR/ }).click();
  await expect(page).toHaveURL(/\/company\/DHR$/);
  await expect(page.getByRole("heading", { name: "Danaher Corporation" })).toBeVisible();
  await expect(page.getByText("Demonstration data.", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Price chart unavailable")).toBeVisible();
});

test("statements show five fiscal years and trace a figure to its XBRL source", async ({ page }) => {
  await page.goto("/company/DHR/statements");
  const headers = page.locator("thead th");
  await expect(headers).toHaveCount(6); // label + 5 periods
  await expect(headers.nth(5)).toContainText("FY2025");
  await page.locator("tr", { has: page.getByRole("rowheader", { name: "Revenue", exact: true }) }).locator("td button").last().click();
  const inspector = page.getByRole("complementary", { name: "Value inspector" });
  await expect(inspector).toContainText("RevenueFromContractWithCustomerExcludingAssessedTax");
  await expect(inspector).toContainText("10-K");
  await page.getByRole("radio", { name: "Quarterly" }).click();
  await expect(page.locator("thead th").last()).toContainText("Q2 FY2026");
});

test("changing revenue growth 5% → 8% propagates to forecast and DCF", async ({ page }) => {
  await page.goto("/company/DHR/dcf");
  await setInput(page, "driver-growth-input", "5");
  const perShare5 = money(await page.getByTestId("dcf-per-share").textContent());
  await setInput(page, "driver-growth-input", "8");
  await expect(page.getByTestId("dcf-per-share")).not.toHaveText(`$${perShare5.toFixed(2)}`);
  const perShare8 = money(await page.getByTestId("dcf-per-share").textContent());
  expect(perShare8).toBeGreaterThan(perShare5);

  await page.getByRole("link", { name: "Forecasting" }).click();
  await expect(page.getByTestId("input-revenueGrowth-0")).toHaveValue("8.0");
  await expect(page.getByTestId("input-revenueGrowth-4")).toHaveValue("8.0");
  await expect(page.getByTestId("forecast-per-share")).toHaveText(`$${perShare8.toFixed(2)}`);
  await page.getByTestId("cell-revenue-0").click();
  await expect(page.getByTestId("trace")).toContainText("growth 8.0%");

  // Year-specific edit in the grid updates the shared valuation.
  await setInput(page, "input-revenueGrowth-0", "12");
  await expect(page.getByTestId("forecast-per-share")).not.toHaveText(`$${perShare8.toFixed(2)}`);
});

test("DCF rejects terminal growth ≥ WACC and the sensitivity matrix responds to WACC", async ({ page }) => {
  await page.goto("/company/DHR/dcf");
  const center = page.getByTestId("sens-wacc").locator("tbody tr").nth(2).locator("td").nth(2);
  const before = await center.textContent();
  await setInput(page, "wacc-beta-input", "1.30");
  await expect(center).not.toHaveText(before ?? "");

  await setInput(page, "terminal-growth-input", "15");
  await expect(page.getByTestId("dcf-errors")).toContainText("must be below WACC");
  await expect(page.getByTestId("dcf-per-share")).toHaveText("—");
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByTestId("dcf-errors")).toHaveCount(0);
});

test("save a scenario, reload, and reopen the saved research", async ({ page }) => {
  await page.goto("/company/MSFT/scenarios");
  await setInput(page, "scn-bear-revenueGrowthDelta", "-5");
  const bearValue = await page.getByTestId("scenario-table").locator("tr", { hasText: "Intrinsic value" }).locator("td").nth(1).textContent();
  await page.getByRole("button", { name: /Save/ }).first().click();
  await page.reload();
  await expect(page.getByTestId("scn-bear-revenueGrowthDelta")).toHaveValue("-5.00");
  await expect(page.getByTestId("scenario-table").locator("tr", { hasText: "Intrinsic value" }).locator("td").nth(1)).toHaveText(bearValue ?? "");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /MSFT.*saved/ })).toBeVisible();
});

test("export the model to CSV", async ({ page }) => {
  await page.goto("/company/AAPL/dcf");
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Forecast & DCF model (CSV)" }).click()]);
  expect(download.suggestedFilename()).toBe("AAPL-dcf-model.csv");
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toContain("Enterprise value");
  expect(text).toContain("Value per share");
});

test("company with missing metrics shows unavailable values, not zeros", async ({ page }) => {
  await page.goto("/company/NOVA/statements");
  const rnd = page.locator("tr", { has: page.getByRole("rowheader", { name: "R&D", exact: true }) });
  await expect(rnd.locator("td").last()).toHaveText("—");
  await rnd.locator("td button").last().click();
  await expect(page.getByRole("complementary", { name: "Value inspector" })).toContainText("Not reported");
});

test("unknown tickers show a clear error", async ({ page }) => {
  await page.goto("/company/ZZZZ");
  await expect(page.getByRole("heading", { name: "Unable to load ZZZZ" })).toBeVisible();
  await expect(page.getByText(/Demo tickers/)).toBeVisible();
});
