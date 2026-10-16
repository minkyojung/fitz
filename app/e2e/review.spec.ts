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
