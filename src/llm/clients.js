import OpenAI from 'openai'
import { isHybridOnly } from '../config/renderer.js'

// Lazy singletons so the API keys are read from the environment at first use
// (after dotenv has loaded), not at module-import time.
let _openai
let _groq

/**
 * OpenAI client (reads OPENAI_API_KEY from env). Used for brainstorm, vision QA, and images.
 * Hard guard: with PAGE_RENDERER=hybrid-only (zero-OpenAI mode) it throws instead of
 * constructing a client, so a code path that would spend OpenAI credits fails loudly.
 */
export function openai(env = process.env) {
  if (isHybridOnly(env)) {
    throw new Error('OpenAI client requested in PAGE_RENDERER=hybrid-only mode (zero-OpenAI run) — this code path must not call OpenAI')
  }
  return (_openai ??= new OpenAI())
}

/** True once openai() has constructed a client in this process (for tests). */
export const openaiConstructed = () => _openai !== undefined

/** Groq client (OpenAI-compatible endpoint). Used for text content generation. */
export function groq() {
  return (_groq ??= new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
  }))
}
