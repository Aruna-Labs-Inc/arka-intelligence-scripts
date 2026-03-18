# Org Mapping

Map users to teams for team-level analytics. Export from your HR system (Workday, BambooHR, etc.) and upload to Arka Intelligence.

## File Format

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

## Key Fields

| Field | Description |
|-------|-------------|
| `externalUsername` | Must match GitHub username (case-sensitive) |
| `groupSlugs` | List of group slugs the user belongs to (empty array if ungrouped) |
| `parentSlug` | Creates nested group hierarchy (`null` for root groups) |

## Export from Workday

1. Export: Employee Name, Email, Department
2. Map emails to GitHub usernames
3. Structure as JSON above

See `sample-org-mapping.json` for a complete example.
