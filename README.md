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
npm run export -- your-org
# Or multiple orgs at once:
npm run export -- org1 org2

# 3. Upload arka-data.json to Arka Intelligence
```

### Jira Export

**Prerequisites:** Node.js v18+, Jira API token

```bash
# 1. Install and set credentials
npm install
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"

# 2. Export Jira issues (project key optional — omit to export all projects)
npm run export:jira -- mycompany.atlassian.net PROJ
npm run export:jira -- mycompany.atlassian.net --since=2025-01-01

# 3. Upload jira-data.json to Arka Intelligence
```

**Get Jira API Token:** https://id.atlassian.com/manage-profile/security/api-tokens

## Command Options

### GitHub Export

```bash
npm run export -- <owner> [owner2 ...] [options]

Options:
  --repo=<name>        Only export a specific repo (single owner only)
  --output=<file>      Output file (default: arka-data.json)
  --org-slug=<slug>    Organization slug (default: first owner)
  --since=YYYY-MM-DD   Only export after date
  --max-pages=<n>      Max pages per repo (default: 50)
  --no-resume          Ignore existing checkpoint and start fresh

Examples:
  npm run export -- your-org                        # all repos
  npm run export -- your-org --repo=myrepo          # single repo
  npm run export -- org1 org2 org3                  # multiple orgs
  npm run export -- your-org --since=2025-01-01
  npm run export -- your-org --max-pages=100
```

### Resuming an Interrupted Export

The GitHub export automatically saves a checkpoint after each repo completes. If the export is interrupted (network error, timeout, Ctrl+C), just re-run the exact same command and it will pick up where it left off:

```bash
# First run — interrupted at repo 47/120
npm run export -- your-org

# Re-run — skips the first 46 repos automatically
npm run export -- your-org

# Force a fresh start, ignoring the checkpoint
npm run export -- your-org --no-resume
```

The checkpoint file (`arka-data.checkpoint.json`) is deleted automatically on successful completion. It is invalidated and ignored if you change the org list or `--since` date.

### Jira Export

```bash
npm run export:jira -- domain [project-key] [options]

Options:
  --output=<file>       Output file (default: jira-data.json)
  --org-slug=<slug>     Organization slug (default: domain prefix)
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
- **Commits** - Author, message, changes, AI assistance (Cursor, Copilot, Claude, ChatGPT); linked to their PR via `prExternalId` (null for direct-push commits)
- **Reviews** - Reviewer, state (approved/changes requested/commented), submitted date
- **Issues** (optional) - State, author, assignee, cycle time
- **Contributors** - GitHub username (`externalUsername`), display name, email, avatar (bots excluded)

**Jira Export** (`jira-data.json`):
- **Issues** - Issue type, state, priority, story points, cycle time
- **People** - Author, assignee, reporter (by email)
- **Metadata** - Labels, status, resolution date

**Mapping:** Link Jira issues to GitHub activity by mapping employee emails to GitHub usernames in your org structure file.

See `example-output.json` for GitHub format.

## Organizational Structure (Required for Team Analytics)

Create a separate JSON file mapping users to groups (teams). Export this from your HR system (Workday, BambooHR, etc.) and upload it to Arka Intelligence separately.

```json
{
  "meta": { "organization": "myorg" },
  "organization": { "name": "My Company", "slug": "myorg" },
  "groups": [
    { "slug": "engineering",  "name": "Engineering",  "parentSlug": null },
    { "slug": "frontend",     "name": "Frontend",     "parentSlug": "engineering" },
    { "slug": "backend",      "name": "Backend",      "parentSlug": "engineering" }
  ],
  "users": [
    {
      "externalUsername": "johndoe",
      "externalId": "1001",
      "displayName": "John Doe",
      "email": "john.doe@company.com",
      "avatarUrl": null,
      "groupSlugs": ["frontend"]
    }
  ]
}
```

**Key Fields:**
- `externalUsername` - Must match GitHub username (case-sensitive)
- `groupSlugs` - List of group slugs the user belongs to (empty array if ungrouped)
- `parentSlug` - Creates nested group hierarchy (null for root groups)

**Export from Workday:**
1. Export: Employee Name, Email, Department
2. Map emails to GitHub usernames
3. Structure as JSON above

See `sample-org-mapping.json` for a complete example.

## Data Relationships

```
Organization
  └── Repository
       ├── Contributors (linked by externalUsername)
       ├── Pull Requests (→ authorUsername)
       │    ├── Commits (→ prExternalId, authorUsername)
       │    └── Reviews (→ prExternalId, reviewerUsername)
       └── Issues (→ authorUsername, assigneeUsername)
```

**Import Flow:**
1. Upload GitHub export (`arka-data.json`) — PRs, commits, issues, contributors
2. Upload Jira export (`jira-data.json`) — issues
3. Upload org mapping file — links users to groups

## Troubleshooting

- **gh: command not found** → Install: `brew install gh` (macOS) or see [cli.github.com](https://cli.github.com/)
- **Authentication required** → Run `gh auth login`
- **Rate limit exceeded** → Use `--since` to limit date range, or the script will automatically back off and retry
- **Export interrupted** → Just re-run the same command — checkpointing means it resumes from where it stopped
- **Contributor emails missing** → Email fetching requires org admin access; run `gh auth login` with an org admin account
- **Jira returns 0 issues** → The API token may lack permission to search all projects; pass a project key explicitly
- **GraphQL timeouts** → The script retries automatically; if it keeps failing, try `--max-pages=25` to reduce query size

## Support

- GitHub Issues: [Report a bug](https://github.com/Aruna-Labs-Inc/arka-intelligence-scripts/issues)
- Contact: devops@arunalabs.io

## License

MIT License
