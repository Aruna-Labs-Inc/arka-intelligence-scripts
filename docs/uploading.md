# Uploading Data

All export scripts have built-in upload support via `--upload` and `--upload-only` flags.

## API Key Setup

Set your Arka Intelligence Admin API key:

```bash
# Option A: .env file (recommended, auto-loaded)
echo 'API_ADMIN_KEY=ak_your_key_here' > .env

# Option B: environment variable
export API_ADMIN_KEY="ak_your_key_here"
```

Request an admin key from your Arka Intelligence account settings.

## Flags

| Flag | Description |
|------|-------------|
| `--upload` | Export **and** upload in one step |
| `--upload-only` | Skip export, upload an existing JSON file |
| `--input=<file>` | Specify input file for `--upload-only` |
| `--api-url=<url>` | API base URL (default: `https://intel.arka.so/api/v1`) |
| `--dry-run` | Preview upload payload size without sending |

## Examples

```bash
# Export + upload
npm run export -- your-org --upload

# Upload existing file
npm run export -- --upload-only
npm run export:jira -- --upload-only --input=jira-data.json

# Preview without sending
npm run export -- your-org --upload --dry-run
```

## Upload Response

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

| Field | Meaning |
|-------|---------|
| **Added** | New records not previously in the platform |
| **Changed** | Existing records updated with new data |
| **Unchanged** | Records identical to what's already stored |
| **Missing** | Records in the platform but not in this upload (not deleted) |

Uploads are incremental — existing data is matched and updated, not replaced.
