# Arka Intelligence - Data Export Scripts

Export data from GitHub and Jira into JSON files for import into Arka Intelligence.

## Quick Start

### GitHub Export

**Prerequisites:** Node.js v18+, [GitHub CLI](https://cli.github.com/)

```bash
# 1. Install and authenticate
npm install
gh auth login

# 2. Export GitHub data (PRs, commits, issues) — all repos by default
npm run export -- continuedev

# 3. Upload arka-data.json to Arka Intelligence
```

### Jira Export

**Prerequisites:** Node.js v18+, Jira API token

```bash
# 1. Install and set credentials
npm install
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"

# 2. Export Jira issues
npm run export:jira -- mycompany.atlassian.net PROJ

# 3. Upload jira-data.json to Arka Intelligence
```

**Get Jira API Token:** https://id.atlassian.com/manage-profile/security/api-tokens

## Command Options

### GitHub Export

```bash
npm run export -- owner [repo] [options]

Options:
  --output=<file>      Output file (default: arka-data.json)
  --org-slug=<slug>    Organization slug (default: repo owner)
  --since=YYYY-MM-DD   Only export after date
  --max-pages=<n>      Max pages per repo (default: 50)

Examples:
  npm run export -- facebook                        # all repos
  npm run export -- facebook react                  # single repo
  npm run export -- vercel --since=2025-01-01
  npm run export -- anthropics --max-pages=100
```

### Jira Export

```bash
npm run export:jira -- domain project-key [options]

Options:
  --output=<file>       Output file (default: jira-data.json)
  --org-slug=<slug>     Organization slug (default: project key)
  --since=YYYY-MM-DD    Only export issues created after date
  --max-results=<n>     Max issues to fetch (default: 1000)

Examples:
  npm run export:jira -- mycompany.atlassian.net PROJ
  npm run export:jira -- acme.atlassian.net ENG --since=2025-01-01
  npm run export:jira -- company.atlassian.net PLATFORM --max-results=5000
```

**Note:** GitHub issues are optional. If your issues are in Jira, the GitHub export will skip them automatically.

## Exported Data

**GitHub Export** (`arka-data.json`):
- **Pull Requests** - State, author, lines changed, cycle time, AI tool detection
- **Commits** - Author, message, changes, AI assistance (Cursor, Copilot, Claude, ChatGPT)
- **Issues** (optional) - State, author, assignee, cycle time
- **Contributors** - GitHub username, display name, email, avatar (bots excluded)

**Jira Export** (`jira-data.json`):
- **Issues** - Issue type, state, priority, story points, cycle time
- **People** - Author, assignee, reporter (by email)
- **Metadata** - Labels, status, resolution date

**Mapping:** Link Jira issues to GitHub activity by mapping employee emails to GitHub usernames in your org structure file.

See `example-output.json` for GitHub format.

## Organizational Structure (Required for Team Analytics)

Create a separate JSON file with team structure from your HR system (Workday, BambooHR, etc.):

```json
{
  "organizationSlug": "myorg",
  "teams": [
    {
      "teamId": "engineering",
      "teamName": "Engineering",
      "parentTeamId": null,
      "members": [
        {
          "githubUsername": "johndoe",  // MUST match GitHub export
          "email": "john.doe@company.com",
          "role": "Engineer",
          "managerId": "janedoe"  // GitHub username of manager
        }
      ]
    }
  ]
}
```

**Key Fields:**
- `githubUsername` - Links to GitHub export (case-sensitive)
- `managerId` - Creates reporting hierarchy (null for top-level)
- `parentTeamId` - Creates nested teams (null for root teams)

**Export from Workday:**
1. Export: Employee Name, Email, Manager, Department, Title
2. Map emails to GitHub usernames
3. Structure as JSON above

See `example-org-structure.json` for complete example.

## Data Relationships

```
Organization
  └── Repository
       ├── Contributors (linked by githubUsername)
       ├── Pull Requests (→ authorUsername)
       ├── Commits (→ authorUsername)
       └── Issues (→ authorUsername, assigneeUsername)
```

**Import Flow:**
1. Create organization from `organizationSlug`
2. Create repository from `metadata.repository`
3. Create contributors
4. Link PRs/commits/issues to contributors by matching usernames
5. Create teams and link members to contributors

## Troubleshooting

- **gh: command not found** → Install: `brew install gh` (macOS) or see [cli.github.com](https://cli.github.com/)
- **Authentication required** → Run `gh auth login`
- **Rate limit exceeded** → Use `--since` to limit date range

## Support

- GitHub Issues: [Report a bug](https://github.com/Aruna-Labs-Inc/arka-intelligence-scripts/issues)
- Contact: devops@arunalabs.io

## License

MIT License
