"use client";

import React, { useState, useTransition, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateCustomerBasicInfo,
  updateCustomerDietaryProfile,
  updateCustomerMedicalProfile,
  deleteMedicalDocument,
  adminUpsertCustomerAddress,
  adminDeleteCustomerAddress,
  adminSetCustomerPassword,
  adminSendPasswordReset,
  adminToggleCustomerActive,
  deactivateCustomerAccount,
} from "@/actions/admin-actions/customerActions";
import { isArchivedCustomerEmail } from "@/lib/customers/customerArchive";

import { AdminSubmenu } from "@/shared/components/admin/core/AdminSubmenu";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { Switch } from "@/shared/components/ui/switch";
import { Label } from "@/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { ConfirmDeleteModal } from "../core/ConfirmDeleteModal";
import { AdminMedicalUploadModal } from "./AdminMedicalUploadModal";

import {
  BadgeIndianRupee,
  CheckCircle2,
  CreditCard,
  Edit,
  Eye,
  Eye as EyeIcon,
  EyeOff,
  FileText,
  Home,
  Loader2,
  MapPin,
  Plus,
  ReceiptText,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { format, isValid } from "date-fns";
import type { AddressFormValues } from "@/validations/addressSchema";
import {
  AdminAddSubscriptionForm,
  type InitialSubscriptionData,
} from "./AdminAddSubscriptionForm";
import {
  AdminCouponsTab,
  type CouponRow,
} from "./AdminCouponsTab";

const AddressPickerMap = dynamic(
  () =>
    import("@/shared/components/customer/address-picker-map").then(
      (module) => module.AddressPickerMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-[220px] w-full animate-pulse rounded-lg bg-muted" />
    ),
  },
);

function parseCoordInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "." || trimmed === "-.") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAddressUpdatedAt(iso?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (!isValid(date)) return null;
  return format(date, "dd MMM yyyy, hh:mm a");
}

interface CustomerProfile {
  userId: string;
  authUserId?: string;
  isActive?: boolean;
  id: string;
  full_name: string;
  email: string;
  mobile: string;
  gender: string;
  date_of_birth: string;
  dietary_preference: string;
  allergies: string;
  medical_history_notes: string;
  has_medical_history: boolean;
  medical_documents: {
    id: string;
    file_name: string;
    storage_path: string;
    uploaded_at: string;
    signedUrl?: string;
  }[];
  addresses: CustomerAddress[];
}

interface CustomerAddress {
  id: string;
  tag: "Home" | "Work" | "Other";
  street_1: string;
  street_2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  is_primary: boolean;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string;
}

interface BillingPayment {
  id: string;
  amount: number | string;
  payment_method: string;
  status: string;
  created_at: string;
  paid_at?: string | null;
  invoice_type?: string | null;
  payment_reference?: string | null;
  payment_notes?: string | null;
  subscriptions?: {
    subscription_code?: string | null;
    status?: string | null;
    subscription_plans?: { name?: string | null } | null;
  } | null;
}

