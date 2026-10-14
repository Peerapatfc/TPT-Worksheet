// One-time local helper: obtain a Google OAuth2 refresh token for the Drive upload step.
// Usage: put GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env, then
//   node scripts/get-refresh-token.js
// Opens a consent URL, catches the redirect on a loopback port (Desktop-app OAuth
// client), exchanges the code, and prints the refresh token for the
// GOOGLE_OAUTH_REFRESH_TOKEN secret. Nothing is written to disk.
import dotenv from 'dotenv'
import http from 'http'
import { execFile } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { google } from 'googleapis'

// Load repo-root .env regardless of the shell's current directory.
const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
dotenv.config({ path: ENV_PATH, quiet: true })

// Full Drive scope: the pipeline writes into folders you created by hand
// (GOOGLE_DRIVE_FOLDER_ID / GOOGLE_DRIVE_TPT_FOLDER_ID), which drive.file cannot reach.
const SCOPES = ['https://www.googleapis.com/auth/drive']

// Unfilled .env.example values look like "<...>"; treat them as missing.
const envValue = (name) => {
  const v = process.env[name]?.trim()
  return v && !v.startsWith('<') ? v : null
}
const clientId = envValue('GOOGLE_OAUTH_CLIENT_ID')
const clientSecret = envValue('GOOGLE_OAUTH_CLIENT_SECRET')
if (!clientId || !clientSecret) {
  console.error(`Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in ${ENV_PATH}`)
  process.exit(1)
}

const server = http.createServer()
// Port 0 = any free port; Desktop-app clients accept any loopback port.
server.listen(0, '127.0.0.1', () => {
  const redirectUri = `http://127.0.0.1:${server.address().port}`
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always re-issue a refresh token, even if previously granted
    scope: SCOPES,
  })

  console.log('\nOpen this URL and sign in with the Google account that owns the Drive folders:\n')
  console.log(url + '\n')
  if (process.platform === 'darwin') execFile('open', [url])

  const timeout = setTimeout(() => fail('Timed out after 5 minutes waiting for authorization.'), 5 * 60_000)

  server.on('request', async (req, res) => {
    const params = new URL(req.url, redirectUri).searchParams
    if (!params.has('code') && !params.has('error')) {
      res.writeHead(404).end()
      return
    }
    clearTimeout(timeout)

    if (params.has('error')) {
      res.end('Authorization failed - see terminal.')
      fail(`Authorization failed: ${params.get('error')}`)
      return
    }

    try {
      const { tokens } = await auth.getToken(params.get('code'))
      if (!tokens.refresh_token) throw new Error('No refresh_token returned. Revoke the app at https://myaccount.google.com/permissions and retry.')

      auth.setCredentials(tokens)
      const { data } = await google.drive({ version: 'v3', auth }).about.get({ fields: 'user(emailAddress)' })

      res.end('Done - you can close this tab and return to the terminal.')
      console.log(`Authorized as: ${data.user.emailAddress}`)
      console.log('\nGOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token)
      console.log('\nPut this value in .env and in the GitHub Actions secret GOOGLE_OAUTH_REFRESH_TOKEN.')
      server.close()
    } catch (err) {
      res.end('Token exchange failed - see terminal.')
      fail(`Token exchange failed: ${err.response?.data?.error_description ?? err.message}`)
    }
  })
})

function fail(message) {
  console.error(message)
  server.close()
  process.exitCode = 1
}
