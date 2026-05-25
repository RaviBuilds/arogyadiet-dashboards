"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// 1. Accept either a simple string OR a complex routing object
export type TabItem = string | { id: string; label: string; href?: string };

interface AdminSubmenuProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function AdminSubmenu({
  tabs,
  activeTab,
  onTabChange,
}: AdminSubmenuProps) {
  const router = useRouter();
  const pathname = usePathname();

  // 2. Normalize whatever the developer passed into a consistent object format internally
  const normalizedTabs = tabs.map((tab) => {
    if (typeof tab === "string") {
      return { id: tab, label: tab, isSimple: true };
    }
    return { ...tab, isSimple: false };
  });

  // 3. Automatically set the active tab based on the URL pathname (Only runs for complex tabs with hrefs)
  useEffect(() => {
    const currentTab = normalizedTabs.find(
      (tab) => tab.href && pathname.includes(tab.href),
    );
    if (currentTab && currentTab.id !== activeTab) {
      onTabChange(currentTab.id);
    }
  }, [pathname, normalizedTabs, activeTab, onTabChange]);

  const handleTabClick = (tab: {
    id: string;
    label: string;
    href?: string;
    isSimple: boolean;
  }) => {
    // Always trigger the state change
    onTabChange(tab.id);

    // 4. Routing Logic: Only alter the URL if the developer passed the Complex object version
    if (!tab.isSimple) {
      if (tab.href) {
        router.push(tab.href);
      } else {
        router.push(`${pathname}?tab=${tab.id}`);
      }
    }
  };

  return (
    <div className="flex items-center space-x-2 border-b pb-0 mb-6 overflow-x-auto hide-scrollbar">
      {normalizedTabs.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          onClick={() => handleTabClick(tab)}
          className={cn(
            "justify-start px-5 py-3 text-sm font-medium transition-colors border-b-2 rounded-none hover:bg-transparent",
            activeTab === tab.id
              ? "border-primary text-primary hover:text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
