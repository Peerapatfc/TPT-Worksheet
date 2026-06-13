# Refactor Notes — Restructure & Modernize

Branch: `refactor/restructure-and-modernize`
Date: 2026-06-14

This document records every change made during the investigation + refactor, why,
and the migration steps required to deploy it. **No external integrations changed** —
env var names, the CI entry point (`node scripts/pipeline.js`), the Supabase schema,
the Drive folder layout, and all TPT output files are byte-for-byte compatible.

---

## 1. Architecture: flat `scripts/` → layered `src/`

**Before:** 17 files in one `scripts/` directory; the orchestrator, library code,
constants, and one-off helpers all mixed together.

**After:**

```
scripts/   entry points only (pipeline.js, test-plan.js, create-issue.js, + 2 local-only)
src/
  run-pipeline.js   orchestrator
  config/           constants.js (MODELS, PAGE_RANGES, RETRY, A4, IMAGE_SIZE), tpt-taxonomy.js
  llm/              clients.js (lazy openai()/groq()), with-retry.js, tool-call.js
  lib/              slugify, source-pages, markdown, logger, package-type, concurrency
  steps/            the 11 pipeline steps + schema/worksheet-plan.js
test/               vitest unit suite
```

`scripts/pipeline.js`, `scripts/test-plan.js`, and `scripts/create-issue.js` remain as
thin entry points so CI and `npm` scripts are unchanged.

## 2. Bugs fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | **Telegram caption rendered literal backslashes.** `notify-telegram.js` sent `parse_mode: 'Markdown'` (legacy) but escaped MarkdownV2 characters and hand-wrote `\(`, `\.`, `\$`. | Switched to `parse_mode: 'MarkdownV2'` and rewrote `buildCaption` to escape all dynamic values + literal specials via `escapeMarkdownV2` (`src/lib/markdown.js`). Unit-tested. |
| 2 | **Marketing-slide failure aborted the whole run.** `Promise.all([generatePages, generateMarketingSlides])` discarded already-generated worksheet pages if a (non-essential) slide threw. | The marketing-slides promise is now `.catch()`-guarded in `src/run-pipeline.js`: it logs a warning, returns `[]`, and the run continues. Only essential steps abort the pipeline. |

## 3. Documentation drift corrected (code was right, docs were wrong)

- `generate-content` uses **Groq `llama-3.3-70b-versatile`**, not gpt-4o — fixed in CLAUDE.md, readme.md.
- `validate-page` / `reconcile-content` use **gpt-4o-mini**, not gpt-4o — fixed.
- Page-tier ranges now consistent everywhere: **free 7–10, small 15–20, large 21–MAX**
  (CLAUDE.md, readme.md, and `.env.example` previously gave three different wrong sets).
- `GROQ_API_KEY` documented in CLAUDE.md + readme.md (it was a hard dependency, undocumented).
- Removed the duplicate `OPENAI_API_KEY` row from CLAUDE.md.
- `create-issue.js` checklist referenced non-existent `ANTHROPIC_API_KEY` and
  `GOOGLE_SERVICE_ACCOUNT_KEY`; replaced with the real secrets (OPENAI/GROQ/OAuth/Supabase/Telegram).

## 4. De-duplication (DRY)

- `withRetry` was byte-identical in 5 files → single `src/llm/with-retry.js`.
- `new OpenAI()` in 5 files → lazy singletons `openai()` / `groq()` in `src/llm/clients.js`.
- `slugify` (two subtly different copies) → one `src/lib/slugify.js` with optional max length.
- The "resolve answer-key source pages → questions" logic (duplicated in generate-pages
  and validate-page, each re-handling the legacy `sourcePageNum`) → `src/lib/source-pages.js`.
- The forced-tool-call + JSON-parse pattern → `src/llm/tool-call.js` (`callTool`).
- `brainstorm.js` shrank from a 430-line monolith: the two large taxonomy arrays moved to
  `src/config/tpt-taxonomy.js` and the JSON tool schema to `src/steps/schema/worksheet-plan.js`.

## 5. Performance

