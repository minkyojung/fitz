import { expect, test } from "@playwright/test"

// The sidebar folds to icons, not out of the DOM, so assert on its state attribute.
const sidebar = (page: import("@playwright/test").Page) => page.locator('[data-slot="sidebar"][data-state]').first()

test("the sidebar folds to icons and opens again, by button and by ⌘B, and remembers it; folded, the stages stay and the header's chapter menu changes the chapter", async ({ page }) => {
  await page.goto("/")
  const chapters = page.getByRole("navigation", { name: "Chapters" })
  const toggle = page.getByRole("button", { name: "Toggle sidebar", exact: true })  // the sidebar's rail is "Toggle Sidebar"
  await expect(chapters.getByRole("button", { name: /1: Selma/ })).toBeVisible()
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
  await toggle.click()
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed")
  await expect(chapters).toBeHidden()

  const translate = page.getByRole("button", { name: "Translate", exact: true })
  await translate.click()
  await expect(translate).toHaveAttribute("aria-current", "page")
  const crumb = page.locator("header [data-slot=dropdown-menu-trigger]")
  await crumb.click()
  await page.getByRole("menuitemradio", { name: /18: / }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)  // a chapter picked closes the menu
  await expect(crumb).toHaveText("18: Operation Success")
  await expect(page.locator("footer")).toContainText("18: Operation Success")

  await toggle.click()
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
  await expect(chapters.getByRole("button", { name: /18: / })).toHaveAttribute("data-active")
  await page.locator("body").click({ position: { x: 700, y: 400 } })
  await page.keyboard.press("Meta+b")
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed")
  await page.reload()
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed") // remembered via cookie
  await page.keyboard.press("Meta+b")
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
})

test("Export picks its own chapters: the sidebar's list and the header's chapter make way", async ({ page }) => {
  await page.goto("/")
  const chapters = page.getByRole("navigation", { name: "Chapters" })
  await expect(chapters).toBeVisible()
  await page.getByRole("button", { name: "Export", exact: true }).click()
  await expect(chapters).toHaveCount(0)
  await expect(page.locator("header [data-slot=dropdown-menu-trigger]")).toHaveCount(0)
  await expect(page.locator("header")).toContainText("Export")
  await page.getByRole("button", { name: "Review", exact: true }).click()
  await expect(chapters).toBeVisible()
})

test("Find lives in the sidebar: what it finds takes the chapters' place until Esc; folded, ⌘F or its button opens the sidebar first; a hit found in Export opens in Review", async ({ page }) => {
  await page.goto("/")
  const chapters = page.getByRole("navigation", { name: "Chapters" })
  const results = page.getByRole("region", { name: "Find results" })
  const find = page.getByRole("textbox", { name: "Find in book" })
  const toggle = page.getByRole("button", { name: "Toggle sidebar", exact: true })
  await expect(chapters).toBeVisible()
  await toggle.click()
  await expect(find).toBeHidden()
  await page.keyboard.press("Meta+f")
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
  await expect(find).toBeFocused()
  await find.fill("Zemurray")
  await expect(results.getByRole("status")).toContainText(/\d+ paragraphs, \d+ matches/)
  await expect(chapters).toHaveCount(0)
  await find.press("Escape")
  await expect(find).toHaveValue("")
  await expect(results).toHaveCount(0)
  await expect(chapters).toBeVisible()

  await toggle.click()
  await page.getByRole("button", { name: "Find in book" }).click()
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded")
  await expect(find).toBeFocused()

  await page.getByRole("button", { name: "Export", exact: true }).click()
  await find.fill("Zemurray")
  await results.getByRole("button", { name: /13: King Fish/ }).first().click()
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("footer")).toContainText("13: King Fish")
})

test("in Translate, a paragraph Find found opens at its pair: in another chapter, and in the same one", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const results = page.getByRole("region", { name: "Find results" })
  const selected = page.locator("[data-pair][data-selected]")
  await page.getByRole("textbox", { name: "Find in book" }).fill("Zemurray")
  await results.getByRole("button", { name: /13: King Fish/ }).nth(2).click()
  await expect(page.locator("footer")).toContainText("13: King Fish")
  await expect(selected).toContainText("Zemurray")
  const first = await selected.getAttribute("data-pair")
  await results.getByRole("button", { name: /13: King Fish/ }).nth(4).click()
  await expect(selected).not.toHaveAttribute("data-pair", first!)
  await expect(selected).toContainText("Zemurray")
  await expect(selected).toBeInViewport()
})

test("Claude's panel opens and closes from the header's button; closed, it stays closed after a reload; ⌘L opens it to its box", async ({ page }) => {
  await page.goto("/")
  const claude = page.getByRole("button", { name: "Claude", exact: true })
  const box = page.getByRole("textbox", { name: "Message to Claude" })
  await expect(claude).toHaveAttribute("aria-pressed", "true")
  await expect(box).toBeVisible()
  await claude.click()
  await expect(claude).toHaveAttribute("aria-pressed", "false")
  await expect(box).toBeHidden()
  await page.reload()
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible()
  await expect(claude).toHaveAttribute("aria-pressed", "false")
  await expect(box).toBeHidden()
  await page.keyboard.press("Meta+l")
  await expect(claude).toHaveAttribute("aria-pressed", "true")
  await expect(box).toBeVisible()
  await expect(box).toBeFocused()
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
  const show = async (view: "Review" | "Translate") => { await page.getByRole("button", { name: view, exact: true }).click(); await expect.poll(async () => (await widths()).length).toBe(view === "Review" ? 3 : 2) }

  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await show("Review")
  near(await widths(), review)
  await show("Translate")
  near(await widths(), translate)
})
