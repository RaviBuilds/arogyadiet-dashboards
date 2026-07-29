"use client";

// KIT customer bulk import UI.
//
// Flow: download template → upload sheet → dry-run validation → chunked import.
// The dry run runs first so nothing is written while the sheet still has errors,
// and the import loops over fixed-size chunks so a 200-row migration never
// exceeds a single request budget.

import { useCallback, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Package,
  Upload,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  bulkImportKitCustomersAction,
  downloadKitBulkImportWorkbookAction,
  validateKitCustomerFileAction,
  type KitBulkRowResult,
} from "@/actions/admin-actions/kitBulkImportActions";
import type { RowValidationError } from "@/lib/bulk-migration/validate";

type KitProductReference = {
  id: string;
  name: string;
  base_price: number;
};

const CHUNK_SIZE = 20;

function downloadBase64File(base64: string, fileName: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(text: string, fileName: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function csvCell(value: string | undefined): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function KitBulkImportClient({
  kitProducts,
}: {
  kitProducts: KitProductReference[];
}) {
  const [busy, setBusy] = useState<null | "template" | "validate" | "import">(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    totalRows: number;
    validRows: number;
    errors: RowValidationError[];
  } | null>(null);
  const [results, setResults] = useState<KitBulkRowResult[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const fileBase64Ref = useRef<string | null>(null);

  const succeeded = useMemo(() => results.filter((r) => r.success).length, [results]);
  const failed = results.length - succeeded;

  const resetRun = () => {
    setValidation(null);
    setResults([]);
    setProgress(null);
  };

  const handleDownloadTemplate = async () => {
    setBusy("template");
    try {
      const res = await downloadKitBulkImportWorkbookAction();
      if (res.success) {
        downloadBase64File(res.base64, res.fileName);
        toast.success("KIT template downloaded with live product reference.");
      } else {
        toast.error(res.error);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleFile = useCallback(async (file: File) => {
    resetRun();
    setFileName(file.name);
    setBusy("validate");
    try {
      const base64 = await fileToBase64(file);
      fileBase64Ref.current = base64;
      const res = await validateKitCustomerFileAction(base64);
      if (!res.success) {
        fileBase64Ref.current = null;
        toast.error(res.error);
        return;
      }
      setValidation({
        totalRows: res.totalRows,
        validRows: res.validRows,
        errors: res.validationErrors,
      });
      if (res.validationErrors.length === 0) {
        toast.success(`${res.validRows} row(s) ready to import.`);
      } else {
        toast.warning(
          `${res.validationErrors.length} cell error(s) found. Fix the sheet or import the ${res.validRows} valid row(s).`,
        );
      }
    } catch {
      toast.error("Could not read the file.");
    } finally {
      setBusy(null);
    }
  }, []);

  const runImport = async () => {
    const base64 = fileBase64Ref.current;
    if (!base64) return;

    setBusy("import");
    setResults([]);
    const collected: KitBulkRowResult[] = [];
    let offset = 0;
    let total = validation?.validRows ?? 0;
    setProgress({ done: 0, total });

    try {
      // Loop until the action reports the last chunk. Bounded by `total` so a
      // malformed response can never spin forever.
      for (let guard = 0; guard < 1000; guard++) {
        const res = await bulkImportKitCustomersAction(base64, offset, CHUNK_SIZE);
        if (!res.success) {
          toast.error(res.error);
          break;
        }
        total = res.totalValidRows;
        collected.push(...res.results);
        setResults([...collected]);
        setProgress({ done: res.nextOffset, total });
        offset = res.nextOffset;
        if (res.done) break;
      }

      const ok = collected.filter((r) => r.success).length;
      const bad = collected.length - ok;
      if (ok > 0) toast.success(`Onboarded ${ok} KIT customer(s).`);
      if (bad > 0) toast.warning(`${bad} row(s) failed. Review the report below.`);
    } finally {
      setBusy(null);
    }
  };

  const exportReport = () => {
    const header = "row,mobile,full_name,kit_product,temporary_pin,status,message";
    const lines = results.map((r) =>
      [
        String(r.row),
        csvCell(r.identifier),
        csvCell(r.name),
        csvCell(r.kitProduct),
        csvCell(r.tempPin),
        r.success ? "SUCCESS" : "FAILED",
        csvCell(r.message),
      ].join(","),
    );
    downloadTextFile(
      [header, ...lines].join("\n"),
      "kit_import_report.csv",
    );
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => {
      const file = accepted[0];
      if (file) void handleFile(file);
    },
    disabled: busy !== null,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
  });

  const canImport =
    validation !== null && validation.validRows > 0 && busy === null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            KIT customer collection sheet
          </CardTitle>
          <CardDescription>
            One row per KIT customer. Each row creates the customer, their KIT
            subscription and the payment together. Optional columns are marked
            <span className="font-mono text-xs"> (optional)</span> in the header
            and listed on the <span className="font-mono text-xs">00_read_me</span>{" "}
            sheet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={handleDownloadTemplate} disabled={busy !== null}>
            {busy === "template" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download KIT template (.xlsx)
          </Button>
          <Button variant="outline" asChild>
            <a href="/templates/bulk-migration/03_kit_customers_bulk.csv" download>
              <Download className="h-4 w-4 mr-2" />
              KIT customers CSV
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Active KIT products (reference)
          </CardTitle>
          <CardDescription>
            Use the exact name in the <code className="text-xs">kit_product</code>{" "}
            column. Prices are inclusive of tax.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Price (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kitProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground text-sm">
                    No active KIT products. Create them under Subscriptions →
                    Kits first.
                  </TableCell>
                </TableRow>
              ) : (
                kitProducts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {p.base_price.toLocaleString("en-IN")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:bg-muted/40"
        } ${busy !== null ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input {...getInputProps()} />
        {busy === "validate" ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground" />
        )}
        <p className="font-medium text-sm">Upload KIT customer spreadsheet</p>
        <p className="text-xs text-muted-foreground text-center max-w-md">
          CSV or Excel (.xlsx). The first sheet is read, so keep{" "}
          <span className="font-mono">01_kit_customers</span> first. The file is
          checked before anything is created.
        </p>
        {fileName && (
          <Badge variant="outline" className="font-mono text-xs">
            {fileName}
          </Badge>
        )}
      </div>

      {validation && (
        <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm">Validation</p>
            <Badge variant={validation.errors.length === 0 ? "default" : "outline"}>
              {validation.validRows}/{validation.totalRows} rows ready
            </Badge>
            {validation.errors.length > 0 && (
              <Badge variant="destructive">
                {validation.errors.length} cell error(s)
              </Badge>
            )}
          </div>

          {validation.errors.length > 0 && (
            <div className="max-h-48 overflow-auto text-xs space-y-1">
              {validation.errors.slice(0, 50).map((e, i) => (
                <p key={i} className="text-destructive">
                  Row {e.row}, <span className="font-mono">{e.field}</span>:{" "}
                  {e.message}
                </p>
              ))}
              {validation.errors.length > 50 && (
                <p className="text-muted-foreground">
                  …and {validation.errors.length - 50} more
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runImport} disabled={!canImport}>
              {busy === "import" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Import {validation.validRows} KIT customer(s)
            </Button>
            {validation.errors.length > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Rows with errors are skipped. Fix and re-upload them separately.
              </p>
            )}
          </div>

          {progress && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${
                      progress.total > 0
                        ? Math.round((progress.done / progress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress.done} of {progress.total} processed
              </p>
            </div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm">KIT import report</p>
            <Badge variant={failed === 0 ? "default" : "destructive"}>
              {succeeded}/{results.length} succeeded
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={exportReport}
              className="ml-auto"
            >
              <Download className="h-4 w-4 mr-2" />
              Export report (with PINs)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each customer signs in with their mobile number and the temporary PIN
            below, and is asked to set a permanent PIN on first login. Export the
            report before leaving this page — the PINs are not shown again.
          </p>
          <div className="max-h-80 overflow-auto rounded border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Row</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>KIT product</TableHead>
                  <TableHead>Temp PIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.row}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.identifier}
                    </TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-xs">{r.kitProduct}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.tempPin ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.success ? (
                        <span className="text-emerald-600">OK</span>
                      ) : (
                        <span className="text-destructive">Failed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