export function Customer360Dashboard({
  customer,
  initialSubscriptionData,
  initialCoupons,
  billingPayments = [],
  hasActiveSubscription = false,
}: {
  customer: CustomerProfile;
  initialSubscriptionData: InitialSubscriptionData;
  initialCoupons: CouponRow[];
  billingPayments?: BillingPayment[];
  hasActiveSubscription?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState("Profile & Medical");

  // User Management State
  const [pwdForm, setPwdForm] = useState({ password: "", confirm: "", showPwd: false });
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isAccountActive, setIsAccountActive] = useState(customer.isActive ?? true);
  const isArchivedAccount = isArchivedCustomerEmail(customer.email);

  // Modals State
  const [isPersonalModalOpen, setIsPersonalModalOpen] = useState(false);
  const [isDietaryModalOpen, setIsDietaryModalOpen] = useState(false);
  const [isMedicalModalOpen, setIsMedicalModalOpen] = useState(false);
  const [deleteDocState, setDeleteDocState] = useState({
    isOpen: false,
    docId: "",
    storagePath: "",
  });
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [addressModalMode, setAddressModalMode] = useState<"create" | "edit">(
    "create",
  );
  const [addressForm, setAddressForm] = useState<AddressFormValues>({
    tag: "Home",
    street_1: "",
    street_2: "",
    landmark: "",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "",
    is_primary: false,
    lat: null,
    lng: null,
  });
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [deleteAddressState, setDeleteAddressState] = useState({
    isOpen: false,
    addressId: "",
  });

  // Forms State
  const [personalForm, setPersonalForm] = useState({
    fullName: customer.full_name,
    mobile: customer.mobile,
    gender: customer.gender,
    dateOfBirth: customer.date_of_birth,
  });
  const [dietaryForm, setDietaryForm] = useState({
    dietaryPreference: customer.dietary_preference,
    allergies: customer.allergies,
  });
  const [medicalForm, setMedicalForm] = useState({
    medicalHistoryNotes: customer.medical_history_notes,
    hasMedicalHistory: customer.has_medical_history,
  });

  // Handlers
  const handlePersonalSubmit = () =>
    startTransition(async () => {
      const res = await updateCustomerBasicInfo(
        customer.id,
        customer.userId,
        personalForm,
      );
      if (res.success) {
        toast.success("Personal info updated!");
        setIsPersonalModalOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const handleDietarySubmit = () =>
    startTransition(async () => {
      const res = await updateCustomerDietaryProfile(customer.id, dietaryForm);
      if (res.success) {
        toast.success("Dietary profile updated!");
        setIsDietaryModalOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const handleMedicalSubmit = () =>
    startTransition(async () => {
      const res = await updateCustomerMedicalProfile(customer.id, medicalForm);
      if (res.success) {
        toast.success("Medical assessment updated!");
        setIsMedicalModalOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const executeDeleteDocument = () => {
    startTransition(async () => {
      const res = await deleteMedicalDocument(
        deleteDocState.docId,
        deleteDocState.storagePath,
        customer.id,
      );
      if (res.success) {
        toast.success("Document deleted!");
        setDeleteDocState({ isOpen: false, docId: "", storagePath: "" });
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const syncCoordInputs = useCallback(
    (lat: number | null, lng: number | null) => {
      setLatInput(lat != null ? String(lat) : "");
      setLngInput(lng != null ? String(lng) : "");
    },
    [],
  );

  const handleMapCoordinatesChange = useCallback(
    (lat: number, lng: number) => {
      setAddressForm((prev) => ({ ...prev, lat, lng }));
      syncCoordInputs(lat, lng);
    },
    [syncCoordInputs],
  );

  const openCreateAddressModal = () => {
    setAddressModalMode("create");
    setAddressForm({
      tag: "Home",
      street_1: "",
      street_2: "",
      landmark: "",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "",
      is_primary: customer.addresses.length === 0,
      lat: null,
      lng: null,
    });
    syncCoordInputs(null, null);
    setIsAddressModalOpen(true);
  };

  const openEditAddressModal = (address: CustomerAddress) => {
    setAddressModalMode("edit");
    const lat = address.lat ?? null;
    const lng = address.lng ?? null;
    setAddressForm({
      id: address.id,
      tag: address.tag,
      street_1: address.street_1,
      street_2: address.street_2 ?? "",
      landmark: address.landmark ?? "",
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      is_primary: address.is_primary,
      lat,
      lng,
    });
    syncCoordInputs(lat, lng);
    setIsAddressModalOpen(true);
  };

  const handleAddressSubmit = () =>
    startTransition(async () => {
      const res = await adminUpsertCustomerAddress(customer.id, addressForm);
      if (res.success) {
        toast.success(
          addressModalMode === "create"
            ? "Address added successfully."
            : "Address updated successfully.",
        );
        setIsAddressModalOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to save address.");
      }
    });

  const executeDeleteAddress = () =>
    startTransition(async () => {
      const res = await adminDeleteCustomerAddress(
        customer.id,
        deleteAddressState.addressId,
      );
      if (res.success) {
        toast.success("Address deleted successfully.");
        setDeleteAddressState({ isOpen: false, addressId: "" });
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to delete address.");
      }
    });

  const successfulPayments = billingPayments.filter((payment) =>
    ["PAID", "SUCCESS", "CAPTURED"].includes(payment.status),
  );
  const pendingPayments = billingPayments.filter(
    (payment) => payment.status === "PENDING",
  );
  const totalPaid = successfulPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );
  const totalPending = pendingPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );
  const formatMoney = (value: number | string) =>
    `₹${Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="w-full">
      <AdminSubmenu
        tabs={[
          "Profile & Medical",
          "Add Subscription",
          "Addresses",
          "Billing",
          "Coupons",
          "User Management",
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="mt-8">
        {activeTab === "Profile & Medical" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Personal Info Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>Personal Info</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsPersonalModalOpen(true)}
                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Full Name
                  </p>
                  <p className="font-semibold">{customer.full_name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Email
                  </p>
                  <p>{customer.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Mobile
                  </p>
                  <p>{customer.mobile}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Gender
                  </p>
                  <p>{customer.gender}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    DOB
                  </p>
                  <p>
                    {customer.date_of_birth &&
                    isValid(new Date(customer.date_of_birth))
                      ? format(new Date(customer.date_of_birth), "PPP")
                      : "N/A"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Dietary Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>Dietary Profile</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsDietaryModalOpen(true)}
                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Dietary Preference
                  </p>
                  <Badge>{customer.dietary_preference}</Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Allergies
                  </p>
                  <p>{customer.allergies}</p>
                </div>
              </CardContent>
            </Card>

            {/* Medical Assessment Card */}
            <Card className="lg:col-span-1">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>Medical Assessment</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMedicalModalOpen(true)}
                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Notes
                </p>
                <p className="text-sm mb-4">{customer.medical_history_notes}</p>
                <div className="flex items-center justify-between mb-3 pt-2 border-t mt-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    Documents
                  </p>
                  <AdminMedicalUploadModal
                    profileId={customer.id}
                    userId={customer.userId}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {customer.medical_documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="relative group aspect-square bg-muted rounded border flex items-center justify-center overflow-hidden"
                    >
                      {doc.signedUrl ? (
                        doc.file_name.endsWith(".pdf") ? (
                          <FileText className="h-8 w-8 text-red-400" />
                        ) : (
                          <img
                            src={doc.signedUrl}
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          Link expired
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1">
                        <a
                          href={doc.signedUrl}
                          target="_blank"
                          className="p-1.5 bg-white/20 hover:bg-white/40 rounded-full text-white transition-colors"
                        >
                          <Eye className="h-4 w-4 text-white" />
                        </a>
                        <button
                          onClick={() =>
                            setDeleteDocState({
                              isOpen: true,
                              docId: doc.id,
                              storagePath: doc.storage_path,
                            })
                          }
                          className="p-1.5 bg-red-500/80 hover:bg-red-500 rounded-full text-white transition-colors"
                        >
                          <Trash2 className="h-4 w-4 text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "Add Subscription" && (
          <AdminAddSubscriptionForm
            customerProfileId={customer.id}
            initialData={initialSubscriptionData}
          />
        )}

        {activeTab === "Addresses" && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  Address Management
                </h2>
                <p className="text-sm text-muted-foreground">
                  Manage saved delivery addresses for this customer. Maximum 2
                  addresses are allowed.
                </p>
              </div>
              <Button
                size="sm"
                onClick={openCreateAddressModal}
                disabled={customer.addresses.length >= 2}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Address
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Saved Addresses
                      </p>
                      <p className="mt-2 text-3xl font-black">
                        {customer.addresses.length}
                        <span className="text-sm font-medium text-muted-foreground">
                          {" "}
                          / 2
                        </span>
                      </p>
                    </div>
                    <MapPin className="h-8 w-8 text-primary" />
                  </div>
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <Star className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Primary Address</p>
                      <p className="text-sm text-muted-foreground">
                        {customer.addresses.find((addr) => addr.is_primary)
                          ? `${customer.addresses.find((addr) => addr.is_primary)?.street_1}, ${customer.addresses.find((addr) => addr.is_primary)?.city} - ${customer.addresses.find((addr) => addr.is_primary)?.pincode}`
                          : "No primary address selected yet."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {customer.addresses.length === 0 ? (
              <Card className="border-dashed shadow-none">
                <CardContent className="p-10 text-center text-muted-foreground">
                  <MapPin className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  No addresses saved for this customer.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {customer.addresses.map((address) => (
                  <Card
                    key={address.id}
                    className={
                      address.is_primary
                        ? "border-primary/40 shadow-sm"
                        : "shadow-sm"
                    }
                  >
                    <CardHeader className="flex flex-row items-start justify-between gap-4 border-b bg-muted/20 pb-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl border bg-background p-2">
                          {address.tag === "Home" ? (
                            <Home className="h-5 w-5 text-primary" />
                          ) : (
                            <MapPin className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <CardTitle className="flex items-center gap-2 text-base">
                            {address.tag}
                            {address.is_primary && (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                Primary
                              </Badge>
                            )}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            Pincode {address.pincode}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditAddressModal(address)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() =>
                            setDeleteAddressState({
                              isOpen: true,
                              addressId: address.id,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-3">
                      <p className="text-sm font-medium leading-6">
                        {address.street_1}
                        {address.street_2 ? `, ${address.street_2}` : ""}
                      </p>
                      {address.landmark && (
                        <p className="text-sm text-muted-foreground">
                          Landmark: {address.landmark}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="bg-muted/40">
                          {address.city}
                        </Badge>
                        <Badge variant="outline" className="bg-muted/40">
                          {address.state}
                        </Badge>
                      </div>
                      {formatAddressUpdatedAt(address.updated_at) && (
                        <p className="text-xs text-gray-500 mt-2">
                          Last updated:{" "}
                          {formatAddressUpdatedAt(address.updated_at)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "Billing" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                Billing Overview
              </h2>
              <p className="text-sm text-muted-foreground">
                Review payment totals, pending collections, and invoice history
                for this customer.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-emerald-200 bg-emerald-50/50">
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-700">
                      Total Paid
                    </p>
                    <p className="mt-2 text-2xl font-black text-emerald-900">
                      {formatMoney(totalPaid)}
                    </p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </CardContent>
              </Card>
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-amber-700">
                      Pending Collection
                    </p>
                    <p className="mt-2 text-2xl font-black text-amber-900">
                      {formatMoney(totalPending)}
                    </p>
                  </div>
                  <CreditCard className="h-8 w-8 text-amber-600" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Billing Records
                    </p>
                    <p className="mt-2 text-2xl font-black">
                      {billingPayments.length}
                    </p>
                  </div>
                  <ReceiptText className="h-8 w-8 text-primary" />
                </CardContent>
              </Card>
            </div>

            <Card className="overflow-hidden shadow-sm">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BadgeIndianRupee className="h-5 w-5 text-primary" />
                  Payment History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {billingPayments.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground">
                    <ReceiptText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    No billing records found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-5 py-4 font-bold">Date</th>
                          <th className="px-5 py-4 font-bold">Plan / Type</th>
                          <th className="px-5 py-4 font-bold">Amount</th>
                          <th className="px-5 py-4 font-bold">Method</th>
                          <th className="px-5 py-4 font-bold">Status</th>
                          <th className="px-5 py-4 font-bold">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {billingPayments.map((payment) => {
                          const subscription = Array.isArray(payment.subscriptions)
                            ? payment.subscriptions[0]
                            : payment.subscriptions;
                          const planName =
                            subscription?.subscription_plans?.name ??
                            payment.invoice_type ??
                            "Billing Record";
                          const isPaid = ["PAID", "SUCCESS", "CAPTURED"].includes(
                            payment.status,
                          );

                          return (
                            <tr key={payment.id} className="hover:bg-muted/20">
                              <td className="px-5 py-4 whitespace-nowrap">
                                <div className="font-medium">
                                  {payment.created_at &&
                                  isValid(new Date(payment.created_at))
                                    ? format(
                                        new Date(payment.created_at),
                                        "MMM d, yyyy",
                                      )
                                    : "N/A"}
                                </div>
                                {payment.paid_at && (
                                  <div className="text-xs text-muted-foreground">
                                    Paid{" "}
                                    {format(new Date(payment.paid_at), "MMM d")}
                                  </div>
                                )}
                              </td>
                              <td className="px-5 py-4">
                                <div className="font-semibold">{planName}</div>
                                {subscription?.subscription_code && (
                                  <div className="text-xs text-muted-foreground">
                                    {subscription.subscription_code}
                                  </div>
                                )}
                              </td>
                              <td className="px-5 py-4 font-bold">
                                {formatMoney(payment.amount)}
                              </td>
                              <td className="px-5 py-4">
                                <Badge variant="outline" className="bg-muted/40">
                                  {payment.payment_method}
                                </Badge>
                              </td>
                              <td className="px-5 py-4">
                                <Badge
                                  variant="outline"
                                  className={
                                    isPaid
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : payment.status === "PENDING"
                                        ? "bg-amber-50 text-amber-700 border-amber-200"
                                        : "bg-red-50 text-red-700 border-red-200"
                                  }
                                >
                                  {isPaid ? "PAID" : payment.status}
                                </Badge>
                              </td>
                              <td className="px-5 py-4 text-muted-foreground">
                                {payment.payment_reference || payment.id.slice(0, 8)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "Coupons" && (
          <AdminCouponsTab
            customerProfileId={customer.id}
            initialCoupons={initialCoupons}
          />
        )}

        {activeTab === "User Management" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ── Set New Password ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  Set New Password
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">New Password</label>
                  <div className="relative">
                    <Input
                      type={pwdForm.showPwd ? "text" : "password"}
                      placeholder="Min 8 characters"
                      value={pwdForm.password}
                      onChange={(e) => setPwdForm((p) => ({ ...p, password: e.target.value }))}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setPwdForm((p) => ({ ...p, showPwd: !p.showPwd }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {pwdForm.showPwd ? <EyeOff className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Confirm Password</label>
                  <Input
                    type="password"
                    placeholder="Repeat password"
                    value={pwdForm.confirm}
                    onChange={(e) => setPwdForm((p) => ({ ...p, confirm: e.target.value }))}
                  />
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  disabled={
                    isPending ||
                    pwdForm.password.length < 8 ||
                    pwdForm.password !== pwdForm.confirm
                  }
                  onClick={() =>
                    startTransition(async () => {
                      if (!customer.authUserId) return;
                      const res = await adminSetCustomerPassword(customer.authUserId, pwdForm.password);
                      if (res.success) {
                        toast.success("Password updated successfully.");
                        setPwdForm({ password: "", confirm: "", showPwd: false });
                      } else {
                        toast.error(res.error ?? "Failed to update password.");
                      }
                    })
                  }
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Update Password
                </Button>
              </CardContent>
            </Card>

            {/* ── Send Password Reset ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="h-4 w-4 text-primary" />
                  Send Password Reset Link
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Send a secure password reset link to{" "}
                  <span className="font-semibold text-foreground">{customer.email}</span>.
                  The customer can use it to set a new password.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await adminSendPasswordReset(customer.email);
                      if (res.success) {
                        toast.success("Password reset link sent successfully.");
                      } else {
                        toast.error(res.error ?? "Failed to send reset link.");
                      }
                    })
                  }
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-3.5 w-3.5 mr-2" />}
                  Send Reset Link
                </Button>
              </CardContent>
            </Card>

            {/* ── Account Status ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {isAccountActive ? (
                    <UserCheck className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <UserX className="h-4 w-4 text-orange-500" />
                  )}
                  Account Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Current status:</span>
                  <Badge
                    variant="outline"
                    className={
                      isAccountActive
                        ? "border-emerald-500 text-emerald-600 bg-emerald-50"
                        : "border-orange-500 text-orange-600 bg-orange-50"
                    }
                  >
                    {isAccountActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {isAccountActive ? (
                  <p className="text-xs text-muted-foreground">
                    Deactivating archives the account and releases the email for future reuse. Billing history is preserved.
                  </p>
                ) : isArchivedAccount ? (
                  <p className="text-xs text-muted-foreground">
                    This account is archived. Create a new customer with the original email if they return.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Reactivating will restore the customer&apos;s login access.
                  </p>
                )}
                {isAccountActive && hasActiveSubscription && (
                  <p className="text-xs text-destructive font-medium">
                    Cannot deactivate — customer has an active subscription. Cancel the subscription first.
                  </p>
                )}
                <Button
                  variant={isAccountActive ? "outline" : "default"}
                  className="w-full"
                  size="sm"
                  disabled={
                    isPending ||
                    isArchivedAccount ||
                    (isAccountActive && hasActiveSubscription)
                  }
                  onClick={() =>
                    startTransition(async () => {
                      if (!customer.authUserId) return;
                      const makeActive = !isAccountActive;
                      const res = await adminToggleCustomerActive(
                        customer.id,
                        customer.userId,
                        customer.authUserId,
                        makeActive,
                      );
                      if (res.success) {
                        toast.success(
                          makeActive ? "Account reactivated." : "Account deactivated.",
                        );
                        setIsAccountActive(makeActive);
                        router.refresh();
                      } else {
                        toast.error(res.error ?? "Failed to update account status.");
                      }
                    })
                  }
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : isAccountActive ? (
                    <UserX className="h-3.5 w-3.5 mr-2" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5 mr-2" />
                  )}
                  {isArchivedAccount
                    ? "Account Archived"
                    : isAccountActive
                      ? "Deactivate Account"
                      : "Reactivate Account"}
                </Button>
              </CardContent>
            </Card>

            {/* ── Danger Zone: Delete ── */}
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Deactivate and archive this customer account. Login will be
                  blocked, but billing history is preserved. The same email can
                  be used later to create a new customer.
                </p>
                {hasActiveSubscription && (
                  <p className="text-xs text-destructive font-medium">
                    Cannot deactivate — customer has an active subscription. Cancel the subscription first.
                  </p>
                )}
                {isArchivedAccount && (
                  <p className="text-xs text-muted-foreground font-medium">
                    This account is already archived.
                  </p>
                )}
                <div className="grid gap-1.5">
                  <label className="text-xs text-muted-foreground">
                    Type <span className="font-mono font-semibold text-foreground">{customer.full_name}</span> to confirm
                  </label>
                  <Input
                    placeholder={customer.full_name}
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    className="border-destructive/40 focus-visible:ring-destructive/30"
                  />
                </div>
                <Button
                  variant="destructive"
                  className="w-full"
                  size="sm"
                  disabled={
                    isPending ||
                    deleteConfirmName !== customer.full_name ||
                    hasActiveSubscription ||
                    isArchivedAccount ||
                    !isAccountActive
                  }
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deactivateCustomerAccount(
                        customer.id,
                        customer.userId,
                      );
                      if (res.success) {
                        toast.success("Customer account deactivated.");
                        router.push("/customers");
                      } else {
                        toast.error(res.error ?? "Failed to deactivate customer.");
                      }
                    })
                  }
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-3.5 w-3.5 mr-2" />}
                  Deactivate Account
                </Button>
              </CardContent>
            </Card>

          </div>
        )}
      </div>

      <ConfirmDeleteModal
        isOpen={deleteDocState.isOpen}
        onClose={() =>
          setDeleteDocState({ isOpen: false, docId: "", storagePath: "" })
        }
        onConfirm={executeDeleteDocument}
        title="Delete Document"
        description="Permanent delete?"
        isPending={isPending}
      />

      <ConfirmDeleteModal
        isOpen={deleteAddressState.isOpen}
        onClose={() =>
          setDeleteAddressState({ isOpen: false, addressId: "" })
        }
        onConfirm={executeDeleteAddress}
        title="Delete Address"
        description="Are you sure you want to delete this saved address? This action cannot be undone."
        isPending={isPending}
      />

      {/* --- ADDRESS MODAL --- */}
      <Dialog open={isAddressModalOpen} onOpenChange={setIsAddressModalOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {addressModalMode === "create" ? "Add Address" : "Edit Address"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Address Tag</Label>
                <Select
                  value={addressForm.tag}
                  onValueChange={(value: "Home" | "Work" | "Other") =>
                    setAddressForm({ ...addressForm, tag: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Home">Home</SelectItem>
                    <SelectItem value="Work">Work</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Pincode</Label>
                <Input
                  value={addressForm.pincode}
                  onChange={(e) =>
                    setAddressForm({
                      ...addressForm,
                      pincode: e.target.value,
                    })
                  }
                  placeholder="500XXX"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Street Address</Label>
              <Input
                value={addressForm.street_1}
                onChange={(e) =>
                  setAddressForm({ ...addressForm, street_1: e.target.value })
                }
                placeholder="Flat / House no, street, area"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Street 2</Label>
                <Input
                  value={addressForm.street_2 ?? ""}
                  onChange={(e) =>
                    setAddressForm({
                      ...addressForm,
                      street_2: e.target.value,
                    })
                  }
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-2">
                <Label>Landmark</Label>
                <Input
                  value={addressForm.landmark ?? ""}
                  onChange={(e) =>
                    setAddressForm({
                      ...addressForm,
                      landmark: e.target.value,
                    })
                  }
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>City</Label>
                <Input
                  value={addressForm.city}
                  onChange={(e) =>
                    setAddressForm({ ...addressForm, city: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>State</Label>
                <Input
                  value={addressForm.state}
                  onChange={(e) =>
                    setAddressForm({ ...addressForm, state: e.target.value })
                  }
                />
              </div>
            </div>

            <AddressPickerMap
              lat={addressForm.lat ?? null}
              lng={addressForm.lng ?? null}
              showLocateButton={false}
              onCoordinatesChange={handleMapCoordinatesChange}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Latitude</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={latInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setLatInput(value);
                    const parsed = parseCoordInput(value);
                    if (parsed !== null) {
                      setAddressForm((prev) => ({ ...prev, lat: parsed }));
                    } else if (value.trim() === "") {
                      setAddressForm((prev) => ({ ...prev, lat: null }));
                    }
                  }}
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-2">
                <Label>Longitude</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={lngInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setLngInput(value);
                    const parsed = parseCoordInput(value);
                    if (parsed !== null) {
                      setAddressForm((prev) => ({ ...prev, lng: parsed }));
                    } else if (value.trim() === "") {
                      setAddressForm((prev) => ({ ...prev, lng: null }));
                    }
                  }}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
              <div>
                <Label className="font-semibold">Primary Address</Label>
                <p className="text-xs text-muted-foreground">
                  Used as the default delivery address for this customer.
                </p>
              </div>
              <Switch
                checked={addressForm.is_primary}
                onCheckedChange={(checked) =>
                  setAddressForm({ ...addressForm, is_primary: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddressModalOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAddressSubmit} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- PERSONAL INFO MODAL --- */}
      <Dialog open={isPersonalModalOpen} onOpenChange={setIsPersonalModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Personal Info</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="fullName" className="text-right">
                Full Name
              </Label>
              <Input
                id="fullName"
                value={personalForm.fullName}
                onChange={(e) =>
                  setPersonalForm({ ...personalForm, fullName: e.target.value })
                }
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input
                id="email"
                value={customer.email}
                disabled
                className="col-span-3 bg-muted"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="mobile" className="text-right">
                Mobile
              </Label>
              <Input
                id="mobile"
                value={personalForm.mobile}
                onChange={(e) =>
                  setPersonalForm({ ...personalForm, mobile: e.target.value })
                }
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="gender" className="text-right">
                Gender
              </Label>
              <Select
                value={personalForm.gender}
                onValueChange={(value) =>
                  setPersonalForm({ ...personalForm, gender: value })
                }
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select Gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="dateOfBirth" className="text-right">
                Date of Birth
              </Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={personalForm.dateOfBirth}
                onChange={(e) =>
                  setPersonalForm({
                    ...personalForm,
                    dateOfBirth: e.target.value,
                  })
                }
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              onClick={handlePersonalSubmit}
              disabled={isPending}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- DIETARY MODAL --- */}
      <Dialog open={isDietaryModalOpen} onOpenChange={setIsDietaryModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Dietary Profile</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="dietaryPreference" className="text-right">
                Dietary Preference
              </Label>
              <Select
                value={dietaryForm.dietaryPreference}
                onValueChange={(value) =>
                  setDietaryForm({ ...dietaryForm, dietaryPreference: value })
                }
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select Preference" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Veg">Veg</SelectItem>
                  <SelectItem value="Non-Veg">Non-Veg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="allergies" className="text-right">
                Allergies
              </Label>
              <Textarea
                id="allergies"
                value={dietaryForm.allergies}
                onChange={(e) =>
                  setDietaryForm({ ...dietaryForm, allergies: e.target.value })
                }
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              onClick={handleDietarySubmit}
              disabled={isPending}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- MEDICAL MODAL --- */}
      <Dialog open={isMedicalModalOpen} onOpenChange={setIsMedicalModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Medical Assessment</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="hasMedicalHistory" className="text-right">
                Has Medical History
              </Label>
              <Switch
                id="hasMedicalHistory"
                checked={medicalForm.hasMedicalHistory}
                onCheckedChange={(checked) =>
                  setMedicalForm({ ...medicalForm, hasMedicalHistory: checked })
                }
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="medicalHistoryNotes" className="text-right">
                Medical Notes
              </Label>
              <Textarea
                id="medicalHistoryNotes"
                value={medicalForm.medicalHistoryNotes}
                onChange={(e) =>
                  setMedicalForm({
                    ...medicalForm,
                    medicalHistoryNotes: e.target.value,
                  })
                }
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              onClick={handleMedicalSubmit}
              disabled={isPending}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
