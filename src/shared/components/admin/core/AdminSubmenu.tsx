import { ReactNode } from "react";

interface AdminSubmenuProps {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function AdminSubmenu({ tabs, activeTab, onTabChange }: AdminSubmenuProps) {
  return (
    <div className="flex border-b border-border/60 overflow-x-auto hide-scrollbar mb-6">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`px-5 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
            activeTab === tab
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}