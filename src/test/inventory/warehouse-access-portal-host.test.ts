// src/test/inventory/warehouse-access-portal-host.test.ts
//
// Unit tests for resolvePortalFromHost — Requirements: 7.4
//

import { describe, it, expect } from "vitest";
import { resolvePortalFromHost } from "@/lib/inventory/warehouse-access";

describe("resolvePortalFromHost", () => {
  describe("admin portal resolution", () => {
    it('returns "admin" for admin.arogyadiet.com', () => {
      expect(resolvePortalFromHost("admin.arogyadiet.com")).toBe("admin");
    });

    it('returns "admin" for admin.localhost:3000', () => {
      expect(resolvePortalFromHost("admin.localhost:3000")).toBe("admin");
    });

    it('returns "admin" for ADMIN.example.com (case insensitive)', () => {
      expect(resolvePortalFromHost("ADMIN.example.com")).toBe("admin");
    });
  });

  describe("master portal resolution", () => {
    it('returns "master" for master.arogyadiet.com', () => {
      expect(resolvePortalFromHost("master.arogyadiet.com")).toBe("master");
    });

    it('returns "master" for master.localhost:3000', () => {
      expect(resolvePortalFromHost("master.localhost:3000")).toBe("master");
    });

    it('returns "master" for MASTER.example.com (case insensitive)', () => {
      expect(resolvePortalFromHost("MASTER.example.com")).toBe("master");
    });
  });

  describe("unknown portal resolution", () => {
    it('returns "unknown" for null', () => {
      expect(resolvePortalFromHost(null)).toBe("unknown");
    });

    it('returns "unknown" for empty string', () => {
      expect(resolvePortalFromHost("")).toBe("unknown");
    });

    it('returns "unknown" for localhost:3000 (no subdomain prefix)', () => {
      expect(resolvePortalFromHost("localhost:3000")).toBe("unknown");
    });

    it('returns "unknown" for customer.arogyadiet.com', () => {
      expect(resolvePortalFromHost("customer.arogyadiet.com")).toBe("unknown");
    });

    it('returns "unknown" for random-host.com', () => {
      expect(resolvePortalFromHost("random-host.com")).toBe("unknown");
    });
  });
});
