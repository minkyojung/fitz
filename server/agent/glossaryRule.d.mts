// Types for glossaryRule.mjs, which the editor's page shares with the server.

export interface GlossaryForms { term: string; translation: string; aliases?: string | null }

export function termPattern(term: string, flags?: string): RegExp
export function acceptedForms(entry: GlossaryForms): string[]
export function missingForms<E extends GlossaryForms>(entries: E[], target: string): E[]
