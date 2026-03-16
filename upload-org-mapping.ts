#!/usr/bin/env tsx
/**
 * Upload org mapping data to Arka Intelligence API.
 * Reads an org-mapping JSON file and POSTs it to /uploads/org-mapping.
 *
 * Usage:
 *   npm run upload:org -- [options]
 *
 * Options:
 *   --input=<file>   Input file (default: org-mapping.json)
 *   --api-url=<url>  API base URL (default: https://intel.arka.so/api/v1)
 *   --dry-run        Print what would be uploaded without sending
 */

import * as fs from "fs";

const API_URL =
  getArg("--api-url") || "https://intel.arka.so/api/v1";
const API_KEY = process.env.API_ADMIN_KEY || loadEnvKey();
const INPUT = getArg("--input") || "org-mapping.json";
const DRY_RUN = process.argv.includes("--dry-run");

function loadEnvKey(): string {
  try {
    const env = fs.readFileSync(".env", "utf-8");
    const match = env.match(/^API_ADMIN_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  console.error("Error: API_ADMIN_KEY not set. Set it in .env or as an environment variable.");
  process.exit(1);
}

function getArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix + "="));
  return arg ? arg.split("=").slice(1).join("=") : undefined;
}

async function upload(body: unknown): Promise<void> {
  const url = `${API_URL}/uploads/org-mapping`;
  console.log(`\nUploading to ${url} ...`);

  if (DRY_RUN) {
    const json = JSON.stringify(body, null, 2);
    console.log(`[dry-run] Would POST ${(json.length / 1024).toFixed(1)} KB`);
    return;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Upload failed (${res.status}): ${text}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log("Upload successful!");
  console.log(`  Upload ID:  ${result.uploadId}`);
  console.log(`  Records:    ${result.recordCount}`);
  if (result.diffSummary) {
    const d = result.diffSummary;
    console.log(`  Added:      ${d.added}`);
    console.log(`  Changed:    ${d.changed}`);
    console.log(`  Unchanged:  ${d.unchanged}`);
    if (d.missingFromUpload) console.log(`  Missing:    ${d.missingFromUpload}`);
  }
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`File not found: ${INPUT}`);
    console.error(`Create an org-mapping file first. See sample-org-mapping.json for format.`);
    process.exit(1);
  }

  console.log(`Reading ${INPUT} ...`);
  const data = JSON.parse(fs.readFileSync(INPUT, "utf-8"));

  // The existing org-mapping format uses "groups" and "users".
  // The API expects "teams" with nested "members".
  // Transform if needed.
  const orgSlug =
    data.organization?.slug ||
    data.meta?.organization ||
    data.organizationSlug ||
    "unknown";

  let payload: any;

  if (data.teams) {
    // Already in API format
    payload = {
      organizationSlug: data.organizationSlug || orgSlug,
      teams: data.teams,
      exportedAt: data.exportedAt || new Date().toISOString(),
      version: "1.0",
    };
  } else if (data.groups && data.users) {
    // Transform from the existing groups/users format to teams/members
    const usersByGroup = new Map<string, any[]>();
    for (const user of data.users || []) {
      for (const slug of user.groupSlugs || []) {
        if (!usersByGroup.has(slug)) usersByGroup.set(slug, []);
        usersByGroup.get(slug)!.push(user);
      }
    }

    const teams = (data.groups || []).map((g: any) => ({
      teamId: g.slug,
      teamName: g.name,
      parentTeamId: g.parentSlug || null,
      managerEmail: "",
      members: (usersByGroup.get(g.slug) || []).map((u: any) => ({
        email: u.email || "",
        fullName: u.displayName || "",
        scmUsername: u.externalUsername || "",
        role: "",
      })),
    }));

    payload = {
      organizationSlug: orgSlug,
      teams,
      exportedAt: new Date().toISOString(),
      version: "1.0",
    };
  } else {
    console.error("Unrecognized org-mapping format. Expected 'groups'+'users' or 'teams'.");
    process.exit(1);
  }

  const teamCount = payload.teams?.length ?? 0;
  const memberCount = payload.teams?.reduce(
    (sum: number, t: any) => sum + (t.members?.length ?? 0),
    0
  );
  console.log(`Found ${teamCount} teams, ${memberCount} members`);

  await upload(payload);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
