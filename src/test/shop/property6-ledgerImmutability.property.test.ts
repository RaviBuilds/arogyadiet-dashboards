// src/test/shop/property6-ledgerImmutability.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 6 (Task 4.12)
//
// Property 6: Ledger entries are immutable.
//
// For any existing ledger entry and any attempted update or delete of it, the
// attempt is rejected and the stored entry's clinic, product, direction,
// quantity, movement source, actor, references, and timestamp are unchanged.
//
// **Validates: Requirements 2.9, 1.14**
//
// WHY THIS IS SPLIT INTO TWO HALVES
// Property 6 is primarily a DATABASE-LEVEL guarantee: `trg_cpl_append_only`
// (scripts/create-clinic-product-ledger-table.sql) rejects any UPDATE/DELETE
// on `clinic_product_ledger`, with a `REVOKE UPDATE, DELETE` as a second layer.
// That guarantee is already asserted structurally by
// create-clinic-product-ledger-table.sql's own comments and exercised live by
// the live-database half of schema-guards.integration.test.ts (Task 1.4). There
// is no live database available in this environment, so this file cannot
// re-prove the trigger fires — it instead:
//
//   (1) Asserts the SQL source that defines the trigger, its function, and the
//       REVOKE actually encode "reject unconditionally, no escape branch" —
//       reading the file, not executing it.
//   (2) Proves the MODEL's own mutation surface (`clinicStockModel.ts`) never
//       mutates an existing `world.ledger` entry in place. The model has no
//       update/delete function at all — it only ever appends — so this half
//       checks that fact holds across an arbitrary movement sequence, for every
//       operation kind, whether accepted (appends) or rejected/visibility-only
//       (appends nothing, but also touches nothing already there).
//
// vitest + fast-check, >=100 runs for the property-based half.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  clinicShopApplySale,
  clinicShopStockIn,
  createWorld,
  setClinicProductVisibility,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  ADDON_ORDER_IDS,
  arbMovementSequence,
  CORE_CLINIC_IDS,
  INVENTORY_PRODUCT_IDS,
  PRODUCT_IDS,
  type MovementCommand,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;
const REPO_ROOT = process.cwd();

// ─── (1) Structural: the SQL itself defines an unconditional, two-layer guard ─

describe("Property 6 (structural): the ledger's SQL defines an unconditional append-only guard", () => {
  const ledgerTableSql = readFileSync(
    path.join(REPO_ROOT, "scripts", "create-clinic-product-ledger-table.sql"),
    "utf8",
  );

  it("defines trg_cpl_append_only as a BEFORE UPDATE OR DELETE trigger on clinic_product_ledger", () => {
    expect(ledgerTableSql).toMatch(
      /CREATE TRIGGER\s+trg_cpl_append_only\s+BEFORE UPDATE OR DELETE ON public\.clinic_product_ledger/,
    );
    expect(ledgerTableSql).toMatch(
      /EXECUTE FUNCTION public\.reject_clinic_ledger_mutation\(\)/,
    );
  });

  it("reject_clinic_ledger_mutation() unconditionally raises, with no branch that could let an UPDATE/DELETE through", () => {
    const match = ledgerTableSql.match(
      /CREATE OR REPLACE FUNCTION public\.reject_clinic_ledger_mutation\(\)[\s\S]*?\$\$;/,
    );
    expect(match).not.toBeNull();
    const fnBody = match![0];

    // The function must raise an exception...
    expect(fnBody).toMatch(/RAISE EXCEPTION/);
    // ...and must not contain any conditional construct (IF/CASE/WHEN) that
    // could route execution around the RAISE for some inputs. The whole body
    // between BEGIN and END should be nothing but the RAISE statement.
    expect(fnBody).not.toMatch(/\bIF\b/i);
    expect(fnBody).not.toMatch(/\bCASE\b/i);
    expect(fnBody).not.toMatch(/\bWHEN\b/i);
    expect(fnBody).not.toMatch(/\bRETURN\b/i);
  });

  it("the raised exception carries the CLINIC_STOCK_LEDGER_IMMUTABLE: prefix", () => {
    expect(ledgerTableSql).toMatch(/CLINIC_STOCK_LEDGER_IMMUTABLE:/);
    // The prefix must appear inside the RAISE EXCEPTION for the mutation guard,
    // not merely somewhere else in the file.
    const match = ledgerTableSql.match(
      /CREATE OR REPLACE FUNCTION public\.reject_clinic_ledger_mutation\(\)[\s\S]*?\$\$;/,
    );
    expect(match![0]).toMatch(/RAISE EXCEPTION[\s\S]*CLINIC_STOCK_LEDGER_IMMUTABLE:/);
  });

  it("REVOKEs UPDATE and DELETE on clinic_product_ledger as the belt-and-braces second layer", () => {
    expect(ledgerTableSql).toMatch(
      /REVOKE UPDATE,\s*DELETE ON public\.clinic_product_ledger FROM authenticated/,
    );
    expect(ledgerTableSql).toMatch(
      /REVOKE UPDATE,\s*DELETE ON public\.clinic_product_ledger FROM anon/,
    );
  });

  it("neither the stock-in RPC nor the apply-sale RPC ever UPDATEs or DELETEs clinic_product_ledger (INSERT only)", () => {
    const rpcFiles = [
      "create-clinic-shop-stock-in-rpc.sql",
      "create-clinic-shop-apply-sale-rpc.sql",
    ];

    for (const file of rpcFiles) {
      const source = readFileSync(path.join(REPO_ROOT, "scripts", file), "utf8");

      expect(source).not.toMatch(/UPDATE\s+public\.clinic_product_ledger/i);
      expect(source).not.toMatch(/DELETE\s+FROM\s+public\.clinic_product_ledger/i);

      // Each RPC does write to the ledger — confirming the absence above isn't
      // simply because the table is never touched.
      expect(source).toMatch(/INSERT INTO public\.clinic_product_ledger/);
    }
  });
});

