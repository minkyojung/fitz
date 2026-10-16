import { expect, test } from "@playwright/test"

test("review edits persist across reload", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /1: Selma/ }).click()

  // second row = first body paragraph of chapter 1 (row 0 is the heading)
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.nth(1)).toContainText("Sam Zemurray saw his first banana")
  const row = rows.nth(1)
  await row.click()

  // verify
  await row.getByRole("checkbox", { name: "확인됨" }).click()
  await expect(row.getByRole("checkbox", { name: "확인됨" })).toBeChecked()
  await expect(page.getByRole("button", { name: /1: Selma/ })).toContainText("1/15")

  // kind
  await row.getByRole("button", { name: "인용" }).click()

  // text edit
  await row.getByRole("button", { name: "텍스트 수정" }).click()
  const box = row.getByRole("textbox")
  await box.fill("Edited paragraph text.")
  await box.press("Meta+Enter")
  await expect(row).toContainText("Edited paragraph text.")

  await page.reload()
  await page.getByRole("button", { name: /1: Selma/ }).click()
  const again = page.locator("[data-slot=scroll-area] .group").nth(1)
  await expect(again).toContainText("Edited paragraph text.")
  await expect(again.getByRole("checkbox", { name: "확인됨" })).toBeChecked()
  await again.click()
  await expect(again.getByRole("button", { name: "인용" })).toHaveAttribute("aria-pressed", "true")
})

test("page navigation follows the selected segment", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /1: Selma/ }).click()
  await expect(page.getByText("p. 11", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "다음 페이지" }).click()
  await expect(page.getByText("p. 12", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("img", { name: "원서 12쪽" })).toBeVisible()
})

test("split at caret and merge back restore the paragraph", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /2: Ripes/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/Ripes/)
  const before = await rows.count()
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  await row.click()

  await row.getByRole("button", { name: "텍스트 수정" }).click()
  const box = row.getByRole("textbox")
  const cut = original.indexOf(" ", 40) + 1 // after a space, well inside the paragraph
  await box.evaluate((el: HTMLTextAreaElement, pos: number) => el.setSelectionRange(pos, pos), cut)
  await row.getByRole("button", { name: "커서 위치에서 분할" }).click()

  await expect(rows).toHaveCount(before + 1)
  await expect(rows.nth(1).locator("p")).toHaveText(original.slice(0, cut).trim())
  await expect(rows.nth(2).locator("p")).toHaveText(original.slice(cut).trim())

  await rows.nth(1).click()
  await rows.nth(1).getByRole("button", { name: "다음 단락과 병합" }).click()
  await expect(rows).toHaveCount(before)
  await expect(rows.nth(1).locator("p")).toHaveText(original)
})

test("an unanchored note can be linked to a segment", async ({ page }) => {
  await page.goto("/")
  const panel = page.locator("[data-slot=resizable-panel]").last()
  await expect(panel.getByText("미연결 미주")).toBeVisible()
  const before = await panel.getByRole("button", { name: "연결" }).count()
  expect(before).toBeGreaterThan(0)
  await expect(page.locator("footer")).toContainText(`미연결 미주 ${before}`)

  await panel.getByRole("button", { name: "연결" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder(/단락/).fill("Zemurray")
  await dialog.getByRole("option").first().click()

  await expect(panel.getByRole("button", { name: "연결" })).toHaveCount(before - 1)
  await expect(page.locator("footer")).toContainText(`미연결 미주 ${before - 1}`)
  await page.reload()
  await expect(page.locator("footer")).toContainText(`미연결 미주 ${before - 1}`)
})
