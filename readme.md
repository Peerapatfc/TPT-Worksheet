# TPT Worksheet Generator

Daily pipeline: generates one printable worksheet SET per day using gpt-4o + gpt-image-2, uploads to Google Drive, notifies Telegram. Runs via GitHub Actions cron.

## How It Works

```
GitHub Actions cron (00:00 UTC)
  → scripts/pipeline.js
    → topic-history.js       (Supabase: load past 60 topics to avoid repeats)
    → brainstorm.js          (gpt-4o: pick topic + plan N pages + education standards)
    → generate-content.js    (gpt-4o: generate Q&A content for each worksheet page)
    → generate-pages.js      (gpt-image-2: generate page images)
    → validate-page.js       (gpt-4o vision: QA check, retry up to 2× on fail)
    → reconcile-content.js   (gpt-4o vision: correct Q&A answers against image)
    → convert-pdf.js         (pdf-lib: PNG → grayscale PDF + preview PDF per page)
    → upload-drive.js        (Google Drive OAuth2: folder + all files)
    → topic-history.js       (Supabase: save topic to history)
    → notify-telegram.js     (Telegram: cover photo + caption)
```

Each run produces one set folder in Google Drive:
```
2026-05-04_fractions-grade-3-abc12345/
├── page_1_cover.png / .pdf
├── page_2_worksheet.png / .pdf
├── page_N_answer_key.png / .pdf
├── {slug}-complete-set.pdf        ← grayscale, all pages merged (upload to TPT)
├── {slug}-complete-set-color.pdf  ← color version
├── {slug}-preview.pdf             ← color, cover + 3 sample pages, PREVIEW watermark
├── metadata.json
└── tpt-listing.txt                ← paste-ready title, description, keywords, price, education standards
```

The TPT subfolder (`GOOGLE_DRIVE_TPT_FOLDER_ID`) receives only the 3 PDFs above — no PNGs/JSON/TXT (TPT Drive integration rejects those).

## Package Tiers

Day-of-week routing controls package size:

| Tier | Pages | Price | Trigger |
|------|-------|-------|---------|
| `free` | 3–8 | $0 | `FREE_WORKSHEET_DAY` |
| `small` | 10–20 | $2–5 | all other days |
| `large` | 20–`MAX_PAGES_PER_SET` | $5–15 | `LARGE_PACKAGE_DAY` |

## TPT Listing — Static Fields

| Field | Value |
|-------|-------|
| Format | `PDF` + `Image` |
| Tax Code | `Digital books sold to an end user with rights for permanent use` |
| Product Previews | Upload `{slug}-preview.pdf` from Drive |
| Education Standards | See `tpt-listing.txt` → "EDUCATION STANDARDS" section (CCSS for Math/ELA, NGSS for Science) |
| Subject Area | Leaf nodes only — headers (Art, English Language Arts, etc.) are not selectable |

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
| `GOOGLE_DRIVE_FOLDER_ID` | Open assets Drive folder → copy ID from URL |
| `GOOGLE_DRIVE_TPT_FOLDER_ID` | Open TPT-only Drive folder → copy ID from URL |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Run `node scripts/get-refresh-token.js` |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `TELEGRAM_BOT_TOKEN` | See Telegram Setup below |
| `TELEGRAM_CHANNEL_ID` | See Telegram Setup below |

**Variables** — Settings → Variables → Actions:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRADE_LEVEL` | _(empty)_ | Target grade (e.g. `Grade 3`). Empty = AI picks K–6 |
| `MAX_PAGES_PER_SET` | `30` | Max pages for large package |
| `FREE_WORKSHEET_DAY` | `0` | Day of week for free tier (0=Sun … 6=Sat) |
| `LARGE_PACKAGE_DAY` | _(unset)_ | Day of week for large tier. Omit = never |

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
npm run test:plan      # dry-run: brainstorm + content only (no images/Drive/Telegram)
npm start              # full pipeline run
```

## Logs

Each run writes `logs/pipeline-run.json` (one JSON object per line).
GitHub Actions uploads logs as artifact for 30 days.

On failure, a GitHub Issue is automatically opened and assigned to `peerapatfc`.
