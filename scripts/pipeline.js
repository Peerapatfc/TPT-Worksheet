// Entry point — invoked by CI as `node scripts/pipeline.js`.
// Orchestration lives in src/run-pipeline.js.
import 'dotenv/config'
import { runPipeline } from '../src/run-pipeline.js'
import { appendLog } from '../src/lib/logger.js'

runPipeline().catch(err => {
  appendLog({ step: 'fatal', status: 'error', error: err.message, timestamp: new Date().toISOString() })
  console.error(err)
  process.exit(1)
})
