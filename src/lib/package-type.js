/**
 * Decide the package tier for a given weekday from the configured trigger days.
 * Pure and fully testable — no env or Date access.
 *
 * Free takes priority over large when both land on the same day.
 *
 * @param {{ day: number, freeDay: number, largeDay?: number }} args
 *   day: 0=Sun … 6=Sat; largeDay omitted/<0 disables the large tier
 * @returns {'free'|'large'|'small'}
 */
export function resolvePackageType({ day, freeDay, largeDay = -1 }) {
  if (day === freeDay) return 'free'
  if (largeDay >= 0 && day === largeDay) return 'large'
  return 'small'
}

/**
 * Resolve the package tier from the current date and environment variables.
 * @param {Date} [now]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'free'|'large'|'small'}
 */
export function getPackageType(now = new Date(), env = process.env) {
  const freeDay = parseInt(env.FREE_WORKSHEET_DAY ?? '0', 10)
  const largeDay = env.LARGE_PACKAGE_DAY != null ? parseInt(env.LARGE_PACKAGE_DAY, 10) : -1
  return resolvePackageType({ day: now.getDay(), freeDay, largeDay })
}
