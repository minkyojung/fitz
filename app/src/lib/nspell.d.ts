declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): NSpell
    remove(word: string): NSpell
  }
  function nspell(aff: string, dic: string): NSpell
  export default nspell
}
declare module "*.aff?raw" { const s: string; export default s }
declare module "*.dic?raw" { const s: string; export default s }
