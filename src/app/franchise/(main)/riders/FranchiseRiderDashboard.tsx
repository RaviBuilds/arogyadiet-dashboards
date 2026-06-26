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
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
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
  Activity,
  Users,
  MapPin,
  MoreHorizontal,
  Edit,
  Trash2,
  AlertTriangle,
  PhoneCall,
} from "lucide-react";
import { toast } from "sonner";
import {
  franchiseOnboardRider,
  franchiseUpdateRiderDetails,
  franchiseDeleteRider,
} from "@/actions/franchise-actions/franchiseRiderActions";
import { StatCard, SectionCard } from "@/shared/components/franchise/ui/GlassCard";
import FranchiseServiceAreaManager from "./FranchiseServiceAreaManager";

const TH = "text-[11px] font-medium uppercase tracking-wider text-slate-400";

interface RiderData {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  emergencyContact: string;
  isOnline: boolean;
  statusUpdatedAt: string | null;
  serviceAreas: string[];
  joiningDate: string | null;
  todayTotalOrders: number;
  todayCompletedOrders: number;
  todayExpectedEarning: number;
  hasPickedUp: boolean;
  todayDeliveryStatus: string;
  totalEarned: number | null;
  lastPayoutAmount: number | null;
  lastPayoutDate: string | null;
}

interface ServiceArea {
  id: string;
  area_name: string;
  pincode: string;
  rider_id: string | null;
}

interface Props {
  riders: RiderData[];
  allAreas: ServiceArea[];
  approvedPincodes: string[];
  franchiseId: string;
}

const TABS = ["Today's Activity", "Rider List", "Service Areas"] as const;
type Tab = (typeof TABS)[number];

const EMPTY_ONBOARD = {
  fullName: "",
  email: "",
  mobile: "",
  employeeCode: "",
  password: "",
};

