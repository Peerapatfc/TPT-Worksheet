# TPT Worksheet Generator

Daily pipeline: generates one printable worksheet SET per day (OpenAI gpt-4o for planning, Groq gpt-oss-120b for questions/answers, gpt-image-2 for page art), uploads it to Google Drive, and posts the cover plus a review summary to Telegram. Runs via GitHub Actions cron. About $0.30 of API spend per set.

## How It Works

```
GitHub Actions cron (00:00 UTC; GitHub often starts it hours late)
  → npm test               (gate: fail before spending any API budget)
  → scripts/pipeline.js → src/run-pipeline.js
    → topic-history          (Supabase: load past topics to avoid repeats)
    → brainstorm             (gpt-4o: topic, page plan, listing text, standards — no questions)
    → generate-content       (Groq gpt-oss-120b: questions + answers + imageSpec per page, then a recheck;
                              charts come back as structured data)
    → generate-pages         (per page, in parallel with the marketing slides:)
        cover / worksheet / activity → gpt-image-2, then validate-page (gpt-4o-mini vision QA, up to 2 retries)
                                        and reconcile-content (fix answers that depend on the drawn picture)
        picture graph / bar graph / table → drawn by code (src/lib/chart-page.js), no image model
        answer keys → rendered from the Q&A data (SVG), no image model
    → generate-marketing-slides (gpt-image-2 cover + 2 template slides; non-essential)
    → convert-pdf            (pdf-lib: grayscale set, color set, watermarked preview)
    → upload-drive           (Google Drive OAuth2: assets folder + TPT folder)
    → topic-history          (Supabase: save topic)
    → notify-telegram        (cover photo + caption, then a plain-text review summary)
```

Library code lives under `src/` (`config/`, `llm/`, `lib/`, `steps/`); `scripts/` holds only entry points and local helpers. See [CLAUDE.md](CLAUDE.md) for the full layout and the design decisions behind each step.

Each run produces one set folder in the Google Drive assets folder (`GOOGLE_DRIVE_FOLDER_ID`):
```
2026-05-04_fractions-grade-3-abc12345/
├── {slug}-complete-set.pdf        ← grayscale, all pages merged (printer-friendly)
├── {slug}-complete-set-color.pdf  ← color, all pages merged (the file sold on TPT)
├── {slug}-preview.pdf             ← color, cover + 3 sample pages, PREVIEW watermark
├── marketing-cover.png            ← listing thumbnails
├── marketing-whats-included.png
├── marketing-benefits.png
├── metadata.json                  ← set facts, per-page hashes, listing fields
└── tpt-listing.txt                ← paste-ready title, description, keywords, price, education standards
```

There are no per-page PNG/PDF files. To look at individual pages, extract them from a PDF:
`node scripts/extract-pdf-pages.js <complete-set-color.pdf> <out-dir> --sheets`.

The TPT subfolder (`GOOGLE_DRIVE_TPT_FOLDER_ID`) receives only the color set and the preview PDF — no PNGs/JSON/TXT (the TPT Drive integration rejects those).

## Package Tiers

Day-of-week routing controls package size:

| Tier | Pages | Price | Trigger |
|------|-------|-------|---------|
| `free` | 7–10 | $0 | `FREE_WORKSHEET_DAY` |
| `small` | 15–20 | $2–5 | all other days |
| `large` | 21–`MAX_PAGES_PER_SET` | $5–15 | `LARGE_PACKAGE_DAY` |

## TPT Listing — Static Fields

| Field | Value |
|-------|-------|
| Format | `PDF` + `Image` |
| Tax Code | `Digital books sold to an end user with rights for permanent use` |
| Product Previews | Upload `{slug}-preview.pdf` from Drive |
| Education Standards | See `tpt-listing.txt` → "EDUCATION STANDARDS" section (CCSS for Math/ELA, NGSS for Science) |
| Subject Area | Leaf nodes only — category headers (Art, English Language Arts, Math, Science, Social Studies, etc.) are not selectable |

