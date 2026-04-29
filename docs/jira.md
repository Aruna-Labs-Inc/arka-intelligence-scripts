# Jira Export

Exports issues from Jira with state, priority, story points, and cycle time.

**Prerequisites:** Jira API token ([create one here](https://id.atlassian.com/manage-profile/security/api-tokens))

## Authentication

```bash
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token"
```

## Usage

```bash
npm run export:jira -- <domain> [project-key] [options]
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output=<file>` | `jira-data.json` | Output file |
| `--org-slug=<slug>` | domain prefix | Organization slug in Arka |
| `--since=YYYY-MM-DD` | none | Only export issues *updated* since date. Filters by `updated` (not `created`) so old issues that close during the window are still included. |
| `--max-results=<n>` | 1000 | Max issues to fetch |
| `--upload` | false | Upload to Arka after export |
| `--upload-only` | false | Skip export, upload existing file |

## Examples

```bash
npm run export:jira -- mycompany.atlassian.net PROJ
npm run export:jira -- acme.atlassian.net ENG --since=2025-01-01
npm run export:jira -- company.atlassian.net PLATFORM --max-results=5000
npm run export:jira -- mycompany.atlassian.net PROJ --upload
```

Omit the project key to export all projects.

## What's Exported

- **Issues** — issue type, state, priority, story points, cycle time
- **People** — author, assignee, reporter (by email)
- **Metadata** — labels, status name, resolution date

**Note:** If your issues are in Jira, the GitHub export will skip GitHub issues automatically.
