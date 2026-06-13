import OpenAI from 'openai'

// Lazy singletons so the API keys are read from the environment at first use
// (after dotenv has loaded), not at module-import time.
let _openai
let _groq

/** OpenAI client (reads OPENAI_API_KEY from env). Used for brainstorm, vision QA, and images. */
export function openai() {
  return (_openai ??= new OpenAI())
}

/** Groq client (OpenAI-compatible endpoint). Used for text content generation. */
export function groq() {
  return (_groq ??= new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
  }))
}
