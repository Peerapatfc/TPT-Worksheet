// Registry of hybrid page layouts: renderer + what illustration each needs.
//   art 'spot'    one decorative FLUX vignette, placed by compose (band/float) or dropped
//   art 'large'   one big FLUX picture the layout is built around (labeling)
//   art 'lineart' one full-page FLUX colouring picture (activity_art)
//   art 'none'    drawn entirely by code (shapes)
// Every renderer is pure: (plan, page, spec, { art }) → { svg, boxes, meta }, and
// throws LayoutOverflowError when the content cannot fit (caller falls back).
import { questionsPageSvg, fillBlankPageSvg } from './worksheet.js'
import { multipleChoicePageSvg } from './choice.js'
import { matchingPageSvg } from './matching.js'
import { sortingPageSvg } from './sorting.js'
import { labelingPageSvg } from './labeling.js'
import { tableFillPageSvg } from './table.js'
import { shapesPageSvg } from './shapes.js'
import { activityArtPageSvg } from './activity.js'

export const LAYOUT_REGISTRY = {
  questions: { art: 'spot', render: (plan, pg, _spec, opts) => questionsPageSvg(plan, pg, opts) },
  fill_blank: { art: 'spot', render: (plan, pg, spec, opts) => fillBlankPageSvg(plan, pg, { ...opts, wordBank: spec?.wordBank ?? [] }) },
  multiple_choice: { art: 'spot', render: multipleChoicePageSvg },
  matching: { art: 'spot', render: matchingPageSvg },
  sorting: { art: 'spot', render: sortingPageSvg },
  labeling: { art: 'large', render: labelingPageSvg },
  table_fill: { art: 'spot', render: tableFillPageSvg },
  shapes: { art: 'none', render: (plan, pg, spec) => shapesPageSvg(plan, pg, spec) },
  activity_art: { art: 'lineart', render: activityArtPageSvg },
}

/** Render a layout. Pure. */
export function renderLayout(layout, plan, pg, spec, { art = null } = {}) {
  const entry = LAYOUT_REGISTRY[layout]
  if (!entry) throw new Error(`unknown hybrid layout ${layout}`)
  return entry.render(plan, pg, spec, { art })
}
