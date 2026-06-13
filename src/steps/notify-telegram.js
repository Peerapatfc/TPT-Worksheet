import { escapeMarkdownV2 as e } from '../lib/markdown.js'

export async function notifyTelegram(plan, coverBuffer, folderLink) {
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
