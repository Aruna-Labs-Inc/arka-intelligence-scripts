# Data Format & Relationships

## Exported Files

| Script | Output File | Key Data |
|--------|------------|----------|
| GitHub | `arka-data.json` | PRs, commits, reviews, issues, contributors |
| Jira | `jira-data.json` | Issues with type, priority, story points |
| Claude Code | `claude-code-data.json` | Per-user sessions, tokens, cost, tool acceptance |
| Cursor | `cursor-data.json` | Per-user agent edits, tab completions, mode usage |
| Copilot | `copilot-data.json` | Seat assignments, activity status |

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

## Import Flow

1. Upload GitHub export — PRs, commits, issues, contributors
2. Upload Jira export — issues
3. Upload org mapping — links users to teams

Link Jira issues to GitHub activity by mapping employee emails to GitHub usernames in your org mapping file.

See `example-output.json` for the full GitHub export format.
