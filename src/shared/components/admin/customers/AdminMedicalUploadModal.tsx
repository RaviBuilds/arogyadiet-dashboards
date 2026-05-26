"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { UploadCloud, FileText, X, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadAdminMedicalDocument } from "@/actions/admin-actions/customerActions";

interface AdminUploadProps {
  profileId: string;
  userId: string;
}

const MAX_FILE_SIZE_MB = 2;
const MAX_FILES = 10;

export function AdminMedicalUploadModal({ profileId, userId }: AdminUploadProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = Array.from(e.target.files || []);
    
    if (selectedFiles.length + files.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} documents allowed.`);
      return;
    }

    const validFiles = files.filter(f => {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`${f.name} exceeds ${MAX_FILE_SIZE_MB}MB.`);
        return false;
      }
      return true;
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const handleUpload = () => {
    if (selectedFiles.length === 0) return;
    setError(null);

    startTransition(async () => {
      let successCount = 0;
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("profileId", profileId);
        formData.append("userId", userId); // Pass the CUSTOMER'S auth ID for the folder path

        const res = await uploadAdminMedicalDocument(formData);
        if (res.success) successCount++;
        else toast.error(`Failed to upload ${file.name}: ${res.error}`);
      }

      if (successCount > 0) {
        toast.success(`Successfully uploaded ${successCount} document(s).`);
        setSelectedFiles([]);
        setIsOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-2 bg-primary/5 text-primary border-primary/20 hover:bg-primary/10">
          <UploadCloud className="h-4 w-4" /> Upload Document
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Medical Documents</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="border-2 border-dashed rounded-xl p-8 text-center relative hover:bg-muted/50 transition-colors">
            <input 
              type="file" multiple accept="image/*,application/pdf" 
              onChange={handleFileSelect} disabled={isPending || selectedFiles.length >= MAX_FILES}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" 
            />
            <UploadCloud className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-bold">Click or drag files here</p>
            <p className="text-xs text-muted-foreground mt-1">Max 2MB per file (.jpg, .png, .pdf)</p>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-xs font-medium rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="space-y-2 max-h-[150px] overflow-y-auto">
              {selectedFiles.map((file, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded text-sm">
                  <div className="flex items-center gap-2 truncate pr-4">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </div>
                  <button onClick={() => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))} disabled={isPending} className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleUpload} disabled={isPending || selectedFiles.length === 0}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading...</> : `Upload ${selectedFiles.length} File(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
