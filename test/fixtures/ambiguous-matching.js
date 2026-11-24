// Regression fixture: a Grade 4 solar-system matching page from a hybrid render where
// "Has a system of rings" was keyed to Saturn only — Jupiter, Uranus and Neptune have
// rings too, so a student could be right and marked wrong.
export const solarPlan = { setTitle: 'Our Solar System', gradeLevel: 'Grade 4', subject: 'Science', packageType: 'small', themeColor: '#1E3A8A', pageCount: 12 }

const base = [
  ['Mercury', 'Closest planet to the Sun'],
  ['Venus', 'Hottest planet in our solar system'],
  ['Earth', 'Only planet known to have life'],
  ['Mars', 'Called the Red Planet'],
  ['Jupiter', 'Largest planet in our solar system'],
  ['Saturn', 'Has a system of rings'],
  ['Uranus', 'Spins on its side'],
  ['Neptune', 'Farthest planet from the Sun'],
]
const pairs = (saturn) => base.map(([term, match]) => ({ term, match: term === 'Saturn' ? saturn : match }))

/** The page as Groq returned it (the blocklisted "Has a system of rings"). */
export const ringsPage = { pageNum: 6, title: 'Planet Match', layout: 'matching', illustrationSubject: 'a ringed planet with stars', pairs: pairs('Has a system of rings'), questions: null, chart: null }
/** The same ambiguity worded so no code rule catches it — only the self-check can. */
export const ringsPageReworded = { ...ringsPage, pairs: pairs('Has beautiful rings made of ice and rock') }
/** A fixed page: every meaning true of exactly one planet. */
export const fixedPage = { ...ringsPage, pairs: pairs('Planet with the largest, brightest ring system') }

/** Planets with rings: what a careful solver says the rings meaning fits. */
export const RINGED = ['Jupiter', 'Saturn', 'Uranus', 'Neptune']
