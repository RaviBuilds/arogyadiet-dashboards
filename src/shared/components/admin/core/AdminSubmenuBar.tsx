import { ReactNode } from "react";

import { AdminSubmenu, TabItem } from "./AdminSubmenu";

interface AdminSubmenuBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  actions?: ReactNode;
}

export function AdminSubmenuBar({
  tabs,
  activeTab,
  onTabChange,
  actions,
}: AdminSubmenuBarProps) {
  return (
    <div className="flex items-start justify-between gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <AdminSubmenu
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
      />
      {actions && (
        <div className="flex shrink-0 flex-col items-stretch gap-3 transition-all duration-200">
          {actions}
        </div>
      )}
    </div>
  );
}
