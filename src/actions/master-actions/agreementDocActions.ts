"use server";

// src/actions/master-actions/agreementDocActions.ts
// Master-portal Server Actions for franchise agreement documents in the
// multi-tenant-franchise hierarchy
// (multi-tenant-franchise spec — Task 9.1, Requirements 7.1–7.9).
//
// LAYERING: Action layer ONLY. These actions orchestrate authorization
// (role / scope), the franchise feature-flag gate, pure metadata validation
// (`agreementDocMetaSchema` from src/validations/franchise.ts), private Supabase
// Storage I/O (upload + short-lived signed URLs), and data access
// (src/repositories/franchise/agreementDocRepository.ts).
//
// STORAGE: the document BYTES live in the PRIVATE Supabase Storage bucket
// `franchise-documents`, keyed by the per-franchise prefix
// `{franchise_id}/{uuid}-{filename}` (Req 7.1). The bucket is private, so a
// download is ONLY ever issued as a short-lived SIGNED URL after an access check
// (Req 7.7) — never a public URL. This mirrors the existing private-bucket
// pattern used for `medical_records` (upload via the service-role admin client +
// `createSignedUrl`).
//
// NOTE: the private bucket `franchise-documents` must be PROVISIONED in Supabase
// by the operator (buckets are provisioned out-of-band, like `medical_records`,
// `product-images`, `avatars`). These actions assume it exists; a missing bucket
// surfaces as a storage error rather than failing at authoring time.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import {
  FRANCHISE_FEATURES_ENABLED,
  GLOBAL_ACCESS_ROLES,
  FRANCHISE_SCOPED_ROLE,
} from "@/lib/franchise/constants";
import { agreementDocMetaSchema } from "@/validations/franchise";
import {
  insertAgreementDoc,
  listAgreementDocsByFranchise,
  getAgreementDocById,
  deleteAgreementDoc,
  type AgreementDocRecord,
} from "@/repositories/franchise/agreementDocRepository";
import { getFranchiseById } from "@/repositories/franchise/franchiseRepository";
import type {
  ActionResult,
  AgreementDocMeta,
  FranchiseContext,
} from "@/types/franchise";

// The PRIVATE Supabase Storage bucket holding agreement document bytes
// (Req 7.1). Must be provisioned in Supabase by the operator.
const AGREEMENT_DOCS_BUCKET = "franchise-documents";

// Short-lived signed-URL lifetime (seconds). Downloads are only ever issued as
// expiring signed URLs, never public URLs (Req 7.7).
const SIGNED_URL_TTL_SECONDS = 60;

const MASTER_SYSTEM_PATH = "/system";

// Generic denial that never reveals whether a document exists (Req 7.6).
const NOT_PERMITTED = "You are not permitted to access this document";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the authenticated caller's franchise context behind the feature flag.
 * Returns the {@link FranchiseContext} on success, or an `ActionResult` failure
 * when franchise features are disabled (Req 18.3/18.4) or the request is
 * unauthenticated.
 */
async function resolveCaller(): Promise<
  | { ok: true; context: FranchiseContext }
  | { ok: false; result: { success: false; error: string } }
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return {
      ok: false,
      result: { success: false, error: "Franchise features are not enabled" },
    };
  }

  // Resolve the session first so an unauthenticated request reads as
  // Unauthorized rather than a generic context error.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, result: { success: false, error: "Unauthorized" } };
  }

  const context = await resolveFranchiseContext();
  if (!context) {
    return { ok: false, result: { success: false, error: "Unauthorized" } };
  }

  return { ok: true, context };
}

/** True when the role has unrestricted (full network) access — ADMIN / MASTER_ADMIN. */
function isGlobalAccess(role: string): boolean {
  return (GLOBAL_ACCESS_ROLES as readonly string[]).includes(role);
}

/**
 * Validate an uploaded file's content type and size BEFORE any upload
 * (Req 7.8/7.9): content type ∈ {application/pdf, image/jpeg, image/png} and
 * size <= 10 MB (10,485,760 bytes). Returns the trimmed file name on success or
 * an `ActionResult` failure carrying the offending field otherwise.
 */
function validateFileMeta(
  file: File
): { ok: true; fileName: string } | { ok: false; result: { success: false; error: string; field?: string } } {
  const parsed = agreementDocMetaSchema.safeParse({
    content_type: file.type,
    size_bytes: file.size,
    file_name: file.name,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      result: {
        success: false,
        error: issue?.message ?? "Invalid document",
        field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
      },
    };
  }

  return { ok: true, fileName: parsed.data.file_name };
}

/** Build the private-bucket object key: `{franchiseId}/{uuid}-{filename}` (Req 7.1). */
function buildStoragePath(franchiseId: string, fileName: string): string {
  return `${franchiseId}/${randomUUID()}-${fileName}`;
}

