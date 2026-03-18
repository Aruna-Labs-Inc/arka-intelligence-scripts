# Arka Intelligence - Data Export & Upload Scripts

Export data from GitHub, Jira, and AI tools, then upload to Arka Intelligence — all in one command.

## Prerequisites

- Node.js v18+
- `npm install`

## Quick Start

```bash
# Set your Arka API key (for uploads)
echo 'API_ADMIN_KEY=ak_your_key_here' > .env

# GitHub — PRs, commits, contributors
gh auth login
npm run export -- your-org --upload

# Jira — issues
export JIRA_EMAIL="you@company.com"
export JIRA_API_TOKEN="your-token"
npm run export:jira -- mycompany.atlassian.net --upload

# Claude Code — usage metrics
export CLAUDE_ADMIN_API_KEY="sk-ant-admin..."
npm run export:claude-code -- --org-slug=myorg --upload

# Cursor — usage metrics
export CURSOR_API_KEY="your-key"
npm run export:cursor -- --org-slug=myorg --upload

# GitHub Copilot — seat utilization
npm run export:copilot -- myorg --upload
```

Add `--upload` to export and upload in one step. Omit it to just export locally.

## Upload Flags

Every script supports these flags for uploading:

| Flag | Description |
|------|-------------|
| `--upload` | Export **and** upload in one step |
| `--upload-only` | Skip export, upload existing JSON file |
| `--dry-run` | Preview upload without sending |
| `--input=<file>` | Specify input file (with `--upload-only`) |
| `--api-url=<url>` | Override API URL |

## Detailed Guides

| Guide | Description |
|-------|-------------|
| [GitHub Export](docs/github.md) | Options, checkpointing, resuming interrupted exports |
| [Jira Export](docs/jira.md) | Options, authentication, project filtering |
| [AI Tools Export](docs/ai-tools.md) | Claude Code, Cursor, and Copilot options |
| [Uploading Data](docs/uploading.md) | API key setup, upload responses, troubleshooting |
| [Org Mapping](docs/org-mapping.md) | Team structure file format, Workday export |
| [Data Format](docs/data-format.md) | Exported data schemas and relationships |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and fixes |

## Support

- GitHub Issues: [Report a bug](https://github.com/Aruna-Labs-Inc/arka-intelligence-scripts/issues)
- Contact: devops@arunalabs.io

## License

MIT License
