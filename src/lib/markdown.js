// Telegram MarkdownV2 escaping.
// V2 requires escaping these characters anywhere they appear literally:
//   _ * [ ] ( ) ~ ` > # + - = | { } . ! \
const V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g

/**
 * Escape a string for Telegram MarkdownV2.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdownV2(text) {
  return String(text).replace(V2_SPECIAL, '\\$&')
}
