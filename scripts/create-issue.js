import 'dotenv/config'

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, MAINTAINER_USERNAME } = process.env
const date = new Date().toISOString().split('T')[0]
const runUrl = `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`

const body = `## Worksheet Pipeline Failed

**Date:** ${date}
**Run:** [${GITHUB_RUN_ID}](${runUrl})

### Next Steps
- [ ] Check Actions log for error details
- [ ] Verify \`ANTHROPIC_API_KEY\` is valid
- [ ] Verify \`OPENAI_API_KEY\` is valid
- [ ] Verify \`GOOGLE_SERVICE_ACCOUNT_KEY\` is valid JSON
- [ ] Verify \`TELEGRAM_BOT_TOKEN\` / \`TELEGRAM_CHANNEL_ID\`
- [ ] Re-run via workflow_dispatch once fixed

/cc @${MAINTAINER_USERNAME}`

const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: JSON.stringify({
    title: `Worksheet pipeline failed – ${date}`,
    body,
    labels: ['pipeline-failure', 'automated'],
    assignees: [MAINTAINER_USERNAME].filter(Boolean),
  }),
})

if (!res.ok) {
  console.error(`Failed to create issue: ${res.status}`, await res.text())
  process.exit(1)
}

const issue = await res.json()
console.log(`Issue created: ${issue.html_url}`)
