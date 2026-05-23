"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateCustomerBasicInfo,
  updateCustomerDietaryProfile,
  updateCustomerMedicalProfile,
  deleteMedicalDocument,
} from "@/actions/admin-actions/customerActions";

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

import { Edit, Loader2, Trash2, Eye, FileText } from "lucide-react";
import { format, isValid } from "date-fns";

interface CustomerProfile {
  userId: string;
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
}

export function Customer360Dashboard({
  customer,
}: {
  customer: CustomerProfile;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState("Profile & Medical");

  // Modals State
  const [isPersonalModalOpen, setIsPersonalModalOpen] = useState(false);
  const [isDietaryModalOpen, setIsDietaryModalOpen] = useState(false);
  const [isMedicalModalOpen, setIsMedicalModalOpen] = useState(false);
  const [deleteDocState, setDeleteDocState] = useState({
    isOpen: false,
    docId: "",
    storagePath: "",
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

  return (
    <div className="w-full">
      <AdminSubmenu
        tabs={[
          "Profile & Medical",
          "Subscriptions & Pauses",
          "Addresses",
          "Billing",
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

        {/* ... OTHER TABS ... */}
        {activeTab === "Subscriptions & Pauses" && (
          <div className="p-8 text-center text-muted-foreground border border-dashed rounded-xl">
            Subscriptions Module coming soon...
          </div>
        )}

        {activeTab === "Addresses" && (
          <div className="p-8 text-center text-muted-foreground border border-dashed rounded-xl">
            Addresses Module coming soon...
          </div>
        )}

        {activeTab === "Billing" && (
          <div className="p-8 text-center text-muted-foreground border border-dashed rounded-xl">
            Billing Module coming soon...
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
