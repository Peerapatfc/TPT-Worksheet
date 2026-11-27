// Realistic brainstorm plans (content pages only, imagePrompts in brainstorm's
// style) for the Groq-only hybrid content eval (scripts/eval-hybrid.js). K–5,
// math / ELA / science, covering every hybrid layout including a banned crossword
// request that must be converted.
const page = (pageNum, type, filename, imagePrompt) => ({ pageNum, type, filename, imagePrompt })

export const hybridPlans = [
  {
    setTitle: 'CVC Word Families Worksheets', gradeLevel: 'Kindergarten', subject: 'ELA', packageType: 'small', themeColor: '#2E86C1', pageCount: 13,
    pages: [
      page(2, 'worksheet', 'sort-word-families', 'A sorting page: students sort CVC words into -at, -an and -ig word family columns. Decorated with a cartoon cat and a pig.'),
      page(3, 'worksheet', 'match-cvc-words-to-meanings', 'A matching page: CVC words on the left, simple meanings on the right. Decorated with a friendly dog.'),
      page(4, 'worksheet', 'fill-in-the-missing-word', 'Fill-in-the-blank sentences using CVC words from a word bank. Decorated with a frog on a log.'),
      page(5, 'activity', 'color-the-cat', 'A coloring page of a big friendly cat sitting on a mat for students to color.'),
    ],
  },
  {
    setTitle: 'Counting and Shapes Fun', gradeLevel: 'Grade 1', subject: 'Math', packageType: 'small', themeColor: '#E8731C', pageCount: 12,
    pages: [
      page(2, 'worksheet', 'count-the-objects', 'Count the objects in each group and write the number. Groups of stars, hearts and circles.'),
      page(3, 'worksheet', 'shape-sides-and-corners', 'Shapes page: students write how many sides and corners each 2D shape has (triangle, square, hexagon, pentagon).'),
      page(4, 'worksheet', 'favorite-fruit-picture-graph', 'A picture graph of favorite fruits in a class with questions about the data.'),
      page(5, 'worksheet', 'one-more-ten-more-table', 'A table to complete: number, one more, ten more, one less.'),
      page(6, 'worksheet', 'addition-word-problems', 'Addition word problems within 20 about apples and pumpkins. Decorated with a basket of apples.'),
    ],
  },
  {
    setTitle: 'Spring Plant Life Cycle', gradeLevel: 'Grade 2', subject: 'Science', packageType: 'small', themeColor: '#2E7D32', pageCount: 15,
    pages: [
      page(2, 'worksheet', 'label-the-plant', 'Label the parts of a flowering plant: roots, stem, leaf, flower, seed. Large plant diagram in the center.'),
      page(3, 'worksheet', 'living-or-nonliving-sort', 'Sort pictures and words into Living and Nonliving columns.'),
      page(4, 'worksheet', 'plant-vocabulary-match', 'Match plant life cycle words (seed, sprout, seedling, pollen) to their meanings.'),
      page(5, 'worksheet', 'plant-needs-quiz', 'A multiple choice quiz about what plants need to grow. Decorated with a watering can and sun.'),
      page(6, 'activity', 'life-cycle-crossword', 'A crossword puzzle of plant life cycle vocabulary words.'),
    ],
  },
  {
    setTitle: 'Fraction Fun with Pizza', gradeLevel: 'Grade 3', subject: 'Math', packageType: 'small', themeColor: '#C0392B', pageCount: 16,
    pages: [
      page(2, 'worksheet', 'name-the-fraction', 'Name the fraction shown by the shaded parts of circles and rectangles.'),
      page(3, 'worksheet', 'shade-the-fraction', 'Shade the given fraction of each shape (1/2, 1/3, 3/4, 2/6).'),
      page(4, 'worksheet', 'pizza-fraction-word-problems', 'Fraction word problems about sharing pizzas equally among friends. Decorated with a cheesy pizza.'),
      page(5, 'worksheet', 'fraction-words-match', 'Match fractions written in numbers to fractions written in words (one half, two thirds...).'),
      page(6, 'worksheet', 'compare-fractions-quiz', 'Multiple choice: which fraction is greater? Compare fractions with the same denominator.'),
    ],
  },
  {
    setTitle: 'Exploring the Solar System', gradeLevel: 'Grade 4', subject: 'Science', packageType: 'large', themeColor: '#5B2C83', pageCount: 22,
    pages: [
      page(2, 'worksheet', 'inner-and-outer-planets-sort', 'Sort the eight planets into Inner Planets and Outer Planets.'),
      page(3, 'worksheet', 'planet-facts-match', 'Match each planet to a fact about it. Decorated with Saturn and its rings.'),
      page(4, 'worksheet', 'planet-data-table', 'Complete the table: planet, order from the Sun, type (rocky or gas giant).'),
      page(5, 'activity', 'label-the-earth-layers', 'Label the layers of the Earth: crust, mantle, outer core, inner core in a cut-away diagram.'),
      page(6, 'worksheet', 'solar-system-quiz', 'Solar system quiz with multiple choice and true or false questions.'),
    ],
  },
  {
    setTitle: 'Figurative Language Practice', gradeLevel: 'Grade 5', subject: 'ELA', packageType: 'small', themeColor: '#1B4F8A', pageCount: 16,
    pages: [
      page(2, 'worksheet', 'simile-or-metaphor-sort', 'Sort sentences into Simile and Metaphor columns.'),
      page(3, 'worksheet', 'figurative-language-terms-match', 'Match figurative language terms (simile, metaphor, personification, hyperbole, onomatopoeia) to definitions.'),
      page(4, 'worksheet', 'idioms-meaning', 'Write the meaning of each idiom (e.g. "break the ice"). Decorated with an ice cube character.'),
      page(5, 'worksheet', 'complete-the-simile', 'Complete each simile with a word from the word bank.'),
      page(6, 'worksheet', 'figurative-language-quiz', 'Multiple choice: identify the type of figurative language in each sentence.'),
    ],
  },
]
