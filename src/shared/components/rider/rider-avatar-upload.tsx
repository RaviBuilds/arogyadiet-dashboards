"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User, Upload, Loader2 } from "lucide-react";
import { updateRiderAvatar } from "@/actions/rider-actions/profileActions";

export function RiderAvatarUpload({
  userId,
  currentAvatar,
}: {
  userId: string;
  currentAvatar?: string | null;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const supabase = createClient();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // 1. Create a unique file name
      const fileExt = file.name.split(".").pop();
      const filePath = `${userId}-${Date.now()}.${fileExt}`;

      // 2. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // 3. Get the public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      // 4. Save to the database
      await updateRiderAvatar(userId, publicUrl);
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Failed to upload image. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="relative h-24 w-24 bg-white rounded-full p-1 shadow-md border-2 border-zinc-100 group overflow-hidden cursor-pointer shrink-0">
      {isUploading ? (
        <div className="h-full w-full bg-zinc-100 rounded-full flex items-center justify-center text-zinc-400">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : currentAvatar ? (
        <img
          src={currentAvatar}
          alt="Profile"
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div className="h-full w-full bg-zinc-100 rounded-full flex items-center justify-center text-zinc-400">
          <User className="h-10 w-10" />
        </div>
      )}

      {/* Hover Overlay */}
      <label className="absolute inset-1 rounded-full bg-black/60 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
        <Upload className="h-5 w-5 mb-1" />
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Upload
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
          disabled={isUploading}
        />
      </label>
    </div>
  );
}
