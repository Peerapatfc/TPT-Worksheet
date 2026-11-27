// Raw hybrid pages shaped like the failures seen in live eval:hybrid runs
// (Gemini flash-lite fallback and Groq gpt-oss-120b, Nov 2026). The eval logs
// keep only the error lines, not the raw JSON, so these are reconstructed from
// those lines:
//   "p5 activity_art: task 2 depends on the picture: "Color the cat's collar blue""
//   "p4 chart: chart missing"
//   "p3 sorting: categories: 2–4 required; sort items: use only the categories  (spelled exactly)…"
//   "p2 sorting: items[1].category "Personification" is not one of the categories; items[2].word empty or longer than 30…"

export const activityArtCollar = {
  pageNum: 5,
  title: 'Color the Cat',
  layout: 'activity_art',
  illustrationSubject: 'a happy cat sitting on a mat',
  subject: 'a cat on a mat',
  instruction: 'Color the picture.',
  tasks: ['Write the word cat three times.', "Color the cat's collar blue", 'Count the spots on the cat.'],
}

const chartQuestions = [
  { num: 1, question: 'How many children chose apples?', answer: '5' },
  { num: 2, question: 'Which fruit was chosen the most?', answer: 'Apples' },
  { num: 3, question: 'How many children chose pears?', answer: '2' },
  { num: 4, question: 'How many more chose apples than pears?', answer: '3' },
]
const fruit = [{ label: 'Apples', value: 5 }, { label: 'Bananas', value: 3 }, { label: 'Pears', value: 2 }]

/** Chart pages whose chart did not arrive as a { type, categories: [{label, value}] } object. */
export const chartVariants = {
  // chart written as a JSON string (the schema allows string so a "" never fails the call)
  jsonString: { pageNum: 4, title: 'Favourite Fruit', layout: 'chart', chart: JSON.stringify({ type: 'bar', title: 'Favourite Fruit', categories: fruit }), questions: chartQuestions },
  // chart null, its data on the page itself
  lifted: { pageNum: 4, title: 'Favourite Fruit', layout: 'chart', chart: null, chartType: 'picture graph', icon: 'star', categories: ['Apples: 5', 'Bananas: 3', 'Pears: 2'], questions: chartQuestions },
  // type alias, { label: value } map, string values
  aliasMap: { pageNum: 4, title: 'Favourite Fruit', layout: 'chart', chart: { type: 'Bar Graph', categories: { Apples: '5', Bananas: '3', Pears: '2' } }, questions: chartQuestions },
  // no type, over the bar limit → inferred bar → drawn as a table by repairChart
  noTypeOverLimit: { pageNum: 4, title: 'Steps Walked', layout: 'chart', chart: { title: 'Steps', categories: [{ label: 'Mon', value: 40 }, { label: 'Tue', value: 55 }, { label: 'Wed', value: 30 }] }, questions: chartQuestions },
  // nothing at all: the observed "chart missing"
  missing: { pageNum: 4, title: 'Favourite Fruit', layout: 'chart', chart: null, questions: chartQuestions },
}
export const chartGood = { pageNum: 4, title: 'Favourite Fruit', layout: 'chart', chart: { type: 'pictograph', title: 'Favourite Fruit', icon: 'circle', categories: fruit }, questions: chartQuestions }

/** Spring Plant Life Cycle p3 (Gemini): heading list not a JSON list, item categories in other spellings. */
export const sortingPlantStringCats = {
  pageNum: 3,
  title: 'Sort the Life Cycle',
  layout: 'sorting',
  categories: 'Seed, Sprout, Flower',
  sortItems: [
    { word: 'tiny and hard', category: 'Seeds' },
    { word: 'buried in soil', category: 'seed' },
    { word: 'first green shoot', category: 'Sprouts' },
    { word: 'two small leaves', category: ' sprout ' },
    { word: 'bright petals', category: 'Flowers' },
    { word: 'visited by bees', category: 'FLOWER' },
  ],
}
/** Same page with no heading list at all (the "categories: 2–4 required" line). */
export const sortingPlantNoCats = { ...sortingPlantStringCats, categories: null }

/** Figurative Language p2 (Groq): unlisted categories and whole sentences as words. */
export const sortingFigurative = {
  pageNum: 2,
  title: 'Sort the Figurative Language',
  layout: 'sorting',
  categories: ['Simile', 'Metaphor'],
  sortItems: [
    { word: 'as busy as a bee', category: 'Similes' },
    { word: 'The wind whispered softly through the tall trees at night', category: 'Simile' },
    { word: 'time is money', category: 'metaphors' },
    { word: 'the leaves danced', category: 'Personification' },
    { word: 'as cold as ice', category: 'Simile' },
    { word: 'a night owl', category: 'Metaphor' },
    { word: 'like a rocket', category: 'simile' },
    { word: 'a heart of gold', category: 'Metaphor' },
    { word: 'buzz', category: 'Onomatopoeia' },
  ],
}
