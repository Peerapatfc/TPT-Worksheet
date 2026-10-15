# Listing a set on TPT

The single reference for creating (or fixing) a TPT product from a pipeline set. Used by hand and by the
daily review task (Claude in Chrome). Everything below was done on real listings on 2026-10-14/15 unless
it is under **Not tested**. The form can change; if a label here no longer matches, trust the page.

Inputs come from the set's Drive folder: `tpt-listing.txt` (title, description, keywords, price, subject
areas, tags, duration, standards), the color set PDF (`{slug}-complete-set-color.pdf`), `{slug}-preview.pdf`
and `marketing-cover.png` / `marketing-whats-included.png` / `marketing-benefits.png`.

## Rules for an automated run

- Ask the user in chat before clicking **Submit** — it publishes a product — and ask whether the listing
  should be Active or a draft.
- If TPT shows a login page (the session expires mid-run), the user logs in; never type or look for
  passwords and never bypass captchas.
- Check `My-Products` first so a set is not listed twice.

## Static answers (same for every set)

| Field | Value |
|-------|-------|
| Product type | Digital Download (`My-Products/New-Item` → "Digital Download") |
| Format | `PDF` + `Image` |
| Tax Code | `Digital books sold to an end user with rights for permanent use` (pick it **before** the prices, see below) |
| Subject Area | Leaf nodes only — category headers (Art, English Language Arts, Math, Science, Social Studies, …) are not selectable. Seen so far: Arithmetic, Basic Operations, Biology, Environment, U.S. History |
| Answer Key | Included |
| Copyright | Leave the default attestation ("original work") as is |

## Per-set fields (from `tpt-listing.txt`)

- **Title** — as written (pattern `{Topic} {Type} | {Grade} | No Prep …`, under 80 chars).
- **Description** — the description text, then a blank line (Enter, Enter) and a short "What's Included" list
  with `•` bullets (page counts, answer key pages, question count). Plain text; the editor is a rich-text box.
- **Price** — the suggested price; used so far: $3.00 (13–19 pages) and $3.50 (18 pages).
- **Multiple Licenses** — TPT overwrites it whenever other price/tax fields change (it set 2.70 for $3.00
  and 3.15 for $3.50). Set it **after** the tax code, then re-check right before Submit. Used: price − $0.50.
- **Grade Level** — up to four; judge by the actual content difficulty, not just the pipeline's grade.
- **Subject Area** — up to three leaves; **Tags** — up to six (from `TPT_TAGS` in
  `src/config/tpt-taxonomy.js`; e.g. Autumn/Halloween under Theme → Seasonal, Worksheets, Activities,
  Independent Work Packet, Homework).
- **Teaching Duration** — nearest option (45 Minutes, 1 Hour, …). **Number of Pages** — total pages.
- **Education Standards** — only when `tpt-listing.txt` lists codes. Math/ELA → "Select CCSS": tab (Math)
  → grade (the select lists `Kindergarten`, `1` … `12`) → domain → tick each code → Done. Science →
  "Select NGSS": grade, then the domain the code belongs to (e.g. `3-LS2-1` Ecosystems, `3-LS1-1` From
  Molecules to Organisms, `3-LS4-3` Biological Evolution). Other subjects: leave empty; the description
  must then not claim alignment (the pipeline strips those claims).

## Files and thumbnails

- **Downloadable file** — upload the color set. The pipeline now embeds JPEG, so it is ~4 MB. The browser
  upload tool takes about 10 MB **per call**: upload the file and the preview in separate calls, and for an
  older or very long set over ~9 MB build a smaller JPEG-embedded copy. The file name is shown to buyers —
  keep the Drive name (`{slug}-complete-set.pdf`, without `-color`).
- **Product Previews** — `{slug}-preview.pdf` (cover + 3 pages, PREVIEW watermark).
- **Thumbnails** — choose **Upload thumbnails now**, then upload `marketing-cover.png` as Main Cover and the
  other two as optional thumbnails (≤ 4 MB each). Find the real `type=file` inputs with the page's find/read
  tools; clicking the slot labels does not work. "Auto generate" previews plain page crops from the PDF (not used for any listing so far).
- Wait for every progress bar to finish before Submit. If an upload call reports a lost connection, look at
  the page first — it may have worked; retry once, with a smaller file if it was the preview/PDF.

## Form quirks

- **Format dropdown**: type `Image`, click the option, then press Escape and click an empty area. Extra
  clicks while the list is open add unwanted formats (a stray "Prezi" was added once).
- **Subject/Tag boxes**: type to filter, click the option; the list closes after each pick.
- **Coordinates shift** when the viewport size changes between runs — locate fields by label/ref, not by
  remembered pixels.
- **Product Status**: "Make Listing Active" is ticked by default. Un-tick it to save a draft. The first
  activation emails followers who opted in; new products can take up to an hour to show in the store.

## After Submit

Open the product page TPT redirects to and confirm title, price, grade, subject, page count, answer key and
the three thumbnails. To fix a live listing: `My-Products` → Edit (`/itemsDigital/editNext/<id>`); to
replace the file click its ✖ and upload again. "Notify Buyers" (edit only) messages people who already
bought — leave it off unless the user says so.

## Not tested

- The "Google Drive" product type (`My-Products/New/Online-Resource`) — it was opened once and abandoned;
  whether it accepts the TPT-folder PDFs has not been checked.
- Whether TPT requires an AI-generated-content disclosure — no such field appeared in the form, but check
  TPT's current policy.
- The `Printables` tag (the pipeline requires it; the listings so far used other valid tags).
- Large (21+ page) sets — expected size ~7–9 MB.
