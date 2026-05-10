"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { UploadCloud } from "lucide-react";
interface MedicalUploadModalProps {
  customerProfileId: string;
}

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES = 10;

export function MedicalDocumentUploadModal({
  customerProfileId,
}: MedicalUploadModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return <Dialog open={isOpen} onOpenChange={setIsOpen}>

    <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-bold text-zinc-600">
          <UploadCloud className="h-4 w-4" />
          Upload Documents
        </Button>
    </DialogTrigger>
    
  </Dialog>;
}
