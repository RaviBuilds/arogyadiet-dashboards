"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  Users,
  CalendarDays,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import {
  bulkImportCustomersAction,
  bulkImportSubscriptionsAction,
  downloadBulkMigrationWorkbookAction,
  type BulkImportResult,
} from "@/actions/admin-actions/bulkImportActions";

type ReferencePlan = {
  code: string;
  name: string;
  duration_days: number;
  pause_credits: number;
  price: number;
};

type ReferenceMeal = {
  code: string;
  name: string;
};

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ImportResultPanel({
  title,
  result,
}: {
  title: string;
  result: BulkImportResult | null;
}) {
  if (!result) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-sm">{title}</p>
        <Badge variant={result.success ? "default" : "destructive"}>
          {result.succeeded}/{result.processed} succeeded
        </Badge>
        {result.validationErrors.length > 0 && (
          <Badge variant="outline">{result.validationErrors.length} validation errors</Badge>
        )}
      </div>

      {result.validationErrors.length > 0 && (
        <div className="max-h-40 overflow-auto text-xs space-y-1">
          {result.validationErrors.slice(0, 20).map((e, i) => (
            <p key={i} className="text-destructive">
              Row {e.row}, {e.field}: {e.message}
            </p>
          ))}
          {result.validationErrors.length > 20 && (
            <p className="text-muted-foreground">
              …and {result.validationErrors.length - 20} more
            </p>
          )}
        </div>
      )}

      {result.results.length > 0 && (
        <div className="max-h-48 overflow-auto rounded border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Row</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.results.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.row}</TableCell>
                  <TableCell className="font-mono text-xs">{r.identifier}</TableCell>
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
      )}
    </div>
  );
}

function UploadZone({
  label,
  description,
  onFile,
  disabled,
}: {
  label: string;
  description: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
  });

  return (
    <div
      {...getRootProps()}
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
        isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:bg-muted/40"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input {...getInputProps()} />
      <Upload className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium text-sm">{label}</p>
      <p className="text-xs text-muted-foreground text-center max-w-sm">{description}</p>
    </div>
  );
}

export function BulkMigrationClient({
  plans,
  meals,
}: {
  plans: ReferencePlan[];
  meals: ReferenceMeal[];
}) {
  const [isPending, startTransition] = useTransition();
  const [customerResult, setCustomerResult] = useState<BulkImportResult | null>(
    null,
  );
  const [subscriptionResult, setSubscriptionResult] =
    useState<BulkImportResult | null>(null);

  const handleDownloadWorkbook = () => {
    startTransition(async () => {
      const res = await downloadBulkMigrationWorkbookAction();
      if (res.success) {
        downloadBase64File(res.base64, res.fileName);
        toast.success("Downloaded templates with live plan & meal reference.");
      } else {
        toast.error("Failed to generate workbook.");
      }
    });
  };

  const runCustomerImport = (file: File) => {
    startTransition(async () => {
      try {
        const base64 = await fileToBase64(file);
        const result = await bulkImportCustomersAction(base64);
        setCustomerResult(result);
        if (result.succeeded > 0) {
          toast.success(`Created ${result.succeeded} customer(s).`);
        }
        if (result.failed > 0 || result.validationErrors.length > 0) {
          toast.warning("Some rows failed. Review the import report below.");
        }
      } catch {
        toast.error("Could not read file.");
      }
    });
  };

  const runSubscriptionImport = (file: File) => {
    startTransition(async () => {
      try {
        const base64 = await fileToBase64(file);
        const result = await bulkImportSubscriptionsAction(base64);
        setSubscriptionResult(result);
        if (result.succeeded > 0) {
          toast.success(`Created ${result.succeeded} subscription(s).`);
        }
        if (result.failed > 0 || result.validationErrors.length > 0) {
          toast.warning("Some rows failed. Review the import report below.");
        }
      } catch {
        toast.error("Could not read file.");
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/customers">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Customers
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Bulk migration templates
          </CardTitle>
          <CardDescription>
            Download the Excel workbook (customer + subscription sheets and live
            reference data), or use the CSV templates. Import customers first,
            then subscriptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={handleDownloadWorkbook} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download full workbook (.xlsx)
          </Button>
          <Button variant="outline" asChild>
            <a href="/templates/bulk-migration/01_customers_bulk.csv" download>
              <Download className="h-4 w-4 mr-2" />
              Customers CSV
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/templates/bulk-migration/02_subscriptions_bulk.csv" download>
              <Download className="h-4 w-4 mr-2" />
              Subscriptions CSV
            </a>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active plans (reference)</CardTitle>
            <CardDescription>
              Use <code className="text-xs">plan_code</code> in subscription file
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground text-sm">
                      No active plans in database.
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((p) => (
                    <TableRow key={p.code}>
                      <TableCell className="font-mono text-xs">{p.code}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.duration_days}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meal categories (reference)</CardTitle>
            <CardDescription>
              Use <code className="text-xs">meal_category_code</code> in subscription file
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meals.map((m) => (
                  <TableRow key={m.code}>
                    <TableCell className="font-mono text-xs">{m.code}</TableCell>
                    <TableCell>{m.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="customers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="customers" className="gap-2">
            <Users className="h-4 w-4" />
            Import customers
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            Import subscriptions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="space-y-4">
          <UploadZone
            label="Upload customer spreadsheet"
            description="CSV or Excel (.xlsx). First sheet only. Headers must match the template."
            onFile={runCustomerImport}
            disabled={isPending}
          />
          <ImportResultPanel title="Customer import report" result={customerResult} />
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Customers must already exist with at least one address. Start date must
            be tomorrow or later (same rules as manual Add Subscription).
          </p>
          <UploadZone
            label="Upload subscription spreadsheet"
            description="One row per subscription. Link rows via customer_email or customer_mobile."
            onFile={runSubscriptionImport}
            disabled={isPending}
          />
          <ImportResultPanel
            title="Subscription import report"
            result={subscriptionResult}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