// ─── (2) Model: nothing in the model's mutation surface ever mutates a prior

// ledger entry in place — every operation only ever appends ─────────────────

/** A world with every fixture product linked and warehouse lots seeded, so
 * stock-in and sale submissions can genuinely be accepted (appending entries)
 * as well as rejected (appending nothing). */
function buildWorld(): World {
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: PRODUCT_IDS.map((id, index) => ({
      id,
      inventoryProductId: INVENTORY_PRODUCT_IDS[index % INVENTORY_PRODUCT_IDS.length],
    })),
    lots: {
      [INVENTORY_PRODUCT_IDS[0]]: [{ id: "seed-lot-0", quantityRemaining: 10_000_000 }],
      [INVENTORY_PRODUCT_IDS[1]]: [{ id: "seed-lot-1", quantityRemaining: 10_000_000 }],
    },
    addonOrderIds: [...ADDON_ORDER_IDS],
    actorUserIds: [...ACTOR_USER_IDS],
  });
}

/** Apply one movement command against the model, mirroring the sequence-form
 * helper used by Property 3's test. Rejections and visibility-only operations
 * are expected to leave the ledger untouched. */
function applyCommand(world: World, command: MovementCommand): void {
  switch (command.kind) {
    case "stock-in": {
      clinicShopStockIn(world, {
        clinicId: command.clinicId,
        lines: [{ productId: command.productId, quantity: command.quantity }],
        actorUserId: command.actorUserId,
      });
      return;
    }
    case "sale": {
      clinicShopApplySale(world, {
        clinicId: command.clinicId,
        addonOrderId: command.addonOrderId,
        lines: [{ productId: command.productId, quantity: command.quantity }],
        movementSource: command.channel,
        actorUserId: command.actorUserId,
      });
      return;
    }
    case "set-visibility": {
      setClinicProductVisibility(world, {
        clinicId: command.clinicId,
        productId: command.productId,
        isVisible: command.isVisible,
      });
      return;
    }
  }
}

describe("Property 6 (model): every model operation only ever appends to the ledger, never mutates a prior entry", () => {
  it("for an arbitrary movement sequence, every ledger entry present before a step is still present, unchanged, at the same index after the step", () => {
    fc.assert(
      fc.property(
        arbMovementSequence({
          clinicIds: [CORE_CLINIC_IDS[0], CORE_CLINIC_IDS[1]],
          productIds: [PRODUCT_IDS[0], PRODUCT_IDS[1]],
          maxLength: 20,
        }),
        (commands) => {
          const world = buildWorld();

          for (const command of commands) {
            // Snapshot every prior entry as a shallow copy before the step.
            const before = world.ledger.map((entry) => ({ ...entry }));

            applyCommand(world, command);

            // Every entry that existed before the step must still exist,
            // unchanged, at the SAME index — the model, by construction, only
            // ever appends. This holds whether the step appended a new entry
            // (accepted stock-in/sale), appended nothing (rejection), or is
            // not a stock change at all (set-visibility, Req 6.6).
            expect(world.ledger.length).toBeGreaterThanOrEqual(before.length);
            for (let index = 0; index < before.length; index += 1) {
              expect(world.ledger[index]).toEqual(before[index]);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("clinicStockModel.ts exposes no update/delete function over the ledger at all — appends are the only mutation surface", () => {
    const modelSource = readFileSync(
      path.join(REPO_ROOT, "src", "test", "shop", "clinicStockModel.ts"),
      "utf8",
    );

    // The only mutation of `draft.ledger` (or `world.ledger`) anywhere in the
    // model is the push inside `appendLedger` — there is no assignment into an
    // existing element (`ledger[i] = ...`) and no splice/pop/shift removal.
    expect(modelSource).not.toMatch(/ledger\[[^\]]+\]\s*=/);
    expect(modelSource).not.toMatch(/ledger\.(splice|pop|shift)\(/);
    expect(modelSource).not.toMatch(/export function\s+\w*(Update|Delete|Remove)\w*Ledger/i);
  });
});
