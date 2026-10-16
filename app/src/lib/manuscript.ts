/** Korean publishing counts translations in 200-character manuscript sheets (원고지 매수), spaces included. */

export const SHEET_CHARS = 200

export function charCount(text: string): number {
  return Array.from(text.replace(/\r?\n/g, "")).length
}

/** Sheets to one decimal, e.g. 1,480.5. */
export function sheets(text: string): number {
  return Math.round((charCount(text) / SHEET_CHARS) * 10) / 10
}

export function formatSheets(n: number): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sheets`
}
