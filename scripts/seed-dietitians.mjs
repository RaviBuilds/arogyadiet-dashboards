// ============================================================================
// DIETITIAN MANAGEMENT — SEED THE FOUR EXISTING DIETITIANS (IDEMPOTENT)
// ============================================================================
// Feature: dietitian-management
// Requirements: 4.1, 4.2, 4.3, 4.6
//
// Creates the four Dietitians already working in the business so that logging
// can begin on release:
//
//   Avinash  / 9154850031 / arogyadiet.avinashd@gmail.com
//   Nandini  / 9154850030 / nandini.dt03.arogyadiet@gmail.com
//   Divya    / 9154850029 / divya.dt03.arogyadiet@gmail.com
//   Joshitha / 9059410172 / joshitha.dt04.arogyadiet@gmail.com
//
// Each row is written with role `ADMIN`, `admin_access_level = 'dietitian'`,
// `franchise_id = NULL`, `dietitian_clinic_id = NULL` (the Dietitian_Clinic_Link
// starts empty — the master admin assigns the Clinic later), `is_active = true`
// and `force_password_change = true` (Req 4.1, 4.2, 4.3).
//
// Idempotence (Req 4.6, 1.3, 26.8): a Dietitian whose email or mobile already
// exists on a `users` row is left completely unchanged and reported as skipped,
// so a second run is a no-op.
//
// Prerequisite: `scripts/create-dietitian-management.sql` must have been applied
// (it adds the `dietitian` access level and `users.dietitian_clinic_id`).
//
// Usage (from the repo root):
//   node scripts/seed-dietitians.mjs             # create missing Dietitians
//   node scripts/seed-dietitians.mjs --dry-run   # report only, write nothing
//
// Credentials are read from the environment, falling back to `.env.local`:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// An initial password may be supplied via DIETITIAN_SEED_PASSWORD; otherwise a
// random one is generated per account and printed once. Every account is created
// with force_password_change = true, so the password is temporary either way.
// ============================================================================

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
// The create/skip decision lives in a pure module so it can be property-tested
// without a database (Property 37).
import {
  DIETITIANS,
  planDietitianSeed,
  seedLookupValues,
} from "./lib/dietitian-seed-plan.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Minimal `.env.local` loader — the repo has no dotenv dependency and this
 * script runs outside Next.js, which is what normally injects these values.
 * Values already present in `process.env` win.
 */
function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Temporary password, replaced on first login (force_password_change = true). */
function generatePassword() {
  return `Arogya@${randomBytes(6).toString("base64url")}`;
}

function log(message) {
  console.log(message);
}

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in the environment or .env.local.",
    );
    process.exit(1);
  }

  // Fail fast on bad seed data rather than on the database check constraint.
  for (const d of DIETITIANS) {
    if (!/^\d{10}$/.test(d.mobile)) {
      console.error(`Seed data error: ${d.fullName} has a non 10-digit mobile (${d.mobile}).`);
      process.exit(1);
    }
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  log(`Seeding ${DIETITIANS.length} Dietitians${DRY_RUN ? " (dry run — nothing is written)" : ""}\n`);

  // ADMIN role id — every seeded Dietitian is a Core_Business Dietitian (Req 4.2).
  const { data: roleData, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("code", "ADMIN")
    .single();

  if (roleError || !roleData) {
    console.error(`Could not resolve the ADMIN role: ${roleError?.message ?? "not found"}`);
    process.exit(1);
  }

  // One query for every conflicting email or mobile (Req 4.6).
  const { emails, mobiles } = seedLookupValues(DIETITIANS);
  const { data: existingRows, error: existingError } = await supabase
    .from("users")
    .select("id, email, mobile, admin_access_level, is_active")
    .or(`email.in.(${emails.join(",")}),mobile.in.(${mobiles.join(",")})`);

  if (existingError) {
    console.error(`Could not read existing users: ${existingError.message}`);
    process.exit(1);
  }

  // Pure decision: who is created, who is skipped and why (Req 4.6).
  const plan = planDietitianSeed(DIETITIANS, existingRows ?? []);

  const created = [];
  const skipped = [];
  const failed = [];

  for (const decision of plan.decisions) {
    const { dietitian, email } = decision;

    // Skip and report — the existing row is left completely unchanged (Req 4.6).
    if (decision.action === "skip") {
      const { reason, existingUserId } = decision;
      skipped.push({ ...dietitian, reason, existingUserId });
      log(`SKIP    ${dietitian.fullName} (${email}) — ${reason}, row left unchanged`);
      continue;
    }

    if (DRY_RUN) {
      created.push({ ...dietitian, password: "(dry run)" });
      log(`WOULD CREATE ${dietitian.fullName} (${email})`);
      continue;
    }

    const password = process.env.DIETITIAN_SEED_PASSWORD || generatePassword();

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: dietitian.fullName },
    });

    if (authError || !authData?.user) {
      failed.push({ ...dietitian, error: authError?.message ?? "auth user not returned" });
      log(`FAILED  ${dietitian.fullName} (${email}) — ${authError?.message ?? "auth user not returned"}`);
      continue;
    }

    const authUserId = authData.user.id;

    const { error: insertError } = await supabase.from("users").insert({
      auth_user_id: authUserId,
      role_id: roleData.id,
      full_name: dietitian.fullName,
      email,
      mobile: dietitian.mobile,
      admin_access_level: "dietitian",
      admin_operations_access: null,
      franchise_id: null,
      dietitian_clinic_id: null,
      is_active: true,
      is_email_verified: true,
      force_password_change: true,
    });

    if (insertError) {
      // Leave no partial account behind, mirroring createAdminUser.
      await supabase.auth.admin.deleteUser(authUserId);
      failed.push({ ...dietitian, error: insertError.message });
      log(`FAILED  ${dietitian.fullName} (${email}) — ${insertError.message} (auth account rolled back)`);
      continue;
    }

    created.push({ ...dietitian, password });
    log(`CREATED ${dietitian.fullName} (${email})`);
  }

  log(
    `\nSummary: ${created.length} created, ${skipped.length} skipped, ${failed.length} failed.`,
  );

  if (skipped.length > 0) {
    log("\nSkipped (pre-existing rows, unchanged):");
    for (const s of skipped) log(`  - ${s.fullName} <${s.email}> / ${s.mobile} — ${s.reason}`);
  }

  if (created.length > 0 && !DRY_RUN) {
    log("\nTemporary passwords (shown once — every account must change it on first login):");
    for (const c of created) log(`  - ${c.email}  ${c.password}`);
    log("\nNext step: assign a Clinic to each Dietitian in the Master Portal.");
  }

  if (failed.length > 0) {
    log("\nFailed:");
    for (const f of failed) log(`  - ${f.fullName} <${f.email}> — ${f.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Seed aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
