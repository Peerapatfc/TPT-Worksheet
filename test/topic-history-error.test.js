import { describe, it, expect } from 'vitest'
import { describeSupabaseError } from '../src/steps/topic-history.js'

describe('describeSupabaseError', () => {
  it('surfaces the network cause hidden in details', () => {
    const error = {
      message: 'TypeError: fetch failed',
      details: 'TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND abc.supabase.co (ENOTFOUND)\nError: getaddrinfo ...\n    at stack',
      hint: '',
      code: '',
    }
    expect(describeSupabaseError(error, { status: 0, url: 'https://abc.supabase.co' }))
      .toBe('TypeError: fetch failed | cause: Error: getaddrinfo ENOTFOUND abc.supabase.co (ENOTFOUND) | host: abc.supabase.co')
  })

  it('includes code, hint and HTTP status for server-side errors', () => {
    const error = { message: 'relation "topic_history" does not exist', details: null, hint: 'Create the table', code: '42P01' }
    expect(describeSupabaseError(error, { status: 404, url: 'https://abc.supabase.co' }))
      .toBe('relation "topic_history" does not exist | code: 42P01 | hint: Create the table | HTTP 404 | host: abc.supabase.co')
  })

  it('flags a missing or malformed SUPABASE_URL', () => {
    expect(describeSupabaseError({ message: 'x' }, {})).toContain('host: SUPABASE_URL not set')
    expect(describeSupabaseError({ message: 'x' }, { url: 'not a url' })).toContain('host: invalid SUPABASE_URL')
  })
})
