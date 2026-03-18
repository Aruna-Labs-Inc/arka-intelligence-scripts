# AI Tools Export

Export usage data from Claude Code, Cursor, and GitHub Copilot.

## Claude Code

**Prerequisites:** Anthropic Admin API key ([create one here](https://console.anthropic.com/settings/admin-keys)) — requires org admin role.

```bash
export CLAUDE_ADMIN_API_KEY="sk-ant-admin..."
npm run export:claude-code -- --org-slug=myorg
```

| Option | Default | Description |
|--------|---------|-------------|
| `--output=<file>` | `claude-code-data.json` | Output file |
| `--org-slug=<slug>` | `my-org` | Organization slug |
| `--days=<n>` | 7 | Days of history |
| `--since=YYYY-MM-DD` | none | Start date (overrides --days) |
| `--upload` | false | Upload after export |
| `--upload-only` | false | Upload existing file |

**What's captured:** sessions, lines added/removed, commits, PRs, tool acceptance rates (edit/write), token breakdown by model, estimated cost, seat utilization.

## Cursor

**Prerequisites:** Cursor Analytics API key (enterprise team plan). Generate under Cursor → Settings → Team → Analytics API.

```bash
export CURSOR_API_KEY="your-api-key"
npm run export:cursor -- --org-slug=myorg
```

| Option | Default | Description |
|--------|---------|-------------|
| `--output=<file>` | `cursor-data.json` | Output file |
| `--org-slug=<slug>` | `my-org` | Organization slug |
| `--days=<n>` | 7 | Days of history |
| `--since=YYYY-MM-DD` | none | Start date (overrides --days) |
| `--upload` | false | Upload after export |
| `--upload-only` | false | Upload existing file |

**What's captured:** agent edit acceptance rates, tab completion rates, active days, models used, commands run, plan/ask mode usage, seat utilization.

## GitHub Copilot

**Prerequisites:** [GitHub CLI](https://cli.github.com/), org owner or Copilot billing manager role.

```bash
gh auth login
npm run export:copilot -- myorg
```

| Option | Default | Description |
|--------|---------|-------------|
| `--output=<file>` | `copilot-data.json` | Output file |
| `--org-slug=<slug>` | org name | Organization slug |
| `--inactive-days=<n>` | 30 | Days without activity to consider inactive |
| `--upload` | false | Upload after export |
| `--upload-only` | false | Upload existing file |

**What's captured:** every assigned seat with login, last activity date/editor, seat assignment date, team, status (`active` / `inactive` / `never_used`).
