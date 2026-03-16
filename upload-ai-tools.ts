#!/usr/bin/env tsx
/**
 * Upload AI tool usage data to Arka Intelligence API.
 * Reads the output of sync-claude-code.ts, sync-cursor.ts, or sync-copilot.ts
 * and POSTs it to /uploads/ai-tools.
 *
 * Usage:
 *   npm run upload:ai -- --source=<tool> [options]
 *
 * Options:
 *   --source=<tool>  Required. One of: claude-code, cursor, github-copilot
 *   --input=<file>   Input file (default: based on --source)
 *   --api-url=<url>  API base URL (default: https://intel.arka.so/api/v1)
 *   --dry-run        Print what would be uploaded without sending
 */

import * as fs from "fs";

const API_URL =
  getArg("--api-url") || "https://intel.arka.so/api/v1";
const API_KEY = process.env.API_ADMIN_KEY || loadEnvKey();
const SOURCE = getArg("--source");
const DRY_RUN = process.argv.includes("--dry-run");

const DEFAULT_FILES: Record<string, string> = {
  "claude-code": "claude-code-data.json",
  cursor: "cursor-data.json",
  "github-copilot": "copilot-data.json",
};

const INPUT = getArg("--input") || (SOURCE ? DEFAULT_FILES[SOURCE] : undefined);

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
  const url = `${API_URL}/uploads/ai-tools`;
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

function transformClaudeCode(data: any): any {
  return {
    metadata: {
      source: "claude-code",
      organizationSlug: data.metadata?.organizationSlug || "unknown",
      startDate: data.metadata?.startDate,
      endDate: data.metadata?.endDate,
      exportedAt: data.metadata?.exportedAt || new Date().toISOString(),
      version: "1.0",
    },
    users: (data.users || []).map((u: any) => ({
      email: u.email,
      githubUsername: "",
      tool: "claude-code",
      name: u.email,
      isActive: u.isActive,
      activeDays: u.activeDays ?? 0,
      tabsAccepted: 0,
      tabsTotal: 0,
      agentEditsAccepted: u.toolActions?.overall?.accepted ?? 0,
      agentEditsRejected: u.toolActions?.overall?.rejected ?? 0,
      commandsRun: 0,
      planModeUses: 0,
      askModeUses: 0,
      modelsUsed: (u.modelBreakdown || []).map((m: any) => m.model),
      linesWithAi: u.totalLinesAdded ?? 0,
      totalLines: (u.totalLinesAdded ?? 0) + (u.totalLinesRemoved ?? 0),
      prsWithAi: u.totalPRs ?? 0,
      totalPrs: u.totalPRs ?? 0,
    })),
  };
}

function transformCursor(data: any): any {
  return {
    metadata: {
      source: "cursor",
      organizationSlug: data.metadata?.organizationSlug || "unknown",
      startDate: data.metadata?.startDate,
      endDate: data.metadata?.endDate,
      exportedAt: data.metadata?.exportedAt || new Date().toISOString(),
      version: "1.0",
    },
    users: (data.users || []).map((u: any) => ({
      email: u.email || "",
      githubUsername: "",
      tool: "cursor",
      name: u.name || u.email || u.userId,
      isActive: u.isActive,
      activeDays: u.activeDays ?? 0,
      tabsAccepted: u.tabs?.accepted ?? 0,
      tabsTotal: u.tabs?.total ?? 0,
      agentEditsAccepted: u.agentEdits?.accepted ?? 0,
      agentEditsRejected: u.agentEdits?.rejected ?? 0,
      commandsRun: u.commandsRun ?? 0,
      planModeUses: u.planModeUses ?? 0,
      askModeUses: u.askModeUses ?? 0,
      modelsUsed: u.modelsUsed || [],
      linesWithAi: 0,
      totalLines: 0,
      prsWithAi: 0,
      totalPrs: 0,
    })),
  };
}

function transformCopilot(data: any): any {
  const today = new Date().toISOString().slice(0, 10);
  return {
    metadata: {
      source: "github-copilot",
      organizationSlug: data.metadata?.organizationSlug || "unknown",
      startDate: today,
      endDate: today,
      exportedAt: data.metadata?.exportedAt || new Date().toISOString(),
      version: "1.0",
    },
    users: (data.seats || []).map((s: any) => ({
      email: "",
      githubUsername: s.login,
      tool: "github-copilot",
      name: s.login,
      isActive: s.status === "active",
      activeDays: s.status === "active" ? 1 : 0,
      tabsAccepted: 0,
      tabsTotal: 0,
      agentEditsAccepted: 0,
      agentEditsRejected: 0,
      commandsRun: 0,
      planModeUses: 0,
      askModeUses: 0,
      modelsUsed: [],
      linesWithAi: 0,
      totalLines: 0,
      prsWithAi: 0,
      totalPrs: 0,
    })),
  };
}

async function main() {
  if (!SOURCE || !["claude-code", "cursor", "github-copilot"].includes(SOURCE)) {
    console.error("Usage: npm run upload:ai -- --source=<claude-code|cursor|github-copilot>");
    process.exit(1);
  }

  if (!INPUT || !fs.existsSync(INPUT)) {
    console.error(`File not found: ${INPUT || "(no input)"}`);
    console.error(`Run the export first, then upload.`);
    process.exit(1);
  }

  console.log(`Reading ${INPUT} (source: ${SOURCE}) ...`);
  const data = JSON.parse(fs.readFileSync(INPUT, "utf-8"));

  let payload: any;
  switch (SOURCE) {
    case "claude-code":
      payload = transformClaudeCode(data);
      break;
    case "cursor":
      payload = transformCursor(data);
      break;
    case "github-copilot":
      payload = transformCopilot(data);
      break;
  }

  const userCount = payload.users?.length ?? 0;
  console.log(`Transformed ${userCount} users for upload`);

  await upload(payload);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
