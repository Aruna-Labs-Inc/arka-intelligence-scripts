# GitHub Export

Exports pull requests, commits, reviews, issues, and contributors from GitHub.

**Prerequisites:** [GitHub CLI](https://cli.github.com/) (`gh auth login`)

## Usage

```bash
npm run export -- <owner> [owner2 ...] [options]
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--repo=<name>` | all repos | Export a specific repo (single owner only) |
| `--output=<file>` | `arka-data.json` | Output file |
| `--org-slug=<slug>` | first owner | Organization slug in Arka |
| `--since=YYYY-MM-DD` | none | Only export after this date |
| `--max-pages=<n>` | 50 | Max pages per repo (100 items/page) |
| `--no-resume` | false | Ignore checkpoint, start fresh |
| `--upload` | false | Upload to Arka after export |
| `--upload-only` | false | Skip export, upload existing file |

## Examples

```bash
npm run export -- your-org                          # all repos
npm run export -- your-org --repo=myrepo            # single repo
npm run export -- org1 org2 org3                    # multiple orgs
npm run export -- your-org --since=2025-01-01       # date filter
npm run export -- your-org --upload                 # export + upload
npm run export -- --upload-only                     # upload existing file
```

## Checkpointing

The export saves a checkpoint after each repo. If interrupted, re-run the same command to resume:

```bash
# Interrupted at repo 47/120 — just re-run:
npm run export -- your-org

# Force fresh start:
npm run export -- your-org --no-resume
```

The checkpoint file (`arka-data.checkpoint.json`) is deleted on successful completion and invalidated if you change the org list or `--since` date.

## What's Exported

- **Pull Requests** — state, author, lines changed, cycle time, AI tool detection
- **Commits** — author, message, changes, AI assistance (Cursor, Copilot, Claude, ChatGPT); linked to PR via `prExternalId`
- **Reviews** — reviewer, state, submitted date
- **Issues** (optional) — state, author, assignee, cycle time
- **Contributors** — GitHub username, display name, email, avatar (bots excluded)

See `example-output.json` for the full format.
