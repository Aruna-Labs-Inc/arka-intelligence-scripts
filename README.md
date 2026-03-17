# Arka Intelligence - Data Export & Upload Scripts

Export data from GitHub, Jira, and AI tools into JSON files, then upload them to the Arka Intelligence platform via API.

## Prerequisites

- Node.js v18+
- `npm install`

---

# Part 1: Collecting Data

Export data from your tools into local JSON files.

## GitHub Export

**Additional prerequisites:** [GitHub CLI](https://cli.github.com/)

```bash
# 1. Authenticate
gh auth login

# 2. Export GitHub data (PRs, commits, issues) — all repos by default
npm run export -- your-org
# Or multiple orgs at once:
npm run export -- org1 org2
```

## Jira Export

**Additional prerequisites:** Jira API token

```bash
# 1. Set credentials
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"

# 2. Export Jira issues (project key optional — omit to export all projects)
npm run export:jira -- mycompany.atlassian.net PROJ
npm run export:jira -- mycompany.atlassian.net --since=2025-01-01
```

**Get Jira API Token:** https://id.atlassian.com/manage-profile/security/api-tokens

## Claude Code Analytics Export

**Additional prerequisites:** Anthropic Admin API key

```bash
# 1. Set your Admin API key
export CLAUDE_ADMIN_API_KEY="sk-ant-admin..."

# 2. Export Claude Code usage metrics (last 7 days by default)
npm run export:claude-code -- --org-slug=myorg
```

**Get an Admin API key:** https://console.anthropic.com/settings/admin-keys
Requires organization admin role — standard API keys will not work.

## Cursor Analytics Export

**Additional prerequisites:** Cursor enterprise team, Cursor Analytics API key

```bash
# 1. Set your Cursor API key
export CURSOR_API_KEY="your-api-key"

# 2. Export Cursor usage metrics (last 7 days by default)
npm run export:cursor -- --org-slug=myorg
```

**Get a Cursor API key:** Cursor → Settings → Team → Analytics API → Generate Key
Requires enterprise team plan.

## GitHub Copilot Seat Utilization Export

**Additional prerequisites:** [GitHub CLI](https://cli.github.com/), org owner or Copilot billing manager role

```bash
# 1. Authenticate
gh auth login

# 2. Export Copilot seat utilization snapshot
npm run export:copilot -- myorg
```

## Export Command Options

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

### Claude Code Analytics Export

```bash
npm run export:claude-code -- [options]

Options:
  --output=<file>      Output file (default: claude-code-data.json)
  --org-slug=<slug>    Organization slug
  --days=<n>           Days of history to fetch (default: 7)
  --since=YYYY-MM-DD   Start date (overrides --days)

Examples:
  npm run export:claude-code -- --org-slug=myorg
  npm run export:claude-code -- --org-slug=myorg --days=30
  npm run export:claude-code -- --org-slug=myorg --since=2025-01-01
```

**What's captured:** sessions, lines added/removed, commits and PRs created by Claude Code, tool acceptance rates (edit/write), token breakdown by model, estimated cost, terminal types, seat utilization (active vs inactive users).

### Cursor Analytics Export

```bash
npm run export:cursor -- [options]

Options:
  --output=<file>      Output file (default: cursor-data.json)
  --org-slug=<slug>    Organization slug
  --days=<n>           Days of history to fetch (default: 7)
  --since=YYYY-MM-DD   Start date (overrides --days)

Examples:
  npm run export:cursor -- --org-slug=myorg
  npm run export:cursor -- --org-slug=myorg --days=30
  npm run export:cursor -- --org-slug=myorg --since=2025-01-01
```

**What's captured:** agent edit acceptance rates, tab completion rates, daily active days, models used, commands run, plan/ask mode usage, seat utilization (active vs inactive users).

### GitHub Copilot Seat Utilization Export

```bash
npm run export:copilot -- <org> [options]

Options:
  --output=<file>        Output file (default: copilot-data.json)
  --org-slug=<slug>      Organization slug (default: org name)
  --inactive-days=<n>    Days without activity to consider inactive (default: 30)

Examples:
  npm run export:copilot -- myorg
  npm run export:copilot -- myorg --inactive-days=14
  npm run export:copilot -- myorg --output=seats.json
```

**What's captured:** every assigned seat with login, last activity date and editor, seat assignment date, team assignment, pending cancellation, and status (`active` / `inactive` / `never_used`). Inactive and never-used seats are listed explicitly in the terminal output.

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

**Copilot Export** (`copilot-data.json`):
- **Seats** - Login, last activity date, last activity editor, seat assigned date, assigning team
- **Status** - `active` (used within threshold), `inactive` (not used recently), `never_used`
- **Summary** - Total seats billed, active/inactive/never-used counts

**Jira Export** (`jira-data.json`):
- **Issues** - Issue type, state, priority, story points, cycle time
- **People** - Author, assignee, reporter (by email)
- **Metadata** - Labels, status, resolution date

**Claude Code Export** (`claude-code-data.json`):
- **Per-user metrics** - Sessions, lines added/removed, commits, PRs, tool acceptance rates
- **Token usage** - Input/output/cache tokens broken down by model
- **Cost** - Estimated cost per user and total (in USD)
- **Seat utilization** - Active vs inactive users over the period, with inactive seats listed explicitly

**Cursor Export** (`cursor-data.json`):
- **Per-user metrics** - Agent edit acceptance rate, tab completion rate, active days
- **Usage patterns** - Models used, commands run, plan/ask mode usage
- **Seat utilization** - Active vs inactive users over the period, with inactive seats listed explicitly

**Mapping:** Link Jira issues to GitHub activity by mapping employee emails to GitHub usernames in your org structure file.

See `example-output.json` for GitHub format.

---

# Part 2: Uploading Data

Upload exported data to Arka Intelligence via the API. Each export script has built-in `--upload` and `--upload-only` flags — no separate upload commands needed.

## Setup

Set your Arka Intelligence Admin API key:

```bash
# Option A: environment variable
export API_ADMIN_KEY="ak_your_key_here"

# Option B: .env file (auto-loaded by scripts)
echo 'API_ADMIN_KEY=ak_your_key_here' > .env
```

**Get an API key:** Request an admin key from your Arka Intelligence account settings.

## Upload Flags

Every export script supports these additional flags:

| Flag | Description |
|------|-------------|
| `--upload` | Export data **and** upload to Arka Intelligence in one step |
| `--upload-only` | Skip export, upload an existing JSON file |
| `--input=<file>` | Specify input file for `--upload-only` (defaults to standard export filename) |
| `--api-url=<url>` | API base URL (default: `https://intel.arka.so/api/v1`) |
| `--dry-run` | With `--upload` or `--upload-only`, print payload size without sending |

## Examples

```bash
# Export + upload in one step
npm run export -- your-org --upload
npm run export:jira -- mycompany.atlassian.net PROJ --upload
npm run export:claude-code -- --org-slug=myorg --upload
npm run export:cursor -- --org-slug=myorg --upload
npm run export:copilot -- myorg --upload

# Upload previously exported files (no re-export)
npm run export -- --upload-only
npm run export:jira -- --upload-only
npm run export:claude-code -- --upload-only
npm run export:cursor -- --upload-only
npm run export:copilot -- --upload-only

# Upload a specific file
npm run export -- --upload-only --input=arka-data.json

# Dry run (preview without uploading)
npm run export -- your-org --upload --dry-run
```

### Upload Response

Each successful upload returns a diff summary:

```
Upload successful!
  Upload ID:  abc-123
  Records:    542
  Added:      48
  Changed:    12
  Unchanged:  482
  Missing:    0
```

- **Added** — new records not previously in the platform
- **Changed** — existing records updated with new data
- **Unchanged** — records identical to what's already stored
- **Missing** — records in the platform but not in this upload (not deleted)

## End-to-End Workflow

```bash
# Export and upload everything in one go
npm run export -- your-org --upload
npm run export:jira -- mycompany.atlassian.net --upload
npm run export:claude-code -- --org-slug=myorg --upload
npm run export:cursor -- --org-slug=myorg --upload
npm run export:copilot -- myorg --upload
```

---

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

### Export Issues
- **gh: command not found** → Install: `brew install gh` (macOS) or see [cli.github.com](https://cli.github.com/)
- **Authentication required** → Run `gh auth login`
- **Rate limit exceeded** → Use `--since` to limit date range, or the script will automatically back off and retry
- **Export interrupted** → Just re-run the same command — checkpointing means it resumes from where it stopped
- **Contributor emails missing** → Email fetching requires org admin access; run `gh auth login` with an org admin account
- **Jira returns 0 issues** → The API token may lack permission to search all projects; pass a project key explicitly
- **GraphQL timeouts** → The script retries automatically; if it keeps failing, try `--max-pages=25` to reduce query size
- **Claude Code: authentication failed** → Must use an Admin API key (`sk-ant-admin...`), not a regular API key; create one at https://console.anthropic.com/settings/admin-keys
- **Claude Code: 0 users returned** → The Admin API key must belong to an org admin; individual accounts are not supported
- **Cursor: authentication failed** → API key requires enterprise team plan; generate it under Settings → Team → Analytics API
- **Copilot: access denied (403)** → Must be an org owner or have the Copilot billing manager role; run `gh auth login` with an eligible account
- **Copilot: 0 seats returned** → Copilot may not be enabled for the org, or the authenticated user lacks billing access

### Upload Issues
- **401 Unauthorized** → Check that `API_ADMIN_KEY` is set correctly in `.env` or as an environment variable
- **403 Forbidden** → Your API key may be read-only; uploads require an admin key
- **422 Validation error** → The exported data may be in an unexpected format; try re-exporting first
- **File not found** → Run the corresponding export command first to generate the JSON file

## Support

- GitHub Issues: [Report a bug](https://github.com/Aruna-Labs-Inc/arka-intelligence-scripts/issues)
- Contact: devops@arunalabs.io

## License

MIT License
