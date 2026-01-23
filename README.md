# Arka Intelligence - GitHub Data Export Scripts

Export GitHub repository data (pull requests, commits, issues, contributors) into a JSON file that can be uploaded to Arka Intelligence for analytics and dashboards.

## Prerequisites

1. **Node.js** (v18 or higher)
2. **GitHub CLI** (`gh`) - [Install instructions](https://cli.github.com/)
3. **GitHub Access** - Read access to the repositories you want to export

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Authenticate with GitHub

```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account.

### 3. Export Repository Data

```bash
npm run export -- <owner> <repo>
```

**Example:**

```bash
npm run export -- continuedev continue
```

This will create a file called `arka-data.json` with all the exported data.

### 4. Upload to Arka Intelligence

Upload the generated JSON file through your Arka Intelligence dashboard or upload it to your designated S3 bucket.

## Command Options

| Option | Description | Required | Default |
|--------|-------------|----------|---------|
| `owner` | GitHub repository owner/org | ✅ Yes | - |
| `repo` | GitHub repository name | ✅ Yes | - |
| `--output=<file>` | Output JSON file path | No | `arka-data.json` |
| `--org-slug=<slug>` | Organization identifier in Arka | No | repo owner |
| `--since=<date>` | Only export data after this date (YYYY-MM-DD) | No | All time |
| `--max-pages=<n>` | Max API pages to fetch (100 items/page) | No | `50` |

## Examples

### Basic Export

```bash
npm run export -- myorg myrepo
```

### Custom Output File

```bash
npm run export -- myorg myrepo --output=my-data.json
```

### Export Recent Data Only

```bash
npm run export -- myorg myrepo --since=2025-01-01
```

### Export with Custom Organization Slug

```bash
npm run export -- myorg myrepo --org-slug="my-team"
```

### Export More Data

```bash
npm run export -- myorg myrepo --max-pages=200
```

## What Gets Exported

### Pull Requests
- Number, title, URL, state (open/merged/closed)
- Author, reviewers, labels
- Lines added/deleted (via GraphQL batch queries)
- Cycle time (time to merge)
- Review counts, draft status

### Commits
- SHA, message, URL, timestamp
- Author information
- Lines added/deleted
- **AI tool detection** (Cursor, Copilot, Claude, ChatGPT)
- AI model identification

### Issues
- Number, title, URL, state
- Author, assignee, labels
- Creation/closure dates
- Cycle time (time to close)

### Contributors
- GitHub username and ID
- Display name (fetched from profile)
- Avatar URL
- **Automatically filters out bots**

## Output Format

The generated JSON file has this structure:

```json
{
  "metadata": {
    "exportedAt": "2026-01-23T00:00:00.000Z",
    "repository": "owner/repo",
    "organizationSlug": "myorg",
    "since": null,
    "version": "1.0.0"
  },
  "contributors": [
    {
      "externalUsername": "johndoe",
      "externalId": "123456",
      "displayName": "John Doe",
      "avatarUrl": "https://..."
    }
  ],
  "pullRequests": [...],
  "commits": [...],
  "issues": [...]
}
```

See `example-output.json` for a complete example.

## Data Structure & Relationships

Understanding how the exported data is organized is important for proper import into Arka Intelligence.

### Organizational Hierarchy

```
Organization (identified by organizationSlug)
  └── Repository (metadata.repository)
       ├── Contributors (people who contributed)
       ├── Pull Requests (linked to contributors via authorUsername)
       ├── Commits (linked to contributors via authorUsername)
       └── Issues (linked to contributors via authorUsername & assigneeUsername)
```

### Key Relationships

1. **Organization**
   - Identified by `metadata.organizationSlug`
   - All data in the export belongs to this single organization
   - Default: Uses the repository owner name if not specified

2. **Contributors**
   - Unique GitHub users who authored PRs, commits, or issues
   - Identified by `externalUsername` (GitHub username)
   - Referenced by pull requests, commits, and issues
   - Automatically excludes bot accounts

3. **Pull Requests**
   - `authorUsername` → References a contributor's `externalUsername`
   - Belongs to repository specified in `metadata.repository`
   - Contains metadata about labels, reviewers, draft status

4. **Commits**
   - `authorUsername` → References a contributor's `externalUsername`
   - Belongs to repository specified in `metadata.repository`
   - Includes AI tool detection (Cursor, Copilot, Claude, ChatGPT)

5. **Issues**
   - `authorUsername` → References a contributor's `externalUsername`
   - `assigneeUsername` → References a contributor's `externalUsername` (if assigned)
   - Belongs to repository specified in `metadata.repository`

### Data Integrity

When importing this data into Arka Intelligence, the system should:

1. **Create/Update Organization** using `metadata.organizationSlug`
2. **Create/Update Repository** using `metadata.repository` under the organization
3. **Create Contributors** from the `contributors` array
   - Use `externalUsername` as the unique identifier
   - Store `displayName` and `avatarUrl` for display purposes
4. **Link Work Items** to contributors by matching `authorUsername`/`assigneeUsername` to `externalUsername`
5. **Associate All Data** with the repository and organization

### Example Import Flow

```
1. Check if organization "myorg" exists, create if not
2. Check if repository "myorg/myrepo" exists, create if not
3. For each contributor: Create/update user profile
4. For each PR: Link to contributor by username, link to repository
5. For each commit: Link to contributor by username, link to repository
6. For each issue: Link to contributor + assignee by username, link to repository
```

### Important Notes

- **Usernames are case-sensitive** - Match exactly as provided
- **Contributors without profiles** - If a GitHub user is deleted/private, their username will still be present but `displayName` may be null
- **Bot filtering** - The export automatically excludes common bot accounts
- **Orphaned references** - If a contributor is missing from the `contributors` array but referenced in work items, the importer should handle gracefully (create stub profile or skip)

## Features

- **Batch GraphQL queries** - Fetches 100 PR details per query (much faster than REST API)
- **AI tool detection** - Identifies AI-assisted commits from commit messages
- **Bot filtering** - Automatically excludes bot accounts (dependabot, renovate, etc.)
- **Retry logic** - Handles rate limits and connection errors automatically
- **Incremental export** - Use `--since` to only fetch recent data
- **Progress logging** - See real-time export progress
- **No database required** - Pure JSON export, no database credentials needed

## Rate Limits

GitHub API has rate limits:
- **Authenticated**: 5,000 requests/hour
- **GraphQL**: 5,000 points/hour (100 PRs = ~1 point)

The script automatically handles rate limiting with exponential backoff. For large repos, consider using `--since` to limit the date range.

## Troubleshooting

### "gh: command not found"

Install the GitHub CLI:
```bash
# macOS
brew install gh

# Linux
sudo apt install gh

# Windows
winget install GitHub.cli
```

### "Authentication required"

Run `gh auth login` and follow the prompts.

### "Rate limit exceeded"

Wait for the rate limit to reset (shown in error message) or use `--since` to fetch less data.

## File Size Considerations

Exported JSON files can be large for repositories with lots of data:
- **Small repo** (< 1000 PRs): ~500 KB
- **Medium repo** (1000-5000 PRs): ~2-5 MB
- **Large repo** (5000+ PRs): ~10+ MB

Use `--since` to reduce file size by limiting the date range.

## Support

For issues or questions:
- Open an issue on GitHub
- Contact: devops@arunalabs.io

## License

MIT License - See LICENSE file for details
