# CLAUDE.md — TPT Worksheet Generator

## Project Overview

Daily GitHub Actions pipeline that generates printable worksheet SETs for Teachers Pay Teachers (TPT). One set per day, auto-uploaded to Google Drive, notified via Telegram.

## Stack

| Layer | Tool |
|-------|------|
| Brainstorm (topic + plan) | gpt-4o (`openai`) |
| Content generation + Q&A recheck | llama-3.3-70b-versatile (Groq, OpenAI-compatible) |
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
- **Two LLM providers** — text brainstorm + vision QA run on OpenAI; Q&A content generation + recheck run on **Groq** (`llama-3.3-70b-versatile`) via the OpenAI-compatible endpoint. Clients are lazy singletons in `src/llm/clients.js` (`openai()`, `groq()`).
- **Forced tool call for structured JSON** — `tool_choice: {type:'function', function:{name:'...'}}` reliably forces structured output. The single-shot pattern is wrapped in `src/llm/tool-call.js` (`callTool`); brainstorm keeps a bespoke multi-turn validation-retry loop. Parse with `JSON.parse(toolCall.function.arguments)`.
- **Shared retry** — `src/llm/with-retry.js` (`withRetry`) retries 429/500/503 with exponential backoff. One implementation, used by every API call site.
- **gpt-image-2** — DALL-E 3 was retired March 2026. gpt-image-2 does not accept `response_format` param; always returns b64_json.
- **Grayscale post-processing** — gpt-image-2 always generates color images. `sharp(buffer).grayscale()` enforces blackline printable output. Grayscale is computed **once per page** and reused for the per-page and combined grayscale PDFs.
- **Color PNG + Grayscale PDF** — PNGs stay color (TPT listing preview). `sharp().grayscale()` applied only when embedding into PDF (printable B&W). Both uploaded per page.
- **Combined PDF** — merged all pages into `{slug}-complete-set.pdf`. TPT requires 1 uploadable file per listing; combined PDF serves this. Individual PDFs also uploaded for preview.
- **gpt-image-2 size** — use `1024x1536` (portrait, closer to A4). `1024x1024` leaves large white margins after aspect-ratio fit to A4.
- **Supabase for history** — GitHub Actions filesystem resets every run; local file won't persist. Drive file also works but Supabase is cleaner.
- **Dynamic page count** — brainstorm (gpt-4o) decides how many pages within the tier range. Answer-key pages are always grouped at the end.
- **QA validation with retry** — after each image generation, gpt-4o-mini vision validates layout/content. Retries up to 2× on fail, then logs warning and continues (fail-open: a flaky validator never blocks the run).
- **Bounded-concurrency page generation** — `generatePages` honors `PAGE_CONCURRENCY` (default 1 = sequential, preserving the original cost/rate profile). Raise to 2–3 to cut wall-clock; higher values risk OpenAI image rate limits.
- **Non-essential steps degrade gracefully** — marketing slides are generated in parallel with pages but a failure there is caught and the run continues without them; only essential steps abort the pipeline.
- **3-tier package system** — `free` (7–10 pages, $0), `small` (15–20 pages, $2–5), `large` (21–`MAX_PAGES_PER_SET` pages, $5–15). Ranges are defined in `src/config/constants.js` (`PAGE_RANGES`). Day-of-week routing: `FREE_WORKSHEET_DAY` → free, `LARGE_PACKAGE_DAY` → large, all others → small. Free wins ties. All tracked in Supabase history.

## Project Layout

