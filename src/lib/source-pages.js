/**
 * Resolve the worksheet questions an answer-key page is responsible for.
 *
 * Prefers the explicit `sourcePageNums` array (with a legacy `sourcePageNum`
 * single-value fallback). If no valid source pages resolve, falls back to every
 * question in the set so the answer key is never left empty.
 *
 * @param {object} page       an answer_key page ({ sourcePageNums?, sourcePageNum? })
 * @param {Array<object>} allPages  the full plan.pages array
 * @returns {{ nums: number[], questions: Array<{ num:number, question:string, answer:string }> }}
 */
export function resolveSourceQuestions(page, allPages = []) {
  const nums = page.sourcePageNums ?? (page.sourcePageNum ? [page.sourcePageNum] : [])
  const sourcePages = nums.map(n => allPages.find(p => p.pageNum === n)).filter(Boolean)
  const questions = sourcePages.length > 0
    ? sourcePages.flatMap(p => p.content?.questions ?? [])
    : allPages.filter(p => p.content?.questions?.length > 0).flatMap(p => p.content.questions)
  return { nums, questions }
}
