"use client";

import { useState } from "react";
import { format, isValid } from "date-fns";
import {
  BadgeIndianRupee,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ExternalLink,
  History,
  Package,
  Truck,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { AdminKitTrackerView } from "../kit-tracker/AdminKitTrackerView";
import { parseISODateString } from "@/lib/dates/ist";
import { getCourierDisplayName } from "@/types/kitShipping";
import type { CourierPartner } from "@/types/kitShipping";
import type { AdminKitOverview, AdminKitRecord } from "@/types/kitLifecycle";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  // `starts_on`, `ends_on` and the tracker dates are Postgres `date` columns
  // ("yyyy-MM-dd"); parsing those as local calendar dates avoids a UTC-midnight
  // day shift. Timestamps (created_at) keep normal Date parsing.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parseISODateString(value)
    : new Date(value);
  return isValid(date) ? format(date, "PPP") : "N/A";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return isValid(date) ? format(date, "dd MMM yyyy, hh:mm a") : "N/A";
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-500 text-emerald-600 bg-emerald-50",
  PENDING: "border-amber-400 text-amber-700 bg-amber-50",
  EXPIRED: "border-slate-300 text-slate-600 bg-slate-50",
  CANCELLED: "border-red-300 text-red-600 bg-red-50",
  STOPPED: "border-red-300 text-red-600 bg-red-50",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={STATUS_STYLES[status] ?? "border-slate-300 text-slate-600 bg-slate-50"}
    >
      {status}
    </Badge>
  );
}

/** Human summary of where a dispatch currently stands. */
function shippingStageLabel(record: AdminKitRecord): string {
  if (!record.shipping) return "Courier details not entered";
  if (record.shipping.deliveredAt) return "Delivered";
  if (record.shipping.shippedAt) return "Shipped";
  return "Not shipped";
}

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

function KitSummaryCards({ record }: { record: AdminKitRecord }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              KIT Product
            </p>
            <p className="mt-2 text-xl font-black">{record.kitProductName}</p>
          </div>
          <Package className="h-8 w-8 text-primary" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Duration
            </p>
            <p className="mt-2 text-2xl font-black">
              {record.kitDurationDays}
              <span className="text-sm font-medium text-muted-foreground">
                {" "}
                days
              </span>
            </p>
          </div>
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <div className="mt-2">
              <StatusBadge status={record.status} />
            </div>
          </div>
          <BadgeIndianRupee className="h-8 w-8 text-muted-foreground/50" />
        </CardContent>
      </Card>
    </div>
  );
}

