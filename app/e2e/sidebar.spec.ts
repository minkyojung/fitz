import { expect, test } from "@playwright/test"

// An off-canvas sidebar slides out of view but stays in the DOM, so assert on its state attribute.
const sidebar = (page: import("@playwright/test").Page) => page.locator('[data-slot="sidebar"][data-state]').first()

test("the chapter sidebar collapses and reopens, by button and by ⌘B, and remembers its state", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("button", { name: /1: Selma/ })).toBeVisible()
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
  await page.getByRole("button", { name: "Toggle chapters" }).click()
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed")
  await page.getByRole("button", { name: "Toggle chapters" }).click()
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
  await page.locator("body").click({ position: { x: 700, y: 400 } })
  await page.keyboard.press("Meta+b")
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed")
  await page.reload()
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed") // remembered via cookie
  await page.keyboard.press("Meta+b")
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
})
