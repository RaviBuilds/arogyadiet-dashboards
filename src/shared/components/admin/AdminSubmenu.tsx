"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface AdminSubmenuProps {
  tabs: { id: string; label: string; href?: string }[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function AdminSubmenu({ tabs, activeTab, onTabChange }: AdminSubmenuProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Automatically set the active tab based on the URL pathname
  useEffect(() => {
    const currentTab = tabs.find((tab) => pathname.includes(tab.href || tab.id));
    if (currentTab && currentTab.id !== activeTab) {
      onTabChange(currentTab.id);
    }
  }, [pathname, tabs, activeTab, onTabChange]);

  const handleTabClick = (tabId: string, href?: string) => {
    onTabChange(tabId);
    if (href) {
      router.push(href);
    } else {
      router.push(`/admin/subscriptions?tab=${tabId}`); // Default push for consistency
    }
  };

  return (
    <div className="flex items-center space-x-2 border-b pb-4 overflow-x-auto">
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          onClick={() => handleTabClick(tab.id, tab.href)}
          className={cn(
            "justify-start px-4 py-2 text-sm font-medium transition-colors hover:bg-muted",
            activeTab === tab.id
              ? "bg-muted text-foreground"
              : "text-muted-foreground"
          )}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