- **convert-pdf:** grayscale was computed twice per page (per-page PDF + combined PDF).
  Now computed **once per page** and reused — halves `sharp` grayscale work. Output is identical.
- **generate-pages:** the sequential page loop (the #1 wall-clock bottleneck) is now
  `mapWithConcurrency` and tunable via `PAGE_CONCURRENCY`. **Default is `1` (sequential)** so
  the live pipeline's cost and rate-limit profile are unchanged until you opt in. Raise to 2–3
  to cut wall-clock; higher values risk OpenAI image rate limits. Output order is preserved.

## 6. Dependencies (major bumps — verified)

| Package | Was | Now | Notes |
|---------|-----|-----|-------|
| `openai` | 4.104 | 6.42 | 2 majors. Used surfaces (`chat.completions.create`, `images.generate`, Groq via `baseURL`) verified present. `max_tokens` still accepted for gpt-4o/4o-mini. |
| `googleapis` | 144 | 173 | `OAuth2`, `drive.files.create`, `getAccessToken` verified present. |
| `sharp` | 0.33.5 | 0.35.1 | grayscale/composite/png/metadata/resize/raw all stable. |
| `dotenv` | 16.6 | 17.4 | `import 'dotenv/config'` unchanged. |
| `@supabase/supabase-js` | 2.105 | 2.108 | patch. |

`npm audit` → **0 vulnerabilities** (the transitive `ws` advisory was fixed; vitest pinned to
v4 to avoid the esbuild dev-server advisory in vitest 3's tree).

> Not changed: `max_tokens` → `max_completion_tokens`. Both are accepted by the API for the
> models used; renaming is an untestable behavior change here, so it's left as a future task.

## 7. Tests (new)

`vitest` suite under `test/` — **53 tests, 9 files, 0 API calls/keys required:**
`slugify`, `resolvePackageType`/`getPackageType`, `escapeMarkdownV2`, `buildCaption`,
`resolveSourceQuestions`, `buildPrompt`, `validate` + `largestEvenN`, `validateSchema`,
`mapWithConcurrency`. Run with `npm test`.

## 8. CI

- New `.github/workflows/test.yml` — runs `npm ci && npm test` on every push and PR.
- `daily-worksheets.yml` — added an `npm test` gate **before** the pipeline run (fail fast,
  before spending API budget), bumped Node 20 → 22 (matches local + current LTS; `engines`
  stays `>=20`), and passes through the new `PAGE_CONCURRENCY` variable.

## 9. Backward compatibility

Unchanged and verified: env var names, `node scripts/pipeline.js` entry point, `npm start` /
`npm run test:plan` / `npm run create-issue`, Supabase table schema, Drive folder/file naming,
TPT output files (`*-complete-set.pdf`, `*-preview.pdf`, `metadata.json`, `tpt-listing.txt`),
and the Telegram cover-photo notification (now renders correctly).

---

## Migration steps (deploy)

1. **Merge the branch.** No code changes needed by consumers.
2. **GitHub Actions Node:** workflows now request Node 22. No action required (hosted runners
   provide it); `actions/setup-node` handles it.
3. **(Optional) `PAGE_CONCURRENCY`:** add a GitHub **Variable** `PAGE_CONCURRENCY=2` (or `3`)
   to speed up runs. Leave unset to keep current sequential behavior.
4. **No secret changes.** `GROQ_API_KEY` was already required and configured; this only
   documents it.
5. **First run:** trigger `workflow_dispatch` once and confirm the Telegram caption renders
   (the MarkdownV2 fix), then let the cron resume.

## Verification evidence

- `npm test` → `Test Files 9 passed (9) | Tests 53 passed (53)`.
- Full ESM import of `src/run-pipeline.js` and every module → resolves with no errors.
- `node --check` on all entry scripts → OK.
- `npm audit` → `found 0 vulnerabilities`.
- SDK surface smoke test on the new majors → all used methods present.

**Not verified (requires live keys + real external writes + image-gen spend):** the end-to-end
image → Drive → Telegram → Supabase path. Run `npm run test:plan` (live text models, no writes)
and one `workflow_dispatch` to validate the full path before relying on the daily cron.
