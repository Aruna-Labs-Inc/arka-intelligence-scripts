# Troubleshooting

## Export Issues

| Error | Fix |
|-------|-----|
| `gh: command not found` | Install: `brew install gh` (macOS) or see [cli.github.com](https://cli.github.com/) |
| Authentication required | Run `gh auth login` |
| Rate limit exceeded | Use `--since` to limit date range; the script retries automatically |
| Export interrupted | Re-run the same command — checkpointing resumes from where it stopped |
| Contributor emails missing | Email fetching requires org admin; run `gh auth login` with an admin account |
| Jira returns 0 issues | API token may lack permission; pass a project key explicitly |
| GraphQL timeouts | Script retries automatically; try `--max-pages=25` to reduce query size |
| Claude Code: auth failed | Must use Admin API key (`sk-ant-admin...`), not regular; [create one here](https://console.anthropic.com/settings/admin-keys) |
| Claude Code: 0 users | Admin API key must belong to an org admin; individual accounts not supported |
| Cursor: auth failed | Requires enterprise team plan; generate key under Settings → Team → Analytics API |
| Copilot: 403 | Must be org owner or Copilot billing manager |
| Copilot: 0 seats | Copilot may not be enabled, or user lacks billing access |

## Upload Issues

| Error | Fix |
|-------|-----|
| 401 Unauthorized | Check `API_ADMIN_KEY` in `.env` or environment variable |
| 403 Forbidden | Key may be read-only; uploads require an admin key |
| 422 Validation error | Exported data may be in unexpected format; try re-exporting |
| File not found | Run the export command first to generate the JSON file |
