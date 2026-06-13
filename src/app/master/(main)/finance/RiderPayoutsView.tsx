"use client";

import { useState, useMemo, useTransition } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Truck,
  CheckCircle,
  Clock,
  IndianRupee,
  AlertTriangle,
  Calendar,
  Plus,
  Calculator,
  Loader2,
  Users,
  CircleSlash,
  PenLine,
  Banknote,
} from "lucide-react";
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
import * as XLSX from "xlsx";
import {
  generateMonthlyPayment,
  createCustomPayment,
  markPaymentAsPaid,
  getAllRidersWithEarnings,
} from "@/actions/admin-actions/financeActions";
import { addPayoutAdjustment } from "@/actions/admin-actions/financePayoutActions";
import { toast } from "sonner";
import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { DataSearchFilter } from "@/shared/components/admin/core/DataSearchFilter";
import { ExportButton } from "@/shared/components/admin/core/ActionButtons";

// ─── Types ──────────────────────────────────

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
  adjustment_total?: number;
  final_amount?: number;
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

interface OverviewData {
  totalDeliveryEarnings: number;
  totalRiderPayoutsGenerated: number;
  totalRiderPayoutsPaid: number;
  totalRiderPayoutsPending: number;
}

// ─── Helpers ────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const TONE_STYLES: Record<string, { bg: string; icon: string }> = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600" },
  blue: { bg: "bg-blue-50", icon: "text-blue-600" },
  orange: { bg: "bg-orange-50", icon: "text-orange-600" },
  violet: { bg: "bg-violet-50", icon: "text-violet-600" },
  amber: { bg: "bg-amber-50", icon: "text-amber-600" },
  cyan: { bg: "bg-cyan-50", icon: "text-cyan-600" },
  rose: { bg: "bg-rose-50", icon: "text-rose-600" },
};

const PAYOUT_STATUS_COLORS: Record<string, string> = {
  Paid: "#16a34a",
  Pending: "#f59e0b",
};

const tooltipStyle = {
  borderRadius: "12px",
  border: "1px solid #e2e8f0",
  fontSize: "12px",
} as const;

// ─── Main Component ─────────────────────────