/** Map a persisted record to the public {@link AgreementDocMeta} shape (drops storage internals). */
function toMeta(record: AgreementDocRecord): AgreementDocMeta {
  return {
    id: record.id,
    franchise_id: record.franchise_id,
    file_name: record.file_name,
    content_type: record.content_type,
    size_bytes: record.size_bytes,
    uploaded_at: record.uploaded_at,
  };
}

// ─── Upload (Req 7.1, 7.2, 7.8, 7.9) ─────────────────────────────────────────

/**
 * Upload an agreement document for a Franchise. MASTER_ADMIN only.
 *
 * Validates the file's content type ∈ {application/pdf, image/jpeg, image/png}
 * and size <= 10 MB BEFORE uploading (Req 7.8/7.9), stores the bytes in the
 * PRIVATE `franchise-documents` bucket under `{franchiseId}/{uuid}-{filename}`
 * (Req 7.1), then records the metadata via the repository (Req 7.2).
 *
 * Validates: Requirements 7.1, 7.2, 7.8, 7.9.
 */
export async function uploadAgreementDocument(
  franchiseId: string,
  file: File
): Promise<ActionResult<AgreementDocMeta>> {
  const caller = await resolveCaller();
  if (!caller.ok) return caller.result;

  // Writes to the agreement registry are MASTER_ADMIN only.
  if (caller.context.role !== "MASTER_ADMIN") {
    return {
      success: false,
      error: "Only a Master Admin can upload agreement documents",
    };
  }

  if (!franchiseId || franchiseId.trim().length === 0) {
    return { success: false, error: "Franchise id is required", field: "franchiseId" };
  }

  // Validate BEFORE upload (Req 7.8/7.9).
  const meta = validateFileMeta(file);
  if (!meta.ok) return meta.result;

  // The target franchise must exist (clean error ahead of the FK constraint).
  const franchise = await getFranchiseById(franchiseId);
  if (!franchise) {
    return { success: false, error: "Franchise not found", field: "franchiseId" };
  }

  const admin = createAdminClient();
  const storagePath = buildStoragePath(franchiseId, meta.fileName);

  const { error: uploadError } = await admin.storage
    .from(AGREEMENT_DOCS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { success: false, error: uploadError.message };
  }

  try {
    const record = await insertAgreementDoc({
      franchise_id: franchiseId,
      storage_path: storagePath,
      file_name: meta.fileName,
      content_type: file.type,
      size_bytes: file.size,
      // uploader's internal users.id is not exposed by the franchise context;
      // the column is nullable, so we record null rather than issuing an extra lookup.
      uploaded_by: null,
    });

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: toMeta(record) };
  } catch (err) {
    // Best-effort cleanup of the orphaned object if metadata insert failed.
    await admin.storage.from(AGREEMENT_DOCS_BUCKET).remove([storagePath]);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to record agreement document",
    };
  }
}

// ─── List (Req 7.3) ──────────────────────────────────────────────────────────

/**
 * List the agreement documents for a Franchise — only that franchise's docs
 * (Req 7.3). Access: full-network (MASTER_ADMIN / ADMIN) for any franchise, or
 * the owning FRANCHISE_ADMIN for their own franchise; any other caller is denied
 * without revealing anything (Req 7.5/7.6).
 *
 * Validates: Requirement 7.3.
 */
export async function listAgreementDocuments(
  franchiseId: string
): Promise<ActionResult<AgreementDocMeta[]>> {
  const caller = await resolveCaller();
  if (!caller.ok) return caller.result;

  if (!franchiseId || franchiseId.trim().length === 0) {
    return { success: false, error: "Franchise id is required", field: "franchiseId" };
  }

  const { role, franchise_id } = caller.context;
  const permitted =
    isGlobalAccess(role) ||
    (role === FRANCHISE_SCOPED_ROLE && franchise_id === franchiseId);

  if (!permitted) {
    return { success: false, error: NOT_PERMITTED };
  }

  try {
    const records = await listAgreementDocsByFranchise(franchiseId);
    return { success: true, data: records.map(toMeta) };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to list agreement documents",
    };
  }
}

// ─── Replace (Req 7.4) ───────────────────────────────────────────────────────

/**
 * Replace an existing agreement document with a new file, KEEPING the franchise
 * association (Req 7.4). MASTER_ADMIN only.
 *
 * Validates the new file (Req 7.8/7.9), uploads it to the private bucket under
 * the SAME franchise prefix, records new metadata, then best-effort removes the
 * superseded object + metadata row. The franchise_id is carried over from the
 * existing record so the association is preserved (Req 7.4).
 *
 * Validates: Requirements 7.4, 7.8, 7.9.
 */
