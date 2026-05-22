"use client";

import React, { useState } from "react";
import { AdminSubmenu } from "@/shared/components/admin/core/AdminSubmenu";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { format, isValid } from "date-fns";
import { ExternalLinkIcon } from "lucide-react";

interface CustomerProfile {
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
  addresses: {
    id: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    state: string;
    pincode: string;
    is_default: boolean;
  }[];
  medical_documents: {
    id: string;
    file_name: string;
    storage_path: string;
    uploaded_at: string;
    signedUrl?: string; // New field for viewing docs
  }[];
  subscriptions: {
    id: string;
    status: string;
    starts_on: string;
    ends_on: string;
    subscription_plans: {
      name: string;
    };
  }[];
}

interface Customer360DashboardProps {
  customer: CustomerProfile;
}

export function Customer360Dashboard({ customer }: Customer360DashboardProps) {
  const [activeTab, setActiveTab] = useState("Profile & Medical");

  const tabs = [
    "Profile & Medical",
    "Subscriptions & Pauses",
    "Addresses",
    "Billing",
  ];

  return (
    <div className="w-full">
      <AdminSubmenu
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="mt-8">
        {activeTab === "Profile & Medical" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Personal Info</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Full Name
                  </p>
                  <p className="text-lg font-semibold">{customer.full_name}</p>
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
                    Date of Birth
                  </p>
                  <p>
                    {customer.date_of_birth &&
                    customer.date_of_birth !== "N/A" &&
                    isValid(new Date(customer.date_of_birth))
                      ? format(new Date(customer.date_of_birth), "PPP")
                      : "N/A"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dietary Profile</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Dietary Preference
                  </p>
                  <Badge className="mt-1">{customer.dietary_preference}</Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Allergies / Instructions
                  </p>
                  <p className="mt-1">{customer.allergies || "None"}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 xl:col-span-1">
              <CardHeader>
                <CardTitle>Medical Assessment</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Medical History Notes
                  </p>
                  <p className="text-sm">
                    {customer.medical_history_notes !== "N/A"
                      ? customer.medical_history_notes
                      : "No notes provided."}
                  </p>
                </div>

                {customer.medical_documents &&
                  customer.medical_documents.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium text-muted-foreground mb-3">
                        Uploaded Documents
                      </p>
                      <ul className="space-y-2">
                        {customer.medical_documents.map((doc) => (
                          <li
                            key={doc.id}
                            className="flex items-center justify-between p-2.5 bg-muted/30 border rounded-md"
                          >
                            <span className="text-sm font-medium truncate pr-4">
                              {doc.file_name}
                            </span>
                            {doc.signedUrl ? (
                              <a
                                href={doc.signedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 font-semibold text-xs flex items-center gap-1 shrink-0 bg-primary/10 px-2 py-1 rounded"
                              >
                                View <ExternalLinkIcon className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Link expired
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {!customer.has_medical_history && (
                  <div className="border-t pt-4 mt-2">
                    <p className="text-muted-foreground italic text-sm">
                      Customer confirmed no medical history.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ... KEEP OTHER TABS EXACTLY AS THEY WERE ... */}
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
    </div>
  );
}
