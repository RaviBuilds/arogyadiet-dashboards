// src/lib/clinic/__tests__/helpers/inMemoryDb.ts
//
// Shared in-memory Supabase fake for the master-portal business/city/kitchen/
// clinic Server Action tests (core-clinic-architecture, tasks 3.6–3.10).
//
// A live Supabase connection is not available in unit tests, so this module
// provides a single in-memory model of the tables the clinic-domain
// repositories and master actions touch, plus minimal `createAdminClient`
// (data access) and `createClient` (auth) fakes that close over that model.
//
// It is intentionally NOT a `.test.ts` file, so vitest does not collect it as a
// test suite. Test files register the mocks via:
//
//   vi.mock("@/lib/supabase/admin", async () => {
//     const h = await vi.importActual<typeof import("./helpers/inMemoryDb")>(
//       "./helpers/inMemoryDb",
//     );
//     return { createAdminClient: () => h.makeAdminClient() };
//   });
//   vi.mock("@/lib/supabase/server", async () => {
//     const h = await vi.importActual<typeof import("./helpers/inMemoryDb")>(
//       "./helpers/inMemoryDb",
//     );
//     return { createClient: async () => h.makeServerClient() };
//   });
//
// Because the module is a singleton, the `db`/auth handles imported by the test
// are the exact instances the fake clients read and write.

export type Row = Record<string, unknown>;

export interface InMemoryDb {
  businesses: Row[];
  cities: Row[];
  kitchens: Row[];
  clinics: Row[];
  users: Row[];
  rider_service_areas: Row[];
  rider_profiles: Row[];
  customer_profiles: Row[];
  workload_snapshots: Row[];
}

type TableName = keyof InMemoryDb;

/** The shared singleton model. */
export const db: InMemoryDb = {
  businesses: [],
  cities: [],
  kitchens: [],
  clinics: [],
  users: [],
  rider_service_areas: [],
  rider_profiles: [],
  customer_profiles: [],
  workload_snapshots: [],
};

/** Auth state consulted by the server-client fake's `auth.getUser()`. */
export const authState: { user: { id: string } | null } = {
  user: { id: "auth-user-1" },
};

let idCounter = 0;
/** Deterministic-ish unique id generator for inserts. */
export function genId(prefix = "row"): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Clear all tables and reset auth to an authenticated MASTER_ADMIN. */
export function resetDb(): void {
  for (const key of Object.keys(db) as TableName[]) {
    db[key].length = 0;
  }
  idCounter = 0;
  authState.user = { id: "auth-user-1" };
  // Seed the calling user as MASTER_ADMIN by default (passes both the
  // MASTER_ADMIN-only and ADMIN/MASTER_ADMIN authorization gates).
  db.users.push({
    id: "user-1",
    auth_user_id: "auth-user-1",
    roles: { code: "MASTER_ADMIN" },
  });
}

/** Set the calling user's role code (e.g. "ADMIN", "MASTER_ADMIN"). */
export function setAuthRole(code: string): void {
  authState.user = { id: "auth-user-1" };
  const existing = db.users.find((u) => u.auth_user_id === "auth-user-1");
  if (existing) {
    existing.roles = { code };
  } else {
    db.users.push({ id: "user-1", auth_user_id: "auth-user-1", roles: { code } });
  }
}

/** Simulate an unauthenticated caller. */
export function setUnauthenticated(): void {
  authState.user = null;
}

// ─── Seed helpers (return the generated id) ──────────────────────────────────

export function addBusiness(overrides: Partial<Row> = {}): string {
  const id = (overrides.id as string) ?? genId("business");
  db.businesses.push({
    id,
    name: `Business ${id}`,
    type: "Core",
    created_at: null,
    updated_at: null,
    ...overrides,
    id,
  });
  return id;
}

export function addCity(overrides: Partial<Row> = {}): string {
  const id = (overrides.id as string) ?? genId("city");
  db.cities.push({
    id,
    name: `City ${id}`,
    created_at: null,
    updated_at: null,
    ...overrides,
    id,
  });
  return id;
}

export function addKitchen(overrides: Partial<Row> = {}): string {
  const id = (overrides.id as string) ?? genId("kitchen");
  db.kitchens.push({
    id,
    name: `Kitchen ${id}`,
    business_id: null,
    city_id: null,
    ...overrides,
    id,
  });
  return id;
}

