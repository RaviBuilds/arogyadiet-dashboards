"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/lib/utils";

import "react-quill-new/dist/quill.snow.css";
import "./product-description-editor.css";

const ReactQuill = dynamic(() => import("react-quill-new"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="min-h-[140px] animate-pulse rounded-lg border border-input bg-muted/20 dark:bg-input/30"
    />
  ),
});

const EDITOR_MODULES = {
  toolbar: [["bold", "italic"], [{ list: "bullet" }]],
};

const EDITOR_FORMATS = ["bold", "italic", "list"];

interface ProductDescriptionEditorProps {
  id?: string;
  name?: string;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
}

export function ProductDescriptionEditor({
  id,
  name = "description",
  defaultValue = "",
  className,
  placeholder = "Enter product description...",
}: ProductDescriptionEditorProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className={cn("product-description-editor", className)}>
      <input type="hidden" name={name} value={value} />
      <div
        id={id}
        className={cn(
          "overflow-hidden rounded-lg border border-input bg-transparent transition-colors outline-none dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        )}
      >
        <ReactQuill
          theme="snow"
          value={value}
          onChange={setValue}
          modules={EDITOR_MODULES}
          formats={EDITOR_FORMATS}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