```
scripts/                  entry points only
  pipeline.js             CI entry — imports src/run-pipeline.js
  test-plan.js            dry-run entry (brainstorm + content)
  create-issue.js         opens a GitHub Issue on pipeline failure
  get-refresh-token.js    one-time OAuth2 setup (local only, gitignored)
  test-drive-upload.js    Drive auth smoke test (local only, gitignored)
src/
  run-pipeline.js         orchestrator — runs every step in order
  config/
    constants.js          MODELS, PAGE_RANGES, RETRY, A4, IMAGE_SIZE
    tpt-taxonomy.js        TPT_SUBJECT_AREAS, TPT_TAGS (allowed strings)
  llm/
    clients.js            lazy openai() / groq() singletons
    with-retry.js         withRetry (429/500/503 backoff)
    tool-call.js          callTool (forced single tool call + JSON parse)
  lib/
    slugify.js  source-pages.js  markdown.js  logger.js
    package-type.js       tier routing (pure + env wrapper)
    concurrency.js        mapWithConcurrency (ordered, bounded)
  steps/
    brainstorm.js         gpt-4o: topic + full page plan (exports validate)
    generate-content.js   Groq: Q&A per page (exports validateSchema)
    generate-pages.js     gpt-image-2 + validate + reconcile (exports buildPrompt)
    validate-page.js      gpt-4o-mini vision QA
    reconcile-content.js  gpt-4o-mini vision: fix answers vs image
    generate-marketing-slides.js  gpt-image-2 ×3 + logo composite
    convert-pdf.js        pdf-lib: per-page + combined + preview PDFs
    upload-drive.js       Drive: folder + PNG/PDF/metadata/listing
    topic-history.js      Supabase read/write
    notify-telegram.js    Telegram cover photo + MarkdownV2 caption
    schema/worksheet-plan.js  brainstorm tool-call JSON schema
test/                     vitest unit tests for the pure-logic surface
```

## Environment Variables

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | brainstorm, generate-pages, validate-page, reconcile-content, generate-marketing-slides |
| `GROQ_API_KEY` | generate-content (content + Q&A recheck) |
| `GOOGLE_DRIVE_FOLDER_ID` | upload-drive (full assets folder) |
| `GOOGLE_DRIVE_TPT_FOLDER_ID` | upload-drive (flat TPT folder — PDF only, optional) |
| `GOOGLE_OAUTH_CLIENT_ID` | upload-drive, get-refresh-token |
| `GOOGLE_OAUTH_CLIENT_SECRET` | upload-drive, get-refresh-token |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | upload-drive |
| `SUPABASE_URL` | topic-history |
| `SUPABASE_SERVICE_ROLE_KEY` | topic-history |
| `TELEGRAM_BOT_TOKEN` | notify-telegram |
| `TELEGRAM_CHANNEL_ID` | notify-telegram |
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

## Local Testing

```bash
cp .env.example .env   # fill all values
npm install
npm test                            # unit tests (no API keys needed)
npm run test:plan                   # dry-run: brainstorm + content only
node scripts/test-drive-upload.js   # verify Drive auth
npm start                           # full pipeline run
```

## Gotchas

- **Telegram `TELEGRAM_CHANNEL_ID`** — must be a channel ID starting with `-100...`, NOT a personal user ID. Get it by forwarding a channel message to @userinfobot.
- **`GRADE_LEVEL`** — set as GitHub **Variable** (`vars.GRADE_LEVEL`), not Secret. Empty = AI picks any grade K–6.
- **OAuth2 consent screen** — before running `get-refresh-token.js`, add your Gmail as a test user in Google Cloud Console → OAuth consent screen → Test users. Otherwise get `403 access_denied`.
- **`FREE_WORKSHEET_DAY` / `LARGE_PACKAGE_DAY`** — set as GitHub **Variables** (not Secrets). `FREE_WORKSHEET_DAY` triggers free tier (7–10 pages, $0). `LARGE_PACKAGE_DAY` triggers large tier (21–`MAX_PAGES_PER_SET` pages). All other days = small tier (15–20 pages). If both fall on the same day, free wins.
- **`GOOGLE_DRIVE_TPT_FOLDER_ID`** — TPT Drive integration rejects PNGs, JSON, TXT. Use a separate flat folder containing only PDFs. Each run uploads `{slug}-complete-set.pdf` there. Link THIS folder to TPT, not `GOOGLE_DRIVE_FOLDER_ID`.
- **Preview PDF** — `convert-pdf.js` builds `{slug}-preview.pdf`: cover + first 3 worksheet/activity pages, color, diagonal PREVIEW watermark. Uploaded alongside combined PDFs. Upload this file to TPT "Product Previews" slot manually each listing.
- **Education standards** — `brainstorm.js` outputs `plan.educationStandards: { framework, codes }`. Math/ELA → CCSS codes, Science → NGSS codes, other → null. Written to `tpt-listing.txt` under "EDUCATION STANDARDS". Copy-paste into TPT "Select CCSS/NGSS" when listing.

## TPT Listing — Static Field Answers

These never change run-to-run; always fill them the same way:

| Field | Value |
|-------|-------|
| Format | `PDF` + `Image` |
| Tax Code | `Digital books sold to an end user with rights for permanent use` |
| Subject Area | Leaf nodes only — category headers (Art, English Language Arts, etc.) are NOT selectable |
