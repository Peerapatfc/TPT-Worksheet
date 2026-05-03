export async function notifyTelegram(plan, coverBuffer, folderLink) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHANNEL_ID
  const caption = buildCaption(plan, folderLink)

  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('photo', new Blob([coverBuffer], { type: 'image/png' }), 'cover.png')
  form.append('caption', caption)
  form.append('parse_mode', 'Markdown')

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${body}`)
  }
}

function buildCaption(plan, folderLink) {
  const { setTitle, gradeLevel, subject, pageCount, tptListing } = plan
  const keywords = tptListing.keywords.slice(0, 5).join(', ')
  const price = tptListing.suggestedPrice.toFixed(2)
  return [
    `✅ *${escapeMarkdown(setTitle)}*`,
    `📚 ${gradeLevel} | ${subject}`,
    `📄 ${pageCount} pages \\(incl\\. answer key\\)`,
    `💰 Suggested: \\$${price}`,
    `🔑 ${escapeMarkdown(keywords)}`,
    `📁 [Open in Drive](${folderLink})`,
  ].join('\n')
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
}
