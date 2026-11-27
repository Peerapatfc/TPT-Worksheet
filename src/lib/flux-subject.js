// Text-free FLUX subjects, shared by the cover (hybrid-cover.js) and the page
// illustrations (illustrations.js). FLUX.1 schnell largely ignores "no text": asked
// for "a chalkboard with fractions" it wrote "2₄ = 2", and a page whose subject was
// "identifying equivalent multiple choice themed objects" got an "=" sign and
// "(1remiting = equivalcet". So the subject itself must not invite writing: math
// notation is removed, and things that carry writing (boards, signs, books, clocks,
// rulers, cards, number lines…) are dropped from the subject.

/** The no-text directive put before and after every FLUX subject. */
export const NO_TEXT = 'no text, no letters, no numbers, no equations, no writing, no chalkboard writing, no signs, no labels, no symbols'

// Objects that FLUX draws with writing, digits or symbols on them.
const WRITING_OBJECTS = [
  '(?:chalk|black|white|dry[- ]erase|bulletin|message|score)\\s?boards?', 'boards?', 'easels?', 'slates?',
  'signs?', 'signposts?', 'posters?', 'banners?', 'labels?', 'tags?', 'stickers?', 'badges?',
  'flash\\s?cards?', 'cards?', 'calendars?', 'clocks?', 'watch(?:es)?', 'rulers?', 'tape measures?', 'scales? with numbers',
  'number lines?', 'equations?', 'formulas?', 'math problems?', 'sums?', 'numbers?', 'numerals?', 'digits?',
  'letters?', 'alphabet(?: blocks)?', 'words?', 'text', 'writing', 'handwriting', 'notes?', 'notebooks?', 'papers?',
  'worksheets?', 'pages?', '(?:open |story |text|picture )?books?', 'charts?', 'graphs?', 'tables? of', 'diagrams?', 'maps?',
  'screens?', 'computers?', 'tablets?', 'laptops?', 'fraction (?:tiles|strips|bars|cards|circles|walls?)', 'symbols?',
]
const LEADIN = '(?:\\b(?:on|at|in front of|beside|next to|near|with|holding|reading|writing|and|or|plus)\\s+)?'
const ARTICLE = '(?:\\b(?:a|an|the|some|two|three|four|many|several)\\s+)?'
const TRAIL = '(?:\\s+(?:with|showing|of|that shows|displaying|covered (?:in|with)|full of|reading|that reads|labell?ed)\\b[^,.;:!?]*)?'
// Up to 2 adjectives ("a big green chalkboard"), never a verb or lead-in word, so
// "children holding signs" keeps "children".
const ADJ = '(?:(?![\\p{L}-]+ing\\b|(?:on|at|in|with|and|or|plus|near|beside|of|the|a|an)\\b)[\\p{L}-]+\\s+){0,2}?'
const WRITING_RE = new RegExp(`${LEADIN}${ARTICLE}${ADJ}\\b(?:${WRITING_OBJECTS.join('|')})\\b${TRAIL}`, 'giu')
// Fractions, numbers and operators: "1/2", "2/4 = 1/2", "3 + 4", "½".
const MATH_RE = /\d+\s*\/\s*\d+|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+|[=+×÷<>%#*^]|\s-\s/g
// Quoted text is printed text.
const QUOTED_RE = /"[^"]*"|“[^”]*”|‘[^’]*’/g

const tidy = (s) => s
  .replace(/\(\s*\)/g, ' ')
  .replace(/\s+([,.;:!?])/g, '$1')
  .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
  .replace(/^(?:[\s,;:.\-–—]|\b(?:and|with|plus|or|of)\b)+|(?:[\s,;:\-–—]|\b(?:and|with|plus|or|of|a|an|the)\b)+$/gi, '')
  .replace(/\b(and|with|or)\s+(?:and|with|or)\b/gi, '$1')
  .replace(/\s{2,}/g, ' ')
  .trim()

/**
 * The subject with math notation, quoted text and writing-carrying objects removed.
 * Returns '' when nothing drawable (a word of 3+ letters) is left. Pure.
 */
export function textFreeSubject(subject) {
  let s = String(subject ?? '').replace(QUOTED_RE, ' ').replace(MATH_RE, ' ')
  s = s.replace(WRITING_RE, ' ')
  // Clean each sentence/clause so a removal never leaves "and ," fragments.
  s = s.split(/(?<=[.;])\s+/).map(tidy).filter(x => /[a-z]{3}/i.test(x)).join(' ')
  s = tidy(s)
  return /[a-z]{3}/i.test(s) ? s : ''
}

// Concrete, text-free objects for abstract (mostly math) topics, so a page titled
// "Equivalent Fraction Matching" gets pizza slices instead of random animals or an
// "=" sign. First match wins.
const TOPIC_OBJECTS = [
  [/\bfractions?\b|\bequivalen(?:t|ce)\b|\bhalves\b|\bquarters\b/i, 'a round pizza cut into equal slices, an orange cut into segments and a pie'],
  [/\bmoney\b|\bcoins?\b|\bdollars?\b|\bcents?\b/i, 'a pink piggy bank and a small coin purse'],
  [/\btime\b|\bclocks?\b|\bhours?\b|\bminutes?\b/i, 'a sand hourglass and an alarm bell'],
  [/\bmeasur\w*\b|\blength\b|\bweight\b|\bcapacity\b/i, 'a balance scale holding apples and a watering can'],
  [/\bgeometry\b|\bshapes?\b|\bpolygons?\b|\bsymmetry\b/i, 'colourful wooden building blocks: cubes, cones, cylinders and pyramids'],
  [/\bgraphs?\b|\bdata\b|\btally\b|\bpictographs?\b/i, 'baskets of colourful fruit'],
  [/\bplace value\b|\bmultiplication\b|\bdivision\b|\barrays?\b|\bgroups? of\b/i, 'rows of colourful wooden beads and stacked blocks'],
  [/\baddition\b|\bsubtraction\b|\badd(?:ing)?\b|\bsubtract(?:ing)?\b|\bcount(?:ing)?\b|\bnumbers?\b|\bmath\b|\bmaths\b/i, 'colourful apples, buttons and wooden blocks'],
]

/** A concrete text-free subject for an abstract topic, or null. Pure. */
export function topicObjects(...texts) {
  const t = texts.filter(Boolean).join(' ')
  return TOPIC_OBJECTS.find(([re]) => re.test(t))?.[1] ?? null
}
