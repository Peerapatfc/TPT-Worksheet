import { withRetry } from './with-retry.js'

/**
 * Force a single structured tool call and parse its JSON arguments.
 * Wraps the chat.completions request in retry/backoff and returns the raw
 * assistant message plus the parsed arguments (or nulls if no tool call came back).
 *
 * @param {import('openai').OpenAI} client
 * @param {{
 *   model: string,
 *   messages: Array<object>,
 *   tool: object,          // a single OpenAI tool definition ({ type:'function', function:{ name, ... } })
 *   maxTokens?: number,
 *   label?: string,
 * }} opts
 * @returns {Promise<{ message: object, toolCall: object|null, args: object|null }>}
 */
export async function callTool(client, { model, messages, tool, maxTokens, label = 'OpenAI' }) {
  const result = await withRetry(
    () => client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'function', function: { name: tool.function.name } },
      messages,
    }),
    { label },
  )

  const message = result.choices[0].message
  const toolCall = message.tool_calls?.[0]
  if (!toolCall) return { message, toolCall: null, args: null }
  return { message, toolCall, args: JSON.parse(toolCall.function.arguments) }
}
