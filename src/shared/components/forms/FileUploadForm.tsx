"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { FileUp, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadFormProps {
  onUpload: (file: File) => Promise<any>;
  acceptedFileTypes?: string[];
  maxFileSizeMB?: number;
  buttonText?: string;
  className?: string;
  isPending?: boolean;
}

export function FileUploadForm({
  onUpload,
  acceptedFileTypes = ["image/*", ".pdf"],
  maxFileSizeMB = 5,
  buttonText = "Upload File",
  className,
  isPending = false,
}: FileUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      if (selectedFile.size > maxFileSizeMB * 1024 * 1024) {
        setError(`File size exceeds ${maxFileSizeMB}MB limit.`);
        setFile(null);
        return;
      }
      setFile(selectedFile);
    } else {
      setError("Invalid file type or no file selected.");
      setFile(null);
    }
  }, [maxFileSizeMB]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: acceptedFileTypes.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
  });

  const handleRemoveFile = () => {
    setFile(null);
    setError(null);
  };

  const handleUpload = async () => {
    if (file) {
      setError(null);
      try {
        await onUpload(file);
        setFile(null);
      } catch (e: any) {
        setError(e.message || "File upload failed.");
      }
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-md cursor-pointer transition-colors
          ${isDragActive ? "border-primary bg-primary/10" : "border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600"}
          ${error ? "border-red-500" : ""}
        `}
      >
        <input {...getInputProps()} />
        <FileUp className="w-8 h-8 text-muted-foreground mb-2" />
        {isDragActive ? (
          <p className="text-sm text-muted-foreground">Drop the files here ...</p>
        ) : (
          <p className="text-sm text-muted-foreground">Drag 'n' drop a file here, or click to select file</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          Max {maxFileSizeMB}MB, Accepted: {acceptedFileTypes.map(t => t.split('/').pop()).join(', ')}
        </p>
      </div>

      {file && (
        <div className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
          <span className="text-sm truncate">{file.name}</span>
          <Button variant="ghost" size="icon" onClick={handleRemoveFile} className="text-muted-foreground hover:text-destructive">
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button onClick={handleUpload} disabled={!file || isPending} className="w-full">
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {buttonText}
      </Button>
    </div>
  );
}