export function addClinic(overrides: Partial<Row> = {}): string {
  const id = (overrides.id as string) ?? genId("clinic");
  db.clinics.push({
    id,
    name: `Clinic ${id}`,
    address: "1 Test Road",
    latitude: 17.0,
    longitude: 78.0,
    kitchen_id: null,
    franchise_id: null,
    created_at: null,
    updated_at: null,
    ...overrides,
    id,
  });
  return id;
}

// ─── Query builder ───────────────────────────────────────────────────────────

type Mode = "select" | "insert" | "update" | "delete";

class QueryBuilder {
  private mode: Mode = "select";
  private values: Row = {};
  private filters: Array<(row: Row) => boolean> = [];
  private head = false;
  private wantCount = false;
  private orderCol: string | null = null;
  private orderAsc = true;

  constructor(
    private readonly database: InMemoryDb,
    private readonly table: TableName,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") this.mode = "select";
    if (opts?.head) this.head = true;
    if (opts?.count === "exact") this.wantCount = true;
    return this;
  }

  insert(values: Row) {
    this.mode = "insert";
    this.values = values;
    return this;
  }

  update(values: Row, opts?: { count?: string }) {
    this.mode = "update";
    this.values = values;
    if (opts?.count === "exact") this.wantCount = true;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  neq(col: string, val: unknown) {
    this.filters.push((row) => row[col] !== val);
    return this;
  }

  ilike(col: string, pattern: string) {
    // No wildcards are used by the repositories, so ilike reduces to a
    // case-insensitive exact match.
    const needle = String(pattern).toLowerCase();
    this.filters.push(
      (row) => String(row[col] ?? "").toLowerCase() === needle,
    );
    return this;
  }

  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.filters.push((row) => set.has(row[col]));
    return this;
  }

  not(col: string, operator: string, val: unknown) {
    if (operator === "is" && val === null) {
      this.filters.push((row) => row[col] !== null && row[col] !== undefined);
    }
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(_n: number) {
    return this;
  }

  // ── Internal execution ──────────────────────────────────────────────────

  private rows(): Row[] {
    return this.database[this.table];
  }

  private matched(): Row[] {
    let ms = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      ms = [...ms].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return ms;
  }

  private run(): { rows: Row[]; count: number } {
    const all = this.rows();
    switch (this.mode) {
      case "insert": {
        const id = (this.values.id as string) ?? genId(this.table);
        const row: Row = { ...this.values, id };
        all.push(row);
        return { rows: [row], count: 1 };
      }
      case "update": {
        const ms = this.matched();
        for (const r of ms) Object.assign(r, this.values);
        return { rows: ms, count: ms.length };
      }
      case "delete": {
        const ms = this.matched();
        for (const r of ms) {
          const idx = all.indexOf(r);
          if (idx >= 0) all.splice(idx, 1);
        }
        return { rows: ms, count: ms.length };
      }
      case "select":
      default:
        return { rows: this.matched(), count: this.matched().length };
    }
  }

  // ── Terminals ────────────────────────────────────────────────────────────

  single(): Promise<{ data: Row | null; error: unknown }> {
    const { rows } = this.run();
    const data = rows[0] ?? null;
    return Promise.resolve({ data, error: null });
  }

  maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
    const { rows } = this.run();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  then(
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) {
    let result: unknown;
    try {
      const { rows, count } = this.run();
      if (this.head) {
        result = { data: null, error: null, count };
      } else if (this.wantCount) {
        result = { data: rows, error: null, count };
      } else {
        result = { data: rows, error: null };
      }
    } catch (err) {
      return Promise.reject(err).then(onFulfilled, onRejected);
    }
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

// ─── Client factories ─────────────────────────────────────────────────────────

/** Fake service-role admin client used by the clinic-domain repositories. */
export function makeAdminClient() {
  return {
    from: (table: TableName) => new QueryBuilder(db, table),
  };
}

/** Fake SSR server client used by the action-layer authorization helpers. */
export function makeServerClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: authState.user }, error: null }),
    },
    from: (table: TableName) => new QueryBuilder(db, table),
  };
}
