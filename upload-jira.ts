#!/usr/bin/env tsx
/**
 * Upload Jira export data to Arka Intelligence API.
 * Reads the output of sync-jira.ts and POSTs it to /uploads/jira-issues.
 *
 * Usage:
 *   npm run upload:jira -- [options]
 *
 * Options:
 *   --input=<file>   Input file (default: jira-data.json)
 *   --api-url=<url>  API base URL (default: https://intel.arka.so/api/v1)
 *   --dry-run        Print what would be uploaded without sending
 */

import * as fs from "fs";

const API_URL =
  getArg("--api-url") || "https://intel.arka.so/api/v1";
const API_KEY = process.env.API_ADMIN_KEY || loadEnvKey();
const INPUT = getArg("--input") || "jira-data.json";
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

async function upload(type: string, body: unknown): Promise<void> {
  const url = `${API_URL}/uploads/${type}`;
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
    console.error(`Run the Jira export first: npm run export:jira -- <domain>`);
    process.exit(1);
  }

  console.log(`Reading ${INPUT} ...`);
  const data = JSON.parse(fs.readFileSync(INPUT, "utf-8"));

  const issueCount = data.issues?.length ?? 0;
  console.log(`Found ${issueCount} issues`);

  // Build the payload matching the jira-issues upload schema
  const payload = {
    metadata: {
      exportedAt: data.metadata?.exportedAt || new Date().toISOString(),
      source: "jira",
      projectKey: data.metadata?.projectKey || null,
      organizationSlug: data.metadata?.organizationSlug || "unknown",
      since: data.metadata?.since || null,
      version: "1.0",
    },
    issues: (data.issues || []).map((issue: any) => ({
      externalId: issue.externalId,
      title: issue.title,
      state: issue.state,
      createdAt: issue.createdAt,
      externalUrl: issue.externalUrl,
      issueType: issue.issueType || "Task",
      assigneeEmail: issue.assigneeEmail || null,
      priority: issue.priority || null,
      storyPoints: issue.storyPoints ?? null,
      resolvedAt: issue.resolvedAt || null,
      cycleTimeHours: issue.cycleTimeHours ?? null,
      metadata: {
        labels: issue.metadata?.labels || [],
        statusName: issue.metadata?.statusName || issue.state,
      },
    })),
  };

  await upload("jira-issues", payload);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
