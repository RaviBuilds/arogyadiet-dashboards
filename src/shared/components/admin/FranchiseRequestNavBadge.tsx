"use client";

import { useEffect, useState } from "react";
import { countPendingPincodeRequests } from "@/actions/admin-actions/franchisePincodeActions";

/**
 * Small count badge shown on the admin "Franchises" nav item indicating the
 * number of pending franchise pincode requests awaiting approval.
 * Renders nothing when there are no pending requests.
 */
export function FranchiseRequestNavBadge({ className = "" }: { className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      const c = await countPendingPincodeRequests();
      if (active) setCount(c);
    };
    fetchCount();
    // Light polling so the badge stays fresh while the admin works.
    const interval = setInterval(fetchCount, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <span
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
