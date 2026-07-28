// src/shared/components/dietitian/DietitianActivityReport.tsx
// Feature: dietitian-management — task 10.8.
//
// Portal-neutral display component (design.md section 12: "Shared by the
// Master dashboard and the Franchise Owner page (Req 20, 24)"). It receives
// an already-fetched `DietitianActivitySummary` as a prop — the Master
// dashboard fetches it via `getDietitianActivityReport` in
// `src/actions/master-actions/dietitianActivityActions.ts`, and the Franchise
// Owner page will fetch the Franchise-scoped equivalent through its own
// action (task 13.1) — so this component imports nothing from
// `src/app/admin` or `src/app/franchise` and calls no Server Action itself.
//
// Renders the three headline stat cards (Req 20.2, 20.3, 20.4), the
// seven-column per-customer table taken verbatim from Requirement 20.5
// ("the customer name, Customer_Category, Last_Dietitian_Log_Date,
// Days_Not_Logged, Pending_Log_Count, the count of Skipped_Self_Logs and
// Paused_Days_Count"), per-row Report_Card navigation (Req 20.6) and the
// empty-state message (Req 20.7). The Franchise "no active Dietitian"
// message (Req 24.4) is a page-level concern (the Franchise Owner page
// renders it in place of this component when the Franchise has no Dietitian
// to select at all) — it is re-exported here so both callers import it from
// one place.
//
// Requirements: 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 24.4

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import type {
  CustomerCategory,
  DietitianActivitySummary,
} from "@/types/dietitian";
import { NO_CUSTOMERS_FOR_DIETITIAN } from "@/lib/dietitian/messages";

/** Re-exported so both portal callers import Req 24.4's pinned string from one place. */
export { NO_DIETITIAN_FOR_FRANCHISE } from "@/lib/dietitian/messages";

interface DietitianActivityReportProps {
  /** The Dietitian_Activity_Report to render, already fetched by the caller. */
  summary: DietitianActivitySummary;
  /**
   * Builds the Report_Card href for a customer row (Req 20.6). Each caller
   * supplies its own portal-correct route — the Admin_Portal's Report_Card
   * lives at `/customers/[id]/report-card` and the Franchise_Portal's at the
   * same relative path under its own layout (design.md section 13) — so this
   * component stays portal-neutral and does not hardcode either prefix.
   */
  reportCardHrefFor: (customerProfileId: string) => string;
}

/** Display label for a Customer_Category, mirroring the enum's own casing. */
function categoryLabel(category: CustomerCategory): string {
  switch (category) {
    case "ACCOMMODATION":
      return "Accommodation";
    case "KIT":
      return "Kit";
    case "MEAL":
      return "Meal";
  }
}

/** Format YYYY-MM-DD to a more readable display format (DD MMM YYYY). */
function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return `${day} ${months[month - 1]} ${year}`;
}

function HeadlineStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Shared Dietitian_Activity_Report: three headline stats, the seven-column
 * per-customer table and per-row Report_Card navigation, computed entirely
 * from the already-fetched `summary` (Req 20.8's Cadence_Engine computation
 * happens upstream in the Server Action, not in this display component).
 */
export function DietitianActivityReport({
  summary,
  reportCardHrefFor,
}: DietitianActivityReportProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HeadlineStat
          label="Customers with pending logs"
          value={summary.customersWithPendingLogs}
        />
        <HeadlineStat
          label="Max days not logged"
          value={summary.maxDaysNotLogged}
        />
        <HeadlineStat
          label="Missing self logs"
          value={summary.customersMissingSelfLog}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {NO_CUSTOMERS_FOR_DIETITIAN}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Last dietitian log</TableHead>
                  <TableHead className="text-right">Days not logged</TableHead>
                  <TableHead className="text-right">Pending logs</TableHead>
                  <TableHead className="text-right">Skipped self logs</TableHead>
                  <TableHead className="text-right">Paused days</TableHead>
                  <TableHead className="text-right">Report card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((row) => (
                  <TableRow key={row.customerProfileId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {categoryLabel(row.category)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDisplayDate(row.lastDietitianLogDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.daysNotLogged}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.pendingLogCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.skippedSelfLogCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.pausedDaysCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={reportCardHrefFor(row.customerProfileId)}>
                          Report Card
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
