# CLAUDE.md — TPT Worksheet Generator

## Project Overview

Daily GitHub Actions pipeline that generates printable worksheet SETs for Teachers Pay Teachers (TPT). One set per day, auto-uploaded to Google Drive, notified via Telegram.

## Stack

| Layer | Tool |
|-------|------|
| Brainstorm | Gemini 2.5 Flash (`@google/generative-ai`) |
| Image generation | gpt-image-2 (`openai`) |
| Image processing | sharp (grayscale post-process) |
| PDF conversion | pdf-lib (pure Node, no system deps) |
| Cloud storage | Google Drive API v3 (`googleapis`) |
| Topic history | Supabase (`@supabase/supabase-js`) |
| Notifications | Telegram Bot API (native fetch) |
| CI/CD | GitHub Actions cron `0 0 * * *` |

## Key Architecture Decisions

- **OAuth2 not service account** — personal Google Drive accounts have no service account storage quota. Uses `GOOGLE_OAUTH_REFRESH_TOKEN` instead.
- **Gemini native JSON mode** — `responseMimeType: 'application/json'` is more reliable than prompt engineering for structured output.
- **gpt-image-2** — DALL-E 3 was retired March 2026. gpt-image-2 does not accept `response_format` param; always returns b64_json.
- **Grayscale post-processing** — gpt-image-2 always generates color images. `sharp(buffer).grayscale()` enforces blackline printable output.
- **Individual PDFs** — 1 PNG = 1 PDF (not a combined multi-page PDF). TPT buyers expect individual page downloads.
- **Supabase for history** — GitHub Actions filesystem resets every run; local file won't persist. Drive file also works but Supabase is cleaner.
- **Dynamic page count** — Gemini decides how many pages (min 2, max `MAX_PAGES_PER_SET`). Last page always `answer_key`.
- **QA validation with retry** — after each image generation, Gemini vision validates layout/content. Retries up to 2× on fail, then logs warning and continues.

## Scripts

| File | Purpose |
|------|---------|
| `pipeline.js` | Orchestrator — calls all steps in order |
| `brainstorm.js` | Gemini: pick topic + plan full page set (1 API call) |
| `generate-pages.js` | gpt-image-2 loop + sharp grayscale + validate |
| `validate-page.js` | Gemini vision QA check per page |
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
| `GEMINI_API_KEY` | brainstorm.js, validate-page.js |
| `OPENAI_API_KEY` | generate-pages.js |
| `GOOGLE_DRIVE_FOLDER_ID` | upload-drive.js |
| `GOOGLE_OAUTH_CLIENT_ID` | upload-drive.js, get-refresh-token.js |
| `GOOGLE_OAUTH_CLIENT_SECRET` | upload-drive.js, get-refresh-token.js |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | upload-drive.js |
| `SUPABASE_URL` | topic-history.js |
| `SUPABASE_SERVICE_ROLE_KEY` | topic-history.js |
| `TELEGRAM_BOT_TOKEN` | notify-telegram.js |
| `TELEGRAM_CHANNEL_ID` | notify-telegram.js |
| `GRADE_LEVEL` | pipeline.js (default: `Grade 3`) |
| `MAX_PAGES_PER_SET` | pipeline.js (default: `8`) |

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
node scripts/test-drive-upload.js   # verify Drive auth
npm start                           # full pipeline run
```
