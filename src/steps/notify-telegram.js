import { escapeMarkdownV2 as e } from '../lib/markdown.js'

/**
 * Post the cover + caption, then (if `reviewText` is given) a plain-text review
 * summary. The review goes to TELEGRAM_REVIEW_CHAT_ID when set, so a public
 * channel can get the announcement while QA notes go to a private chat.
 */
export async function notifyTelegram(plan, coverBuffer, folderLink, reviewText) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHANNEL_ID
  const caption = buildCaption(plan, folderLink)

  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('photo', new Blob([coverBuffer], { type: 'image/png' }), 'cover.png')
  form.append('caption', caption)
  form.append('parse_mode', 'MarkdownV2')

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${body}`)
  }

  if (!reviewText) return
  const reviewRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID || chatId,
      text: reviewText,
      disable_web_page_preview: true,
    }),
  })
  if (!reviewRes.ok) {
    const body = await reviewRes.text()
    throw new Error(`Telegram review sendMessage failed: ${reviewRes.status} ${body}`)
  }
}

/**
 * Build the Telegram channel caption in MarkdownV2. All dynamic values and literal
 * special characters are escaped per the V2 spec. Exported for unit testing.
 */
export function buildCaption(plan, folderLink) {
  const { setTitle, gradeLevel, subject, pageCount, tptListing } = plan
  const keywords = tptListing.keywords.slice(0, 5).join(', ')
  const price = tptListing.suggestedPrice.toFixed(2)
  return [
    `✅ *${e(setTitle)}*`,
    `📚 ${e(gradeLevel)} \\| ${e(subject)}`,
    `📄 ${pageCount} pages \\(incl\\. answer key\\)`,
    `💰 Suggested: $${e(price)}`,
    `🔑 ${e(keywords)}`,
    `📁 [Open in Drive](${folderLink})`,
  ].join('\n')
}
