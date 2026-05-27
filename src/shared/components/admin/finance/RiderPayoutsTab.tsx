"use client";

import { useState, useMemo, useTransition } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  CheckCircle,
  Loader2,
  Plus,
  Calculator,
  IndianRupee,
  Truck,
  Clock,
  Calendar,
  Users,
} from "lucide-react";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { ExportButton } from "../core/ActionButtons";
import {
  generateMonthlyPayment,
  createCustomPayment,
  markPaymentAsPaid,
  getAllRidersWithEarnings,
} from "@/actions/admin-actions/financeActions";
import { toast } from "sonner";

interface RiderSummary {
  id: string;
  month: number;
  year: number;
  period_start: string | null;
  period_end: string | null;
  total_earnings: number;
  total_distance_km: number;
  total_deliveries: number;
  status: string;
  is_custom: boolean;
  paid_at: string | null;
  paid_notes: string | null;
  created_at: string;
}

interface RiderData {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  mobile: string;
  summaries: RiderSummary[];
  totalPaid: number;
  totalPending: number;
  uncoveredEarnings: number;
  totalDeliveredEarnings: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function RiderPayoutsTab({
  initialRiders,
}: {
  initialRiders: RiderData[];
}) {
  const [riders, setRiders] = useState<RiderData[]>(initialRiders);
  const [selectedRiderId, setSelectedRiderId] = useState<string>(
    initialRiders[0]?.id || "",
  );
  const [isPending, startTransition] = useTransition();

  // Mark as Paid dialog state
  const [payDialog, setPayDialog] = useState<{
    open: boolean;
    summaryId: string;
    amount: number;
    period: string;
  }>({ open: false, summaryId: "", amount: 0, period: "" });
  const [payNotes, setPayNotes] = useState("");

  // Generate Monthly dialog state
  const [genDialog, setGenDialog] = useState(false);
  const [genMonth, setGenMonth] = useState(String(new Date().getMonth()));
  const [genYear, setGenYear] = useState(String(new Date().getFullYear()));

  // Custom Payment dialog state
  const [customDialog, setCustomDialog] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // All Riders search
  const [riderSearchColumn, setRiderSearchColumn] = useState("fullName");
  const [riderSearchTerm, setRiderSearchTerm] = useState("");

  const selectedRider = riders.find((r) => r.id === selectedRiderId);

  const filteredRiders = useMemo(() => {
    if (!riderSearchTerm) return riders;
    const lower = riderSearchTerm.toLowerCase();
    return riders.filter((r) => {
      if (riderSearchColumn === "fullName")
        return r.fullName.toLowerCase().includes(lower);
      if (riderSearchColumn === "employeeCode")
        return r.employeeCode.toLowerCase().includes(lower);
      return true;
    });
  }, [riders, riderSearchTerm, riderSearchColumn]);

  const refreshData = () => {
    startTransition(async () => {
      const data = await getAllRidersWithEarnings();
      setRiders(data);
    });
  };

  const handleMarkPaid = () => {
    startTransition(async () => {
      const result = await markPaymentAsPaid(payDialog.summaryId, payNotes);
      if (result.success) {
        toast.success("Payment marked as paid. Email sent to rider.");
        setPayDialog({ open: false, summaryId: "", amount: 0, period: "" });
        setPayNotes("");
        refreshData();
      } else {
        toast.error(result.error || "Failed to mark as paid.");
      }
    });
  };

  const handleGenerateMonthly = () => {
    if (!selectedRiderId) return;
    startTransition(async () => {
      const result = await generateMonthlyPayment(
        selectedRiderId,
        Number(genMonth),
        Number(genYear),
      );
      if (result.success) {
        toast.success("Monthly payment generated successfully.");
        setGenDialog(false);
        refreshData();
      } else {
        toast.error(result.error || "Failed to generate.");
      }
    });
  };

  const handleCreateCustom = () => {
    if (!selectedRiderId || !customFrom || !customTo) return;
    startTransition(async () => {
      const result = await createCustomPayment(
        selectedRiderId,
        customFrom,
        customTo,
      );
      if (result.success) {
        toast.success(
          `Custom payment created: ₹${formatINR(result.totalEarnings || 0)} for ${result.totalDeliveries} deliveries.`,
        );
        setCustomDialog(false);
        setCustomFrom("");
        setCustomTo("");
        refreshData();
      } else {
        toast.error(result.error || "Failed to create custom payment.");
      }
    });
  };

  const handleExportRidersOverview = () => {
    if (filteredRiders.length === 0) return;
    const exportData = filteredRiders.map((r) => ({
      "Rider Name": r.fullName,
      "Employee Code": r.employeeCode,
      "Email": r.email,
      "Mobile": r.mobile,
      "Total Delivered (INR)": Number(r.totalDeliveredEarnings.toFixed(2)),
      "Total Paid (INR)": Number(r.totalPaid.toFixed(2)),
      "Pending (INR)": Number(r.totalPending.toFixed(2)),
      "Uncovered (INR)": Number(r.uncoveredEarnings.toFixed(2)),
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Riders Overview");
    XLSX.writeFile(
      workbook,
      `Riders_Payout_Overview_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  return (
    <div className="space-y-6">
      {/* Rider Selector + Actions */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[250px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Select Rider
          </label>
          <Select value={selectedRiderId} onValueChange={setSelectedRiderId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Choose a rider..." />
            </SelectTrigger>
            <SelectContent>
              {riders.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.fullName} ({r.employeeCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          className="h-10 gap-2"
          onClick={() => {
            const now = new Date();
            const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
            const prevYear =
              now.getMonth() === 0
                ? now.getFullYear() - 1
                : now.getFullYear();
            setGenMonth(String(prevMonth));
            setGenYear(String(prevYear));
            setGenDialog(true);
          }}
          disabled={!selectedRiderId}
        >
          <Calendar className="h-4 w-4" />
          Generate Monthly
        </Button>
        <Button
          className="h-10 gap-2"
          onClick={() => setCustomDialog(true)}
          disabled={!selectedRiderId}
        >
          <Plus className="h-4 w-4" />
          Custom Payment
        </Button>
      </div>

      {/* Selected Rider Stats */}
      {selectedRider && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-purple-50 h-10 w-10 rounded-lg flex items-center justify-center">
                <Truck className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Total Delivered
                </p>
                <p className="text-lg font-bold">
                  ₹{formatINR(selectedRider.totalDeliveredEarnings)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-emerald-50 h-10 w-10 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Total Paid
                </p>
                <p className="text-lg font-bold">
                  ₹{formatINR(selectedRider.totalPaid)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-orange-50 h-10 w-10 rounded-lg flex items-center justify-center">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Pending Payouts
                </p>
                <p className="text-lg font-bold">
                  ₹{formatINR(selectedRider.totalPending)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-amber-50 h-10 w-10 rounded-lg flex items-center justify-center">
                <IndianRupee className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Uncovered Earnings
                </p>
                <p className="text-lg font-bold">
                  ₹{formatINR(selectedRider.uncoveredEarnings)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Payment Periods Table */}
      {selectedRider && (
        <DataTableCard
          header={
            <SectionHeader
              title={`Payment History — ${selectedRider.fullName}`}
              icon={IndianRupee}
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Period</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Deliveries</TableHead>
                <TableHead className="text-right">Distance (km)</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!selectedRider.summaries ||
                selectedRider.summaries.length === 0) && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No payment records yet. Use &quot;Generate Monthly&quot; or
                    &quot;Custom Payment&quot; to create one.
                  </TableCell>
                </TableRow>
              )}
              {selectedRider.summaries.map((s) => {
                const periodLabel =
                  s.period_start && s.period_end
                    ? `${formatDate(s.period_start)} — ${formatDate(s.period_end)}`
                    : `${MONTH_NAMES[s.month - 1]} ${s.year}`;

                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-sm">
                      {periodLabel}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          s.is_custom
                            ? "bg-violet-500/10 text-violet-600 border-violet-200"
                            : "bg-blue-500/10 text-blue-600 border-blue-200"
                        }
                      >
                        {s.is_custom ? "Custom" : "Monthly"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {s.total_deliveries}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(s.total_distance_km || 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      ₹{formatINR(Number(s.total_earnings || 0))}
                    </TableCell>
                    <TableCell>
                      {s.status === "PAID" ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 border-emerald-200"
                        >
                          PAID
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-orange-500/10 text-orange-600 border-orange-200"
                        >
                          GENERATED
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {s.status === "PAID" ? (
                        <div>
                          <p className="text-xs">
                            {s.paid_at
                              ? new Date(s.paid_at).toLocaleDateString(
                                  "en-IN",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )
                              : ""}
                          </p>
                          {s.paid_notes && (
                            <p className="text-xs truncate">{s.paid_notes}</p>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {s.status === "GENERATED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                          onClick={() =>
                            setPayDialog({
                              open: true,
                              summaryId: s.id,
                              amount: Number(s.total_earnings || 0),
                              period: periodLabel,
                            })
                          }
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Mark Paid
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTableCard>
      )}

      {/* All Riders Overview */}
      <DataTableCard
        header={<SectionHeader title="All Riders Overview" icon={Users} />}
        controls={
          <DataSearchFilter
            searchColumn={riderSearchColumn}
            onColumnChange={setRiderSearchColumn}
            searchTerm={riderSearchTerm}
            onTermChange={setRiderSearchTerm}
            options={[
              { value: "fullName", label: "Rider Name" },
              { value: "employeeCode", label: "Employee Code" },
            ]}
          />
        }
        actions={
          <ExportButton
            onClick={handleExportRidersOverview}
            disabled={filteredRiders.length === 0}
            label="Export Excel"
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Rider</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Total Delivered</TableHead>
              <TableHead className="text-right">Total Paid</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Uncovered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRiders.map((r) => (
              <TableRow
                key={r.id}
                className={`cursor-pointer ${r.id === selectedRiderId ? "bg-muted/50" : ""}`}
                onClick={() => setSelectedRiderId(r.id)}
              >
                <TableCell className="font-medium">{r.fullName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.employeeCode}
                </TableCell>
                <TableCell className="text-right">
                  ₹{formatINR(r.totalDeliveredEarnings)}
                </TableCell>
                <TableCell className="text-right text-emerald-600 font-medium">
                  ₹{formatINR(r.totalPaid)}
                </TableCell>
                <TableCell className="text-right text-orange-600 font-medium">
                  ₹{formatINR(r.totalPending)}
                </TableCell>
                <TableCell className="text-right text-amber-600 font-medium">
                  ₹{formatINR(r.uncoveredEarnings)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableCard>

      {/* Mark as Paid Dialog */}
      <Dialog
        open={payDialog.open}
        onOpenChange={(open) => {
          if (!open)
            setPayDialog({ open: false, summaryId: "", amount: 0, period: "" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Payment as Paid</DialogTitle>
            <DialogDescription>
              Confirm payment of{" "}
              <span className="font-semibold text-foreground">
                ₹{formatINR(payDialog.amount)}
              </span>{" "}
              for period{" "}
              <span className="font-semibold text-foreground">
                {payDialog.period}
              </span>
              . An email notification will be sent to the rider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Payment Notes (optional)
              </label>
              <Textarea
                placeholder="e.g., Bank transfer ref #12345, UPI payment..."
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setPayDialog({
                  open: false,
                  summaryId: "",
                  amount: 0,
                  period: "",
                })
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleMarkPaid}
              disabled={isPending}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Monthly Payment Dialog */}
      <Dialog open={genDialog} onOpenChange={setGenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Monthly Payment</DialogTitle>
            <DialogDescription>
              Calculate and generate a payment summary for the selected month.
              Already-paid dates will be excluded automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Month</label>
              <Select value={genMonth} onValueChange={setGenMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[120px]">
              <label className="text-sm font-medium mb-1 block">Year</label>
              <Input
                type="number"
                value={genYear}
                onChange={(e) => setGenYear(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerateMonthly}
              disabled={isPending}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Payment Dialog */}
      <Dialog open={customDialog} onOpenChange={setCustomDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Custom Payment</DialogTitle>
            <DialogDescription>
              Select a date range to calculate earnings. Days already covered by
              existing payment summaries will be excluded automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">
                From Date
              </label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">To Date</label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCustom}
              disabled={isPending || !customFrom || !customTo}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Calculate & Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
