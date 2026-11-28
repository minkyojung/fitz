// The book on the screen, compared with the development copy counted by plain SQL.
import { expect, test } from "./server.ts"

const count = (sql: import("node:sqlite").DatabaseSync, query: string, ...params: number[]) => Number(Object.values(sql.prepare(query).get(...params) ?? {})[0])

test("the book's chapters are listed in order with their counts", async ({ page, door, sql }) => {
  await page.goto(door)
  const book = sql.prepare("SELECT title, author FROM book ORDER BY id LIMIT 1").get()!
  const sidebar = page.locator("[data-slot=sidebar]")
  await expect(sidebar.getByText(String(book.title), { exact: true })).toBeVisible()
  await expect(sidebar.getByText(String(book.author), { exact: true })).toBeVisible()
  await expect(page).toHaveTitle(String(book.title))

  const chapters = sql.prepare(
    `SELECT c.id, c.title, count(s.id) n, coalesce(sum(s.target_doc IS NOT NULL), 0) t
     FROM chapter c LEFT JOIN segment s ON s.chapter_id = c.id GROUP BY c.id ORDER BY c.idx`,
  ).all()
  const items = page.locator("[data-chapter-id]")
  await expect(items).toHaveCount(chapters.length)
  expect(chapters.length).toBe(count(sql, "SELECT count(*) FROM chapter"))
  for (const [i, c] of chapters.entries()) {
    const item = items.nth(i)
    await expect(item).toHaveAttribute("data-chapter-id", String(c.id))
    await expect(item.getByText(String(c.title), { exact: true })).toBeVisible()
    await expect(item.locator("[data-slot=sidebar-menu-badge]")).toHaveText(`${c.t}/${c.n}`)
  }
})

test("the token leaves the address and the page cannot read it", async ({ page, door }) => {
  await page.goto(door)
  await expect(page.locator("[data-chapter-id]").first()).toBeVisible()
  expect(new URL(page.url()).search).toBe("")
  expect(await page.evaluate(() => document.cookie)).toBe("")
})

test("every chapter shows its paragraphs, source beside translation", async ({ page, door, sql }) => {
  test.setTimeout(120_000)
  await page.goto(door)
  const chapters = sql.prepare("SELECT id, title FROM chapter ORDER BY idx").all()
  const rows = page.locator("[data-segment-id]")
  let paragraphs = 0
  let translated = 0
  for (const [i, c] of chapters.entries()) {
    const id = Number(c.id)
    // the first chapter is the one open at the start
    if (i > 0) await page.locator(`[data-chapter-id="${id}"] button`).click()
    await expect(page.locator(`[data-chapter-id="${id}"] button`)).toHaveAttribute("aria-current", "true")
    await expect(page.locator("[data-slot=breadcrumb-page]")).toHaveText(String(c.title))
    const segments = sql.prepare("SELECT id, source_text, target_text FROM segment WHERE chapter_id = ? ORDER BY idx").all(id)
    await expect(rows).toHaveCount(segments.length)
    expect(await rows.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-segment-id"))))).toEqual(segments.map((s) => s.id))
    const shown = await rows.evaluateAll((els) => els.map((el) => ({
      source: el.querySelector("[data-side=source]")?.textContent ?? null,
      target: el.querySelector("[data-side=target]")?.getAttribute("data-translated") === "true" ? el.querySelector("[data-side=target]")?.textContent ?? null : null,
    })))
    // paragraphs of one text are joined by a newline in the database and drawn as separate blocks
    const flat = (text: unknown) => (text === null ? null : String(text).replaceAll("\n", ""))
    expect(shown).toEqual(segments.map((s) => ({ source: flat(s.source_text), target: flat(s.target_text) })))
    paragraphs += shown.length
    translated += shown.filter((s) => s.target !== null).length
  }
  expect(paragraphs).toBe(count(sql, "SELECT count(*) FROM segment"))
  expect(translated).toBe(count(sql, "SELECT count(*) FROM segment WHERE target_doc IS NOT NULL"))
  test.info().annotations.push({ type: "shown", description: `chapters ${chapters.length}, paragraphs ${paragraphs}, translated ${translated}` })
})

test("Korean is on the screen, and a paragraph not yet translated says so", async ({ page, door, sql }) => {
  await page.goto(door)
  const chapterWhere = (having: string) => sql.prepare(`SELECT chapter_id id FROM segment GROUP BY chapter_id HAVING ${having} ORDER BY chapter_id LIMIT 1`).get()
  const translated = chapterWhere("sum(target_doc IS NOT NULL) > 0")
  const untranslated = chapterWhere("sum(target_doc IS NULL) > 0")
  expect(translated, "the copy has a chapter with a translation").toBeTruthy()
  expect(untranslated, "the copy has a chapter with a paragraph not translated").toBeTruthy()

  await page.locator(`[data-chapter-id="${translated!.id}"] button`).click()
  const done = page.locator("[data-side=target][data-translated=true]").first()
  await expect(done).toBeVisible()
  await expect(done).toHaveAttribute("lang", "ko")
  expect(await done.textContent()).toMatch(/[가-힣]/)
  await expect(page.locator("[data-side=source]").first()).toHaveAttribute("lang", "en")

  await page.locator(`[data-chapter-id="${untranslated!.id}"] button`).click()
  const open = page.locator("[data-side=target][data-translated=false]").first()
  await expect(open).toBeVisible()
  await expect(open).toHaveText("Not translated")
})

test("a server of another protocol is said plainly, and no book is shown", async ({ page, door, complaints }) => {
  await page.route("**/api/hello", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "the page speaks protocol 1 and the server 2" }) }))
  await page.goto(door)
  await expect(page.getByRole("alert")).toContainText("the page speaks protocol 1 and the server 2")
  await expect(page.locator("[data-chapter-id]")).toHaveCount(0)
  complaints.length = 0 // the refused request is the point of this test
})

test("a chapter that fails to load can be tried again", async ({ page, door, complaints }) => {
  let failing = true
  await page.route("**/api/listSegments", (route) => (failing ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "the disk is on fire" }) }) : route.continue()))
  await page.goto(door)
  await expect(page.locator("[data-chapter-id]").first()).toBeVisible()
  const alert = page.getByRole("alert")
  await expect(alert).toContainText("the disk is on fire")
  await expect(page.locator("[data-segment-id]")).toHaveCount(0)
  failing = false
  await alert.getByRole("button", { name: "Try again" }).click()
  await expect(page.locator("[data-segment-id]").first()).toBeVisible()
  await expect(alert).toHaveCount(0)
  complaints.length = 0 // the failed request is the point of this test
})

test("a wrong answer from the server is an error, not a wrong screen", async ({ page, door, complaints }) => {
  await page.route("**/api/listChapters", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "one", title: 3 }]) }))
  await page.goto(door)
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.locator("[data-chapter-id]")).toHaveCount(0)
  complaints.length = 0
})
