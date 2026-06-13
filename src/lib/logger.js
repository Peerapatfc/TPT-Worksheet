import { mkdirSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// src/lib/logger.js -> repo-root/logs (stable regardless of process cwd)
const LOGS_DIR = join(__dirname, '..', '..', 'logs')
const LOG_PATH = join(LOGS_DIR, 'pipeline-run.json')

/**
 * Append one structured JSON line to logs/pipeline-run.json and echo it to stdout.
 * File-write failures are swallowed (logging must never break the pipeline).
 *
 * @param {object} entry arbitrary structured fields; `timestamp` is added if absent
 */
export function appendLog(entry) {
  const line = JSON.stringify({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() })
  console.log(line)
  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    appendFileSync(LOG_PATH, line + '\n')
  } catch {
    // non-fatal — never let logging crash the run
  }
}
