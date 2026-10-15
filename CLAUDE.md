# CLAUDE.md — TPT Worksheet Generator

## Project Overview

Daily GitHub Actions pipeline that generates printable worksheet SETs for Teachers Pay Teachers (TPT). One set per day, auto-uploaded to Google Drive, notified via Telegram.

## Stack

| Layer | Tool |
|-------|------|
| Brainstorm (topic + plan) | gpt-4o (`openai`) |
| Content generation + Q&A recheck | openai/gpt-oss-120b (Groq, OpenAI-compatible) |
| Page QA (vision) + answer reconcile | gpt-4o-mini (`openai`) |
| Image generation | gpt-image-2 (`openai`) |
| Image processing | sharp (grayscale post-process) |
| PDF conversion | pdf-lib (pure Node, no system deps) |
| Cloud storage | Google Drive API v3 (`googleapis`) |
| Topic history | Supabase (`@supabase/supabase-js`) |
| Notifications | Telegram Bot API (native fetch) |
| Unit tests | vitest (pure-logic suite under `test/`) |
| CI/CD | GitHub Actions cron `0 0 * * *` (+ `test.yml` on push/PR) |

> Model identifiers are centralized in `src/config/constants.js` (`MODELS`).

## Key Architecture Decisions

- **OAuth2 not service account** — personal Google Drive accounts have no service account storage quota. Uses `GOOGLE_OAUTH_REFRESH_TOKEN` instead.
- **Layered module layout** — library code lives under `src/` (`config/`, `llm/`, `lib/`, `steps/`); `scripts/` holds only thin entry points (`pipeline.js`, `test-plan.js`, `create-issue.js`) plus local-only helpers. CI still invokes `node scripts/pipeline.js`, so entry-point paths are stable.
- **Two LLM providers** — text brainstorm + vision QA run on OpenAI; Q&A content generation + recheck run on **Groq** (`openai/gpt-oss-120b`; `llama-3.3-70b-versatile` was retired 2026-08-16) via the OpenAI-compatible endpoint. Clients are lazy singletons in `src/llm/clients.js` (`openai()`, `groq()`).
- **Forced tool call for structured JSON** — `tool_choice: {type:'function', function:{name:'...'}}` reliably forces structured output. The single-shot pattern is wrapped in `src/llm/tool-call.js` (`callTool`); brainstorm keeps a bespoke multi-turn validation-retry loop. Parse with `JSON.parse(toolCall.function.arguments)`.
- **Shared retry** — `src/llm/with-retry.js` (`withRetry`) retries 429/500/503 with exponential backoff. One implementation, used by every API call site.
- **gpt-image-2** — DALL-E 3 was retired March 2026. gpt-image-2 does not accept `response_format` param; always returns b64_json.
- **Color is the product** — sets are sold in color: `{slug}-complete-set-color.pdf` is the TPT product file. A grayscale `{slug}-complete-set.pdf` (`sharp().grayscale()` per page) is still built and kept in the assets folder as a printer-friendly option.
- **Combined PDFs only** — TPT needs one uploadable file per listing. Per-page PNG/PDF files are no longer uploaded (nothing used them; ~1.5 min of uploads per run). The assets folder holds the color + grayscale sets, the preview, the 3 marketing slides, `tpt-listing.txt` and `metadata.json`.
- **gpt-image-2 quality** — worksheet/activity pages use `low` (~$0.006/page vs ~$0.042 at `medium`; text and chart values were as crisp/exact in side-by-side tests). The cover and the marketing cover stay `medium`.
- **gpt-image-2 size** — use `1024x1536` (portrait, closer to A4). `1024x1024` leaves large white margins after aspect-ratio fit to A4.
- **Supabase for history** — GitHub Actions filesystem resets every run; local file won't persist. Drive file also works but Supabase is cleaner.
- **Brainstorm plans, Groq writes the questions** — brainstorm (gpt-4o) plans topic, pages, imagePrompts, listing and standards but no Q&A (it used to write every question, which Groq then regenerated). `generateContent` is therefore essential: if Groq returns nothing after 3 attempts the run fails.
- **Dynamic page count** — brainstorm (gpt-4o) decides how many worksheet/activity pages within the tier range. Answer-key pages are rebuilt in code (`normalizeAnswerKeys`): ceil(N/2) keys at the end, each covering 2 consecutive content pages, pages renumbered 1..n — the model's own answer-key count is ignored, so a miscount never costs a brainstorm retry.
- **Standards claims are enforced in code** — `sanitizeStandardsClaims` strips CCSS/Common Core/NGSS mentions from the TPT title, description and keywords unless `plan.educationStandards` names that framework with codes (e.g. a Health set never says "Aligned to Common Core").
- **No grid/path activities** — crosswords, word searches, mazes and dot-to-dot are banned: the image model cannot draw a consistent grid or path (a crossword shipped with answers in its clues and wrong letter counts). Brainstorm's prompt forbids them and `validate()` rejects any page whose filename/imagePrompt names one; the content prompt converts such requests into matching / fill-in / labeling.
- **No answers in imageSpec** — the image prints the spec verbatim on the student page. The content prompt forbids answers in the spec, and `stripAnswerLeaks` removes "= <answer>" after equations and "– <word answer>" after clues (numeric data like "Monday – 4 acorns" is kept).
- **One verifiable answer per question** — content generation forbids opinion/guessing questions and ambiguous negatives; the Groq recheck may return `correctedQuestion` to rewrite such a question (corrections are applied even if it also says `pass: true`). Knowledge questions (e.g. matching a spider to its habitat) are explicitly allowed — an over-broad rule once rewrote a whole matching page into "Is X at the top of the column?" questions — and a rewrite must never become a question about page layout.
- **Picture and questions must agree** — the image is drawn from a page's `imageSpec` and prints it verbatim, so a question may only quote what the spec prints. The recheck may return `imageSpecCorrections` alongside a rewritten question; `applyRecheck` (generate-content.js) reverts any rewrite whose quotation (`quotesMissingFromSpec`, `src/lib/spec-consistency.js`) is missing from the final spec, and falls back to the original spec if a corrected one drops a quote a question still cites. Without this a quote-matching page shipped with the old quotes in the picture and new ones in the questions/answer key. Reverts are logged as `spec_mismatch` review notes.
- **Listing numbers and claims are fixed in code** — `syncListingCounts` rewrites "N-page"/"N worksheets" in the description from the real plan, and `sanitizeStandardsClaims` also drops vague "aligned to … standards" sentences/keywords that name no framework. Subject areas are leaf nodes only (`tpt-taxonomy.js` has no category headers; a plan with only a header is rejected and retried).
- **Marketing cover follows the set's cover page** — `buildMarketingCoverPrompt` includes the cover page's `imagePrompt`, and brainstorm must name the specific people/things to draw on the cover (a "Historical Figures" cover once drew Lincoln and Anne Frank for a set about five other people). The "What's Included" slide shrinks its font to fit the longest row (`fitFontSize`).
- **Filenames have no extension** — brainstorm strips `.png`/`.pdf`; upload-drive appends `.png` / `.pdf`.
- **Template-rendered text pages** — answer keys and the "What's Included" / "Benefits" marketing slides are pure text, so they are rendered locally from SVG templates (`src/lib/svg-templates.js` → sharp PNG) instead of gpt-image-2. No image or vision-QA cost, and answer keys print the exact Q&A data. Answer keys are rendered after all AI pages finish so they reflect reconciled answers. Only the cover, worksheet and activity pages (plus the marketing cover) use gpt-image-2.
- **Review summary** — steps record things a human should check via `addReviewNote` (`src/lib/review-notes.js`): pages that failed QA after all retries, fallbacks (Q&A generation/recheck failed, marketing slides failed), questions rewritten and answers corrected by the recheck, answers stripped from image specs. After upload the pipeline logs a `review` line and sends a plain-text Telegram message (with the run's API cost) after the cover post — to `TELEGRAM_REVIEW_CHAT_ID` if set.
- **Cost logging** — every API call records its `usage` into `src/lib/cost-tracker.js` under a step bucket (`brainstorm`, `content`, `content_recheck`, `cover_image`, `page_image`, `validate_page`, `reconcile_page`, `marketing_image`). The pipeline appends one `{"step":"cost",...}` line to `logs/pipeline-run.json` at the end of every run (even failed ones); `npm run test:plan` prints it too. USD is estimated from `PRICING` in `constants.js` — keep that table current. `page_image` calls minus image pages = QA retries.
- **Chart pages are drawn by code** — gpt-image-2 drew the wrong number of icons on picture-graph pages while the answer key used the data, and neither the validator nor reconcile can count (gpt-4o-mini echoes the spec). Groq now returns a structured `chart` (`pictograph` | `bar` | `table`, categories with whole-number values, limits in `CHART_LIMITS`) instead of an imageSpec for those pages; `chartPageSvg` renders the whole page (chart, questions, answer lines) in the shared template frame. Chart pages skip image generation, QA and reconcile, cost nothing, and their answer key always matches. An invalid chart fails `validateSchema` (retry); `isChartPage` routes only valid ones. Icons are simple SVG shapes for now.
- **Reconcile stays a separate step** — folding it into the validator was tested and rejected: asked to report each imageSpec value as drawn, gpt-4o-mini copied the spec values instead of reading the image (3 tampered specs passed 9/9).
- **QA validation with retry** — after each image generation, gpt-4o-mini vision checks the page. The model only transcribes each listed question as printed and reports page flags (garbled text, no answer space, answers shown, missing header, questions on a cover); `judgeReport` decides pass/fail in code, and `compareQuestion` checks that every listed number appears in the transcription. Only real defects trigger a paid regeneration — letting gpt-4o-mini judge severity or "number differs" itself caused false failures (it fact-checked "Spiders have six legs") and missed changed numbers. It does NOT reliably notice answers printed on a student page, so that is prevented upstream (see below). The image is downscaled to a 640px short side (`QA_SHORT_SIDE`) first: ~26k instead of ~37k tokens; 512px was too small to read text. Retries up to 2× on fail, then logs warning and continues (fail-open: a flaky validator never blocks the run).
- **Bounded-concurrency page generation** — `generatePages` honors `PAGE_CONCURRENCY` (default 1 = sequential, preserving the original cost/rate profile). Raise to 2–3 to cut wall-clock; higher values risk OpenAI image rate limits.
- **Non-essential steps degrade gracefully** — marketing slides are generated in parallel with pages but a failure there is caught and the run continues without them; the Telegram notification runs last and a failure there is logged as `warn`. Only essential steps abort the pipeline. `generate_content` logs `warn` with `pagesWithContent` when Groq content generation fell back to the brainstorm plan.
- **3-tier package system** — `free` (7–10 pages, $0), `small` (15–20 pages, $2–5), `large` (21–`MAX_PAGES_PER_SET` pages, $5–15). Ranges are defined in `src/config/constants.js` (`PAGE_RANGES`). Day-of-week routing: `FREE_WORKSHEET_DAY` → free, `LARGE_PACKAGE_DAY` → large, all others → small. Free wins ties. All tracked in Supabase history.

## Project Layout

```
scripts/                  entry points only
  pipeline.js             CI entry — imports src/run-pipeline.js
  test-plan.js            dry-run entry (brainstorm + content)
  create-issue.js         opens a GitHub Issue on pipeline failure
  eval.js                 live regression eval of the validator + Groq recheck (eval/cases.json)
  get-refresh-token.js    OAuth2 refresh-token helper (run locally; prints token)
  test-drive-upload.js    Drive auth smoke test (local only, gitignored)
src/
  run-pipeline.js         orchestrator — runs every step in order
  config/
    constants.js          MODELS, PAGE_RANGES, RETRY, A4, IMAGE_SIZE, PRICING
    tpt-taxonomy.js        TPT_SUBJECT_AREAS, TPT_TAGS (allowed strings)
  llm/
    clients.js            lazy openai() / groq() singletons
    with-retry.js         withRetry (429/500/503 backoff)
    tool-call.js          callTool (forced single tool call + JSON parse)
  lib/
    slugify.js  source-pages.js  markdown.js  logger.js
    package-type.js       tier routing (pure + env wrapper)
    concurrency.js        mapWithConcurrency (ordered, bounded)
    svg-templates.js      answer-key page + text marketing slides (SVG → PNG); shared page frame
    chart-page.js         code-drawn chart pages: pictograph / bar / table + questions
    spec-consistency.js   quotesMissingFromSpec — quotes in questions must appear in the imageSpec
    cost-tracker.js       per-step token usage + USD estimate (logged at run end)
  steps/
    brainstorm.js         gpt-4o: topic + full page plan (exports validate)
    generate-content.js   Groq: Q&A per page (exports validateSchema)
    generate-pages.js     gpt-image-2 + validate + reconcile; answer keys via template (exports buildPrompt)
    validate-page.js      gpt-4o-mini vision QA
    reconcile-content.js  gpt-4o-mini vision: fix answers vs image
    generate-marketing-slides.js  gpt-image-2 cover + 2 template slides + logo composite
    convert-pdf.js        pdf-lib: per-page + combined + preview PDFs
    upload-drive.js       Drive: folder + PNG/PDF/metadata/listing
    topic-history.js      Supabase read/write
    notify-telegram.js    Telegram cover photo + MarkdownV2 caption
    schema/worksheet-plan.js  brainstorm tool-call JSON schema
test/                     vitest unit tests for the pure-logic surface
eval/                     live eval cases (cases.json) + fixture images from real runs; run by scripts/eval.js
```

## Environment Variables

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | brainstorm, generate-pages, validate-page, reconcile-content, generate-marketing-slides |
| `GROQ_API_KEY` | generate-content (content + Q&A recheck) |
| `GOOGLE_DRIVE_FOLDER_ID` | upload-drive (full assets folder) |
| `GOOGLE_DRIVE_TPT_FOLDER_ID` | upload-drive (TPT folder — color set + preview PDFs in a per-run subfolder, optional) |
| `GOOGLE_OAUTH_CLIENT_ID` | upload-drive, get-refresh-token |
| `GOOGLE_OAUTH_CLIENT_SECRET` | upload-drive, get-refresh-token |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | upload-drive |
| `SUPABASE_URL` | topic-history |
| `SUPABASE_SERVICE_ROLE_KEY` | topic-history |
| `TELEGRAM_BOT_TOKEN` | notify-telegram |
| `TELEGRAM_CHANNEL_ID` | notify-telegram |
| `TELEGRAM_REVIEW_CHAT_ID` | notify-telegram — optional chat for the review summary (defaults to `TELEGRAM_CHANNEL_ID`) |
| `GRADE_LEVEL` | run-pipeline (empty = AI picks K–6) |
| `MAX_PAGES_PER_SET` | run-pipeline — max pages for large package (default: `30`) |
| `FREE_WORKSHEET_DAY` | run-pipeline (0=Sun … 6=Sat, default: `0`) — triggers free tier |
| `LARGE_PACKAGE_DAY` | run-pipeline (0=Sun … 6=Sat, omit = never) — triggers large tier |
| `PAGE_CONCURRENCY` | generate-pages — pages generated in parallel (default: `1`) |
| `PACKAGE_TYPE` | test-plan only — override tier for a dry run |

## Supabase Table

```sql
create table topic_history (
  id          uuid        primary key default gen_random_uuid(),
  set_title   text        not null,
  subject     text,
  grade_level text,
  keywords    text[],
  date        date        not null,
  folder_id   text,
  created_at  timestamptz default now()
);
```

## Changing LLM Prompts or QA Logic

**Run `npm run eval` before and after any change** to a prompt, tool schema, or pass/fail logic in `brainstorm.js`, `generate-content.js` (content + recheck), `validate-page.js`, or `reconcile-content.js`. Spot-checking a single case is not enough — it has missed regressions here before (a recheck rule that looked fine on one page rewrote a whole matching page in 4/5 eval runs).

1. `npm run eval` on the current code to get a baseline (all cases should be ✓ or ○ known gap).
2. Make the change.
3. `EVAL_RUNS=5 npm run eval` — every case must stay ✓; investigate any new "flaky" line.
4. When a real run ships a new failure (a wrong page, a bad rewrite), add it to `eval/cases.json` with its fixture image (downscaled to a 640px short side, JPEG) **before** fixing it, confirm it fails, then fix.
5. Mention the eval result in the PR.

The eval calls live models (~$0.11 at 3 runs, ~$0.18 at 5) and needs `OPENAI_API_KEY` + `GROQ_API_KEY` in `.env`; it is not part of `npm test` or CI.

## Local Testing

```bash
cp .env.example .env   # fill all values
npm install
npm test                            # unit tests (no API keys needed)
npm run test:plan                   # dry-run: brainstorm + content only
npm run eval                        # live LLM regression eval (~$0.11; run before changing a prompt)
node scripts/test-drive-upload.js   # verify Drive auth
npm start                           # full pipeline run
```

## Gotchas

- **Telegram `TELEGRAM_CHANNEL_ID`** — must be a channel ID starting with `-100...`, NOT a personal user ID. Get it by forwarding a channel message to @userinfobot.
- **`GRADE_LEVEL`** — set as GitHub **Variable** (`vars.GRADE_LEVEL`), not Secret. Empty = AI picks any grade K–6.
- **OAuth2 consent screen** — before running `get-refresh-token.js`, add your Gmail as a test user in Google Cloud Console → OAuth consent screen → Test users. Otherwise get `403 access_denied`.
- **`FREE_WORKSHEET_DAY` / `LARGE_PACKAGE_DAY`** — set as GitHub **Variables** (not Secrets). `FREE_WORKSHEET_DAY` triggers free tier (7–10 pages, $0). `LARGE_PACKAGE_DAY` triggers large tier (21–`MAX_PAGES_PER_SET` pages). All other days = small tier (15–20 pages). If both fall on the same day, free wins.
- **`GOOGLE_DRIVE_TPT_FOLDER_ID`** — TPT Drive integration rejects PNGs, JSON, TXT. Use a separate folder containing only PDFs. Each run creates a `{date}_{slug}-{id}` subfolder there with `{slug}-complete-set-color.pdf` (product file) and `{slug}-preview.pdf`. Link THIS folder to TPT, not `GOOGLE_DRIVE_FOLDER_ID`.
- **Preview PDF** — `convert-pdf.js` builds `{slug}-preview.pdf`: cover + first 3 worksheet/activity pages, color, diagonal PREVIEW watermark. Uploaded alongside combined PDFs. Upload this file to TPT "Product Previews" slot manually each listing.
- **Education standards** — `brainstorm.js` outputs `plan.educationStandards: { framework, codes }`. Math/ELA → CCSS codes, Science → NGSS codes, other → null. Written to `tpt-listing.txt` under "EDUCATION STANDARDS". Copy-paste into TPT "Select CCSS/NGSS" when listing.

## TPT Listing — Static Field Answers

These never change run-to-run; always fill them the same way:

| Field | Value |
|-------|-------|
| Format | `PDF` + `Image` |
| Tax Code | `Digital books sold to an end user with rights for permanent use` |
| Subject Area | Leaf nodes only — category headers (Art, English Language Arts, Math, Science, Social Studies, etc.) are NOT selectable; pick e.g. Arithmetic, Biology, U.S. History |
