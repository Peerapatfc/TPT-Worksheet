import { createClient } from '@supabase/supabase-js'

function getClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/**
 * One-line description of a Supabase error. When the request never reached the
 * server (paused project, wrong URL, DNS/TLS failure) supabase-js only says
 * "TypeError: fetch failed" in `message`; the real reason is on a
 * "Caused by: ..." line in `details`, so surface that plus code/hint/status/host.
 * Pure — exported for unit testing.
 */
export function describeSupabaseError(error, { status, url } = {}) {
  const cause = error?.details?.match(/^Caused by: (.+)$/m)?.[1]
  let host
  try { host = new URL(url).host } catch { host = url ? 'invalid SUPABASE_URL' : 'SUPABASE_URL not set' }
  return [
    error?.message ?? String(error),
    cause && `cause: ${cause}`,
    error?.code && `code: ${error.code}`,
    error?.hint && `hint: ${error.hint}`,
    status && `HTTP ${status}`,
    `host: ${host}`,
  ].filter(Boolean).join(' | ')
}

export async function readTopicHistory() {
  const supabase = getClient()
  const { data, error, status } = await supabase
    .from('topic_history')
    .select('set_title, subject, grade_level, keywords, date')
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) throw new Error(`Failed to read topic history: ${describeSupabaseError(error, { status, url: process.env.SUPABASE_URL })}`)

  return (data ?? []).map(row => ({
    setTitle: row.set_title,
    subject: row.subject,
    gradeLevel: row.grade_level,
    keywords: row.keywords ?? [],
    date: row.date,
  }))
}

export async function saveTopicEntry(entry) {
  const supabase = getClient()
  const { error, status } = await supabase.from('topic_history').insert({
    set_title: entry.setTitle,
    subject: entry.subject,
    grade_level: entry.gradeLevel,
    keywords: entry.keywords,
    date: entry.date,
    folder_id: entry.folderId,
  })

  if (error) throw new Error(`Failed to save topic history: ${describeSupabaseError(error, { status, url: process.env.SUPABASE_URL })}`)
}
