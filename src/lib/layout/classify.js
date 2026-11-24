// Which P1 hybrid layout (if any) can render a page from today's content shape
// ({ imageSpec, questions[{num, question, answer}] }) without the picture the
// gpt-image-2 path would draw. Anything that needs a drawn picture, diagram,
// table, cut-out or matching columns returns { layout: null } and keeps the
// OpenAI renderer until the later layouts (P2) and structured content (P3) land.

// Questions that only make sense next to a drawn picture or activity layout.
const PICTURE_WORDS = /\b(pictures?|images?|illustrations?|shown|drawn|draw|drawing|colou?r(?:ed|ing)?|circle|cut|paste|glue|trace|match(?:ing)?|columns?|tables?|charts?|graphs?|diagrams?|labels?|labell?ed|shaded|shade|boxes|grid|maze|puzzle|map|section \d|look at|on the (?:page|left|right)|missing|below|above)\b/i
const ACTIVITY_VERB = /^\s*(?:draw|cut|colou?r|circle|trace|match|sort|label|paste|glue|connect|fill in the (?:boxes|chart|table))\b/i
const BLANK = /_{2,}/
const WORD_BANK = /\bword bank\b[^:]*:\s*([^\n.]+)/i
const MAX_BANK_WORD = 30

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Word bank listed in an imageSpec ("Word bank at bottom: lobe, vein, margin"), or null. Pure. */
export function parseWordBank(spec) {
  const m = String(spec ?? '').match(WORD_BANK)
  if (!m) return null
  const words = m[1].split(/[,;]|\s+\band\b\s+/).map(w => w.trim().replace(/^["“']|["”']$/g, '')).filter(Boolean)
  return words.length >= 2 ? words : null
}

/**
 * @returns {{ layout: 'questions'|'fill_blank'|null, reason?: string, wordBank?: string[] }}
 * Pure — exported for unit testing.
 */
export function classifyHybridLayout(page) {
  if (page?.type !== 'worksheet' && page?.type !== 'activity') return { layout: null, reason: `type ${page?.type}` }
  const qs = page.content?.questions ?? []
  if (!qs.length) return { layout: null, reason: 'no questions' }
  if (page.content?.chart) return { layout: null, reason: 'chart page' }
  if (qs.some(q => !String(q.question ?? '').trim() || String(q.answer ?? '').trim() === '')) return { layout: null, reason: 'empty question or answer' }
  const pictureQ = qs.find(q => PICTURE_WORDS.test(q.question) || ACTIVITY_VERB.test(q.question))
  if (pictureQ) return { layout: null, reason: `question ${pictureQ.num} needs a picture/activity layout` }

  const spec = String(page.content?.imageSpec ?? '').trim()
  const blanks = qs.filter(q => BLANK.test(q.question)).length
  if (blanks > 0 && blanks * 2 >= qs.length) {
    const answers = qs.map(q => String(q.answer).trim())
    let bank = spec ? parseWordBank(spec) : null
    if (spec && !bank) return { layout: null, reason: 'imageSpec has more than a word bank' }
    if (bank && !answers.every(a => bank.some(w => norm(w) === norm(a)))) return { layout: null, reason: 'answers not in word bank' }
    if (!bank && answers.every(a => a.length <= 20 && a.split(/\s+/).length <= 2)) {
      // Short single answers: print them as a bank (alphabetical, so order gives nothing away).
      bank = [...new Map(answers.map(a => [norm(a), a])).values()].sort((a, b) => a.localeCompare(b))
    }
    if (bank?.some(w => w.length > MAX_BANK_WORD)) return { layout: null, reason: 'word bank entry too long' }
    return { layout: 'fill_blank', wordBank: bank ?? [] }
  }
  if (spec) return { layout: null, reason: 'imageSpec present' }
  return { layout: 'questions' }
}
