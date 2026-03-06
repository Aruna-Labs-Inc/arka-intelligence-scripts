#!/usr/bin/env node
/**
 * Arka Intelligence - GitHub Copilot Seat Utilization Export
 *
 * Exports Copilot seat assignments and activity for an organization,
 * showing who has a seat, when they last used it, and which editor they used.
 *
 * Usage:
 *   npm install
 *   npm run export:copilot -- <org> [options]
 *
 * Examples:
 *   npm run export:copilot -- myorg
 *   npm run export:copilot -- myorg --output=copilot.json
 *   npm run export:copilot -- myorg --inactive-days=14
 *
 * Prerequisites:
 *   gh auth login  (must be an org owner or Copilot billing manager)
 *
 * Options:
 *   --output=<file>        Output JSON file (default: copilot-data.json)
 *   --org-slug=<slug>      Organization slug in Arka (default: org name)
 *   --inactive-days=<n>    Days without activity to consider inactive (default: 30)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

// =============================================================================
// Types
// =============================================================================

interface CopilotSeat {
  created_at: string;
  updated_at: string;
  pending_cancellation_date: string | null;
  last_activity_at: string | null;
  last_activity_editor: string | null;
  plan_type?: string;
  assignee: {
    login: string;
    id: number;
    avatar_url: string;
    type: string;
  };
  assigning_team?: {
    name: string;
    slug: string;
  } | null;
}

interface CopilotSeatsResponse {
  total_seats: number;
  seats: CopilotSeat[];
}

interface ExportOptions {
  org: string;
  orgSlug: string;
  outputFile: string;
  inactiveDays: number;
}

interface CopilotExportPayload {
  metadata: {
    exportedAt: string;
    organization: string;
    organizationSlug: string;
    totalSeats: number;
    version: string;
  };
  summary: {
    totalSeats: number;
    activeSeats: number;
    inactiveSeats: number;
    neverUsedSeats: number;
    inactiveThresholdDays: number;
  };
  seats: Array<{
    login: string;
    externalId: string;
    avatarUrl: string;
    seatAssignedAt: string;
    lastActivityAt: string | null;
    lastActivityEditor: string | null;
    pendingCancellationDate: string | null;
    assigningTeam: string | null;
    planType: string | null;
    status: "active" | "inactive" | "never_used";
    daysSinceLastActivity: number | null;
  }>;
}

// =============================================================================
// GitHub API Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghApi<T>(endpoint: string, params: Record<string, string> = {}, retries = 3): Promise<T> {
  const queryStr = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const fullEndpoint = queryStr ? `${endpoint}?${queryStr}` : endpoint;
  const cmd = `gh api "${fullEndpoint}"`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return JSON.parse(result);
    } catch (error: any) {
      const stderr = error.stderr?.toString() || "";
      const stdout = error.stdout?.toString() || "";

      if (stdout.includes('"status":"404"') || stdout.includes("Not Found")) {
        throw new Error(`Not found: ${endpoint}`);
      }

      if (stdout.includes('"status":"403"') || stderr.includes("403")) {
        throw new Error(
          `Access denied (403): You must be an org owner or Copilot billing manager.\nRun: gh auth login`
        );
      }

      if ((stdout.includes("rate limit") || stderr.includes("rate limit")) && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 2000;
        console.warn(`Rate limited, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${retries}...`);
        await sleep(waitTime);
        continue;
      }

      const isNetwork =
        stderr.includes("connection refused") ||
        stderr.includes("connection reset") ||
        stderr.includes("dial tcp");

      if (isNetwork && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 2000;
        console.warn(`Network error, retrying in ${waitTime / 1000}s (attempt ${attempt + 1}/${retries})...`);
        await sleep(waitTime);
        continue;
      }

      if (attempt === retries) throw error;

      await sleep(Math.pow(2, attempt) * 500);
    }
  }

  throw new Error(`Failed after ${retries} retries`);
}

async function fetchAllSeats(org: string): Promise<{ totalSeats: number; seats: CopilotSeat[] }> {
  const allSeats: CopilotSeat[] = [];
  let totalSeats = 0;

  for (let page = 1; ; page++) {
    if (page > 1) await sleep(100);

    const response = await ghApi<CopilotSeatsResponse>(
      `orgs/${org}/copilot/billing/seats`,
      { per_page: "100", page: String(page) }
    );

    if (page === 1) {
      totalSeats = response.total_seats;
    }

    if (!response.seats || response.seats.length === 0) break;
    allSeats.push(...response.seats);
    if (response.seats.length < 100) break;
  }

  return { totalSeats, seats: allSeats };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional.length < 1) {
    console.log("Usage: npm run export:copilot -- <org> [options]");
    console.log("");
    console.log("Options:");
    console.log("  --output=<file>        Output file (default: copilot-data.json)");
    console.log("  --org-slug=<slug>      Organization slug (default: org name)");
    console.log("  --inactive-days=<n>    Inactive threshold in days (default: 30)");
    console.log("");
    console.log("Examples:");
    console.log("  npm run export:copilot -- myorg");
    console.log("  npm run export:copilot -- myorg --inactive-days=14");
    process.exit(1);
  }

  const org = positional[0];
  let outputFile = "copilot-data.json";
  let orgSlug = org;
  let inactiveDays = 30;

  for (const arg of args) {
    if (arg.startsWith("--output=")) outputFile = arg.replace("--output=", "");
    if (arg.startsWith("--org-slug=")) orgSlug = arg.replace("--org-slug=", "");
    if (arg.startsWith("--inactive-days=")) inactiveDays = parseInt(arg.replace("--inactive-days=", ""), 10);
  }

  console.log("=".repeat(60));
  console.log(`GitHub Copilot Seat Utilization: ${org}`);
  console.log(`Inactive threshold: ${inactiveDays} days`);
  console.log(`Output file: ${outputFile}`);
  console.log("=".repeat(60));
  console.log("");

  try {
    console.log(`Fetching Copilot seats for ${org}...`);
    const { totalSeats, seats } = await fetchAllSeats(org);
    console.log(`Found ${seats.length} seat assignments (${totalSeats} total seats billed)`);

    const now = new Date();
    const inactiveThresholdMs = inactiveDays * 24 * 60 * 60 * 1000;

    const exportedSeats: CopilotExportPayload["seats"] = seats
      .filter((s) => s.assignee.type !== "Bot")
      .map((s) => {
        let status: "active" | "inactive" | "never_used";
        let daysSinceLastActivity: number | null = null;

        if (!s.last_activity_at) {
          status = "never_used";
        } else {
          const msSinceActivity = now.getTime() - new Date(s.last_activity_at).getTime();
          daysSinceLastActivity = Math.floor(msSinceActivity / (1000 * 60 * 60 * 24));
          status = msSinceActivity > inactiveThresholdMs ? "inactive" : "active";
        }

        return {
          login: s.assignee.login,
          externalId: String(s.assignee.id),
          avatarUrl: s.assignee.avatar_url,
          seatAssignedAt: s.created_at,
          lastActivityAt: s.last_activity_at,
          lastActivityEditor: s.last_activity_editor,
          pendingCancellationDate: s.pending_cancellation_date,
          assigningTeam: s.assigning_team?.slug ?? null,
          planType: s.plan_type ?? null,
          status,
          daysSinceLastActivity,
        };
      });

    const activeSeats = exportedSeats.filter((s) => s.status === "active").length;
    const inactiveSeats = exportedSeats.filter((s) => s.status === "inactive").length;
    const neverUsedSeats = exportedSeats.filter((s) => s.status === "never_used").length;

    const payload: CopilotExportPayload = {
      metadata: {
        exportedAt: now.toISOString(),
        organization: org,
        organizationSlug: orgSlug,
        totalSeats,
        version: "1.0.0",
      },
      summary: {
        totalSeats: exportedSeats.length,
        activeSeats,
        inactiveSeats,
        neverUsedSeats,
        inactiveThresholdDays: inactiveDays,
      },
      seats: exportedSeats,
    };

    writeFileSync(outputFile, JSON.stringify(payload, null, 2));

    console.log("");
    console.log("=".repeat(60));
    console.log("COPILOT SEAT UTILIZATION");
    console.log("=".repeat(60));
    console.log(`  Total seats billed:  ${totalSeats}`);
    console.log(`  Active (< ${inactiveDays}d):     ${activeSeats}`);
    console.log(`  Inactive (>= ${inactiveDays}d):  ${inactiveSeats}`);
    console.log(`  Never used:          ${neverUsedSeats}`);
    console.log("");

    if (inactiveSeats + neverUsedSeats > 0) {
      console.log(`Inactive / never-used seats:`);
      exportedSeats
        .filter((s) => s.status !== "active")
        .sort((a, b) => {
          if (a.status === "never_used" && b.status !== "never_used") return -1;
          if (b.status === "never_used" && a.status !== "never_used") return 1;
          return (b.daysSinceLastActivity ?? Infinity) - (a.daysSinceLastActivity ?? Infinity);
        })
        .forEach((s) => {
          const detail =
            s.status === "never_used"
              ? "never used"
              : `last active ${s.daysSinceLastActivity}d ago via ${s.lastActivityEditor ?? "unknown"}`;
          console.log(`  - ${s.login} (${detail})`);
        });
      console.log("");
    }

    console.log(`Output written to: ${outputFile}`);
    process.exit(0);
  } catch (error: any) {
    console.error("Export failed:", error.message ?? error);
    process.exit(1);
  }
}

main();
