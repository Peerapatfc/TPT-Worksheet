// Sample pages for every hybrid layout (adapted from real sets in logs/content-*.json).
// Used by the layout tests, the golden images and scripts/render-samples.js.
// `art`: 'spot' | 'large' | 'lineart' | 'none' — which illustration the sample asks for.
export const plans = {
  space: { setTitle: 'Exploring the Solar System', gradeLevel: 'Grade 4', subject: 'Science', themeColor: '#5B2C83', pageCount: 18 },
  leaves: { setTitle: 'Autumn Leaf Geometry Worksheets', gradeLevel: 'Grade 3', subject: 'Math', themeColor: '#C2410C', pageCount: 16 },
  cvc: { setTitle: 'CVC Word Families Worksheets', gradeLevel: 'Kindergarten', subject: 'ELA', themeColor: '#2E86C1', pageCount: 13 },
  plants: { setTitle: 'Spring Plant Parts', gradeLevel: 'Grade 2', subject: 'Science', themeColor: '#2E7D32', pageCount: 15 },
}

const pg = (pageNum, title, extra = {}) => ({ pageNum, type: 'worksheet', filename: title.toLowerCase().replace(/\W+/g, '-'), content: { title }, ...extra })

export const samples = [
  {
    name: 'multiple-choice', layout: 'multiple_choice', plan: plans.space,
    page: pg(4, 'Planet Quiz', { imagePrompt: 'A quiz page decorated with a friendly cartoon rocket ship.' }),
    spec: { questions: [
      { num: 1, question: 'Which planet is closest to the Sun?', options: ['Venus', 'Mercury', 'Mars', 'Earth'], answer: 'B' },
      { num: 2, question: 'Which planet is famous for its bright rings?', options: ['Saturn', 'Jupiter', 'Neptune', 'Uranus'], answer: 'Saturn' },
      { num: 3, question: 'What do we call the time it takes Earth to travel once around the Sun?', options: ['A day', 'A month', 'A year', 'A week'], answer: 'C' },
      { num: 4, question: 'Which gas in the thick atmosphere of Venus traps heat and makes it the hottest planet?', options: ['Oxygen', 'Carbon dioxide', 'Helium', 'Nitrogen'], answer: 'B' },
      { num: 5, question: 'The Moon shines because it…', options: ['makes its own light', 'reflects light from the Sun'], answer: 'reflects light from the Sun' },
    ] },
  },
  {
    name: 'matching', layout: 'matching', plan: plans.leaves,
    page: pg(5, 'Leaf Words', { imagePrompt: 'A matching page decorated with colourful autumn maple and oak leaves.' }),
    spec: { pairs: [
      { term: 'Vein', match: 'A line that carries water and food through the leaf' },
      { term: 'Margin', match: 'The outside edge of a leaf' },
      { term: 'Lobe', match: 'A rounded part that sticks out from the leaf' },
      { term: 'Petiole', match: 'The small stalk that joins the leaf to the stem' },
      { term: 'Symmetry', match: 'When one half of a shape matches the other half' },
      { term: 'Blade', match: 'The wide, flat part of the leaf' },
    ] },
  },
  {
    name: 'sorting', layout: 'sorting', plan: plans.cvc,
    page: pg(6, 'Sort the Word Families', { imagePrompt: 'A sorting page decorated with a cartoon cat and a frog on a log.' }),
    spec: {
      categories: ['-at family', '-og family', '-ip family'],
      items: [
        { word: 'cat', category: '-at family' }, { word: 'hat', category: '-at family' }, { word: 'bat', category: '-at family' },
        { word: 'dog', category: '-og family' }, { word: 'log', category: '-og family' }, { word: 'frog', category: '-og family' },
        { word: 'ship', category: '-ip family' }, { word: 'lip', category: '-ip family' }, { word: 'zip', category: '-ip family' },
      ],
    },
  },
  {
    name: 'labeling', layout: 'labeling', plan: plans.plants,
    page: pg(7, 'Parts of a Plant'),
    spec: { subject: 'a sunflower plant growing in soil with roots, stem and leaves', labels: [
      { word: 'roots', clue: 'They hold the plant in the soil and drink up water.' },
      { word: 'stem', clue: 'It holds the plant up and carries water to the leaves.' },
      { word: 'leaf', clue: 'It uses sunlight to make food for the plant.' },
      { word: 'flower', clue: 'Its bright petals invite bees to visit.' },
      { word: 'seeds', clue: 'New plants can grow from these.' },
    ] },
  },
  {
    name: 'table-fill', layout: 'table_fill', plan: plans.leaves,
    page: pg(8, 'Measure the Leaves', { imagePrompt: 'A table page decorated with a ruler and a pile of autumn leaves.' }),
    spec: {
      columns: ['Leaf', 'Length (cm)', 'Width (cm)', 'Length + Width'],
      rows: [
        ['Maple', '7', '5', { answer: '12' }],
        ['Oak', '6', '4', { answer: '10' }],
        ['Birch', '5', { answer: '3' }, '8'],
        ['Heart', { answer: '4' }, '3', '7'],
      ],
      questions: [
        { num: 1, question: 'Which leaf is the longest?', answer: 'Maple' },
        { num: 2, question: 'How much longer is the Maple leaf than the Birch leaf?', answer: '2 cm' },
      ],
    },
  },
  {
    name: 'shapes', layout: 'shapes', plan: plans.leaves,
    page: pg(9, 'Fractions and Shapes'),
    spec: { items: [
      { kind: 'fraction', shape: 'circle', parts: 4, shaded: 3, ask: 'name' },
      { kind: 'fraction', shape: 'rectangle', parts: 6, shaded: 2, ask: 'name' },
      { kind: 'fraction', shape: 'bar', parts: 5, shaded: 2, ask: 'shade' },
      { kind: 'count', icon: 'star', count: 13 },
      { kind: 'polygon', shape: 'hexagon', ask: 'sides' },
      { kind: 'polygon', shape: 'triangle', ask: 'name' },
    ] },
  },
  {
    name: 'activity-art', layout: 'activity_art', plan: plans.space,
    page: { ...pg(10, 'Colour the Astronaut'), type: 'activity' },
    spec: { subject: 'a smiling astronaut floating next to a rocket and a planet with rings', instruction: 'Colour the picture. Use at least four different colours.', tasks: ['Colour the planet\'s rings yellow.', 'Draw two more stars in the sky.'] },
  },
]
