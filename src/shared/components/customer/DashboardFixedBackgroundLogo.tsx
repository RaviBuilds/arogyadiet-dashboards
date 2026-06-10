"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

// SIZE CONTROL — change these values to resize the logo
const LOGO_MAX_WIDTH = "72rem"; // 3x of previous max-w-[38rem] (~114rem); start at 72rem for balance
const LOGO_OPACITY = "0.25";

export function DashboardFixedBackgroundLogo() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center md:pl-64 lg:pl-72 print:hidden"
      aria-hidden="true"
    >
      <Image
        src="/logo.png"
        alt=""
        width={800}
        height={800}
        style={{ maxWidth: LOGO_MAX_WIDTH, opacity: LOGO_OPACITY }}
        className="h-auto w-[90vw] select-none object-contain"
      />
    </div>,
    document.body,
  );
}
