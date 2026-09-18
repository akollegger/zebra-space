// wink-lemmatizer ships no type declarations and no @types package exists for it (checked
// 2026-09-18). Minimal ambient module covering only what src/eval/grader.ts's comparisonKey
// actually calls (lemmatize.noun) — not a full re-statement of the package's API.
declare module "wink-lemmatizer" {
  interface Lemmatize {
    noun(word: string): string
    verb(word: string): string
    adjective(word: string): string
  }
  const lemmatize: Lemmatize
  export default lemmatize
}
