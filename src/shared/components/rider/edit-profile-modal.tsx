"use client";

import { useState } from "react";
import { Edit2, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { updateEmergencyContact } from "@/actions/rider-actions/profileActions";

export function EditProfileModal({
  riderProfileId,
  currentContact,
}: {
  riderProfileId: string;
  currentContact?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [contact, setContact] = useState(currentContact || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!contact.trim()) return;
    setIsSaving(true);
    try {
      await updateEmergencyContact(riderProfileId, contact);
      setIsOpen(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="rounded-xl font-bold shadow-sm"
      >
        <Edit2 className="h-4 w-4 mr-2" /> Edit Profile
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center p-4 border-b bg-zinc-50">
              <h2 className="text-lg font-bold text-zinc-900">Edit Profile</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-zinc-900 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Emergency Contact
                </label>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full mt-2 px-4 py-3 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-zinc-900"
                  placeholder="e.g. +91 98765 43210 (Wife)"
                />
              </div>

              <Button
                onClick={handleSave}
                disabled={isSaving || !contact.trim()}
                className="w-full h-12 rounded-xl font-bold text-base bg-zinc-900 hover:bg-zinc-800 text-white"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
