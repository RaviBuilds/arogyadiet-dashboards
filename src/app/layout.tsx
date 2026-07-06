import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  title: "ArogyaDiet Dashboard",
  description: "We're Providing Everyday Fresh and Quality Products.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* This component listens for toast() calls and displays them */}
        <Toaster richColors position="top-right" />
        <Analytics />
      </body>
    </html>
  );
}
