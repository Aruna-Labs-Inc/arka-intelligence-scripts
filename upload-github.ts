#!/usr/bin/env tsx
/**
 * Upload GitHub export data (PRs, commits) to Arka Intelligence API.
 * Reads the output of sync-github.ts and POSTs it to /uploads/github-prs.
 *
 * Usage:
 *   npm run upload:github -- [options]
 *
 * Options:
 *   --input=<file>   Input file (default: arka-data.json)
 *   --api-url=<url>  API base URL (default: https://intel.arka.so/api/v1)
 *   --dry-run        Print what would be uploaded without sending
 */

import * as fs from "fs";

const API_URL =
  getArg("--api-url") || "https://intel.arka.so/api/v1";
const API_KEY = process.env.API_ADMIN_KEY || loadEnvKey();
const INPUT = getArg("--input") || "arka-data.json";
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
    console.error(`Run the GitHub export first: npm run export -- <org>`);
    process.exit(1);
  }

  console.log(`Reading ${INPUT} ...`);
  const data = JSON.parse(fs.readFileSync(INPUT, "utf-8"));

  const prCount = data.pullRequests?.length ?? 0;
  const commitCount = data.commits?.length ?? 0;
  const contribCount = data.contributors?.length ?? 0;
  console.log(`Found ${prCount} PRs, ${commitCount} commits, ${contribCount} contributors`);

  // Build the payload matching the github-prs upload schema
  const payload = {
    metadata: {
      exportedAt: data.metadata?.exportedAt || new Date().toISOString(),
      repository: data.metadata?.repository || "unknown",
      organizationSlug: data.metadata?.organizationSlug || "unknown",
      since: data.metadata?.since || null,
      version: "1.0",
    },
    contributors: (data.contributors || []).map((c: any) => ({
      username: c.externalUsername,
      displayName: c.displayName || c.externalUsername,
    })),
    pullRequests: (data.pullRequests || []).map((pr: any) => ({
      externalId: String(pr.externalId),
      title: pr.title,
      authorUsername: pr.authorUsername,
      state: pr.state,
      createdAt: pr.createdAt,
      externalUrl: pr.externalUrl,
      mergedAt: pr.mergedAt || null,
      closedAt: pr.closedAt || null,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      commitsCount: pr.commitsCount ?? 0,
      reviewsCount: pr.reviewsCount ?? 0,
      cycleTimeHours: pr.cycleTimeHours ?? 0,
      metadata: {
        labels: pr.metadata?.labels || [],
        reviewers: pr.metadata?.reviewers || [],
        draft: pr.metadata?.draft ?? false,
      },
    })),
    commits: (data.commits || []).map((c: any) => ({
      sha: c.sha,
      authorUsername: c.authorUsername,
      message: c.message,
      committedAt: c.committedAt,
      prExternalId: c.prExternalId || null,
      externalUrl: c.externalUrl,
      additions: c.additions ?? 0,
      deletions: c.deletions ?? 0,
      isAiAssisted: c.isAiAssisted ?? false,
      aiTool: c.aiTool || null,
      aiModel: c.aiModel || null,
    })),
  };

  await upload("github-prs", payload);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
