# CLAUDE.md — TPT Worksheet Generator

## Project Overview

Daily GitHub Actions pipeline that generates printable worksheet SETs for Teachers Pay Teachers (TPT). One set per day, auto-uploaded to Google Drive, notified via Telegram.

## Stack

| Layer | Tool |
|-------|------|
| Brainstorm | gpt-4o (`openai`) |
| Content QA | gpt-4o (`openai`) |
| Image generation | gpt-image-2 (`openai`) |
| Image processing | sharp (grayscale post-process) |
| PDF conversion | pdf-lib (pure Node, no system deps) |
| Cloud storage | Google Drive API v3 (`googleapis`) |
| Topic history | Supabase (`@supabase/supabase-js`) |
| Notifications | Telegram Bot API (native fetch) |
| CI/CD | GitHub Actions cron `0 0 * * *` |

## Key Architecture Decisions

- **OAuth2 not service account** — personal Google Drive accounts have no service account storage quota. Uses `GOOGLE_OAUTH_REFRESH_TOKEN` instead.
- **OpenAI tool use for structured JSON** — `tool_choice: {type: 'function', function: {name: '...'}}` forces structured output reliably. Used in brainstorm, generate-content, validate-page, reconcile-content. Parse with `JSON.parse(toolCall.function.arguments)`.
- **gpt-image-2** — DALL-E 3 was retired March 2026. gpt-image-2 does not accept `response_format` param; always returns b64_json.
- **Grayscale post-processing** — gpt-image-2 always generates color images. `sharp(buffer).grayscale()` enforces blackline printable output.
- **Color PNG + Grayscale PDF** — PNGs stay color (TPT listing preview). `sharp().grayscale()` applied only when embedding into PDF (printable B&W). Both uploaded per page.
- **Combined PDF** — merged all pages into `{slug}-complete-set.pdf`. TPT requires 1 uploadable file per listing; combined PDF serves this. Individual PDFs also uploaded for preview.
- **gpt-image-2 size** — use `1024x1536` (portrait, closer to A4). `1024x1024` leaves large white margins after aspect-ratio fit to A4.
- **Supabase for history** — GitHub Actions filesystem resets every run; local file won't persist. Drive file also works but Supabase is cleaner.
- **Dynamic page count** — gpt-4o decides how many pages (min 2, max `MAX_PAGES_PER_SET`). Last page always `answer_key`.
- **QA validation with retry** — after each image generation, gpt-4o vision validates layout/content. Retries up to 2× on fail, then logs warning and continues.
- **3-tier package system** — `free` (3–8 pages, $0), `small` (10–20 pages, $2–5), `large` (20–`MAX_PAGES_PER_SET` pages, $5–15). Day-of-week routing: `FREE_WORKSHEET_DAY` → free, `LARGE_PACKAGE_DAY` → large, all others → small. All tracked in Supabase history.

## Scripts

| File | Purpose |
|------|---------|
| `pipeline.js` | Orchestrator — calls all steps in order |
| `brainstorm.js` | gpt-4o: pick topic + plan full page set (1 API call) |
| `generate-pages.js` | gpt-image-2 loop + sharp grayscale + validate |
| `validate-page.js` | gpt-4o vision QA check per page |
| `reconcile-content.js` | gpt-4o vision: correct Q&A answers against generated image |
| `generate-content.js` | gpt-4o: generate + validate Q&A for worksheet pages |
| `test-plan.js` | Dry-run: brainstorm + content only, no image/Drive/Telegram |
| `convert-pdf.js` | pdf-lib: PNG Buffer → A4 PDF Buffer per page |
| `upload-drive.js` | Google Drive: create folder, upload PNG+PDF+metadata |
| `topic-history.js` | Supabase: read/write past topics |
| `notify-telegram.js` | Send cover photo + caption to Telegram channel |
| `create-issue.js` | Open GitHub Issue on pipeline failure |
| `logger.js` | Append JSON lines to `logs/pipeline-run.json` |
| `get-refresh-token.js` | One-time OAuth2 setup — run locally, not in CI |
| `test-drive-upload.js` | Quick Drive upload test — run locally only |

## Environment Variables

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | brainstorm.js, generate-content.js, validate-page.js, reconcile-content.js, generate-pages.js |
| `OPENAI_API_KEY` | generate-pages.js |
| `GOOGLE_DRIVE_FOLDER_ID` | upload-drive.js (full assets folder) |
| `GOOGLE_DRIVE_TPT_FOLDER_ID` | upload-drive.js (flat TPT folder — PDF only, optional) |
| `GOOGLE_OAUTH_CLIENT_ID` | upload-drive.js, get-refresh-token.js |
| `GOOGLE_OAUTH_CLIENT_SECRET` | upload-drive.js, get-refresh-token.js |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | upload-drive.js |
| `SUPABASE_URL` | topic-history.js |
| `SUPABASE_SERVICE_ROLE_KEY` | topic-history.js |
| `TELEGRAM_BOT_TOKEN` | notify-telegram.js |
| `TELEGRAM_CHANNEL_ID` | notify-telegram.js |
| `GRADE_LEVEL` | pipeline.js (default: `Grade 3`) |
| `MAX_PAGES_PER_SET` | pipeline.js — max pages for large package (default: `30`) |
| `FREE_WORKSHEET_DAY` | pipeline.js (0=Sun … 6=Sat, default: `0`) — triggers free tier |
| `LARGE_PACKAGE_DAY` | pipeline.js (0=Sun … 6=Sat, omit = never) — triggers large tier |

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
npm run test:plan                   # dry-run: brainstorm + content only
node scripts/test-drive-upload.js   # verify Drive auth
npm start                           # full pipeline run
```

## Gotchas

- **Telegram `TELEGRAM_CHANNEL_ID`** — must be a channel ID starting with `-100...`, NOT a personal user ID. Get it by forwarding a channel message to @userinfobot.
- **`GRADE_LEVEL`** — set as GitHub **Variable** (`vars.GRADE_LEVEL`), not Secret. Empty = AI picks any grade K–6.
- **OAuth2 consent screen** — before running `get-refresh-token.js`, add your Gmail as a test user in Google Cloud Console → OAuth consent screen → Test users. Otherwise get `403 access_denied`.
- **`FREE_WORKSHEET_DAY` / `LARGE_PACKAGE_DAY`** — set as GitHub **Variables** (not Secrets). `FREE_WORKSHEET_DAY` triggers free tier (3–8 pages, $0). `LARGE_PACKAGE_DAY` triggers large tier (20–`MAX_PAGES_PER_SET` pages). All other days = small tier (10–20 pages). Both can be the same day only if you want to override (free takes priority).
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