export async function replaceAgreementDocument(
  docId: string,
  file: File
): Promise<ActionResult<AgreementDocMeta>> {
  const caller = await resolveCaller();
  if (!caller.ok) return caller.result;

  // Writes to the agreement registry are MASTER_ADMIN only.
  if (caller.context.role !== "MASTER_ADMIN") {
    return {
      success: false,
      error: "Only a Master Admin can replace agreement documents",
    };
  }

  if (!docId || docId.trim().length === 0) {
    return { success: false, error: "Document id is required", field: "docId" };
  }

  const existing = await getAgreementDocById(docId);
  if (!existing) {
    return { success: false, error: "Agreement document not found" };
  }

  // Validate BEFORE upload (Req 7.8/7.9).
  const meta = validateFileMeta(file);
  if (!meta.ok) return meta.result;

  const admin = createAdminClient();
  // Keep the franchise association by reusing the existing franchise_id (Req 7.4).
  const storagePath = buildStoragePath(existing.franchise_id, meta.fileName);

  const { error: uploadError } = await admin.storage
    .from(AGREEMENT_DOCS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { success: false, error: uploadError.message };
  }

  let record: AgreementDocRecord;
  try {
    record = await insertAgreementDoc({
      franchise_id: existing.franchise_id,
      storage_path: storagePath,
      file_name: meta.fileName,
      content_type: file.type,
      size_bytes: file.size,
      uploaded_by: null,
    });
  } catch (err) {
    // Roll back the just-uploaded object so we don't orphan it.
    await admin.storage.from(AGREEMENT_DOCS_BUCKET).remove([storagePath]);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to record agreement document",
    };
  }

  // Best-effort cleanup of the superseded object + metadata row. The replacement
  // has already succeeded, so cleanup failures don't fail the action.
  await admin.storage.from(AGREEMENT_DOCS_BUCKET).remove([existing.storage_path]);
  try {
    await deleteAgreementDoc(existing.id);
  } catch {
    // The superseded metadata row could not be removed; the new document is
    // still valid and authoritative. Leave the stale row for later cleanup.
  }

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: toMeta(record) };
}

// ─── Signed download URL (Req 7.5, 7.6, 7.7) ─────────────────────────────────

/**
 * Issue a short-lived SIGNED URL for an agreement document — never a public URL
 * (Req 7.7). Access is granted ONLY to MASTER_ADMIN, ADMIN (full-network scope),
 * or the owning FRANCHISE_ADMIN whose franchise_id matches the document's
 * franchise_id (Req 7.5). Any other caller — including a FRANCHISE_ADMIN of a
 * different franchise, or a request for a non-existent document — receives the
 * SAME generic "not permitted" error, without disclosing whether the document
 * exists (Req 7.6).
 *
 * Validates: Requirements 7.5, 7.6, 7.7.
 */
export async function getAgreementDocumentUrl(
  docId: string
): Promise<ActionResult<{ signedUrl: string; expiresIn: number }>> {
  const caller = await resolveCaller();
  // Don't disclose existence to unauthenticated / feature-disabled callers via a
  // distinct message — but preserve the feature-flag / auth signals as-is for
  // those non-document concerns.
  if (!caller.ok) return caller.result;

  if (!docId || docId.trim().length === 0) {
    return { success: false, error: NOT_PERMITTED };
  }

  const { role, franchise_id } = caller.context;
  const admin = createAdminClient();

  // Full-network roles (MASTER_ADMIN / ADMIN) may access any document. They are
  // authorized to know whether a document exists, so a genuine not-found is fine.
  if (isGlobalAccess(role)) {
    const doc = await getAgreementDocById(docId);
    if (!doc) {
      return { success: false, error: "Agreement document not found" };
    }
    return issueSignedUrl(admin, doc.storage_path);
  }

  // The owning FRANCHISE_ADMIN may access only their own franchise's documents.
  // A missing document OR a mismatched franchise both yield the SAME generic
  // denial so existence is never disclosed (Req 7.6).
  if (role === FRANCHISE_SCOPED_ROLE) {
    const doc = await getAgreementDocById(docId);
    if (!doc || doc.franchise_id !== franchise_id) {
      return { success: false, error: NOT_PERMITTED };
    }
    return issueSignedUrl(admin, doc.storage_path);
  }

  // Any other caller (core users, etc.) is denied without revealing anything.
  return { success: false, error: NOT_PERMITTED };
}

/**
 * Create the short-lived signed URL for a storage path (Req 7.7). Kept private
 * so the access decision in {@link getAgreementDocumentUrl} stays the single gate.
 */
async function issueSignedUrl(
  admin: ReturnType<typeof createAdminClient>,
  storagePath: string
): Promise<ActionResult<{ signedUrl: string; expiresIn: number }>> {
  const { data, error } = await admin.storage
    .from(AGREEMENT_DOCS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return {
      success: false,
      error: error?.message ?? "Failed to generate download URL",
    };
  }

  return {
    success: true,
    data: { signedUrl: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS },
  };
}