export default function FranchiseRiderDashboard({
  riders,
  allAreas,
  approvedPincodes,
  franchiseId,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("Today's Activity");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  // Onboard modal
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [onboardForm, setOnboardForm] = useState(EMPTY_ONBOARD);

  // Edit / Deactivate modals
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [activeRider, setActiveRider] = useState<RiderData | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    mobile: "",
    emergencyContact: "",
    joiningDate: "",
  });
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");

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
        r.employeeCode.toLowerCase().includes(term) ||
        r.serviceAreas.some((p) => p.includes(term)),
    );
  }, [search, riders]);

  const formatTime = (iso: string | null) =>
    iso
      ? new Date(iso)
          .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          .toUpperCase()
      : "N/A";

  const formatDate = (iso: string | null) =>
    iso && iso !== "N/A"
      ? new Date(iso).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "N/A";

  // ── Onboard ──────────────────────────────────────────────────────────────
  const handleOnboard = () => {
    if (
      !onboardForm.fullName ||
      !onboardForm.email ||
      !onboardForm.mobile ||
      !onboardForm.employeeCode ||
      !onboardForm.password
    ) {
      toast.error("Please fill all required fields.");
      return;
    }
    startTransition(async () => {
      const res = await franchiseOnboardRider({ ...onboardForm, franchiseId });
      if (res.success) {
        toast.success("Rider onboarded successfully!");
        setIsOnboardOpen(false);
        setOnboardForm(EMPTY_ONBOARD);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to onboard rider.");
      }
    });
  };

  // ── Edit ─────────────────────────────────────────────────────────────────
  const openEdit = (rider: RiderData) => {
    setActiveRider(rider);
    setEditForm({
      fullName: rider.fullName,
      mobile: rider.mobile,
      emergencyContact: rider.emergencyContact === "N/A" ? "" : rider.emergencyContact,
      joiningDate: rider.joiningDate || "",
    });
    setIsEditOpen(true);
  };

  const handleEdit = () => {
    if (!activeRider) return;
    startTransition(async () => {
      const res = await franchiseUpdateRiderDetails(
        activeRider.userId,
        editForm.fullName,
        editForm.mobile,
        editForm.emergencyContact,
        editForm.joiningDate,
      );
      if (res.success) {
        toast.success("Rider details updated.");
        setIsEditOpen(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to update rider.");
      }
    });
  };

  // ── Deactivate ─────────────────────────────────────────────────────────────
  const openDelete = (rider: RiderData) => {
    setActiveRider(rider);
    setDeleteConfirmCode("");
    setIsDeleteOpen(true);
  };

  const handleDelete = () => {
    if (!activeRider || deleteConfirmCode !== activeRider.employeeCode) return;
    startTransition(async () => {
      const res = await franchiseDeleteRider(activeRider.id);
      if (res.success) {
        toast.success("Rider deactivated.");
        setIsDeleteOpen(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to deactivate rider.");
      }
    });
  };

  const ridersForMapping = riders.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    employeeCode: r.employeeCode,
    isOnline: r.isOnline,
  }));

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <StatCard icon={Truck} label="Total Riders" value={riders.length} accent="text-slate-700" accentBg="bg-slate-100" />
        <StatCard icon={Circle} label="Online Now" value={onlineCount} accent="text-emerald-600" accentBg="bg-emerald-50" />
        <StatCard icon={Package} label="Today's Orders" value={totalOrders} accent="text-blue-600" accentBg="bg-blue-50" />
        <StatCard icon={CheckCircle2} label="Delivered" value={completedOrders} accent="text-violet-600" accentBg="bg-violet-50" />
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 rounded-2xl bg-white/60 p-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-inset ring-white/60 backdrop-blur-xl">
        {TABS.map((tab) => {
          const Icon =
            tab === "Today's Activity" ? Activity : tab === "Rider List" ? Users : MapPin;
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setSearch("");
              }}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                active
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "Service Areas" ? (
        <FranchiseServiceAreaManager
          riders={ridersForMapping}
          allAreas={allAreas}
          approvedPincodes={approvedPincodes}
        />
      ) : (
        <SectionCard
          icon={activeTab === "Today's Activity" ? Activity : Truck}
          title={activeTab}
          subtitle={`${filteredRiders.length} riders`}
          actions={
            <>
              <div className="relative w-60">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search rider name, code..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 rounded-xl border-slate-200/80 bg-white/60 pl-9 text-sm shadow-sm"
                />
              </div>
              {activeTab === "Rider List" && (
                <Button
                  size="sm"
                  className="h-9 rounded-xl shadow-sm"
                  onClick={() => setIsOnboardOpen(true)}
                >
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Onboard Rider
                </Button>
              )}
            </>
          }
        >
          {filteredRiders.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No riders found.</p>
          ) : (
            <div className="overflow-auto rounded-xl ring-1 ring-slate-100">
              <Table>
                <TableHeader>
                  {activeTab === "Today's Activity" ? (
                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                      <TableHead className={TH}>Rider</TableHead>
                      <TableHead className={TH}>Contact</TableHead>
                      <TableHead className={TH}>Status</TableHead>
                      <TableHead className={TH}>Delivery Status</TableHead>
                      <TableHead className={TH}>Deliveries</TableHead>
                      <TableHead className={TH}>Earning</TableHead>
                    </TableRow>
                  ) : (
                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                      <TableHead className={TH}>Name</TableHead>
                      <TableHead className={TH}>Contacts</TableHead>
                      <TableHead className={TH}>Emergency</TableHead>
                      <TableHead className={TH}>Joining Date</TableHead>
                      <TableHead className={TH}>Earnings</TableHead>
                      <TableHead className={TH}>Last Payout</TableHead>
                      <TableHead className={`${TH} w-[50px]`}>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  )}
                </TableHeader>
                <TableBody>
                  {filteredRiders.map((rider) =>
                    activeTab === "Today's Activity" ? (
                      <TableRow key={rider.id} className="border-slate-100 hover:bg-slate-50/40">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                                rider.isOnline ? "bg-emerald-500" : "bg-slate-300"
                              }`}
                            />
                            <div>
                              <p className="text-sm font-medium text-slate-800">
                                {rider.fullName}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {rider.email !== "N/A" ? rider.email : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-slate-600">{rider.mobile}</p>
                          {rider.emergencyContact && rider.emergencyContact !== "N/A" && (
                            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-rose-500">
                              <PhoneCall className="h-3 w-3" />
                              {rider.emergencyContact}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`rounded-lg text-[10px] ${
                              rider.isOnline
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "text-slate-500"
                            }`}
                          >
                            {rider.isOnline ? "Online" : "Offline"}
                          </Badge>
                          <p className="ml-0.5 mt-0.5 text-[10px] text-slate-400">
                            {formatTime(rider.statusUpdatedAt)}
                          </p>
                        </TableCell>
                        <TableCell>
                          {rider.todayDeliveryStatus === "No Batch Assigned" ? (
                            <span className="text-xs text-slate-400">No Batch Assigned</span>
                          ) : (
                            <Badge
                              variant="outline"
                              className={`rounded-lg text-[10px] ${
                                rider.hasPickedUp
                                  ? "border-blue-200 bg-blue-50 text-blue-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {rider.todayDeliveryStatus}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-semibold text-slate-700">
                            {rider.todayCompletedOrders}
                          </span>
                          <span className="text-slate-400"> / {rider.todayTotalOrders}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-emerald-600">
                          {rider.todayExpectedEarning > 0
                            ? `₹${rider.todayExpectedEarning.toFixed(0)}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={rider.id} className="border-slate-100 hover:bg-slate-50/40">
                        <TableCell>
                          <p className="text-sm font-semibold text-slate-800">
                            {rider.fullName}
                          </p>
                          <p className="font-mono text-[10px] text-slate-400">
                            #{rider.employeeCode}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-slate-600">{rider.mobile}</p>
                          <p className="text-[10px] text-slate-400">{rider.email}</p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              !rider.emergencyContact || rider.emergencyContact === "N/A"
                                ? "text-xs italic text-slate-400"
                                : "text-xs text-slate-600"
                            }
                          >
                            {rider.emergencyContact || "N/A"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {formatDate(rider.joiningDate)}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-slate-700">
                          ₹{(rider.totalEarned || 0).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell>
                          {rider.lastPayoutAmount ? (
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-emerald-600">
                                ₹{Number(rider.lastPayoutAmount).toLocaleString("en-IN")}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {formatDate(rider.lastPayoutDate)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs italic text-slate-400">
                              No payouts yet
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4 text-slate-400" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[160px]">
                              <DropdownMenuItem
                                className="cursor-pointer font-medium"
                                onClick={() => openEdit(rider)}
                              >
                                <Edit className="mr-2 h-4 w-4 text-slate-400" />
                                Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="cursor-pointer font-medium text-rose-600 focus:bg-rose-50"
                                onClick={() => openDelete(rider)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Deactivate Rider
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Onboard Rider Modal ── */}
      <Dialog open={isOnboardOpen} onOpenChange={(open) => !open && setIsOnboardOpen(false)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Onboard New Rider
            </DialogTitle>
            <DialogDescription>
              Create a new delivery partner for your franchise. They can change their
              password later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input
                  value={onboardForm.fullName}
                  onChange={(e) => setOnboardForm({ ...onboardForm, fullName: e.target.value })}
                  placeholder="Rider full name"
                />
              </div>
              <div className="space-y-2">
                <Label>Employee Code *</Label>
                <Input
                  value={onboardForm.employeeCode}
                  onChange={(e) =>
                    setOnboardForm({
                      ...onboardForm,
                      employeeCode: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="e.g. RDR-001"
                />
              </div>
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
            <Button onClick={handleOnboard} disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Rider Modal ── */}
      <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Rider Details</DialogTitle>
            <DialogDescription>
              Update rider details for{" "}
              <span className="font-semibold text-slate-800">{activeRider?.fullName}</span>{" "}
              (#{activeRider?.employeeCode}).
            </DialogDescription>
            <DialogDescription className="text-sm font-medium text-amber-600">
              Warning: Changing the mobile number might affect login.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Mobile Number</Label>
              <Input
                value={editForm.mobile}
                onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Emergency Number</Label>
              <Input
                value={editForm.emergencyContact}
                onChange={(e) =>
                  setEditForm({ ...editForm, emergencyContact: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Joining Date</Label>
              <Input
                type="date"
                value={editForm.joiningDate}
                onChange={(e) => setEditForm({ ...editForm, joiningDate: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deactivate Rider Modal ── */}
      <Dialog open={isDeleteOpen} onOpenChange={(open) => !open && setIsDeleteOpen(false)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-5 w-5" /> Deactivate Rider Account
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2 text-sm text-slate-500">
                <p>
                  This deactivates the rider and blocks portal login. Service areas will be
                  unassigned.
                </p>
                <p className="font-medium text-slate-700">
                  Delivery history and earnings records are preserved.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-600">
              To confirm, type the Employee Code:
              <br />
              <span className="text-base font-bold tracking-widest">
                {activeRider?.employeeCode}
              </span>
            </div>
            <Input
              placeholder="Type employee code here..."
              value={deleteConfirmCode}
              onChange={(e) => setDeleteConfirmCode(e.target.value)}
              className="border-rose-200 focus-visible:ring-rose-400"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending || deleteConfirmCode !== activeRider?.employeeCode}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Deactivate Rider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
