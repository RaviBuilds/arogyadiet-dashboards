"use client";

import { useState, useMemo, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  Users,
  Activity,
  MoreHorizontal,
  Edit,
  Trash2,
  AlertTriangle,
  Loader2,
  PhoneCall,
  UserPlus,
} from "lucide-react";
import {
  revalidateRidersPage,
  updateRiderDetails,
  deleteRider,
  onboardRider,
} from "@/actions/admin-actions/riderActions";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { AdminSubmenu } from "../core/AdminSubmenu";
import ServiceAreaManager from "./ServiceAreaManager";

export interface RiderData {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  mobile: string;
  emergency_contact: string;
  employee_code: string;
  is_online: boolean;
  status_updated_at: string;
  assigned_pincodes: string[];
  todayCompletedDeliveries: number;
  todayTotalDeliveries: number;
  todayEstimatedEarning: number;
  latestBatchStatus: string;
  latestBatchTime: string;
  joiningDate: string | null;
  totalEarned: number | null;
  lastPayoutAmount: number | null;
  lastPayoutDate: string | null;
}

export default function RiderManagement({
  data = [],
  allAreas = [],
}: {
  data?: RiderData[];
  allAreas?: any[];
}) {
  const [activeTab, setActiveTab] = useState("Today's Activity");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("fullName");
  const [searchTerm, setSearchTerm] = useState("");

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);

  const [activeRider, setActiveRider] = useState<RiderData | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", mobile: "" });
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [onboardForm, setOnboardForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    employeeCode: "",
    password: "",
  });

  const formatTime = (isoString: string) =>
    isoString && isoString !== "N/A"
      ? new Date(isoString)
          .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          .toUpperCase()
      : "N/A";

  const getPickupBadgeStatus = (status: string) =>
    ["PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(status)
      ? "PICKED UP"
      : "NOT YET PICKED UP";

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchColumn("fullName");
    setSearchTerm("");
  };

  const filteredData = useMemo(() => {
    let result = data;
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter((row) => {
        if (searchColumn === "fullName")
          return row.fullName?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "mobile")
          return row.mobile?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "email")
          return row.email?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "employee_code")
          return row.employee_code?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "pincode")
          return row.assigned_pincodes?.some((pin) =>
            pin.toLowerCase().includes(lowerTerm),
          );
        return true;
      });
    }
    return result;
  }, [data, searchTerm, searchColumn]);

  const searchOptions = [
    { value: "fullName", label: "Name" },
    { value: "mobile", label: "Phone Number" },
    { value: "email", label: "Email ID" },
  ];
  if (activeTab === "Rider List") {
    searchOptions.push({ value: "employee_code", label: "Employee Code" });
    searchOptions.push({ value: "pincode", label: "Area Pincode" });
  }

  const handleRefreshISR = async () => {
    setIsLoading(true);
    await revalidateRidersPage();
    setIsLoading(false);
    toast.success("Data refreshed successfully");
  };

  const handleExportExcel = () => {
    if (filteredData.length === 0) return;
    let exportData = [];
    if (activeTab === "Today's Activity") {
      exportData = filteredData.map((row) => ({
        "Rider Name": row.fullName,
        Email: row.email,
        Mobile: row.mobile,
        "Emergency Contact": row.emergency_contact,
        Status: row.is_online ? "Online" : "Offline",
        "Batch Status": row.latestBatchStatus,
        "Completed Deliveries": row.todayCompletedDeliveries,
        "Total Deliveries": row.todayTotalDeliveries,
        "Estimated Earning (₹)": row.todayEstimatedEarning,
      }));
    } else {
      exportData = filteredData.map((row) => ({
        "Full Name": row.fullName,
        Email: row.email,
        Mobile: row.mobile,
        "Employee Code": row.employee_code,
        Status: row.is_online ? "Online" : "Offline",
        "Assigned Pincodes": row.assigned_pincodes.join(", ") || "Unassigned",
      }));
    }
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      activeTab.replace(/[^a-zA-Z0-9]/g, ""),
    );
    XLSX.writeFile(
      wb,
      `Riders_${activeTab.replace(/[^a-zA-Z0-9]/g, "")}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const openEditModal = (rider: RiderData) => {
    setActiveRider(rider);
    setEditForm({ fullName: rider.fullName, mobile: rider.mobile });
    setIsEditModalOpen(true);
  };
  const openDeleteModal = (rider: RiderData) => {
    setActiveRider(rider);
    setDeleteConfirmCode("");
    setIsDeleteModalOpen(true);
  };

  const handleEditSubmit = () => {
    if (!activeRider) return;
    startTransition(async () => {
      const res = await updateRiderDetails(
        activeRider.userId,
        editForm.fullName,
        editForm.mobile,
      );
      if (res.success) {
        toast.success("Rider details updated");
        setIsEditModalOpen(false);
      } else toast.error(res.error);
    });
  };

  const handleDeleteSubmit = () => {
    if (!activeRider || deleteConfirmCode !== activeRider.employee_code) return;
    startTransition(async () => {
      const res = await deleteRider(activeRider.id);
      if (res.success) {
        toast.success("Rider completely deleted");
        setIsDeleteModalOpen(false);
      } else toast.error(res.error);
    });
  };

  const handleOnboardSubmit = () => {
    if (
      !onboardForm.fullName ||
      !onboardForm.email ||
      !onboardForm.mobile ||
      !onboardForm.employeeCode ||
      !onboardForm.password
    )
      return toast.error("Please fill all fields.");
    startTransition(async () => {
      const res = await onboardRider(onboardForm);
      if (res.success) {
        toast.success("Rider onboarded successfully!");
        setIsOnboardingModalOpen(false);
        setOnboardForm({
          fullName: "",
          email: "",
          mobile: "",
          employeeCode: "",
          password: "",
        });
      } else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <AdminSubmenu
        tabs={["Today's Activity", "Rider List", "Service Areas", "Onboarding"]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {activeTab === "Service Areas" ? (
        <ServiceAreaManager riders={data} allAreas={allAreas} />
      ) : (
        <DataTableCard
          header={
            <SectionHeader
              title={activeTab}
              icon={activeTab === "Today's Activity" ? Activity : Users}
            />
          }
          controls={
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={searchOptions}
            />
          }
          actions={
            <>
              <ExportButton
                onClick={handleExportExcel}
                disabled={filteredData.length === 0}
              />
              {activeTab === "Rider List" && (
                <Button
                  onClick={() => setIsOnboardingModalOpen(true)}
                  className="bg-primary text-primary-foreground shadow-sm"
                >
                  <UserPlus className="mr-2 h-4 w-4" /> Onboard Rider
                </Button>
              )}
              <RefreshButton
                onClick={handleRefreshISR}
                isLoading={isLoading || isPending}
              />
            </>
          }
        >
          <Table>
            <TableHeader>
              {activeTab === "Today's Activity" ? (
                <TableRow className="bg-muted/10">
                  <TableHead>Rider Name</TableHead>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Batch Pickup Status</TableHead>
                  <TableHead>Deliveries</TableHead>
                  <TableHead>Estimated Earning</TableHead>
                </TableRow>
              ) : (
                <TableRow className="bg-muted/10">
                  <TableHead>Name</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead>Emergency</TableHead>
                  <TableHead>Joining Date</TableHead>
                  <TableHead>Earnings</TableHead>
                  <TableHead>Last Payout</TableHead>
                  <TableHead className="w-[50px]">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {filteredData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No riders match your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((rider) => (
                  <TableRow key={rider.id} className="hover:bg-muted/30">
                    {activeTab === "Today's Activity" ? (
                      <>
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {rider.fullName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rider.email !== "N/A" ? rider.email : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{rider.mobile}</div>
                          {rider.emergency_contact &&
                            rider.emergency_contact !== "N/A" && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <PhoneCall className="h-3 w-3 text-destructive" />
                                {rider.emergency_contact}
                              </div>
                            )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={rider.is_online ? "Online" : "Offline"}
                            variant="dot"
                          />
                          <div className="text-[10px] text-muted-foreground mt-0.5 ml-4">
                            {formatTime(rider.status_updated_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {rider.latestBatchStatus === "No Batch Assigned" ? (
                            <span className="text-sm text-muted-foreground">
                              No Batch Assigned
                            </span>
                          ) : (
                            <>
                              <StatusBadge
                                status={getPickupBadgeStatus(
                                  rider.latestBatchStatus,
                                )}
                                variant="outline"
                              />
                              <div className="text-[10px] text-muted-foreground mt-1">
                                {formatTime(rider.latestBatchTime)}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-bold text-foreground">
                            {rider.todayCompletedDeliveries}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            / {rider.todayTotalDeliveries}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium text-green-700">
                          ₹{rider.todayEstimatedEarning}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        {/* Name & Employee ID */}
                        <TableCell>
                          <div className="font-bold">
                            {rider.fullName || "N/A"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            #{rider.employee_code || "UNASSIGNED"}
                          </div>
                        </TableCell>

                        {/* Contacts */}
                        <TableCell>
                          <div>{rider.mobile || "N/A"}</div>
                          <div className="text-xs text-muted-foreground">
                            {rider.email || "N/A"}
                          </div>
                        </TableCell>

                        {/* Emergency Contact */}
                        <TableCell>
                          <span
                            className={
                              !rider.emergency_contact ||
                              rider.emergency_contact === "N/A"
                                ? "text-muted-foreground italic text-sm"
                                : ""
                            }
                          >
                            {rider.emergency_contact || "N/A"}
                          </span>
                        </TableCell>

                        {/* Joining Date Safely Formatted */}
                        <TableCell>
                          {rider.joiningDate && rider.joiningDate !== "N/A" ? (
                            new Date(rider.joiningDate).toLocaleDateString(
                              "en-IN",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              },
                            )
                          ) : (
                            <span className="text-muted-foreground italic text-sm">
                              N/A
                            </span>
                          )}
                        </TableCell>

                        {/* Earnings */}
                        <TableCell>
                          <span className="font-medium">
                            ₹{(rider.totalEarned || 0).toLocaleString("en-IN")}
                          </span>
                        </TableCell>

                        {/* Last Payout Safely Formatted */}
                        <TableCell>
                          {rider.lastPayoutAmount ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-green-600">
                                ₹
                                {Number(rider.lastPayoutAmount).toLocaleString(
                                  "en-IN",
                                )}
                              </span>
                              {rider.lastPayoutDate &&
                                rider.lastPayoutDate !== "N/A" && (
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(
                                      rider.lastPayoutDate,
                                    ).toLocaleDateString("en-IN", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </span>
                                )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">
                              No payouts yet
                            </span>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-[160px]"
                            >
                              <DropdownMenuItem
                                className="cursor-pointer font-medium"
                                onClick={() => openEditModal(rider)}
                              >
                                <Edit className="mr-2 h-4 w-4 text-muted-foreground" />
                                Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:bg-destructive/10 cursor-pointer font-medium"
                                onClick={() => openDeleteModal(rider)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Rider
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DataTableCard>
      )}

      {/* --- ONBOARD RIDER MODAL --- */}
      <Dialog
        open={isOnboardingModalOpen}
        onOpenChange={setIsOnboardingModalOpen}
      >
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Onboard New Rider
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground mt-1.5">
                Create a new delivery partner account. They can change their
                password later.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Full Name</label>
                <Input
                  placeholder="e.g. John Doe"
                  value={onboardForm.fullName}
                  onChange={(e) =>
                    setOnboardForm((prev) => ({
                      ...prev,
                      fullName: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Employee Code</label>
                <Input
                  placeholder="e.g. RID-005"
                  value={onboardForm.employeeCode}
                  onChange={(e) =>
                    setOnboardForm((prev) => ({
                      ...prev,
                      employeeCode: e.target.value.toUpperCase(),
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Email Address</label>
              <Input
                type="email"
                placeholder="rider@arogyadiet.com"
                value={onboardForm.email}
                onChange={(e) =>
                  setOnboardForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Mobile Number</label>
              <Input
                type="tel"
                placeholder="10-digit number"
                value={onboardForm.mobile}
                onChange={(e) =>
                  setOnboardForm((prev) => ({
                    ...prev,
                    mobile: e.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Temporary Password</label>
              <Input
                type="text"
                placeholder="Generate a secure password"
                value={onboardForm.password}
                onChange={(e) =>
                  setOnboardForm((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOnboardingModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleOnboardSubmit} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- EDIT RIDER MODAL --- */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Rider Details</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground mt-1.5">
                Update the name or mobile number for{" "}
                {activeRider?.employee_code}.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Full Name</label>
              <Input
                value={editForm.fullName}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, fullName: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Mobile Number</label>
              <Input
                value={editForm.mobile}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, mobile: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- DELETE RIDER SECURE MODAL --- */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Delete Rider Account
            </DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2 text-red-600/90 font-medium text-sm">
                This action cannot be undone. All data associated with this
                rider will be fully deleted, so please backup data before
                performing delete.
              </div>
            </DialogDescription>
            <div className="text-sm text-muted-foreground mt-2">
              This will permanently delete the rider profile and system access
              for{" "}
              <span className="font-bold text-foreground">
                {activeRider?.fullName}
              </span>
              .
            </div>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20 font-medium">
              To confirm deletion, please type the Employee Code:
              <br />
              <span className="font-bold text-base tracking-widest">
                {activeRider?.employee_code}
              </span>
            </div>
            <Input
              placeholder="Type employee code here..."
              value={deleteConfirmCode}
              onChange={(e) => setDeleteConfirmCode(e.target.value)}
              className="border-destructive/50 focus-visible:ring-destructive"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSubmit}
              disabled={
                isPending || deleteConfirmCode !== activeRider?.employee_code
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}{" "}
              Delete Rider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
