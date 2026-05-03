# TPT Worksheet Generator

Daily pipeline: generates one worksheet SET per day using Gemini 2.5 Flash + gpt-image-2, uploads to Google Drive, notifies Telegram. Runs via GitHub Actions cron.

## How It Works

```
GitHub Actions cron (00:00 UTC)
  → scripts/pipeline.js
    → topic-history.js    (Supabase: load past topics to avoid repeats)
    → brainstorm.js       (Gemini 2.5 Flash: pick topic + plan N pages)
    → generate-pages.js   (gpt-image-2: generate each page image, grayscale)
    → validate-page.js    (Gemini vision: QA check, retry up to 2× on fail)
    → convert-pdf.js      (pdf-lib: PNG → PDF per page)
    → upload-drive.js     (Google Drive OAuth2: folder + all files)
    → topic-history.js    (Supabase: save topic to history)
    → notify-telegram.js  (Telegram: cover photo + caption)
```

Each run produces one set folder in Google Drive:
```
2026-05-04_fractions-grade-3-abc12345/
├── page_1_cover.png / .pdf
├── page_2_worksheet.png / .pdf
├── page_N_answer_key.png / .pdf
├── metadata.json
└── tpt-listing.txt   ← paste-ready title, description, keywords, price
```

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
7. In Google Drive: open the target folder → copy ID from URL

### 4. Configure GitHub Secrets

Go to **Settings → Secrets → Actions → New repository secret** for each:

| Secret | How to get |
|--------|-----------|
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `GOOGLE_DRIVE_FOLDER_ID` | Open target Drive folder → copy ID from URL |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Run `node scripts/get-refresh-token.js` |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `TELEGRAM_BOT_TOKEN` | See Telegram Setup below |
| `TELEGRAM_CHANNEL_ID` | See Telegram Setup below |

### 5. Telegram Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy token
2. Create a channel → add bot as **Admin** (Post Messages permission)
3. Get channel ID: forward any channel message to [@userinfobot](https://t.me/userinfobot)
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` secrets

### 6. Run manually

In GitHub: **Actions → Daily Worksheet Pipeline → Run workflow**

Or locally:
```bash
cp .env.example .env   # fill in all values
npm install
npm start
```

## Configuration

Edit in `.github/workflows/daily-worksheets.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRADE_LEVEL` | `Grade 3` | Target grade for worksheets |
| `MAX_PAGES_PER_SET` | `8` | Safety cap on pages per set |

## Logs

Each run writes `logs/pipeline-run.json` (one JSON object per line).
GitHub Actions uploads logs as artifact for 30 days.

On failure, a GitHub Issue is automatically opened and assigned to `peerapatfc`.
