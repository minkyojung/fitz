import { expect, test } from "@playwright/test"

test("export: pick one chapter, see the summary and warnings, download a .docx", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("tab", { name: "Export" }).click()
  await page.getByRole("button", { name: "None" }).click()
  await expect(page.locator("[data-export-summary]")).toContainText("Pick at least one chapter")
  await page.getByRole("checkbox", { name: /17: Israel is Real/ }).click()
  const summary = page.locator("[data-export-summary]")
  await expect(summary).toContainText("Chapters1")
  await expect(summary).toContainText(/\d+ untranslated/)
  await expect(summary).toContainText(/The_Fish_That_Ate_the_Whale_18_\d{4}-\d{2}-\d{2}\.docx/)
  await expect(page.locator("[data-export-warning=untranslated]")).toContainText("17: Israel is Real · paragraph 1")

  await page.getByRole("button", { name: "B · All footnotes, one series" }).click()
  await expect(page.getByText(/translator's notes end with —옮긴이/)).toBeVisible()

  const waiting = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download .docx" }).click()
  const download = await waiting
  expect(download.suggestedFilename()).toMatch(/^The_Fish_That_Ate_the_Whale_18_\d{4}-\d{2}-\d{2}\.docx$/)
  const path = await download.path()
  const { statSync } = await import("node:fs")
  expect(statSync(path!).size).toBeGreaterThan(5000)
})
