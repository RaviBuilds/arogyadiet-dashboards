"use client";

import React, { useState, useTransition, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getServiceAreaPincodesAction } from "@/actions/pincodeActions";
import { getPincodeValidationError } from "@/lib/address/validatePincode";
import {
  updateCustomerBasicInfo,
  updateCustomerDietaryProfile,
  updateCustomerMedicalProfile,
  deleteMedicalDocument,
  adminUpsertCustomerAddress,
  adminDeleteCustomerAddress,
  adminSetCustomerPassword,
  adminSendPasswordReset,
  adminUpdateCustomerEmail,
  adminToggleCustomerActive,
  deactivateCustomerAccount,
} from "@/actions/admin-actions/customerActions";
import { isArchivedCustomerEmail } from "@/lib/customers/customerArchive";

import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
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
import { ResetPinDialog } from "@/shared/components/admin/ResetPinDialog";
import { ClinicAssignmentSelector } from "./ClinicAssignmentSelector";

import {
  BadgeIndianRupee,
  CheckCircle2,
  CreditCard,
  Download,
  Edit,
  Eye,
  Eye as EyeIcon,
  EyeOff,
  FileText,
  Home,
  KeyRound,
  Loader2,
  MapPin,
  Package,
  Plus,
  ReceiptText,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  Truck,
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
import { CourierForm } from "./CourierForm";
import { AdminKitTrackerView } from "./kit-tracker/AdminKitTrackerView";
import { KitEligibilityBadge } from "./KitEligibilityBadge";
import type { ShippingInfo } from "@/types/kitShipping";

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

/** The customer's active KIT subscription, when Primary_Category is KIT. */
interface KitSubscriptionInfo {
  subscriptionId: string;
  kitProductName: string;
  kitDurationDays: number;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  basePrice: number | null;
  taxRate: number | null;
  kitReceivedDate: string | null;
  kitTrackerEndDate: string | null;
  kitTotalSkippedDays: number;
}

export function Customer360Dashboard({
  customer,
  initialSubscriptionData,
  initialCoupons,
  billingPayments = [],
  hasActiveSubscription = false,
  actions,
  addSubscriptionAction,
  createCouponAction,
  deleteCouponAction,
  uploadMedicalAction,
  franchiseId,
  backHref = "/customers",
  customerCategory = null,
  kitSubscription = null,
  existingShippingInfo = null,
  kitDailyLogs = [],
  customerClinicId = null,
}: {
  customer: CustomerProfile;
  initialSubscriptionData: InitialSubscriptionData;
  initialCoupons: CouponRow[];
  billingPayments?: BillingPayment[];
  hasActiveSubscription?: boolean;
  /** The customer's current Primary_Category ("MEAL" | "KIT" | "ACCOMMODATION"), if any. */
  customerCategory?: string | null;
  /** Active KIT subscription details, present only when customerCategory is "KIT". */
  kitSubscription?: KitSubscriptionInfo | null;
  /** Existing courier/tracking info for the KIT order, if already saved. */
  existingShippingInfo?: ShippingInfo | null;
  /** Daily logs for the KIT tracker (read-only display in admin view). */
  kitDailyLogs?: Array<{
    log_date: string;
    status: "FOOD_TAKEN" | "FOOD_SKIPPED";
    physical_activity_minutes: number | null;
    physical_activity_name: string | null;
    weight_kg: number | null;
  }>;
  /** The customer's currently assigned clinic_id (for manual assignment on KIT customers). */
  customerClinicId?: string | null;
  /**
   * Injectable server actions. Defaults to admin-scoped actions, so the admin
   * portal works unchanged. The franchise portal passes franchise-scoped
   * equivalents that enforce franchise_id ownership.
   */
  actions?: Partial<{
    updateCustomerBasicInfo: typeof updateCustomerBasicInfo;
    updateCustomerDietaryProfile: typeof updateCustomerDietaryProfile;
    updateCustomerMedicalProfile: typeof updateCustomerMedicalProfile;
    deleteMedicalDocument: typeof deleteMedicalDocument;
    adminUpsertCustomerAddress: typeof adminUpsertCustomerAddress;
    adminDeleteCustomerAddress: typeof adminDeleteCustomerAddress;
    adminSetCustomerPassword: typeof adminSetCustomerPassword;
    adminSendPasswordReset: typeof adminSendPasswordReset;
    adminUpdateCustomerEmail: typeof adminUpdateCustomerEmail;
    adminToggleCustomerActive: typeof adminToggleCustomerActive;
    deactivateCustomerAccount: typeof deactivateCustomerAccount;
  }>;
  addSubscriptionAction?: (
    payload: any,
    isCustom: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  createCouponAction?: typeof import("@/actions/admin-actions/adminCouponActions").createCoupon;
  deleteCouponAction?: typeof import("@/actions/admin-actions/adminCouponActions").deleteCoupon;
  uploadMedicalAction?: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  franchiseId?: string;
  backHref?: string;
}) {
  const act = {
    updateCustomerBasicInfo:
      actions?.updateCustomerBasicInfo ?? updateCustomerBasicInfo,
    updateCustomerDietaryProfile:
      actions?.updateCustomerDietaryProfile ?? updateCustomerDietaryProfile,
    updateCustomerMedicalProfile:
      actions?.updateCustomerMedicalProfile ?? updateCustomerMedicalProfile,
    deleteMedicalDocument:
      actions?.deleteMedicalDocument ?? deleteMedicalDocument,
    adminUpsertCustomerAddress:
      actions?.adminUpsertCustomerAddress ?? adminUpsertCustomerAddress,
    adminDeleteCustomerAddress:
      actions?.adminDeleteCustomerAddress ?? adminDeleteCustomerAddress,
    adminSetCustomerPassword:
      actions?.adminSetCustomerPassword ?? adminSetCustomerPassword,
    adminSendPasswordReset:
      actions?.adminSendPasswordReset ?? adminSendPasswordReset,
    adminUpdateCustomerEmail:
      actions?.adminUpdateCustomerEmail ?? adminUpdateCustomerEmail,
    adminToggleCustomerActive:
      actions?.adminToggleCustomerActive ?? adminToggleCustomerActive,
    deactivateCustomerAccount:
      actions?.deactivateCustomerAccount ?? deactivateCustomerAccount,
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isKitCustomer = customerCategory === "KIT";
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    requestedTab && ["Profile & Medical", "KIT", "Shipping", "Addresses", "Billing", "Coupons", "User Management", "Add Subscription"].includes(requestedTab)
      ? requestedTab
      : "Profile & Medical",
  );

  // User Management State
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isAccountActive, setIsAccountActive] = useState(customer.isActive ?? true);
  const [resetPinOpen, setResetPinOpen] = useState(false);
  const [emailUpdateForm, setEmailUpdateForm] = useState("");
  const [sendingPinReset, setSendingPinReset] = useState(false);
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
  const [serviceAreaPincodes, setServiceAreaPincodes] = useState<string[]>([]);
  const [addressPincodeError, setAddressPincodeError] = useState<string | null>(
    null,
  );
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
  useEffect(() => {
    getServiceAreaPincodesAction()
      .then(setServiceAreaPincodes)
      .catch((error) => {
        console.error("Failed to load service area pincodes:", error);
      });
  }, []);

  const handlePersonalSubmit = () =>
    startTransition(async () => {
      const res = await act.updateCustomerBasicInfo(
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
      const res = await act.updateCustomerDietaryProfile(customer.id, dietaryForm);
      if (res.success) {
        toast.success("Dietary profile updated!");
        setIsDietaryModalOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const handleMedicalSubmit = () =>
    startTransition(async () => {
      const res = await act.updateCustomerMedicalProfile(customer.id, medicalForm);
      if (res.success) {
        toast.success("Medical assessment updated!");
        setIsMedicalModalOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const executeDeleteDocument = () => {
    startTransition(async () => {
      const res = await act.deleteMedicalDocument(
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
    setAddressPincodeError(null);
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
    setAddressPincodeError(null);
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
      const latestServiceAreaPincodes = await getServiceAreaPincodesAction();
      setServiceAreaPincodes(latestServiceAreaPincodes);
      const pincodeError = getPincodeValidationError(
        addressForm.pincode,
        latestServiceAreaPincodes,
      );

      if (pincodeError) {
        setAddressPincodeError(pincodeError);
        toast.error(pincodeError);
        return;
      }

      setAddressPincodeError(null);
      const res = await act.adminUpsertCustomerAddress(customer.id, addressForm);
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
      const res = await act.adminDeleteCustomerAddress(
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
      <AdminSubmenuBar
        tabs={
          isKitCustomer
            ? [
                "Profile & Medical",
                "KIT",
                "Shipping",
                "Addresses",
                "Billing",
                "User Management",
              ]
            : [
                "Profile & Medical",
                "Add Subscription",
                "Addresses",
                "Billing",
                "Coupons",
                "User Management",
              ]
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={
          isKitCustomer ? (
            <KitEligibilityBadge
              customerProfileId={customer.id}
              onSendNewKit={() => {
                setActiveTab("KIT");
                toast.info("Send New KIT form will be available here.");
              }}
            />
          ) : undefined
        }
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
                    uploadAction={uploadMedicalAction}
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

            {/* Clinic Assignment Card — for KIT customers, admin can manually assign.
                Hidden for franchise admins since KIT customers are auto-assigned to the franchise clinic. */}
            {isKitCustomer && !franchiseId && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle>Clinic Assignment</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">
                      Assigned Clinic
                    </p>
                    <ClinicAssignmentSelector
                      profileId={customer.id}
                      currentClinicId={customerClinicId}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    For KIT customers, the clinic must be assigned manually by the admin.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab === "Add Subscription" && (
          <AdminAddSubscriptionForm
            customerProfileId={customer.id}
            initialData={initialSubscriptionData}
            submitAction={addSubscriptionAction}
            franchiseId={franchiseId}
          />
        )}

        {activeTab === "KIT" && kitSubscription && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                KIT Subscription
              </h2>
              <p className="text-sm text-muted-foreground">
                Details of the current KIT package purchased by this customer.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      KIT Product
                    </p>
                    <p className="mt-2 text-xl font-black">
                      {kitSubscription.kitProductName}
                    </p>
                  </div>
                  <Package className="h-8 w-8 text-primary" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Duration
                    </p>
                    <p className="mt-2 text-2xl font-black">
                      {kitSubscription.kitDurationDays}
                      <span className="text-sm font-medium text-muted-foreground">
                        {" "}
                        days
                      </span>
                    </p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Status
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        kitSubscription.status === "ACTIVE"
                          ? "mt-2 border-emerald-500 text-emerald-600 bg-emerald-50"
                          : "mt-2 border-slate-300 text-slate-600 bg-slate-50"
                      }
                    >
                      {kitSubscription.status}
                    </Badge>
                  </div>
                  <BadgeIndianRupee className="h-8 w-8 text-muted-foreground/50" />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Package Timeline</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Start Date
                  </p>
                  <p className="font-semibold">
                    {kitSubscription.startsOn &&
                    isValid(new Date(kitSubscription.startsOn))
                      ? format(new Date(kitSubscription.startsOn), "PPP")
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    End Date
                  </p>
                  <p className="font-semibold">
                    {kitSubscription.endsOn &&
                    isValid(new Date(kitSubscription.endsOn))
                      ? format(new Date(kitSubscription.endsOn), "PPP")
                      : "N/A"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* KIT Tracker — read-only admin view */}
            <AdminKitTrackerView
              kitReceivedDate={kitSubscription.kitReceivedDate}
              kitTrackerEndDate={kitSubscription.kitTrackerEndDate}
              kitTotalSkippedDays={kitSubscription.kitTotalSkippedDays}
              kitDurationDays={kitSubscription.kitDurationDays}
              dailyLogs={kitDailyLogs ?? []}
            />
          </div>
        )}

        {activeTab === "Shipping" && kitSubscription && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                Shipping Management
              </h2>
              <p className="text-sm text-muted-foreground">
                Manage courier tracking for this customer&apos;s KIT order.
              </p>
            </div>

            <CourierForm
              customerId={customer.id}
              subscriptionId={kitSubscription.subscriptionId}
              existingShippingInfo={existingShippingInfo}
            />
          </div>
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
                          <th className="px-5 py-4 font-bold text-right">
                            Invoice
                          </th>
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
                          const isPendingManual =
                            payment.status === "PENDING" &&
                            payment.payment_method === "MANUAL";
                          const showInvoiceButton = isPaid || isPendingManual;

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
                              <td className="px-5 py-4 text-right">
                                {showInvoiceButton && (
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    title="Download invoice PDF"
                                    onClick={() =>
                                      window.open(
                                        `/customers/${customer.id}/billing/invoice/${payment.id}`,
                                        "_blank",
                                      )
                                    }
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                )}
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

        {activeTab === "Coupons" && !isKitCustomer && (
          <AdminCouponsTab
            customerProfileId={customer.id}
            initialCoupons={initialCoupons}
            subscriptionPlans={initialSubscriptionData.subscriptionPlans}
            createCouponAction={createCouponAction}
            deleteCouponAction={deleteCouponAction}
          />
        )}

        {activeTab === "User Management" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ── Reset PIN ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Reset PIN
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Reset the customer&apos;s login PIN. They will be required to set a
                  new permanent PIN on their next login.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setResetPinOpen(true)}
                >
                  <KeyRound className="h-3.5 w-3.5 mr-2" />
                  Reset PIN
                </Button>
              </CardContent>
            </Card>

            {/* ── Send PIN Reset Link ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="h-4 w-4 text-primary" />
                  Send PIN Reset Link
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!customer.email || customer.email.includes('@test.arogyaemail.com') ? (
                  <>
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                      <p className="text-xs text-amber-800 font-medium">
                        ⚠️ No valid email on file. Update email first to send PIN reset link.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email-update" className="text-xs text-muted-foreground">
                        Email Address
                      </Label>
                      <Input
                        id="email-update"
                        type="email"
                        placeholder="customer@example.com"
                        value={emailUpdateForm}
                        onChange={(e) => setEmailUpdateForm(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      size="sm"
                      disabled={isPending || !emailUpdateForm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailUpdateForm)}
                      onClick={() =>
                        startTransition(async () => {
                          if (!customer.authUserId) {
                            toast.error("Customer auth user ID not found");
                            return;
                          }
                          
                          const res = await act.adminUpdateCustomerEmail(
                            customer.authUserId,
                            emailUpdateForm
                          );
                          
                          if (res.success) {
                            toast.success("Email updated successfully!");
                            setEmailUpdateForm("");
                            router.refresh();
                          } else {
                            toast.error(res.error ?? "Failed to update email");
                          }
                        })
                      }
                    >
                      {isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                      ) : (
                        <Send className="h-3.5 w-3.5 mr-2" />
                      )}
                      Update Email
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Send a PIN reset link to <strong>{customer.email}</strong>. Customer will receive an email with instructions to set a new PIN.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full"
                      size="sm"
                      disabled={sendingPinReset}
                      onClick={() => {
                        setSendingPinReset(true);
                        startTransition(async () => {
                          try {
                            const res = await act.adminSendPasswordReset(customer.email);
                            if (res.success) {
                              toast.success("PIN reset link sent successfully!");
                            } else {
                              toast.error(res.error ?? "Failed to send PIN reset link");
                            }
                          } finally {
                            setSendingPinReset(false);
                          }
                        });
                      }}
                    >
                      {sendingPinReset ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                      ) : (
                        <Send className="h-3.5 w-3.5 mr-2" />
                      )}
                      Send PIN Reset Link
                    </Button>
                  </>
                )}
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
                      const res = await act.adminToggleCustomerActive(
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
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-[620px]">
          <DialogHeader className="shrink-0 border-b pb-4">
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {addressModalMode === "create" ? "Add Address" : "Edit Address"}
            </DialogTitle>
          </DialogHeader>
          <div className="-mx-4 grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4">
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
                  onChange={(e) => {
                    const pincode = e.target.value;
                    setAddressForm({
                      ...addressForm,
                      pincode,
                    });
                    setAddressPincodeError(
                      getPincodeValidationError(pincode, serviceAreaPincodes),
                    );
                  }}
                  placeholder="5xxxxx"
                />
                {addressPincodeError && (
                  <p className="text-xs text-red-500">
                    {addressPincodeError}
                  </p>
                )}
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
          <DialogFooter className="shrink-0">
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

      {/* --- RESET PIN DIALOG --- */}
      <ResetPinDialog
        userId={customer.userId}
        customerName={customer.full_name}
        open={resetPinOpen}
        onOpenChange={setResetPinOpen}
      />
    </div>
  );
}
