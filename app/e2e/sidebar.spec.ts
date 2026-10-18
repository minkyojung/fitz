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

test("the panel widths you drag to are kept across reloads: one layout with the scan, one without", async ({ page }) => {
  const widths = () => page.locator("[data-slot=resizable-panel]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
  const drag = async (handle: number, dx: number) => {
    const box = (await page.locator("[data-slot=resizable-handle]").nth(handle).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 200)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 200, { steps: 8 })
    await page.mouse.up()
  }
  const near = (a: number[], b: number[]) => expect(a.length === b.length && a.every((w, i) => Math.abs(w - b[i]) <= 2), `${a} vs ${b}`).toBe(true)
  const show = async (view: "Review" | "Translate") => { await page.getByRole("tab", { name: view }).click(); await expect.poll(async () => (await widths()).length).toBe(view === "Review" ? 3 : 2) }

  await page.goto("/")
  await page.getByRole("button", { name: /18: / }).click()
  await show("Review")
  const fresh = await widths()
  await drag(1, -120)
  const review = await widths()
  expect(review[2]).toBeGreaterThan(fresh[2] + 60)
  await show("Translate")  // the scan is folded away: the other layout
  await drag(0, -100)
  const translate = await widths()
  await show("Review")
  near(await widths(), review)

  await page.reload()
  await page.getByRole("button", { name: /18: / }).click()
  await show("Review")
  near(await widths(), review)
  await show("Translate")
  near(await widths(), translate)
})
