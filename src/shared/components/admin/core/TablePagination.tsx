"use client";

import { Button } from "@/shared/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface TablePaginationProps {
  /** Total number of records matching the current filters. */
  totalRecords: number;
  /** Number of records per page (defaults to 20). */
  pageSize?: number;
  /** Current 0-indexed page number. */
  currentPage: number;
  /** Callback to change page. */
  onPageChange: (page: number) => void;
}

/**
 * Shared pagination footer for customer tables.
 *
 * Shows: "Showing X–Y of Z records" + page navigation (First, Prev, page indicator, Next, Last).
 * Only renders navigation controls when more than one page exists.
 */
export function TablePagination({
  totalRecords,
  pageSize = 20,
  currentPage,
  onPageChange,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const start = currentPage * pageSize + 1;
  const end = Math.min((currentPage + 1) * pageSize, totalRecords);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <span className="text-sm text-slate-600">
        {totalRecords === 0
          ? "No records"
          : `Showing ${start}–${end} of ${totalRecords} records`}
      </span>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage === 0}
            onClick={() => onPageChange(0)}
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage === 0}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="px-3 text-sm font-medium text-slate-700">
            Page {currentPage + 1} of {totalPages}
          </span>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage >= totalPages - 1}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage >= totalPages - 1}
            onClick={() => onPageChange(totalPages - 1)}
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
