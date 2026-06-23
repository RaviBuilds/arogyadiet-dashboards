"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import {
  Truck,
  Search,
  CheckCircle2,
  Circle,
  Package,
  UserPlus,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  franchiseOnboardRider,
} from "@/actions/franchise-actions/franchiseRiderActions";
import { StatCard, SectionCard } from "@/shared/components/franchise/ui/GlassCard";

const TH = "text-[11px] font-medium uppercase tracking-wider text-slate-400";

interface RiderData {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  isOnline: boolean;
  lastOnlineAt: string | null;
  serviceAreas: string[];
  joiningDate: string | null;
  emergencyContact: string;
  todayTotalOrders: number;
  todayCompletedOrders: number;
  todayExpectedEarning: number;
  hasPickedUp: boolean;
}

interface Props {
  riders: RiderData[];
  franchiseId: string;
}

export default function FranchiseRiderDashboard({ riders, franchiseId }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [onboardForm, setOnboardForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    employeeCode: "",
    password: "",
  });

  const onlineCount = riders.filter((r) => r.isOnline).length;
  const totalOrders = riders.reduce((sum, r) => sum + r.todayTotalOrders, 0);
  const completedOrders = riders.reduce((sum, r) => sum + r.todayCompletedOrders, 0);

  const filteredRiders = useMemo(() => {
    if (!search) return riders;
    const term = search.toLowerCase();
    return riders.filter(
      (r) =>
        r.fullName.toLowerCase().includes(term) ||
        r.mobile.includes(term) ||
        r.employeeCode.toLowerCase().includes(term)
    );
  }, [search, riders]);

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <StatCard icon={Truck} label="Total Riders" value={riders.length} accent="text-slate-700" accentBg="bg-slate-100" />
        <StatCard icon={Circle} label="Online Now" value={onlineCount} accent="text-emerald-600" accentBg="bg-emerald-50" />
        <StatCard icon={Package} label="Today's Orders" value={totalOrders} accent="text-blue-600" accentBg="bg-blue-50" />
        <StatCard icon={CheckCircle2} label="Delivered" value={completedOrders} accent="text-violet-600" accentBg="bg-violet-50" />
      </div>

      {/* Rider Table */}
      <SectionCard
        icon={Truck}
        title="Rider Directory"
        subtitle={`${filteredRiders.length} riders`}
        actions={
          <>
            <div className="relative w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search rider name, code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 rounded-xl border-slate-200/80 bg-white/60 pl-9 text-sm shadow-sm"
              />
            </div>
            <Button size="sm" className="h-9 rounded-xl shadow-sm" onClick={() => setIsOnboardOpen(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              Onboard Rider
            </Button>
          </>
        }
      >
        {filteredRiders.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">No riders found.</p>
        ) : (
          <div className="overflow-auto rounded-xl ring-1 ring-slate-100">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                  <TableHead className={TH}>Rider</TableHead>
                  <TableHead className={TH}>Contact</TableHead>
                  <TableHead className={TH}>Code</TableHead>
                  <TableHead className={TH}>Status</TableHead>
                  <TableHead className={TH}>Today</TableHead>
                  <TableHead className={TH}>Pincodes</TableHead>
                  <TableHead className={TH}>Earning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRiders.map((rider) => (
                  <TableRow key={rider.id} className="border-slate-100 transition-colors hover:bg-slate-50/40">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                            rider.isOnline ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                        />
                        <span className="text-sm font-medium text-slate-800">{rider.fullName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-xs text-slate-600">{rider.mobile}</p>
                        <p className="text-[10px] text-slate-400">{rider.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{rider.employeeCode}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant="outline"
                          className={`rounded-lg text-[10px] w-fit ${
                            rider.isOnline
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "text-slate-500"
                          }`}
                        >
                          {rider.isOnline ? "Online" : "Offline"}
                        </Badge>
                        {rider.todayTotalOrders > 0 && (
                          <Badge
                            variant="outline"
                            className={`rounded-lg text-[9px] w-fit ${
                              rider.hasPickedUp
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            {rider.hasPickedUp ? "Picked Up" : "Not Picked"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-medium text-slate-700">{rider.todayCompletedOrders}</span>
                      <span className="text-slate-400">/{rider.todayTotalOrders}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {rider.serviceAreas.slice(0, 3).map((p) => (
                          <Badge key={p} variant="secondary" className="rounded-md text-[9px] font-mono">
                            {p}
                          </Badge>
                        ))}
                        {rider.serviceAreas.length > 3 && (
                          <span className="text-[10px] text-slate-400">+{rider.serviceAreas.length - 3}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-600">
                      {rider.todayExpectedEarning > 0 ? `₹${rider.todayExpectedEarning.toFixed(0)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Onboard Rider Modal */}
      <Dialog open={isOnboardOpen} onOpenChange={(open) => { if (!open) setIsOnboardOpen(false); }}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Onboard New Rider</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input
                value={onboardForm.fullName}
                onChange={(e) => setOnboardForm({ ...onboardForm, fullName: e.target.value })}
                placeholder="Rider full name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={onboardForm.email}
                onChange={(e) => setOnboardForm({ ...onboardForm, email: e.target.value })}
                placeholder="rider@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Mobile *</Label>
              <Input
                value={onboardForm.mobile}
                onChange={(e) => setOnboardForm({ ...onboardForm, mobile: e.target.value })}
                placeholder="10-digit mobile number"
              />
            </div>
            <div className="space-y-2">
              <Label>Employee Code *</Label>
              <Input
                value={onboardForm.employeeCode}
                onChange={(e) => setOnboardForm({ ...onboardForm, employeeCode: e.target.value })}
                placeholder="e.g., RDR-001"
              />
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={onboardForm.password}
                  onChange={(e) => setOnboardForm({ ...onboardForm, password: e.target.value })}
                  placeholder="Set initial password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOnboardOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!onboardForm.fullName || !onboardForm.email || !onboardForm.mobile || !onboardForm.employeeCode || !onboardForm.password) {
                  toast.error("Please fill all required fields.");
                  return;
                }
                startTransition(async () => {
                  const result = await franchiseOnboardRider({
                    ...onboardForm,
                    franchiseId,
                  });
                  if (result.success) {
                    toast.success("Rider onboarded successfully!");
                    setIsOnboardOpen(false);
                    setOnboardForm({ fullName: "", email: "", mobile: "", employeeCode: "", password: "" });
                    router.refresh();
                  } else {
                    toast.error(result.error || "Failed to onboard rider.");
                  }
                });
              }}
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Onboard Rider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