## Setup

### 1. Fork / clone this repo

### 2. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run:

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

3. Go to **Settings → API** → copy **Project URL** and **service_role** key

### 3. Google Drive Setup (OAuth2)

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Enable APIs** → enable **Google Drive API**
2. **Credentials → Create Credentials → OAuth client ID** → Application type: **Desktop app**
3. **APIs & Services → OAuth consent screen** → add your Gmail as a **Test user**
4. Download the credentials → copy **Client ID** and **Client Secret**
5. Add to `.env`, then run once to get refresh token:
   ```bash
   node scripts/get-refresh-token.js
   ```
6. Open the URL shown → authorize → copy `GOOGLE_OAUTH_REFRESH_TOKEN` from terminal to `.env`
7. In Google Drive: create two folders:
   - **Assets folder** — all files per run (set as `GOOGLE_DRIVE_FOLDER_ID`)
   - **TPT folder** — PDFs only, link this to TPT Drive integration (set as `GOOGLE_DRIVE_TPT_FOLDER_ID`)

### 4. Configure GitHub Secrets & Variables

**Secrets** — Settings → Secrets → Actions:

| Secret | How to get |
|--------|-----------|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) — used for Q&A generation and the recheck |
| `GOOGLE_DRIVE_FOLDER_ID` | Open assets Drive folder → copy ID from URL |
| `GOOGLE_DRIVE_TPT_FOLDER_ID` | Open TPT-only Drive folder → copy ID from URL |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Run `node scripts/get-refresh-token.js` |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `TELEGRAM_BOT_TOKEN` | See Telegram Setup below |
| `TELEGRAM_CHANNEL_ID` | See Telegram Setup below |
| `TELEGRAM_REVIEW_CHAT_ID` | _(optional)_ Chat that receives the review summary; defaults to the channel |

**Variables** — Settings → Variables → Actions:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRADE_LEVEL` | _(empty)_ | Target grade (e.g. `Grade 3`). Empty = AI picks K–6 |
| `MAX_PAGES_PER_SET` | `30` | Max pages for large package |
| `FREE_WORKSHEET_DAY` | `0` | Day of week for free tier (0=Sun … 6=Sat) |
| `LARGE_PACKAGE_DAY` | _(unset)_ | Day of week for large tier. Omit = never |
| `PAGE_CONCURRENCY` | `1` | Pages generated in parallel. 2–3 is faster; higher risks image rate limits |

### 5. Telegram Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy token
2. Create a channel → add bot as **Admin** (Post Messages permission)
3. Get channel ID: forward any channel message to [@userinfobot](https://t.me/userinfobot) — must start with `-100...`
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` secrets

### 6. Run manually

In GitHub: **Actions → Daily Worksheet Pipeline → Run workflow**

Or locally:
```bash
cp .env.example .env   # fill in all values
npm install
npm test               # unit tests (pure logic, no API keys needed)
npm run test:plan      # dry-run: brainstorm + content only (no images/Drive/Telegram)
npm run eval           # live LLM regression eval (~$0.11) — run before changing a prompt or QA rule
npm start              # full pipeline run
```

## Tests

`npm test` runs the [vitest](https://vitest.dev) suite under `test/` against the pure-logic
surface (tier routing, plan validation, slugify, MarkdownV2 caption, prompt building,
answer-key resolution, bounded concurrency). No API keys or network required — it also runs
in CI on every push/PR (`.github/workflows/test.yml`) and as a gate before the daily pipeline.

`npm run eval` is separate: it calls the real models against saved failure cases (`eval/cases.json`) and is not part of CI. See "Changing LLM Prompts or QA Logic" in CLAUDE.md.

## Logs

Each run writes `logs/pipeline-run.json` (one JSON object per line, including a `review` line with things a human should check and a `cost` line with estimated API spend per step) and `logs/content-*.json` (the final questions/answers). GitHub Actions uploads logs as an artifact for 30 days.

On failure, a GitHub Issue is automatically opened and assigned to `peerapatfc`.
