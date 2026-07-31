// scripts/generate-kit-import-template.mjs
//
// Regenerates the client-facing KIT customer data-collection workbook at
//   public/templates/bulk-migration/KIT_Customer_Data_Collection_Template.xlsx
//
// This is the file you hand to a client to collect offline KIT customer data.
// It contains:
//   00_read_me             — every field with REQUIRED/OPTIONAL, format, notes
//   01_kit_customers       — the sheet the client fills in (2 sample rows)
//   reference_kit_products — the active KIT product names to choose from
//
// The column spec is imported from src/lib/bulk-migration/kitTemplates.ts, the
// same module the in-app download and the importer's validator use, so the three
// can never drift apart.
//
// Usage (from the repo root):
//   node scripts/generate-kit-import-template.mjs
//
// KIT product names are read live from the database when
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available (from the
// environment or .env.local). Without them the reference sheet is written with a
// short "download from the admin portal" note instead, and the rest of the
// workbook is unaffected.
//
// Requires Node 22.6+ (native TypeScript type stripping for the shared spec).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import {
  KIT_CUSTOMER_BULK_HEADERS,
  KIT_CUSTOMER_BULK_KEYS,
  KIT_CUSTOMER_BULK_SAMPLE_ROWS,
  KIT_GUIDE_HEADERS,
  KIT_GUIDE_INTRO,
  KIT_GUIDE_ROWS,
} from "../src/lib/bulk-migration/kitTemplates.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = path.join(
  REPO_ROOT,
  "public/templates/bulk-migration/KIT_Customer_Data_Collection_Template.xlsx",
);

/**
 * Minimal `.env.local` loader — the repo has no dotenv dependency and this
 * script runs outside Next.js, which is what normally injects these values.
 * Values already present in `process.env` win. Mirrors scripts/seed-dietitians.mjs.
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

/** Active KIT products, or `null` when the database is not reachable. */
async function fetchKitProducts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  try {
    const supabase = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase
      .from("kit_products")
      .select("name, base_price")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return (data ?? []).map((p) => ({
      name: p.name,
      price: Number(p.base_price ?? 0),
    }));
  } catch (err) {
    console.warn(`Could not read kit_products: ${err.message ?? err}`);
    return null;
  }
}

async function main() {
  loadEnvLocal();
  const products = await fetchKitProducts();

  const wb = XLSX.utils.book_new();

  const guideSheet = XLSX.utils.aoa_to_sheet([
    ...KIT_GUIDE_INTRO.map((line) => [line]),
    [...KIT_GUIDE_HEADERS],
    ...KIT_GUIDE_ROWS,
  ]);
  guideSheet["!cols"] = [{ wch: 26 }, { wch: 20 }, { wch: 46 }, { wch: 82 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "00_read_me");

  const dataSheet = XLSX.utils.aoa_to_sheet([
    [...KIT_CUSTOMER_BULK_HEADERS],
    ...KIT_CUSTOMER_BULK_SAMPLE_ROWS.map((row) =>
      KIT_CUSTOMER_BULK_KEYS.map((key) => row[key] ?? ""),
    ),
  ]);
  dataSheet["!cols"] = KIT_CUSTOMER_BULK_HEADERS.map((h) => ({
    wch: Math.max(16, h.length + 2),
  }));
  XLSX.utils.book_append_sheet(wb, dataSheet, "01_kit_customers");

  const productRows = [
    ["kit_product", "price_inr_inclusive_of_tax"],
    ...(products && products.length > 0
      ? products.map((p) => [p.name, p.price])
      : [
          [
            "Download the live template from Admin > Customers > Bulk migration > KIT customers.",
            "",
          ],
        ]),
  ];
  const productSheet = XLSX.utils.aoa_to_sheet(productRows);
  productSheet["!cols"] = [{ wch: 44 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, productSheet, "reference_kit_products");

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    products
      ? `Included ${products.length} active KIT product(s) in reference_kit_products.`
      : "No database credentials found — reference_kit_products holds a pointer to the in-app download.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
