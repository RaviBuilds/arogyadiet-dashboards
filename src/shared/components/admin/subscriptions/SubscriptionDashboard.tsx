"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Loader2,
  Trash2,
  Check,
  Edit,
  PauseCircle,
  TrendingUp,
  CalendarDays,
} from "lucide-react";

import {
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  setRecommendedPlan,
  createSubscriptionPlan,
} from "@/actions/admin-actions/subscriptionActions";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import { HolidayCalendarClient } from "@/shared/components/admin/subscriptions/HolidayCalendarClient";
import { GlobalDiscountClient } from "@/shared/components/admin/subscriptions/GlobalDiscountClient";
import type {
  CouponRow,
  CouponSubscriptionPlan,
} from "@/shared/components/admin/customers/AdminCouponsTab";
import { ConfirmDeleteModal } from "@/shared/components/admin/core/ConfirmDeleteModal";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { buildPlanDistribution } from "@/lib/admin/subscriptionPlanDistribution";

export function SubscriptionDashboard({
  plans,
  activeSubscriptions,
  initialGlobalCoupons = [],
}: {
  plans: any[];
  activeSubscriptions: any[];
  initialGlobalCoupons?: CouponRow[];
}) {
  const [activeTab, setActiveTab] = useState("Subscription Plans");
  const [isPending, startTransition] = useTransition();

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [activePlan, setActivePlan] = useState<any>(null);

  // Form State
  const [formState, setFormState] = useState({
    code: "",
    name: "",
    duration_days: 0,
    pause_credits: 0,
    base_price: 0,
    tax_amount: 0,
    is_active: true,
  });
  const [taxRate, setTaxRate] = useState(5);

  // Tax Calculation Logic
  const handleCalculateTax = () => {
    const calculatedTax = parseFloat(
      ((formState.base_price * taxRate) / 100).toFixed(2),
    );
    setFormState({ ...formState, tax_amount: calculatedTax });
  };
  const totalPrice =
    Number(formState.base_price || 0) + Number(formState.tax_amount || 0);

  // Handlers
  const openCreateModal = () => {
    setModalMode("create");
    setActivePlan(null);
    setFormState({
      code: "",
      name: "",
      duration_days: 30,
      pause_credits: 0,
      base_price: 0,
      tax_amount: 0,
      is_active: true,
    });
    setTaxRate(5);
    setIsModalOpen(true);
  };

  const openEditModal = (plan: any) => {
    setModalMode("edit");
    setActivePlan(plan);
    setFormState({
      code: plan.code || "",
      name: plan.name || "",
      duration_days: plan.duration_days || 0,
      pause_credits: plan.pause_credits || 0,
      base_price: plan.base_price || 0,
      tax_amount: plan.tax_amount || 0,
      is_active: plan.is_active ?? true,
    });
    setTaxRate(5); // Reset tax rate to 5% by default on open
    setIsModalOpen(true);
  };

  const handleSave = () => {
    startTransition(async () => {
      if (modalMode === "create") {
        const res = await createSubscriptionPlan(formState);
        if (res.success) {
          toast.success("Plan created successfully!");
          setIsModalOpen(false);
        } else {
          toast.error(res.error || "Failed to create plan");
        }
      } else if (modalMode === "edit" && activePlan) {
        const res = await updateSubscriptionPlan(activePlan.id, formState);
        if (res.success) {
          toast.success("Plan updated successfully!");
          setIsModalOpen(false);
        } else {
          toast.error(res.error || "Failed to update plan");
        }
      }
    });
  };

  const handleDeleteClick = () => {
    setIsDeleteModalOpen(true);
  };

  const executeDelete = () => {
    if (!activePlan) return;
    startTransition(async () => {
      const res = await deleteSubscriptionPlan(activePlan.id);
      if (res.success) {
        toast.success("Plan permanently deleted.");
        setIsDeleteModalOpen(false);
        setIsModalOpen(false);
      } else {
        toast.error(res.error || "Failed to delete plan", { duration: 6000 });
        setIsDeleteModalOpen(false); // Close confirmation, keep edit open to show error
      }
    });
  };

  // Recommended Plan Handler
  const handleSetRecommended = (value: string) => {
    startTransition(async () => {
      const res = await setRecommendedPlan(value);
      if (res.success) toast.success("Recommended plan updated.");
      else toast.error(res.error || "Failed to update recommended plan");
    });
  };

  // Modeling Calculations
  const totalActive = activeSubscriptions.filter(
    (s) => s.status === "ACTIVE",
  ).length;
  const totalPending = activeSubscriptions.filter(
    (s) => s.status === "PENDING",
  ).length;
  const planDistribution = buildPlanDistribution(
    plans,
    activeSubscriptions,
    "ACTIVE",
  );
  const pendingPlanDistribution = buildPlanDistribution(
    plans,
    activeSubscriptions,
    "PENDING",
  );

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      <AdminSubmenuBar
        tabs={[
          "Subscription Plans",
          "Subscription Modeling",
          "Holiday Calendar",
          "Global Discount",
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "Subscription Plans" && (
        <div>
          {/* Top Controls */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-muted/30 p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <Label className="font-semibold text-sm whitespace-nowrap">
                Best Recommended Plan:
              </Label>
              <Select
                value={plans.find((p: any) => p.recommended)?.id || "NONE"}
                onValueChange={handleSetRecommended}
                disabled={isPending}
              >
                <SelectTrigger className="w-[220px] bg-background shadow-sm">
                  <SelectValue placeholder="Select Plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  {plans.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <Button className="shrink-0 shadow-sm" onClick={openCreateModal}>Create New Plan</Button>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className={`flex flex-col relative overflow-hidden transition-all hover:shadow-md ${
                  !plan.is_active
                    ? "opacity-70 grayscale"
                    : plan.recommended
                      ? "border-primary border-2 shadow-md scale-[1.02] z-10"
                      : "border-primary/20"
                }`}
              >
                {plan.recommended && (
                  <div className="bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest py-1 px-15 absolute top-13 -right-12 rotate-45 shadow-sm ">
                    Recommended
                  </div>
                )}
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl font-bold">
                        {plan.name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Code: {plan.code}
                      </CardDescription>
                    </div>
                    <Badge variant={plan.is_active ? "secondary" : "default"}>
                      {plan.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-primary">
                      ₹{Number(plan.price).toLocaleString("en-IN")}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      /{plan.duration_days} days
                    </span>
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground mt-4">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />{" "}
                      {plan.duration_days} Delivery Days
                    </li>
                    <li className="flex items-center gap-2">
                      <PauseCircle className="h-4 w-4 text-amber-500 shrink-0" />{" "}
                      {plan.pause_credits} Pause Credits included
                    </li>
                  </ul>
                </CardContent>
                <CardFooter className="border-t bg-muted/20 pt-4 flex gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => openEditModal(plan)}
                  >
                    <Edit className="h-4 w-4 mr-2" /> Edit Plan
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === "Subscription Modeling" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Active Subscriptions
                </CardTitle>
                <ActivityIcon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalActive}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Pending Subs
                </CardTitle>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalPending}</div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Active Distribution by Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {planDistribution.map((pd) => (
                  <div
                    key={pd.name}
                    className="flex items-center justify-between border-b pb-2"
                  >
                    <span className="font-medium">{pd.name}</span>
                    <Badge variant="outline">{pd.count} Active</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pending Distribution by Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingPlanDistribution.map((pd) => (
                  <div
                    key={pd.name}
                    className="flex items-center justify-between border-b pb-2"
                  >
                    <span className="font-medium">{pd.name}</span>
                    <Badge variant="outline">{pd.count} Pending</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "Holiday Calendar" && <HolidayCalendarClient />}

      {activeTab === "Global Discount" && (
        <GlobalDiscountClient
          initialCoupons={initialGlobalCoupons}
          subscriptionPlans={plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            duration_days: plan.duration_days,
            is_active: plan.is_active,
          }))}
        />
      )}

      {/* CREATE/EDIT PLAN MODAL */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{modalMode === "create" ? "Create New Subscription Plan" : "Edit Subscription Plan"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Row 1: Code & Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Plan Code</Label>
                <Input
                  value={formState.code}
                  onChange={(e) =>
                    setFormState({ ...formState, code: e.target.value })
                  }
                  disabled={modalMode === "edit"} // Often plan codes shouldn't be edited once created
                  placeholder="e.g. LITE_30"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Plan Name</Label>
                <Input
                  value={formState.name}
                  onChange={(e) =>
                    setFormState({ ...formState, name: e.target.value })
                  }
                  placeholder="e.g. Basic Plan"
                />
              </div>
            </div>

            {/* Row 2: Duration & Pause Credits */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Duration (Days)</Label>
                <Input
                  type="number"
                  value={formState.duration_days}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      duration_days: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Pause Credits</Label>
                <Input
                  type="number"
                  value={formState.pause_credits}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      pause_credits: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            {/* Row 3: Base Price & Tax Percentage */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Base Price (₹)</Label>
                <Input
                  type="number"
                  value={formState.base_price}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      base_price: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Tax Percentage</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    className="w-20"
                    placeholder="%"
                  />
                  <span className="text-sm font-medium text-muted-foreground">
                    %
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleCalculateTax}
                  >
                    Calculate
                  </Button>
                </div>
              </div>
            </div>

            {/* Row 4: Tax Amount & Total Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Tax Amount (₹)</Label>
                <Input
                  type="number"
                  value={formState.tax_amount}
                  readOnly
                  className="bg-muted"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Total Price (₹)</Label>
                <div className="flex items-center h-9 px-3 bg-primary/5 rounded-md border border-primary/20 font-bold text-primary">
                  ₹{totalPrice.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Row 5: Active Status */}
            <div className="flex items-center justify-between pt-4 border-t">
              <div className="flex flex-col gap-1">
                <Label className="text-sm font-medium">Active Status</Label>
                <span className="text-xs text-muted-foreground">
                  {formState.is_active
                    ? "Visible to customers on Storefront"
                    : "Hidden (Archived)"}
                </span>
              </div>
              <Switch
                checked={formState.is_active}
                onCheckedChange={(checked) =>
                  setFormState({ ...formState, is_active: checked })
                }
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between w-full pt-4 border-t gap-2 sm:space-x-0">
            {modalMode === "edit" ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={isPending}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete Plan
              </Button>
            ) : (
              <div /> // Empty div to push the right buttons to the end
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="bg-primary hover:bg-primary/90"
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
                {modalMode === "create" ? "Create Plan" : "Save Changes"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REUSABLE DELETE CONFIRMATION MODAL */}
      <ConfirmDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={executeDelete}
        title="Delete Subscription Plan"
        description={`Are you sure you want to permanently delete the "${activePlan?.name}" plan? This action cannot be undone.`}
        isPending={isPending}
      />
    </div>
  );
}

// Temporary Icon wrapper
function ActivityIcon(props: any) {
  return <TrendingUp {...props} />;
}
