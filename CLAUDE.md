# CLAUDE.md — TPT Worksheet Generator

## Project Overview

Daily GitHub Actions pipeline that generates printable worksheet SETs for Teachers Pay Teachers (TPT). One set per day, auto-uploaded to Google Drive, notified via Telegram.

## Stack

| Layer | Tool |
|-------|------|
| Brainstorm (topic + plan) | gpt-4o (`openai`) — or openai/gpt-oss-120b on Groq with `BRAINSTORM_PROVIDER=groq` |
| Content generation + Q&A recheck | openai/gpt-oss-120b (Groq, OpenAI-compatible) |
| Page QA (vision) + answer reconcile | gpt-4o-mini (`openai`) |
| Image generation | gpt-image-2 (`openai`) |
| Cover illustration (opt-in hybrid cover) | Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell` (free tier, native fetch) |
| Hybrid worksheet pages (opt-in, `PAGE_RENDERER=hybrid`) | code layout engine (`src/lib/layout/`, SVG → sharp) + FLUX.1 schnell spot illustrations |
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
- **Brainstorm provider is switchable** — `BRAINSTORM_PROVIDER=groq` runs brainstorm on Groq `openai/gpt-oss-120b` (free tier, `MODELS.brainstormGroq`) instead of OpenAI gpt-4o; unset/`openai` is the default and unknown values fall back to openai with a warning (`resolveBrainstormProvider`, `src/lib/brainstorm-provider.js`). Same prompt, schema, forced tool call and `validate()` retry loop; Groq gets `max_tokens` 16000 because gpt-oss reasoning tokens count toward it, and retries echo only `role/content/tool_calls` (not Groq's `reasoning` field). Cost is recorded under whichever model ran. Compare `npm run test:plan` (and `npm run eval`) on both providers before switching CI.
- **Forced tool call for structured JSON** — `tool_choice: {type:'function', function:{name:'...'}}` reliably forces structured output. The single-shot pattern is wrapped in `src/llm/tool-call.js` (`callTool`); brainstorm keeps a bespoke multi-turn validation-retry loop. Parse with `JSON.parse(toolCall.function.arguments)`.
- **Shared retry** — `src/llm/with-retry.js` (`withRetry`) retries 429/500/503 with exponential backoff. One implementation, used by every API call site. A 429 for exhausted OpenAI credits (`isQuotaExhausted`) or a Groq **daily** limit (`isDailyLimitExhausted`: "tokens per day (TPD)" / "requests per day (RPD)") is thrown at once — the free tier's 200k tokens/day window cannot reset within the ≤60s waits; per-minute 429s (TPM/RPM) are still retried with the server's hint.
- **gpt-image-2** — DALL-E 3 was retired March 2026. gpt-image-2 does not accept `response_format` param; always returns b64_json.
- **Color is the product** — sets are sold in color: `{slug}-complete-set-color.pdf` is the TPT product file. A grayscale `{slug}-complete-set.pdf` (`sharp().grayscale()` per page) is still built and kept in the assets folder as a printer-friendly option.
- **PDFs embed JPEG, not PNG** — page art is embedded as JPEG q90 (4:4:4, mozjpeg) when that is under 70% of the PNG size; flat-text pages (answer keys, chart pages) stay PNG. A 18-page set went 17 MB → 4 MB (color), with no visible loss even zoomed on text, so the product file uploads to TPT through the browser tool (~10 MB limit) without a recompress step. `buildCombinedPdf` steps the quality down (90 → 85 → 80) only if a set is over 9 MB, and warns if it still is.
- **Combined PDFs only** — TPT needs one uploadable file per listing. Per-page PNG/PDF files are no longer uploaded (nothing used them; ~1.5 min of uploads per run). The assets folder holds the color + grayscale sets, the preview, the 3 marketing slides, `tpt-listing.txt` and `metadata.json`.
- **Hybrid cover (opt-in)** — with `COVER_RENDERER=hybrid` and `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` set, the set's cover page is FLUX.1 schnell (Cloudflare Workers AI, free, `src/llm/flux.js`) for a text-free colour illustration plus code for everything printed: `hybridCoverSvg` (`svg-templates.js`) draws frame, auto-fit title, subtitle, name line and grade/page-count pill, so cover text is always spelled exactly. `src/lib/hybrid-cover.js` derives the FLUX prompt from the cover page's `imagePrompt` (quoted titles, text/border/layout phrases stripped, ≤900 chars), crops FLUX's bottom 7% (it hallucinates watermark text there) and makes only edge-connected near-white transparent (a plain near-white mask erased white subjects like a polar bear). Output is the same 1024×1536 PNG page as any other. No validate/reconcile (exact text, no questions). Fail-open: any error → `warn`, `fallback` review note, gpt-image-2 cover. Default off; the marketing cover always stays on gpt-image-2. FLUX does not reliably draw every named subject (4 named animals → 3 drawn in a test), so glance at the cover.
- **Hybrid pages (opt-in)** — with `PAGE_RENDERER=hybrid`, worksheet/activity pages whose content fits a layout are drawn by code: `routePage` (`generate-pages.js`) → `classifyHybridLayout` (`src/lib/layout/classify.js`) → `renderHybridPage` (`src/lib/hybrid-page.js`) → `renderLayout` (`src/lib/layout/index.js`). Today's content (`questions` + `imageSpec`) only routes to `questions` (no imageSpec, no picture-dependent question), `fill_blank` (most questions contain `___`; bank = the imageSpec's "Word bank: …" if it covers every answer, else the short answers alphabetically) and `multiple_choice` (every question has inline "A) … B) …" options or is "True or False: …", and the answer resolves to exactly one option). Questions that read other page content ("how many … in each family", "according to", icons, "sentence 2", "the first picture", "the story") are flagged and stay on gpt-image-2. Pages whose content came from the hybrid content step (below) route by their own `content.layout` + `content.spec` (`structuredRoute`); the classifier only handles legacy-shaped content. Illustrations (`src/lib/illustrations.js`): subject derived in code from the page `imagePrompt` ("decorated with …") or title topic words, fixed style prompt + "no text, no letters, no numbers", prepared like the cover art, identical prompts generated once per run, ≤ `ILLUSTRATION_CONCURRENCY` (default 2) FLUX calls at once, cost bucket `page_illustration`. Illustrations are decorative only — no question may depend on them. No validate/reconcile (text is exact). Fail-open: FLUX error → decorative motif block + `fallback` review note. Pages with no layout, overflowing pages and other hybrid errors (with a review note) go to the gpt-image-2 path, so a hybrid run completes end-to-end. Cover/chart/answer-key renderers are unchanged; the gpt-image-2 path is deleted in P5.
- **Hybrid layouts** (`src/lib/layout/`, each a pure `(plan, page, spec, { art }) → { svg, boxes, meta }` renderer; specs validated and answer keys derived in `layout/specs.js` — `layoutAnswerKey` returns `{ num, question, answer }[]` for `answerKeySvg`, never model-written): `questions`, `fill_blank` (`worksheet.js`); `multiple_choice` (`choice.js`, `{ questions: [{ num, question, options: 2–4, answer: option text or letter }] }`, A–D bubbles, options on one line / two per line / one per line); `matching` (`matching.js`, `{ pairs: [{ term, match }] }` 3–10, a bijection; the right column is shuffled by code with a seeded derangement, so the key is computed); `sorting` (`sorting.js`, `{ categories: 2–4, items: [{ word, category }] 4–16 }`, seeded word bank, every column gets the same line count); `labeling` (`labeling.js`, `{ subject, labels: [{ word, clue }] 3–8 }`: big FLUX picture beside numbered clue callouts + word bank — guaranteed: every word/clue/number and the key; NOT guaranteed: that the picture shows a part or where, so leader lines stop at the picture edge and each callout must be answerable from its clue alone; a clue containing its word is rejected); `table_fill` (`table.js`, `{ columns: 2–5, rows: [[string | { answer }]] 2–10, questions? }`, widths from measured content); `shapes` (`shapes.js`, code-only, no FLUX: `{ items: [{ kind: 'fraction', shape: circle|rectangle|bar, parts 2–12, shaded, ask: name|shade } | { kind: 'count', icon: CHART_ICONS, count 1–20 } | { kind: 'polygon', shape, ask: sides|corners|name }] }` — question and answer generated from the numbers); `activity_art` (`activity.js`, `{ subject, instruction, tasks? ≤3 }`, full-page FLUX colouring line art, no key; tasks must not name things the picture has to contain — FLUX drops subjects). Overflow handling everywhere: shrink 32 → 16 px, drop the illustration, two columns for row layouts (questions, fill_blank, multiple_choice) before going below 20 px, then `LayoutOverflowError` (router falls back). Layouts return their boxes, so tests check no-overflow/no-overlap without pixels (`test/helpers/layout.js`). Spot art goes in a band under the content, a top-right float, or is dropped (the FLUX call is then skipped).
- **Hybrid content (P3, `PAGE_RENDERER=hybrid` only)** — `generateContent` branches to `generateContentHybrid` → `src/steps/hybrid-content.js`: Groq returns one structured spec per page (`generate_layout_content`; layouts `questions`, `fill_blank`, `multiple_choice`, `matching`, `sorting`, `labeling`, `table_fill`, `shapes`, `activity_art`, `chart`) — no `imageSpec`. A code hint (`suggestLayout`, from filename/imagePrompt keywords) is passed per page; Groq may override it. Pages go in chunks of `HYBRID_PAGES_PER_CALL` (3; prompt ~1.9k tokens + `max_tokens` 3000 reserved, ~2.8k actually used per call — one call per ~minute on the 8k TPM free tier, `withRetry` waits on 429), sequential (`RECHECK_CONCURRENCY`). Each page is normalised and cheaply repaired (`normalizeHybridPage`: null/""/wrong-type fields = absent, trim/dedupe/truncate, clamp shape counts, MC answers → letters, `[x]` table cells → blanks, fill-in answer printed in its sentence → `___`, missing word-bank words added) then validated strictly (`validateHybridPage`: specs.js validators, matching/sorting ambiguity checks (below), question counts, `isPictureDependent` — the FLUX picture is decoration only, so no "in the picture", "how many do you see", "colour the rings yellow" —, `readsOtherPageContent`, `isOpenEndedQuestion`, and a dry render that catches overflow). Invalid pages are re-asked with their errors (up to `HYBRID_MAX_ATTEMPTS` = 3; a page whose whole call failed is retried alone). Still invalid → `questions` layout from any valid plain Q&A it produced, else the legacy content prompt (`legacyContentForPages`; the page then goes through the classifier or gpt-image-2) — both with a `fallback` review note. `content.questions` of a structured page is the answer key derived from the spec (`layoutAnswerKey`), so `answerKeySvg` is unchanged and can never disagree with the page. Recheck: `recheckHybridContent` sends each page as numbered items (MC with options, matching with all choices, sorting/labeling with their banks, table blanks with their row; shapes/activity_art skipped — shapes answers are computed) to a Groq tool without `imageSpecCorrections`; `applyHybridCorrections` applies a correction only if the spec stays valid (MC letter, matching/labeling swap, sorting category, word-bank word, table cell) and a rewrite only on `questions`/`chart`/table questions and never if it references the picture/layout — otherwise `spec_mismatch` note. `stripAnswerLeaks` / `quotesMissingFromSpec` do not apply (no imageSpec). Schema gotcha: gpt-oss fills fields that do not apply with `null`, `""` or `{}`, and Groq 400s (`tool_use_failed`) the whole call if that breaks the schema, so optional fields are `anyOf [typed, null, string]`, nested enums are only described, and `chart` has no required keys. Square/rectangle/rhombus/trapezoid "name" answers list every valid name. **Matching ambiguity** (one verifiable answer per question — a live Grade 4 page keyed "Has a system of rings" to Saturn only): the prompt requires each match to be true of its own term and false for every other term (definition, unique fact or superlative; never a shared property like "has rings", "is a mammal", "lives in water", "is big"; a bad/good planets example), terms distinct, no term inside its own match, matches ≤12 words. Code (`matchingIssues`): near-duplicate matches (punctuation/articles ignored), a match containing its own term (whole word, +s/es), and a match that is *only* a vague property ("Is big", "It is important") or bare "Has rings" — deliberately not "is a mammal" etc., which is a valid unique match when only one listed term qualifies. Sorting (`sortingIssues`): a word filed under two categories (normalize no longer silently keeps the first) or equal to a heading. **Matching self-check** (`selfCheckMatching`, on by default, `MATCHING_SELF_CHECK=off` skips it): each matching page that validates gets one extra Groq call (`report_flaws`, gpt-oss-120b, `reasoning_effort` medium, `max_tokens` 1500, ~330 prompt tokens, cost bucket `content_self_check`) that sees the terms and the printed shuffled statements — not the key — and returns per statement the best term + every other term it is also true of; any other term → the page is re-asked with the offending pairs named (counts toward the 3 attempts). Still ambiguous after 3 → the offending pairs are dropped if ≥3 remain (`fallback` note), else the usual questions/legacy fallback. Fail-open: a failed/unusable self-check keeps the page with a `fallback` note. Framing matters: asked to "list every meaning that fits each term", gpt-oss solved it as a one-to-one puzzle and missed the rings clue (live, low and medium effort). The default (unset/`openai`) path sends byte-identical requests — `test/legacy-content-snapshot.test.js` compares them with bodies captured from master.
- **Zero-OpenAI mode (`PAGE_RENDERER=hybrid-only`)** — Groq + FLUX + code only; `OPENAI_API_KEY` may be unset. Hard guard: `openai()` (`src/llm/clients.js`) throws in this mode instead of constructing a client, so any path that would spend OpenAI credits fails loudly (`openaiConstructed()` for tests). Mode is read via `pageRenderer` / `isHybridOnly` (`src/config/renderer.js`). Brainstorm is forced to Groq (`resolveBrainstormProvider`), content uses the hybrid content step (as `hybrid`), and `routePage` never returns `legacy`: a page with no layout routes to `hybrid` with `layout: null`. `renderHybridOnlyPage` (`src/lib/hybrid-only.js`) degrades instead of calling gpt-image-2: routed layout → self-contained conversion of a structured spec (matching/labeling → fill-in + word bank, MC/sorting → plain questions) → plain `questions` (picture-dependent legacy questions dropped when ≥ `MIN_KEEP` (4) remain, renumbered) → compact 16→14px two-column layout trimming trailing questions → colouring page → bare frame. It never throws and returns the content it actually printed, so answer keys (built from the printed pages) match; every step records a `degraded` / `overflow` review note. Vision QA and reconcile never run (no gpt-4o-mini). Cover: FLUX + code (`renderHybridCover`) when Cloudflare credentials exist, else / on error the code-drawn text-only cover with theme motifs (`renderTextCover`) — never gpt-image-2. Marketing cover: `renderMarketingCover` (`hybrid-cover.js`, code title/banner around the shared cover FLUX illustration; motifs on failure). The run log and review message report `openaiCalls` / `openaiUsd` (both 0). Uncovered/overflow pages still go to gpt-image-2 under plain `hybrid`.
- **Bundled font (Nunito, SIL OFL 1.1)** — every code-rendered page (answer keys, chart pages, covers, hybrid layouts) uses `assets/fonts/Nunito-{Regular,Bold,Italic}.ttf` (licence: `assets/fonts/OFL.txt`). `src/lib/fonts.js` (imported by `svg-templates.js`, so before any render) sets `FONTCONFIG_FILE=assets/fonts/fonts.conf` (bundled dir first, system dirs only as glyph fallback for Thai/emoji) and `PANGOCAIRO_BACKEND=fc` — macOS Pango otherwise uses CoreText and ignores fontconfig (renders Helvetica). Both are left alone if already set. `layout/measure.js` reads real advance widths from the TTFs (`parseTtf`: head/hhea/hmtx/cmap, no kerning — it only narrows Nunito text — plus 2% margin); measured widths are 2–6% wider than the rendered ink. `test/fonts.test.js` fails if a render falls back to another font (golden glyph thumbnail). Adding a font: put the static TTFs (no variable fonts — the metrics reader has no HVAR support) + its OFL in `assets/fonts/`, add them to `FONT_FILES`, keep `FONT_STACK` in sync, and refresh goldens with `UPDATE_GOLDENS=1 npm test` after viewing the renders. Older templates (`svg-templates.js`, `chart-page.js`) still wrap with conservative average widths (wider than Nunito, so they never overflow).
- **Golden images** — `test/layouts.test.js` renders every sample in `test/fixtures/layout-samples.js` with a code-drawn stub illustration (no network) and compares a 256 px greyscale thumbnail with `test/goldens/*.png` (`test/helpers/golden.js`: < 1% of pixels off by > 48 and mean diff < 3, so anti-aliasing differences between macOS and Linux pass while moved blocks or a different font fail). After an intended visual change: `npm run render:samples` (writes `samples-out/`, gitignored), view the PNGs, then `UPDATE_GOLDENS=1 npm test`. `npm run render:samples -- --flux` uses live FLUX (free; Cloudflare vars) — never OpenAI.
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
- **Cost logging** — every API call records its `usage` into `src/lib/cost-tracker.js` under a step bucket (`brainstorm`, `content`, `content_recheck`, `cover_image`, `cover_illustration`, `page_illustration`, `page_image`, `validate_page`, `reconcile_page`, `marketing_image`). The pipeline appends one `{"step":"cost",...}` line to `logs/pipeline-run.json` at the end of every run (even failed ones); `npm run test:plan` prints it too. USD is estimated from `PRICING` in `constants.js` — keep that table current. `page_image` calls minus image pages = QA retries.
- **Chart pages are drawn by code** — gpt-image-2 drew the wrong number of icons on picture-graph pages while the answer key used the data, and neither the validator nor reconcile can count (gpt-4o-mini echoes the spec). Groq now returns a structured `chart` (`pictograph` | `bar` | `table`, categories with whole-number values, limits in `CHART_LIMITS`) instead of an imageSpec for those pages; `chartPageSvg` renders the whole page (chart, questions, answer lines) in the shared template frame. Chart pages skip image generation, QA and reconcile, cost nothing, and their answer key always matches. An over-limit chart (e.g. bar values 40/50) is repaired in code by `repairChart`/`repairCharts` into a table with the same numbers (review note `chart_repaired`); one that cannot be repaired fails `validateSchema` (retry); `isChartPage` routes only valid ones. Pie/line/double-bar/misdrawn-graph pages are banned (prompt + `BANNED_ACTIVITY`) because the image model draws their values wrong. The Q&A recheck splits a failed chunk in halves (`recheckWithSplit`) so a 413 no longer ships pages unchecked. Rechecks run sequentially (`RECHECK_CONCURRENCY`, default 1) because Groq's free tier is 8000 tokens/minute and one call is ~7k (prompt + reserved `max_tokens`), so parallel calls always 429. Icons are simple SVG shapes for now.
- **Reconcile stays a separate step** — folding it into the validator was tested and rejected: asked to report each imageSpec value as drawn, gpt-4o-mini copied the spec values instead of reading the image (3 tampered specs passed 9/9).
- **QA validation with retry** — after each image generation, gpt-4o-mini vision checks the page. The model only transcribes each listed question as printed and reports page flags (garbled text, no answer space, answers shown, missing header, questions on a cover); `judgeReport` decides pass/fail in code, and `compareQuestion` checks that every listed number appears in the transcription. Only real defects trigger a paid regeneration — letting gpt-4o-mini judge severity or "number differs" itself caused false failures (it fact-checked "Spiders have six legs") and missed changed numbers. It does NOT reliably notice answers printed on a student page, so that is prevented upstream (see below). The image is downscaled to a 640px short side (`QA_SHORT_SIDE`) first: ~26k instead of ~37k tokens; 512px was too small to read text. Retries up to 2× on fail, then logs warning and continues (fail-open: a flaky validator never blocks the run).
- **Bounded-concurrency page generation** — `generatePages` honors `PAGE_CONCURRENCY` (default 1 = sequential, preserving the original cost/rate profile). Raise to 2–3 to cut wall-clock; higher values risk OpenAI image rate limits.
- **Non-essential steps degrade gracefully** — marketing slides are generated in parallel with pages but a failure there is caught and the run continues without them; the Telegram notification runs last and a failure there is logged as `warn`. Only essential steps abort the pipeline. `generate_content` logs `warn` with `pagesWithContent` when Groq content generation fell back to the brainstorm plan.
- **Market check gates the run** — before brainstorm, `src/steps/market-check.js` asks Groq `openai/gpt-oss-120b` whether a new set is worthwhile today. `MARKET_CHECK` picks the mode (`resolveMarketCheckMode`): `search` = built-in `browser_search` tool (seasonal demand, TPT trends, saturation vs. history; **59k–289k input tokens per call measured, mean ~142k** — up to the whole 200k/day free tier, which starved content/recheck); `light` = no tools, `reasoning_effort: low`, `max_tokens` 1500, judges from date + tier + the last 14 sets only (~1–2k tokens) and may skip **only** for clear saturation (3+ sets with the same subject + grade + topic area in the last 7 days), never for trend/season guesses — a light skip is also overridden in code unless `hasRecentSaturation` confirms 3+ same subject+grade sets in 7 days; `auto` (**default** when unset/empty; unknown values → auto + warning) = `search` on `MARKET_CHECK_SEARCH_DAY` (0–6 UTC, default 1 = Monday) and `light` on the other days; `off` disables it. The search prompt asks for at most 2–3 searches (Groq exposes no documented token cap for the tool in the SDK). One call per run, no fallback call; **fail-open** (any error incl. 429/unparseable answer → generate, `warn`). `generate:false` ends the run as `done/skipped` with a Telegram note (review chat). The log line has `mode` and `tokens`; usage is recorded as `market_check`. Manual `workflow_dispatch` runs force-generate by default (`force` input → `FORCE_GENERATE`).
- **3-tier package system** — `free` (7–10 pages, $0), `small` (15–20 pages, $2–5), `large` (21–`MAX_PAGES_PER_SET` pages, $5–15). Ranges are defined in `src/config/constants.js` (`PAGE_RANGES`). Day-of-week routing: `FREE_WORKSHEET_DAY` → free, `LARGE_PACKAGE_DAY` → large, all others → small. Free wins ties. All tracked in Supabase history.

## Project Layout

```
scripts/                  entry points only
  pipeline.js             CI entry — imports src/run-pipeline.js
  test-plan.js            dry-run entry (brainstorm + content)
  create-issue.js         opens a GitHub Issue on pipeline failure
  eval.js                 live regression eval of the validator + Groq recheck (eval/cases.json)
  eval-hybrid.js          live Groq-only eval of the hybrid content step (eval/hybrid-plans.js)
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
    flux.js               Cloudflare Workers AI FLUX.1 schnell (generateIllustration)
  lib/
    slugify.js  source-pages.js  markdown.js  logger.js
    package-type.js       tier routing (pure + env wrapper)
    concurrency.js        mapWithConcurrency (ordered, bounded)
    svg-templates.js      answer-key page + text marketing slides + hybrid cover (SVG → PNG); shared page frame
    hybrid-cover.js       hybrid cover: FLUX prompt derivation, illustration masking, render; text-only cover + code marketing cover (hybrid-only)
    hybrid-only.js        PAGE_RENDERER=hybrid-only page fallbacks (never OpenAI, never throws)
    chart-page.js         code-drawn chart pages: pictograph / bar / table + questions
    hybrid-page.js        PAGE_RENDERER flag + renderHybridPage (layout + FLUX spot, fail-open)
    illustrations.js      page FLUX subject/prompt derivation + per-run cached, bounded provider
    fonts.js              bundled Nunito: fontconfig/Pango env + TTF advance widths
    layout/               hybrid page engine: measure.js (widths, wrap, fit), worksheet.js (shell, flow/two-column compose, questions / fill_blank), decor.js (motifs, badges, boxes), specs.js (layout spec validators, seeded shuffles, derived answer keys), index.js (layout registry), choice/matching/sorting/labeling/table/shapes/activity.js (layouts), classify.js (which layout fits today's content)
    spec-consistency.js   quotesMissingFromSpec — quotes in questions must appear in the imageSpec
    cost-tracker.js       per-step token usage + USD estimate (logged at run end)
    brainstorm-provider.js  BRAINSTORM_PROVIDER → { provider, model, maxTokens, getClient }
  steps/
    brainstorm.js         gpt-4o: topic + full page plan (exports validate)
    generate-content.js   Groq: Q&A per page (exports validateSchema); branches to hybrid-content.js when PAGE_RENDERER=hybrid
    hybrid-content.js     Groq: structured layout spec per page + validation/repair/fallback + structured recheck
    generate-pages.js     gpt-image-2 + validate + reconcile; answer keys via template (exports buildPrompt)
    validate-page.js      gpt-4o-mini vision QA
    reconcile-content.js  gpt-4o-mini vision: fix answers vs image
    generate-marketing-slides.js  gpt-image-2 cover + 2 template slides + logo composite
    convert-pdf.js        pdf-lib: per-page + combined + preview PDFs
    upload-drive.js       Drive: folder + PNG/PDF/metadata/listing
    topic-history.js      Supabase read/write
    notify-telegram.js    Telegram cover photo + MarkdownV2 caption
    schema/worksheet-plan.js  brainstorm tool-call JSON schema
test/                     vitest unit tests for the pure-logic surface; goldens/ (layout thumbnails), fixtures/layout-samples.js, helpers/
assets/fonts/             bundled Nunito TTFs + OFL.txt + fonts.conf
eval/                     live eval cases (cases.json) + fixture images from real runs; run by scripts/eval.js
```

## Environment Variables

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | brainstorm, generate-pages, validate-page, reconcile-content, generate-marketing-slides — not needed with `PAGE_RENDERER=hybrid-only` |
| `GROQ_API_KEY` | generate-content (content + Q&A recheck), market-check, brainstorm when `BRAINSTORM_PROVIDER=groq` |
| `BRAINSTORM_PROVIDER` | brainstorm — `openai` (default/unset, gpt-4o) or `groq` (openai/gpt-oss-120b, free); unknown → openai + warning |
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
| `COVER_RENDERER` | generate-pages — `hybrid` = FLUX illustration + code-drawn cover text (needs the two Cloudflare vars); anything else/empty = gpt-image-2 cover |
| `PAGE_RENDERER` | generate-content + generate-pages — `hybrid` = Groq writes structured layout specs (no imageSpec) and worksheet/activity pages are code-drawn + FLUX spots (pages without a valid layout fall back to legacy content → classifier or gpt-image-2); `hybrid-only` = zero-OpenAI run (every page, the cover and the marketing cover by code + FLUX, brainstorm on Groq, no vision QA; `openai()` throws); unset/empty/`openai` = imageSpec content + gpt-image-2 (default, unchanged); unknown → openai + warning |
| `ILLUSTRATION_CONCURRENCY` | generate-pages (hybrid pages) — concurrent FLUX calls (default: `2`) |
| `CLOUDFLARE_ACCOUNT_ID` | flux.js — Cloudflare account for Workers AI (hybrid cover / pages) |
| `CLOUDFLARE_API_TOKEN` | flux.js — Workers AI API token (hybrid cover / pages) |
| `MARKET_CHECK` | run-pipeline — `auto` (default/unset: search on `MARKET_CHECK_SEARCH_DAY`, light otherwise) \| `search` \| `light` \| `off`; unknown → auto + warning |
| `MARKET_CHECK_SEARCH_DAY` | run-pipeline — UTC weekday (0=Sun … 6=Sat, default `1`) on which `auto` runs the browser_search check |
| `RECHECK_CONCURRENCY` | generate-content — Q&A recheck chunks in parallel (default: `1`; raise only on a paid Groq tier) |
| `MATCHING_SELF_CHECK` | hybrid-content (`PAGE_RENDERER=hybrid`) — `off` skips the extra Groq ambiguity check per matching page (default: on) |
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

**Groq-only mode (no OpenAI credits):** `npm run eval -- recheck` runs only the Q&A recheck suite (Groq); the `validator` suite needs OpenAI vision. For the hybrid content step (`hybrid-content.js` prompt/schema/validators) run `npm run eval:hybrid` (`scripts/eval-hybrid.js`, plans in `eval/hybrid-plans.js`): per layout first-pass validity, retries, picture-dependence rejects, ambiguity rejects (+ matching self-check count/tokens), fallbacks, tokens/call, 429/400s, wall time. Free, but ~120k Groq tokens at the default 6 plans × 3 runs — Groq's free tier caps gpt-oss-120b at 200k tokens/day (TPD, a 429 that retrying cannot fix), shared with the daily run, so prefer `EVAL_RUNS=1` / `EVAL_PLANS` and never run it near the cron. `EVAL_RUNS`, `EVAL_PLANS=0,3`, `EVAL_RECHECK=1`, and a dir argument saves each run's content JSON.

The eval calls live models (~$0.11 at 3 runs, ~$0.18 at 5) and needs `OPENAI_API_KEY` + `GROQ_API_KEY` in `.env`; it is not part of `npm test` or CI.

## Local Testing

```bash
cp .env.example .env   # fill all values
npm install
npm test                            # unit tests (no API keys needed)
npm run test:plan                   # dry-run: brainstorm + content only
npm run eval                        # live LLM regression eval (~$0.11; run before changing a prompt)
npm run eval:hybrid                 # Groq-only eval of the hybrid content step (free; ~120k of the 200k/day Groq tokens)
npm run render:samples              # one PNG per hybrid layout → samples-out/ (stub art; --flux for live FLUX, free)
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

## TPT Listing

How to create or fix a TPT product from a set — static answers (format, tax code, subject-area rules), per-field mapping from `tpt-listing.txt`, upload limits and form quirks — lives in **[docs/tpt-listing.md](docs/tpt-listing.md)**. Keep it as the single place for that; do not repeat the field table here.
