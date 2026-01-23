# Arka Intelligence - GitHub Data Export

Export GitHub repository data into JSON files for import into Arka Intelligence.

## Quick Start

**Prerequisites:** Node.js v18+, [GitHub CLI](https://cli.github.com/)

```bash
# 1. Install and authenticate
npm install
gh auth login

# 2. Export GitHub data
npm run export -- <owner> <repo>

# 3. Upload arka-data.json to Arka Intelligence
```

## Command Options

```bash
npm run export -- owner repo [options]

Options:
  --output=<file>      Output file (default: arka-data.json)
  --org-slug=<slug>    Organization slug (default: repo owner)
  --since=YYYY-MM-DD   Only export after date
  --max-pages=<n>      Max pages to fetch (default: 50)

Examples:
  npm run export -- myorg myrepo
  npm run export -- myorg myrepo --since=2025-01-01 --max-pages=100
```

## Exported Data

**GitHub Activity Data** (`arka-data.json`):
- **Pull Requests** - State, author, lines changed, cycle time, AI tool detection
- **Commits** - Author, message, changes, AI assistance (Cursor, Copilot, Claude, ChatGPT)
- **Issues** - State, author, assignee, cycle time
- **Contributors** - GitHub username, display name, avatar (bots excluded)

See `example-output.json` for format.

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