export function RiderPayoutsView({
  overviewData,
  initialRiders,
  settingsData,
}: {
  overviewData: OverviewData;
  initialRiders: RiderData[];
  settingsData: any;
}) {
  const [riders, setRiders] = useState<RiderData[]>(initialRiders);
  const [selectedRiderId, setSelectedRiderId] = useState<string>(
    initialRiders[0]?.id || "",
  );
  const [isPending, startTransition] = useTransition();

  // Dialogs
  const [payDialog, setPayDialog] = useState<{
    open: boolean;
    summaryId: string;
    amount: number;
    period: string;
  }>({ open: false, summaryId: "", amount: 0, period: "" });
  const [payNotes, setPayNotes] = useState("");

  const [genDialog, setGenDialog] = useState(false);
  const [genMonth, setGenMonth] = useState(String(new Date().getMonth()));
  const [genYear, setGenYear] = useState(String(new Date().getFullYear()));

  const [customDialog, setCustomDialog] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Adjustment dialog
  const [adjDialog, setAdjDialog] = useState<{
    open: boolean;
    summaryId: string;
    riderName: string;
    period: string;
  }>({ open: false, summaryId: "", riderName: "", period: "" });
  const [adjType, setAdjType] = useState("BONUS");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

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

  // Donut data for payout status
  const payoutStatusData = [
    { name: "Paid", value: overviewData.totalRiderPayoutsPaid },
    { name: "Pending", value: overviewData.totalRiderPayoutsPending },
  ].filter((d) => d.value > 0);

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
        toast.success("Payment released. Email sent to rider.");
        setPayDialog({ open: false, summaryId: "", amount: 0, period: "" });
        setPayNotes("");
        refreshData();
      } else {
        toast.error(result.error || "Failed to release payment.");
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
        toast.success("Payout cycle generated (26th → 27th).");
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
      const result = await createCustomPayment(selectedRiderId, customFrom, customTo);
      if (result.success) {
        toast.success(
          `Custom payout created: ₹${formatINR(result.totalEarnings || 0)} for ${result.totalDeliveries} deliveries.`,
        );
        setCustomDialog(false);
        setCustomFrom("");
        setCustomTo("");
        refreshData();
      } else {
        toast.error(result.error || "Failed to create custom payout.");
      }
    });
  };

  const handleAddAdjustment = () => {
    if (!adjDialog.summaryId || !adjAmount || !adjReason) return;
    startTransition(async () => {
      const numAmount = adjType === "PENALTY" || adjType === "DEDUCTION"
        ? -Math.abs(Number(adjAmount))
        : Math.abs(Number(adjAmount));
      const result = await addPayoutAdjustment({
        summaryId: adjDialog.summaryId,
        riderId: selectedRiderId,
        adjustmentType: adjType,
        amount: numAmount,
        reason: adjReason,
      });
      if (result.success) {
        toast.success("Adjustment applied to payout.");
        setAdjDialog({ open: false, summaryId: "", riderName: "", period: "" });
        setAdjType("BONUS");
        setAdjAmount("");
        setAdjReason("");
        refreshData();
      } else {
        toast.error(result.error || "Failed to apply adjustment.");
      }
    });
  };

  const handleExportRidersOverview = () => {
    if (filteredRiders.length === 0) return;
    const exportData = filteredRiders.map((r) => ({
      "Rider Name": r.fullName,
      "Employee Code": r.employeeCode,
      Email: r.email,
      Mobile: r.mobile,
      "Total Delivered (INR)": Number(r.totalDeliveredEarnings.toFixed(2)),
      "Total Paid (INR)": Number(r.totalPaid.toFixed(2)),
      "Pending (INR)": Number(r.totalPending.toFixed(2)),
      "Uncovered (INR)": Number(r.uncoveredEarnings.toFixed(2)),
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Riders Overview");
    XLSX.writeFile(workbook, `Riders_Payout_Overview_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<Truck className="h-4 w-4" />}
          tone="violet"
          label="Total Delivery Earnings"
          value={formatCurrency(overviewData.totalDeliveryEarnings)}
          subtitle="All-time delivered value"
        />
        <KpiCard
          icon={<Calculator className="h-4 w-4" />}
          tone="cyan"
          label="Payouts Generated"
          value={formatCurrency(overviewData.totalRiderPayoutsGenerated)}
          subtitle={`${riders.length} active riders`}
        />
        <KpiCard
          icon={<CheckCircle className="h-4 w-4" />}
          tone="emerald"
          label="Payouts Released"
          value={formatCurrency(overviewData.totalRiderPayoutsPaid)}
          subtitle="Status: Paid"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
          label="Payouts Pending"
          value={formatCurrency(overviewData.totalRiderPayoutsPending)}
          subtitle="Awaiting release"
          alert={overviewData.totalRiderPayoutsPending > 0}
        />
      </div>

      {/* Payout Status Donut + Rider Selector */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Donut */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Banknote className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Payout Status</h3>
          </div>
          <p className="text-xs text-slate-400 mb-2">Released vs pending payouts</p>
          <div className="h-[220px]">
            {payoutStatusData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={payoutStatusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={2}
                  >
                    {payoutStatusData.map((d) => (
                      <Cell key={d.name} fill={PAYOUT_STATUS_COLORS[d.name]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => [`₹${formatINR(Number(v))}`, "Amount"]}
                    contentStyle={tooltipStyle}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Rider Selector & Actions */}
        <div className="lg:col-span-2 bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-800">
                Payout Cycle Management
              </h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Cycle: 26th of previous month → 27th of current month. Select a
              rider to generate, adjust, or release payouts.
            </p>

            <div className="space-y-3">
              <Select value={selectedRiderId} onValueChange={setSelectedRiderId}>
                <SelectTrigger className="h-10 bg-white">
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

              {selectedRider && (
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Delivered</p>
                    <p className="text-base font-bold text-slate-800">₹{formatINR(selectedRider.totalDeliveredEarnings)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Uncovered</p>
                    <p className="text-base font-bold text-amber-600">₹{formatINR(selectedRider.uncoveredEarnings)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const now = new Date();
                const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
                const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
                setGenMonth(String(prevMonth));
                setGenYear(String(prevYear));
                setGenDialog(true);
              }}
              disabled={!selectedRiderId}
            >
              <Calendar className="h-3.5 w-3.5" />
              Generate Cycle
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setCustomDialog(true)}
              disabled={!selectedRiderId}
            >
              <Plus className="h-3.5 w-3.5" />
              Custom Range
            </Button>
          </div>
        </div>
      </div>

      {/* Payment Periods Table */}
      {selectedRider && (
        <DataTableCard
          header={
            <SectionHeader
              title={`Payout History — ${selectedRider.fullName}`}
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
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Base Earnings</TableHead>
                <TableHead className="text-right">Adjustments</TableHead>
                <TableHead className="text-right">Final Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!selectedRider.summaries || selectedRider.summaries.length === 0) && (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-slate-400">
                    No payout records yet. Use &quot;Generate Cycle&quot; to create one.
                  </TableCell>
                </TableRow>
              )}
              {selectedRider.summaries.map((s) => {
                const periodLabel =
                  s.period_start && s.period_end
                    ? `${formatDate(s.period_start)} — ${formatDate(s.period_end)}`
                    : `${MONTH_NAMES[s.month - 1]} ${s.year}`;
                const adjTotal = Number(s.adjustment_total || 0);
                const finalAmt = Number(s.final_amount || s.total_earnings) + adjTotal;

                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-sm">{periodLabel}</TableCell>
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
                    <TableCell className="text-right">{s.total_deliveries}</TableCell>
                    <TableCell className="text-right">
                      {Number(s.total_distance_km || 0).toFixed(1)} km
                    </TableCell>
                    <TableCell className="text-right">
                      ₹{formatINR(Number(s.total_earnings || 0))}
                    </TableCell>
                    <TableCell className="text-right">
                      {adjTotal !== 0 ? (
                        <span className={adjTotal > 0 ? "text-emerald-600" : "text-rose-600"}>
                          {adjTotal > 0 ? "+" : ""}₹{formatINR(Math.abs(adjTotal))}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      ₹{formatINR(finalAmt)}
                    </TableCell>
                    <TableCell>
                      {s.status === "PAID" ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                          PAID
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-200">
                          GENERATED
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.status === "GENERATED" && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs text-slate-600 hover:text-slate-900"
                            onClick={() =>
                              setAdjDialog({
                                open: true,
                                summaryId: s.id,
                                riderName: selectedRider.fullName,
                                period: periodLabel,
                              })
                            }
                          >
                            <PenLine className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() =>
                              setPayDialog({
                                open: true,
                                summaryId: s.id,
                                amount: finalAmt,
                                period: periodLabel,
                              })
                            }
                          >
                            <CheckCircle className="h-3 w-3" />
                            Release
                          </Button>
                        </div>
                      )}
                      {s.status === "PAID" && s.paid_at && (
                        <span className="text-[11px] text-slate-400">
                          {formatDate(s.paid_at)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTableCard>
      )}

      {/* All Riders Overview Table */}
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
                className={`cursor-pointer transition-colors ${
                  r.id === selectedRiderId ? "bg-slate-50" : "hover:bg-slate-50/50"
                }`}
                onClick={() => setSelectedRiderId(r.id)}
              >
                <TableCell className="font-medium">{r.fullName}</TableCell>
                <TableCell className="text-slate-500">{r.employeeCode}</TableCell>
                <TableCell className="text-right">₹{formatINR(r.totalDeliveredEarnings)}</TableCell>
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

      {/* ─── Release Payment Dialog ─── */}
      <Dialog
        open={payDialog.open}
        onOpenChange={(open) => {
          if (!open) setPayDialog({ open: false, summaryId: "", amount: 0, period: "" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release Payment</DialogTitle>
            <DialogDescription>
              Confirm release of{" "}
              <span className="font-semibold text-slate-900">
                ₹{formatINR(payDialog.amount)}
              </span>{" "}
              for period{" "}
              <span className="font-semibold text-slate-900">{payDialog.period}</span>.
              An email notification will be sent to the rider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Payment Notes</label>
              <Textarea
                placeholder="e.g., Bank transfer ref #12345, UPI ID..."
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPayDialog({ open: false, summaryId: "", amount: 0, period: "" })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMarkPaid}
              disabled={isPending}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Release Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Generate Monthly Cycle Dialog ─── */}
      <Dialog open={genDialog} onOpenChange={setGenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Payout Cycle</DialogTitle>
            <DialogDescription>
              Calculates earnings from the 26th of the previous month to the 27th
              of the selected month. Already-covered dates are excluded.
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
              <Input type="number" value={genYear} onChange={(e) => setGenYear(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenDialog(false)}>Cancel</Button>
            <Button onClick={handleGenerateMonthly} disabled={isPending} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Custom Payment Dialog ─── */}
      <Dialog open={customDialog} onOpenChange={setCustomDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Custom Payout</DialogTitle>
            <DialogDescription>
              Select a date range. Days already covered by existing payout cycles
              will be excluded automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">From</label>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">To</label>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateCustom} disabled={isPending || !customFrom || !customTo} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Calculate & Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Earnings (Adjustment) Dialog ─── */}
      <Dialog
        open={adjDialog.open}
        onOpenChange={(open) => {
          if (!open) setAdjDialog({ open: false, summaryId: "", riderName: "", period: "" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Earnings — Adjustment</DialogTitle>
            <DialogDescription>
              Apply a manual adjustment to{" "}
              <span className="font-semibold text-slate-900">{adjDialog.riderName}</span>
              {" "}for period{" "}
              <span className="font-semibold text-slate-900">{adjDialog.period}</span>.
              This does not alter raw delivery logs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Type</label>
              <Select value={adjType} onValueChange={setAdjType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BONUS">Bonus (+)</SelectItem>
                  <SelectItem value="REIMBURSEMENT">Reimbursement (+)</SelectItem>
                  <SelectItem value="PENALTY">Penalty (−)</SelectItem>
                  <SelectItem value="DEDUCTION">Deduction (−)</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Amount (₹)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="Enter positive value"
              />
              <p className="text-xs text-slate-400 mt-1">
                Sign is auto-applied based on type (Penalty/Deduction = negative).
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Reason</label>
              <Textarea
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g., Fuel bonus for extended route, penalty for late delivery..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAdjDialog({ open: false, summaryId: "", riderName: "", period: "" })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddAdjustment}
              disabled={isPending || !adjAmount || !adjReason}
              className="gap-2"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── KPI Card ──────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  subtitle,
  tone,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  tone: keyof typeof TONE_STYLES;
  alert?: boolean;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div
      className={`group rounded-2xl border p-4 shadow-sm transition-all hover:shadow-md ${
        alert ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white/95"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.bg} ${t.icon}`}>
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-tight">
          {label}
        </span>
      </div>
      <p className={`text-xl font-bold tracking-tight ${alert ? "text-amber-700" : "text-slate-800"}`}>
        {value}
      </p>
      {subtitle && <p className="mt-0.5 text-[11px] text-slate-500 truncate">{subtitle}</p>}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-400">
      <CircleSlash className="h-8 w-8 mb-2 text-slate-300" />
      <p className="text-xs">No data for this view</p>
    </div>
  );
}
