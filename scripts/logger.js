import { mkdirSync, appendFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = join(__dirname, '..', 'logs', 'pipeline-run.json')

export function appendLog(entry) {
  const line = JSON.stringify({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() })
  console.log(line)
  try {
    mkdirSync(join(__dirname, '..', 'logs'), { recursive: true })
    appendFileSync(LOG_PATH, line + '\n')
  } catch {
    // non-fatal
  }
}
