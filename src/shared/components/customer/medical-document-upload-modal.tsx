"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileText, X, AlertCircle, Loader2 } from "lucide-react";

interface MedicalUploadModalProps {
  customerProfileId: string;
}

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES = 10;

export function MedicalDocumentUploadModal({
  customerProfileId,
}: MedicalUploadModalProps) {
  const router = useRouter();
  const supabase = createClient();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = Array.from(e.target.files || []);

    if (selectedFiles.length + files.length > MAX_FILES) {
      setError(`You can only upload a maximum of ${MAX_FILES} documents.`);
      return;
    }

    const validFiles = files.filter((file) => {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`${file.name} exceeds the ${MAX_FILE_SIZE_MB}MB limit.`);
        return false;
      }
      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
  };

  const removeFile = (indexToRemove: number) => {
    setSelectedFiles((prev) =>
      prev.filter((_, index) => index !== indexToRemove),
    );
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    setError(null);

    try {
      // Get the secured logged in auth user

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Unautherized!!");
      for (const file of selectedFiles) {
        const fileExt = file.name.split(".").pop();
        const safeFileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;

        //using the user.id for the folder path
        const filePath = `${user.id}/${safeFileName}`;

        //Upload to secure private bucket

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("medical_records")
          .upload(filePath, file, { cacheControl: "3600", upsert: false });

          if(uploadError) throw new Error(uploadError.message);

          //Insert the record into database table

          const {error:dbError} = await supabase
          .from("medical_documents")
          .insert({customer_profile_id:customerProfileId,
            file_name:file.name,
            storage_path:uploadData.path,
            file_size_bytes:file.size
          });
          if(dbError){
            console.error("ERROR=>", dbError);
            throw new Error(`Failed to save the record for ${file.name}.`)
          }
            
      
          }
          setSelectedFiles([]);
          setIsOpen(false);
          router.refresh();
    } catch (error:any) {
      console.error("Upload process error:", error);
      setError(error.message || "An unexpected error occured during upload");

    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-xs font-bold text-zinc-600"
        >
          <UploadCloud className="h-4 w-4" />
          Upload Documents
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Medical Documents</DialogTitle>
          <DialogDescription>
            Securely upload your prescriptions, lab reports, or medical history.
            (Max {MAX_FILE_SIZE_MB}MB per file, Images or PDFs only).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Custom File Input Zone */}
          <div className="border-2 border-dashed border-zinc-200 rounded-xl p-8 text-center bg-zinc-50 hover:bg-zinc-100 transition-colors relative">
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={handleFileSelect}
              disabled={isUploading || selectedFiles.length >= MAX_FILES}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <UploadCloud className="h-8 w-8 text-zinc-400 mx-auto mb-3" />
            <p className="text-sm font-bold text-zinc-700">
              Click or drag files here to upload
            </p>
            <p className="text-xs font-medium text-zinc-500 mt-1">
              Supports .jpg, .png, and .pdf
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs font-medium text-red-800">{error}</p>
            </div>
          )}

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between p-3 bg-white border rounded-lg shadow-sm"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="bg-blue-50 p-2 rounded-md shrink-0">
                      <FileText className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-bold text-zinc-900 truncate">
                        {file.name}
                      </p>
                      <p className="text-[10px] font-medium text-zinc-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    disabled={isUploading}
                    className="p-1 hover:bg-red-50 text-zinc-400 hover:text-red-600 rounded-md transition-colors disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              variant="ghost"
              onClick={() => setIsOpen(false)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || isUploading}
              className="bg-primary hover:bg-primary/90 min-w-[120px]"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                `Upload ${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
