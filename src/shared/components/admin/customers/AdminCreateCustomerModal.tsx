"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Switch } from "@/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Eye, EyeOff, Plus, Trash2, MapPin, Loader2, CheckCircle } from "lucide-react";
import { adminCreateCustomerAction } from "@/actions/admin-actions/customerActions";
import type { AddressFormValues } from "@/validations/addressSchema";

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

interface AddressEntry extends AddressFormValues {
  _verifiedLocation?: string;
  _isVerifying?: boolean;
  _skipCoords?: boolean;
  _latInput?: string;
  _lngInput?: string;
}

const defaultAddress = (): AddressEntry => ({
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
  _verifiedLocation: "",
  _isVerifying: false,
  _skipCoords: false,
  _latInput: "",
  _lngInput: "",
});

const STEPS = ["Account Info", "Profile Details", "Addresses"] as const;
type Step = (typeof STEPS)[number];

export function AdminCreateCustomerModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("Account Info");

  // Step 1: Account
  const [account, setAccount] = useState({
    fullName: "",
    email: "",
    mobile: "",
    password: "",
    showPassword: false,
  });

  // Step 2: Profile
  const [profile, setProfile] = useState({
    gender: "",
    dateOfBirth: "",
    dietaryPreference: "",
    allergies: "",
    hasMedicalHistory: false,
    medicalHistoryNotes: "",
  });

  // Step 3: Addresses
  const [addresses, setAddresses] = useState<AddressEntry[]>([]);

  const stepIndex = STEPS.indexOf(step);

  const resetAll = () => {
    setStep("Account Info");
    setAccount({ fullName: "", email: "", mobile: "", password: "", showPassword: false });
    setProfile({ gender: "", dateOfBirth: "", dietaryPreference: "", allergies: "", hasMedicalHistory: false, medicalHistoryNotes: "" });
    setAddresses([]);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // ── Step validation ────────────────────────────────────────────────────────
  const isStep1Valid =
    account.fullName.trim().length > 1 &&
    /\S+@\S+\.\S+/.test(account.email) &&
    account.mobile.trim().length >= 10 &&
    account.password.length >= 8;

  // ── Lat/Lng verify ─────────────────────────────────────────────────────────
  const verifyCoords = async (index: number) => {
    const addr = addresses[index];
    if (!addr.lat || !addr.lng) return;

    setAddresses((prev) =>
      prev.map((a, i) => (i === index ? { ...a, _isVerifying: true, _verifiedLocation: "" } : a)),
    );

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${addr.lat}&lon=${addr.lng}&format=json`,
        { headers: { "Accept-Language": "en" } },
      );
      const data = await res.json();
      setAddresses((prev) =>
        prev.map((a, i) =>
          i === index
            ? { ...a, _isVerifying: false, _verifiedLocation: data.display_name ?? "Location found" }
            : a,
        ),
      );
    } catch {
      setAddresses((prev) =>
        prev.map((a, i) =>
          i === index
            ? { ...a, _isVerifying: false, _verifiedLocation: "Could not verify location." }
            : a,
        ),
      );
    }
  };

  const updateAddress = (index: number, patch: Partial<AddressEntry>) => {
    setAddresses((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const removeAddress = (index: number) => {
    setAddresses((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    startTransition(async () => {
      const cleanAddresses: AddressFormValues[] = addresses.map((a) => ({
        id: a.id,
        tag: a.tag,
        street_1: a.street_1,
        street_2: a.street_2,
        landmark: a.landmark,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        is_primary: a.is_primary,
        lat: a._skipCoords ? null : a.lat ?? null,
        lng: a._skipCoords ? null : a.lng ?? null,
      }));

      const res = await adminCreateCustomerAction({
        fullName: account.fullName,
        email: account.email,
        mobile: account.mobile,
        password: account.password,
        gender: profile.gender || undefined,
        dateOfBirth: profile.dateOfBirth || undefined,
        dietaryPreference: profile.dietaryPreference || undefined,
        allergies: profile.allergies || undefined,
        hasMedicalHistory: profile.hasMedicalHistory,
        medicalHistoryNotes: profile.medicalHistoryNotes || undefined,
        addresses: cleanAddresses,
      });

      if (res.success) {
        toast.success("Customer account created successfully!");
        handleClose();
      } else {
        toast.error(res.error ?? "Failed to create customer.");
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Customer Account</DialogTitle>
          {/* Step indicator */}
          <div className="flex items-center gap-2 pt-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border-2 transition-colors ${
                    s === step
                      ? "border-primary bg-primary text-white"
                      : i < stepIndex
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {i < stepIndex ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span
                  className={`text-xs font-medium ${
                    s === step ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s}
                </span>
                {i < STEPS.length - 1 && (
                  <div className="w-6 h-px bg-muted-foreground/20" />
                )}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* ── STEP 1: Account Info ── */}
          {step === "Account Info" && (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  placeholder="e.g. Rahul Sharma"
                  value={account.fullName}
                  onChange={(e) => setAccount((p) => ({ ...p, fullName: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="customer@example.com"
                  value={account.email}
                  onChange={(e) => setAccount((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mobile">Mobile Number *</Label>
                <Input
                  id="mobile"
                  placeholder="10-digit mobile"
                  value={account.mobile}
                  onChange={(e) => setAccount((p) => ({ ...p, mobile: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Temporary Password * (min 8 chars)</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={account.showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={account.password}
                    onChange={(e) => setAccount((p) => ({ ...p, password: e.target.value }))}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setAccount((p) => ({ ...p, showPassword: !p.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {account.showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Profile Details ── */}
          {step === "Profile Details" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Gender</Label>
                  <Select
                    value={profile.gender}
                    onValueChange={(v) => setProfile((p) => ({ ...p, gender: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dob">Date of Birth</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={profile.dateOfBirth}
                    onChange={(e) => setProfile((p) => ({ ...p, dateOfBirth: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Dietary Preference</Label>
                <div className="flex gap-3">
                  {["Veg", "Non-Veg"].map((pref) => (
                    <button
                      key={pref}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, dietaryPreference: pref }))}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
                        profile.dietaryPreference === pref
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-muted hover:border-muted-foreground/50"
                      }`}
                    >
                      {pref}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="allergies">Allergies / Special Instructions</Label>
                <Textarea
                  id="allergies"
                  placeholder="e.g. No peanuts, no dairy..."
                  rows={2}
                  value={profile.allergies}
                  onChange={(e) => setProfile((p) => ({ ...p, allergies: e.target.value }))}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium text-sm">Medical History</p>
                  <p className="text-xs text-muted-foreground">
                    Does this customer have medical conditions to note?
                  </p>
                </div>
                <Switch
                  checked={profile.hasMedicalHistory}
                  onCheckedChange={(v) => setProfile((p) => ({ ...p, hasMedicalHistory: v }))}
                />
              </div>

              {profile.hasMedicalHistory && (
                <div className="grid gap-2">
                  <Label htmlFor="medNotes">Medical Notes</Label>
                  <Textarea
                    id="medNotes"
                    placeholder="Describe relevant medical conditions..."
                    rows={3}
                    value={profile.medicalHistoryNotes}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, medicalHistoryNotes: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Addresses ── */}
          {step === "Addresses" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Add up to 2 delivery addresses (optional). You can add or edit addresses later from
                the Customer 360 Dashboard.
              </p>

              {addresses.map((addr, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">Address {i + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeAddress(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Tag + Pincode */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Tag</Label>
                      <Select
                        value={addr.tag}
                        onValueChange={(v) => updateAddress(i, { tag: v as "Home" | "Work" | "Other" })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Home">Home</SelectItem>
                          <SelectItem value="Work">Work</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Pincode *</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="500XXX"
                        value={addr.pincode}
                        onChange={(e) => updateAddress(i, { pincode: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Street 1 */}
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Flat / House No / Building *</Label>
                    <Input
                      className="h-8 text-sm"
                      placeholder="e.g. Flat 4B, Emerald Heights"
                      value={addr.street_1}
                      onChange={(e) => updateAddress(i, { street_1: e.target.value })}
                    />
                  </div>

                  {/* Street 2 + Landmark */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Area / Street (Optional)</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="e.g. Jubilee Hills"
                        value={addr.street_2 ?? ""}
                        onChange={(e) => updateAddress(i, { street_2: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Landmark (Optional)</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="e.g. Near Apollo Hospital"
                        value={addr.landmark ?? ""}
                        onChange={(e) => updateAddress(i, { landmark: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* City + State */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">City</Label>
                      <Input
                        className="h-8 text-sm"
                        value={addr.city}
                        onChange={(e) => updateAddress(i, { city: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">State</Label>
                      <Input
                        className="h-8 text-sm"
                        value={addr.state}
                        onChange={(e) => updateAddress(i, { state: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Primary toggle */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`primary-${i}`}
                      checked={addr.is_primary}
                      onCheckedChange={(v) => {
                        // Only one primary allowed
                        setAddresses((prev) =>
                          prev.map((a, idx) => ({ ...a, is_primary: idx === i ? v : false })),
                        );
                      }}
                    />
                    <Label htmlFor={`primary-${i}`} className="text-xs cursor-pointer">
                      Set as default / primary address
                    </Label>
                  </div>

                  {/* Coordinates Section */}
                  <div className="border-t pt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Delivery Coordinates (Optional)
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id={`skip-${i}`}
                        checked={addr._skipCoords ?? false}
                        onCheckedChange={(v) =>
                          updateAddress(i, {
                            _skipCoords: v,
                            lat: v ? null : addr.lat,
                            lng: v ? null : addr.lng,
                            _latInput: v
                              ? ""
                              : addr.lat != null
                                ? String(addr.lat)
                                : (addr._latInput ?? ""),
                            _lngInput: v
                              ? ""
                              : addr.lng != null
                                ? String(addr.lng)
                                : (addr._lngInput ?? ""),
                            _verifiedLocation: v ? "" : addr._verifiedLocation,
                          })
                        }
                      />
                      <Label htmlFor={`skip-${i}`} className="text-xs cursor-pointer text-muted-foreground">
                        Continue without coordinates
                      </Label>
                    </div>

                    {!addr._skipCoords && (
                      <div className="space-y-2">
                        <AddressPickerMap
                          lat={addr.lat ?? null}
                          lng={addr.lng ?? null}
                          disabled={addr._skipCoords}
                          showLocateButton={false}
                          onCoordinatesChange={(lat, lng) =>
                            updateAddress(i, {
                              lat,
                              lng,
                              _latInput: String(lat),
                              _lngInput: String(lng),
                              _verifiedLocation: "",
                            })
                          }
                        />

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label className="text-xs">Latitude</Label>
                            <Input
                              className="h-8 text-sm"
                              type="text"
                              inputMode="decimal"
                              placeholder="e.g. 17.4401"
                              value={addr._latInput ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                const patch: Partial<AddressEntry> = {
                                  _latInput: value,
                                  _verifiedLocation: "",
                                };
                                const parsed = parseCoordInput(value);
                                if (parsed !== null) {
                                  patch.lat = parsed;
                                } else if (value.trim() === "") {
                                  patch.lat = null;
                                }
                                updateAddress(i, patch);
                              }}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="text-xs">Longitude</Label>
                            <Input
                              className="h-8 text-sm"
                              type="text"
                              inputMode="decimal"
                              placeholder="e.g. 78.4983"
                              value={addr._lngInput ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                const patch: Partial<AddressEntry> = {
                                  _lngInput: value,
                                  _verifiedLocation: "",
                                };
                                const parsed = parseCoordInput(value);
                                if (parsed !== null) {
                                  patch.lng = parsed;
                                } else if (value.trim() === "") {
                                  patch.lng = null;
                                }
                                updateAddress(i, patch);
                              }}
                            />
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!addr.lat || !addr.lng || addr._isVerifying}
                          onClick={() => verifyCoords(i)}
                          className="h-7 text-xs"
                        >
                          {addr._isVerifying ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <MapPin className="h-3 w-3 mr-1" />
                          )}
                          Verify Location
                        </Button>

                        {addr._verifiedLocation && (
                          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                            <p className="font-semibold mb-0.5">Location Preview</p>
                            <p>{addr._verifiedLocation}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {addresses.length < 2 && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => setAddresses((p) => [...p, defaultAddress()])}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Address {addresses.length + 1}
                </Button>
              )}

              {addresses.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-2">
                  No addresses added. You can skip this step and add them later.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          {stepIndex > 0 && (
            <Button
              variant="outline"
              onClick={() => setStep(STEPS[stepIndex - 1])}
              disabled={isPending}
            >
              Back
            </Button>
          )}
          {stepIndex < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep(STEPS[stepIndex + 1])}
              disabled={step === "Account Info" && !isStep1Valid}
            >
              Next
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isPending || !isStep1Valid}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                "Create Customer"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