function KitTimelineCard({ record }: { record: AdminKitRecord }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Package Timeline</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Ordered On
          </p>
          <p className="font-semibold">{formatDate(record.createdAt)}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Start Date
          </p>
          <p className="font-semibold">
            {record.startsOn ? formatDate(record.startsOn) : "Not started"}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">End Date</p>
          <p className="font-semibold">
            {record.endsOn ? formatDate(record.endsOn) : "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function KitDispatchCard({ record }: { record: AdminKitRecord }) {
  const shipping = record.shipping;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4 text-primary" />
          Dispatch & Tracking
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!shipping ? (
          <p className="text-sm text-muted-foreground">
            No courier details recorded for this KIT yet. Add them from the
            Shipping tab so the customer can track the package.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Courier Partner
              </p>
              <p className="font-semibold">
                {getCourierDisplayName(
                  shipping.courierPartner as CourierPartner,
                ) ?? shipping.courierPartner}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Tracking Number
              </p>
              <p className="font-semibold break-all">
                {shipping.trackingNumber || "—"}
              </p>
              {shipping.trackingUrl && (
                <a
                  href={shipping.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Track package <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Shipped On
              </p>
              <p className="font-semibold">
                {formatDateTime(shipping.shippedAt)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Receipt
              </p>
              <p className="font-semibold">
                {shipping.deliveredAt
                  ? formatDateTime(shipping.deliveredAt)
                  : record.kitReceivedDate
                    ? `Confirmed ${formatDate(record.kitReceivedDate)}`
                    : "Awaiting customer confirmation"}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Daily log entries behind an explicit CTA. Used for every KIT that is no
 * longer running — the data stays reachable without crowding the page with a
 * closed kit's tracker table.
 */
function CollapsibleLogs({
  record,
  customerName,
  label = "daily log entries",
}: {
  record: AdminKitRecord;
  customerName: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const count = record.dailyLogs.length;

  if (count === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="p-6 text-center text-muted-foreground">
          <p className="text-sm">
            No daily entries were logged for this KIT.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ClipboardList className="h-4 w-4" />
        {open ? "Hide" : "View"} {label} ({count})
        {open ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {open && (
        <AdminKitTrackerView
          customerName={customerName}
          // A kit with logs was definitely started; fall back to starts_on so a
          // missing received date can never hide historical entries.
          kitReceivedDate={record.kitReceivedDate ?? record.startsOn}
          kitTrackerEndDate={record.kitTrackerEndDate}
          kitTotalSkippedDays={record.kitTotalSkippedDays}
          kitDurationDays={record.kitDurationDays}
          dailyLogs={record.dailyLogs}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Package;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" />
      <div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/** The freshly dispatched KIT the customer has not started yet. */
function IncomingKitSection({ record }: { record: AdminKitRecord }) {
  return (
    <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-5">
      <SectionHeading
        icon={Truck}
        title="New KIT Dispatched"
        description="Sent to the customer and awaiting receipt. Daily tracking begins once they confirm the package arrived."
      />
      <KitSummaryCards record={record} />
      <KitTimelineCard record={record} />
      <KitDispatchCard record={record} />
    </section>
  );
}

/** The KIT currently being tracked — logs stay expanded, it is live data. */
function CurrentKitSection({
  record,
  customerName,
}: {
  record: AdminKitRecord;
  customerName: string;
}) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={CalendarCheck}
        title="Current KIT"
        description="The KIT this customer is actively tracking."
      />
      <KitSummaryCards record={record} />
      <KitTimelineCard record={record} />
      <KitDispatchCard record={record} />
      <AdminKitTrackerView
        customerName={customerName}
        kitReceivedDate={record.kitReceivedDate}
        kitTrackerEndDate={record.kitTrackerEndDate}
        kitTotalSkippedDays={record.kitTotalSkippedDays}
        kitDurationDays={record.kitDurationDays}
        dailyLogs={record.dailyLogs}
      />
    </section>
  );
}

/**
 * The most recent closed KIT, shown as the headline only when nothing is
 * running and nothing is on the way — otherwise it belongs in history.
 */
function LastKitSection({
  record,
  customerName,
}: {
  record: AdminKitRecord;
  customerName: string;
}) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={Package}
        title="Last KIT"
        description={`This customer's most recent KIT (${record.status.toLowerCase()}). Daily log entries remain available on demand.`}
      />
      <KitSummaryCards record={record} />
      <KitTimelineCard record={record} />
      <KitDispatchCard record={record} />
      <CollapsibleLogs record={record} customerName={customerName} />
    </section>
  );
}

/** Collapsed row per past KIT, expanded on demand. */
function HistoryRow({
  record,
  customerName,
}: {
  record: AdminKitRecord;
  customerName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                KIT Product
              </p>
              <p className="font-semibold">{record.kitProductName}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ordered On
              </p>
              <p className="font-semibold">{formatDate(record.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Duration
              </p>
              <p className="font-semibold">{record.kitDurationDays} days</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Meals Taken / Skipped
              </p>
              <p className="font-semibold">
                {record.daysTaken} / {record.daysSkipped}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Dispatch
              </p>
              <p className="font-semibold">{shippingStageLabel(record)}</p>
            </div>
            <StatusBadge status={record.status} />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? "Hide details" : "View details"}
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {open && (
          <div className="space-y-4 border-t pt-4">
            <KitTimelineCard record={record} />
            <KitDispatchCard record={record} />
            <CollapsibleLogs record={record} customerName={customerName} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KitHistorySection({
  records,
  customerName,
}: {
  records: AdminKitRecord[];
  customerName: string;
}) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={History}
        title="KIT History"
        description="Past KITs for this customer. Details and daily logs open on demand."
      />
      <div className="space-y-3">
        {records.map((record) => (
          <HistoryRow
            key={record.subscriptionId}
            record={record}
            customerName={customerName}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Admin Customer 360 → KIT tab.
 *
 * Renders every KIT the customer holds, grouped by lifecycle role:
 *   - a newly dispatched (PENDING) KIT, when one has been sent;
 *   - the running (ACTIVE) KIT with its live tracker table;
 *   - past KITs as history, collapsed, with logs behind a CTA.
 *
 * When nothing is running and nothing is on the way, the most recent closed KIT
 * is promoted to the headline so the tab still shows where the customer stands.
 */
export function AdminKitOverviewPanel({
  overview,
  customerName,
}: {
  overview: AdminKitOverview;
  customerName: string;
}) {
  const { current, incoming, history } = overview;

  const headlineClosed = !current && !incoming ? (history[0] ?? null) : null;
  const historyRecords = headlineClosed ? history.slice(1) : history;

  if (!current && !incoming && !headlineClosed) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="p-10 text-center text-muted-foreground">
          <Package className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p className="text-sm font-medium">
            This customer has no KIT subscriptions yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-10">
      {incoming && <IncomingKitSection record={incoming} />}
      {current && (
        <CurrentKitSection record={current} customerName={customerName} />
      )}
      {headlineClosed && (
        <LastKitSection record={headlineClosed} customerName={customerName} />
      )}
      {historyRecords.length > 0 && (
        <KitHistorySection
          records={historyRecords}
          customerName={customerName}
        />
      )}
    </div>
  );
}
