"use client";

// src/app/master/(main)/hierarchy/_components/AgreementDocsPanel.tsx
// Master Hierarchy — Agreement Documents panel
// (multi-tenant-franchise — Task 13.6, Req 12.5, 7.2, 7.3, 7.4, 7.7).
//
// Client Component slotted into the HierarchyTree's per-franchise "Agreements"
// mount point. It opens as a Dialog and lets a Master Admin manage the agreement
// documents stored for ONE franchise:
//   - lists the franchise's documents on open (listAgreementDocuments, Req 7.3),
//   - uploads a new document with a client-side type/size guard for UX while the
//     server re-validates authoritatively (uploadAgreementDocument, Req 7.2),
//   - replaces an existing document keeping the franchise association
//     (replaceAgreementDocument, Req 7.4),
//   - opens a SHORT-LIVED signed URL in a new tab for download/view; the public
//     URL is never rendered (getAgreementDocumentUrl, Req 7.7).
//
// All server results are ActionResult<T>; failures (including the generic
// "not permitted" denial that never discloses existence) surface as toasts.

import { useCallback, useRef, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import {
  FileText,
  UploadCloud,
  Download,
  RefreshCw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  listAgreementDocuments,
  uploadAgreementDocument,
  replaceAgreementDocument,
  getAgreementDocumentUrl,
} from "@/actions/master-actions/agreementDocActions";
import type { AgreementDocMeta } from "@/types/franchise";

interface AgreementDocsPanelProps {
  franchiseId: string;
  /**
   * Optional trigger override. When omitted, a default "Agreements" outline
   * button is rendered so the panel can be dropped straight into the tree.
   */
  trigger?: React.ReactNode;
}

// Client-side guard for UX only — the Server Action re-validates authoritatively
// (Req 7.8/7.9). Keep these in sync with `agreementDocMetaSchema`.
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_SIZE_LABEL = "10MB";

/** Human-readable byte size for the document list. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** Locale date-time for `uploaded_at`. Falls back to the raw value if unparseable. */
function formatUploadedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/**
 * UX-only pre-flight validation mirroring the server rules. Returns an error
 * message when the file is unacceptable, or `null` when it passes.
 */
function validateFileForUx(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Only PDF, JPEG, or PNG files are allowed.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${file.name} exceeds the ${MAX_FILE_SIZE_LABEL} limit.`;
  }
  return null;
}

export function AgreementDocsPanel({
  franchiseId,
  trigger,
}: AgreementDocsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [documents, setDocuments] = useState<AgreementDocMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pending transitions, keyed so per-row spinners stay independent.
  const [isUploadPending, startUpload] = useTransition();
  const [, startReplace] = useTransition();
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  // One hidden replace input is reused; the doc it targets is tracked separately.
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetId = useRef<string | null>(null);

  /** Fetch (or refresh) the document list for this franchise (Req 7.3). */
  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const result = await listAgreementDocuments(franchiseId);
    if (result.success) {
      setDocuments(result.data);
    } else {
      setLoadError(result.error);
      setDocuments([]);
    }
    setIsLoading(false);
  }, [franchiseId]);

  /** Load the list whenever the dialog transitions to open. */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) {
        void loadDocuments();
      }
    },
    [loadDocuments],
  );

  // ── Upload (Req 7.2) ──────────────────────────────────────────────────────
  const handleUploadSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    const validationError = validateFileForUx(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    startUpload(async () => {
      const result = await uploadAgreementDocument(franchiseId, file);
      if (result.success) {
        toast.success(`Uploaded "${result.data.file_name}"`);
        await loadDocuments();
      } else {
        toast.error(result.error);
      }
    });
  };

  // ── Replace (Req 7.4) ─────────────────────────────────────────────────────
  const triggerReplace = (docId: string) => {
    replaceTargetId.current = docId;
    replaceInputRef.current?.click();
  };

  const handleReplaceSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const docId = replaceTargetId.current;
    replaceTargetId.current = null;
    if (!file || !docId) return;

    const validationError = validateFileForUx(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setReplacingId(docId);
    startReplace(async () => {
      const result = await replaceAgreementDocument(docId, file);
      if (result.success) {
        toast.success(`Replaced with "${result.data.file_name}"`);
        await loadDocuments();
      } else {
        toast.error(result.error);
      }
      setReplacingId(null);
    });
  };

  // ── Download / view via short-lived signed URL (Req 7.7) ──────────────────
  const handleDownload = async (docId: string) => {
    setDownloadingId(docId);
    const result = await getAgreementDocumentUrl(docId);
    if (result.success) {
      // Open the expiring signed URL in a new tab; never persist/render it.
      window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error(result.error);
    }
    setDownloadingId(null);
  };

  const busy = isUploadPending || replacingId !== null;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-2 text-xs">
            <FileText className="h-4 w-4" />
            Agreements
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agreement Documents</DialogTitle>
          <DialogDescription>
            Manage this franchise&apos;s agreement documents. PDF, JPEG, or PNG
            only (max {MAX_FILE_SIZE_LABEL} per file).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Upload control */}
          <div>
            <input
              ref={uploadInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={handleUploadSelect}
              disabled={busy}
            />
            <Button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={busy}
              className="w-full gap-2"
            >
              {isUploadPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              {isUploadPending ? "Uploading…" : "Upload document"}
            </Button>
          </div>

          {/* Hidden shared input used by every row's Replace control */}
          <input
            ref={replaceInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={handleReplaceSelect}
          />

          {/* Document list */}
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading documents…
              </div>
            ) : loadError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <p className="text-xs font-medium text-red-800">{loadError}</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No agreement documents uploaded yet.
              </div>
            ) : (
              documents.map((doc) => {
                const isReplacing = replacingId === doc.id;
                const isDownloading = downloadingId === doc.id;
                return (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="shrink-0 rounded-md bg-blue-50 p-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-foreground">
                          {doc.file_name}
                        </p>
                        <p className="text-[10px] font-medium text-muted-foreground">
                          {doc.content_type} · {formatBytes(doc.size_bytes)} ·{" "}
                          {formatUploadedAt(doc.uploaded_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => handleDownload(doc.id)}
                        disabled={isDownloading || busy}
                        title="Open a short-lived download link"
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        View
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => triggerReplace(doc.id)}
                        disabled={busy}
                        title="Replace this document"
                      >
                        {isReplacing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Replace
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AgreementDocsPanel;
