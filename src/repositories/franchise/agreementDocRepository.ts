// src/repositories/franchise/agreementDocRepository.ts
// Data-access layer for `franchise_agreement_documents` metadata
// (multi-tenant-franchise — Task 3.4).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// All access uses the service-role admin client (createAdminClient).
//
// The document BYTES live in the private Supabase Storage bucket
// `franchise-documents` under the per-franchise prefix `{franchise_id}/...`;
// this table only records the storage path plus validated metadata so the
// action layer can list, authorize, and issue short-lived signed URLs
// (Req 7.2, 7.3, 7.8).

import { createAdminClient } from "@/lib/supabase/admin";
import type { AgreementDocMeta } from "@/types/franchise";

// The persisted row carries the storage path and uploader in addition to the
// public {@link AgreementDocMeta} shape, since the action layer needs
// `storage_path` to issue signed download URLs (Req 7.8).
export interface AgreementDocRecord extends AgreementDocMeta {
  storage_path: string;
  uploaded_by: string | null;
}

const AGREEMENT_DOC_COLUMNS =
  "id, franchise_id, storage_path, file_name, content_type, size_bytes, uploaded_by, uploaded_at";

/**
 * Input for inserting an agreement-document metadata row. Field validation
 * (content type, 10 MB size cap) is enforced by the action layer and the DB
 * CHECK constraints (Req 7.2).
 */
export interface AgreementDocInsert {
  franchise_id: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by?: string | null;
}

/**
 * Insert an agreement-document metadata row (Req 7.2). The bytes must already
 * have been uploaded to the private `franchise-documents` bucket at
 * `storage_path` by the action layer.
 */
export async function insertAgreementDoc(
  input: AgreementDocInsert
): Promise<AgreementDocRecord> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchise_agreement_documents")
    .insert({
      franchise_id: input.franchise_id,
      storage_path: input.storage_path,
      file_name: input.file_name,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      uploaded_by: input.uploaded_by ?? null,
    })
    .select(AGREEMENT_DOC_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert agreement document: ${error?.message ?? "unknown error"}`
    );
  }
  return data as AgreementDocRecord;
}

/**
 * List the agreement documents for a given Franchise via `franchise_id`, most
 * recent first (Req 7.3).
 */
export async function listAgreementDocsByFranchise(
  franchiseId: string
): Promise<AgreementDocRecord[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchise_agreement_documents")
    .select(AGREEMENT_DOC_COLUMNS)
    .eq("franchise_id", franchiseId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to list agreement documents for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data ?? []) as AgreementDocRecord[];
}

/**
 * Fetch a single agreement-document metadata row by its identifier. Returns
 * `null` when not found.
 */
export async function getAgreementDocById(
  id: string
): Promise<AgreementDocRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchise_agreement_documents")
    .select(AGREEMENT_DOC_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch agreement document ${id}: ${error.message}`);
  }
  return (data as AgreementDocRecord) ?? null;
}

/**
 * Delete an agreement-document metadata row by its identifier. Removing the
 * underlying object from the `franchise-documents` bucket is the action layer's
 * responsibility.
 */
export async function deleteAgreementDoc(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("franchise_agreement_documents")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to delete agreement document ${id}: ${error.message}`);
  }
}
