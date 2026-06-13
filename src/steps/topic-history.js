import { createClient } from '@supabase/supabase-js'

function getClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

export async function readTopicHistory() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('topic_history')
    .select('set_title, subject, grade_level, keywords, date')
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) throw new Error(`Failed to read topic history: ${error.message}`)

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
  const { error } = await supabase.from('topic_history').insert({
    set_title: entry.setTitle,
    subject: entry.subject,
    grade_level: entry.gradeLevel,
    keywords: entry.keywords,
    date: entry.date,
    folder_id: entry.folderId,
  })

  if (error) throw new Error(`Failed to save topic history: ${error.message}`)
}
