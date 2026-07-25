// src/services/KitReportTemplate.tsx
//
// PDF template components for KIT report generation using @react-pdf/renderer.
// Renders a day-wise breakdown of daily log data for a KIT subscription period.
//
// Premium design with clear visual hierarchy, branded colors, and organized layout.
//
// Requirements: 9.2, 9.3, 9.4, 10.2, 10.3

import React from "react";
import path from "path";
import fs from "fs";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

import type { KitDailyLogRow } from "@/repositories/kitLifecycleRepository";

// The logo is read from the filesystem into a Buffer at module load (this
// template only ever renders server-side via renderToBuffer in
// KitReportService). @react-pdf/renderer's <Image src="..."> treats a plain
// string as a URL and calls fetch() on it — passing a filesystem path there
// makes fetch fail silently and the image never embeds. Passing the raw
// Buffer instead skips network resolution entirely.
// Actual aspect ratio of /public/logo.png is 776x321 (~2.42:1) — widths
// below are chosen to preserve that ratio without stretching the wordmark.
let LOGO_BUFFER: Buffer | null = null;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
} catch {
  // Logo asset missing in this environment — report still renders, just
  // without the header/watermark image, rather than failing generation.
  LOGO_BUFFER = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KitReportData {
  customerName: string;
  kitProductName: string;
  durationDays: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD (tracker_end_date for EXPIRED)
  status: "ACTIVE" | "EXPIRED";
  totalSkippedDays: number;
  /** All daily log rows for this subscription, keyed by log_date */
  dailyLogsByDate: Map<string, KitDailyLogRow>;
  /** All dates from start to end (or current date) inclusive */
  dateRange: string[];
}

// ---------------------------------------------------------------------------
// Brand Colors
// ---------------------------------------------------------------------------

const COLORS = {
  // KIT reports use the same emerald identity as the KIT Tracker/Dashboard
  // pages in the app, not the app-wide `--primary` red — that red is used
  // for destructive/marketing accents elsewhere and looks inconsistent next
  // to the green "ACTIVE" badge and KIT UI this report represents.
  primary: "#059669",
  primaryLight: "#ECFDF5",
  emerald: "#059669",
  emeraldLight: "#ECFDF5",
  emeraldBorder: "#A7F3D0",
  amber: "#D97706",
  amberLight: "#FFFBEB",
  amberBorder: "#FDE68A",
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  slate900: "#0F172A",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748B",
  slate400: "#94A3B8",
  slate200: "#E2E8F0",
  slate100: "#F1F5F9",
  slate50: "#F8FAFC",
  white: "#FFFFFF",
  red600: "#DC2626",
  redLight: "#FEF2F2",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    // Reserve room for the fixed footer so content never runs underneath it.
    paddingBottom: 56,
    fontSize: 9,
    fontFamily: "Helvetica",
    backgroundColor: COLORS.white,
  },
  // Full-page watermark — sits behind all page content. Fixed so it repeats
  // on every page @react-pdf/renderer generates. Centered horizontally and
  // vertically for an A4 page (595x842pt): a 70%-wide logo at the 776x321
  // aspect ratio is ~172pt tall, so top is set to keep it optically centred.
  // Opacity is low enough to never compete with body text but high enough to
  // read as an intentional watermark on a dense page, not just a smudge.
  watermark: {
    position: "absolute",
    top: 335,
    left: "15%",
    width: "70%",
    opacity: 0.1,
  },
  // Header Section
  headerContainer: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 9,
    color: COLORS.slate500,
    marginBottom: 16,
  },
  headerLogo: {
    width: 92,
    height: 38, // 776:321 aspect ratio preserved (92 / 2.42 ≈ 38)
  },
  // Info Grid
  infoGrid: {
    flexDirection: "row",
    gap: 16,
  },
  infoCard: {
    flex: 1,
    padding: 12,
    backgroundColor: COLORS.slate50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.slate200,
  },
  infoLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 11,
    fontWeight: "bold",
    color: COLORS.slate900,
  },
  // Status Badge
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 8,
  },
  statusBadgeActive: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.emeraldLight,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
  },
  statusBadgeExpired: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.slate100,
    borderWidth: 1,
    borderColor: COLORS.slate200,
  },
  statusTextActive: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statusTextExpired: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Section Title
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 8,
    marginTop: 2,
  },
  // Day Entry
  dayEntry: {
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.white,
  },
  dayEntryTaken: {
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
    borderRadius: 6,
    backgroundColor: COLORS.emeraldLight,
  },
  dayEntrySkipped: {
    marginBottom: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    borderRadius: 6,
    backgroundColor: COLORS.amberLight,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
  },
  dayHeaderTaken: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.emeraldBorder,
  },
  dayDate: {
    fontSize: 10,
    fontWeight: "bold",
    color: COLORS.slate900,
  },
  dayStatusTaken: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
  },
  dayStatusSkipped: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.amber,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
  },
  dayStatusNoData: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate400,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontStyle: "italic",
  },
  // Fields Grid — 3 columns keeps each card ~1/3 shorter than a 2-column
  // layout, so several fit per page instead of one card leaving a large
  // dead zone whenever wrap={false} pushes the next one to a new page.
  fieldsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  fieldItem: {
    width: "33.33%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 1.5,
    paddingRight: 6,
  },
  fieldLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: COLORS.slate600,
    marginRight: 3,
  },
  fieldValue: {
    fontSize: 7.5,
    color: COLORS.slate900,
  },
  // Summary Section
  summaryContainer: {
    marginBottom: 14,
    padding: 12,
    backgroundColor: COLORS.slate50,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 8,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 9,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryCard: {
    width: "31.5%",
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: COLORS.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.slate200,
  },
  summaryCardHighlight: {
    width: "31.5%",
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
  },
  summaryLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: COLORS.slate500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: "bold",
    color: COLORS.slate900,
  },
  summaryValueHighlight: {
    fontSize: 15,
    fontWeight: "bold",
    color: COLORS.emerald,
  },
  summarySubtext: {
    fontSize: 7,
    color: COLORS.slate500,
    marginTop: 2,
  },
  // Adherence bar
  adherenceBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.slate200,
    marginTop: 10,
    marginBottom: 4,
    flexDirection: "row",
    overflow: "hidden",
  },
  adherenceBarTaken: {
    height: 8,
    backgroundColor: COLORS.emerald,
  },
  adherenceBarSkipped: {
    height: 8,
    backgroundColor: COLORS.amber,
  },
  adherenceLegendRow: {
    flexDirection: "row",
    gap: 14,
    marginTop: 2,
  },
  adherenceLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  adherenceLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  adherenceLegendText: {
    fontSize: 7.5,
    color: COLORS.slate600,
  },
  // Collapsed "no data" range row — replaces one full-width card per empty
  // day so a long unlogged stretch doesn't burn multiple pages.
  noDataRangeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.slate50,
    borderStyle: "dashed",
  },
  noDataRangeText: {
    fontSize: 8.5,
    color: COLORS.slate500,
  },
  noDataRangeCount: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate400,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.slate200,
  },
  footerText: {
    fontSize: 7,
    color: COLORS.slate400,
  },
  footerBrand: {
    fontSize: 7,
    fontWeight: "bold",
    color: COLORS.primary,
  },
});

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Header section: customer name, KIT product name, duration, start date, status */
function ReportHeader({ data }: { data: KitReportData }) {
  return (
    <View style={styles.headerContainer}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.headerTitle}>KIT Report</Text>
          <Text style={styles.headerSubtitle}>
            Daily nutrition and activity tracking report
          </Text>
        </View>
        {LOGO_BUFFER && <Image src={LOGO_BUFFER} style={styles.headerLogo} />}
      </View>

      <View style={styles.infoGrid}>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Customer</Text>
          <Text style={styles.infoValue}>{data.customerName}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>KIT Product</Text>
          <Text style={styles.infoValue}>{data.kitProductName}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Duration</Text>
          <Text style={styles.infoValue}>{data.durationDays} days</Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Start Date</Text>
          <Text style={styles.infoValue}>{formatDisplayDate(data.startDate)}</Text>
        </View>
        {data.status === "EXPIRED" && data.endDate && (
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>End Date</Text>
            <Text style={styles.infoValue}>{formatDisplayDate(data.endDate)}</Text>
          </View>
        )}
        <View
          style={
            data.status === "ACTIVE"
              ? styles.statusBadgeActive
              : styles.statusBadgeExpired
          }
        >
          <Text
            style={
              data.status === "ACTIVE"
                ? styles.statusTextActive
                : styles.statusTextExpired
            }
          >
            {data.status}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Day-wise entry for FOOD_TAKEN — shows all activity/nutrition fields */
function FoodTakenEntry({ date, log }: { date: string; log: KitDailyLogRow }) {
  return (
    // wrap={false} keeps this whole card on one page instead of letting
    // react-pdf split it mid-card (header on one page, fields on the next)
    // whenever it happens to fall near a page boundary.
    <View style={styles.dayEntryTaken} wrap={false}>
      <View style={styles.dayHeaderTaken}>
        <Text style={styles.dayDate}>{formatDisplayDate(date)}</Text>
        <Text style={styles.dayStatusTaken}>Food Taken</Text>
      </View>
      <View style={styles.fieldsGrid}>
        {renderField("Weight (kg)", log.weight_kg)}
        {renderField("Steps", log.step_count)}
        {renderField("Activity (min)", log.physical_activity_minutes)}
        {renderField("Activity Name", titleCase(log.physical_activity_name))}
        {renderField("Water (L)", log.water_intake_liters)}
        {renderField("Buttermilk", titleCase(log.buttermilk_intake))}
        {renderField("Fat Consumption", titleCase(log.fat_consumption))}
        {renderField("Main Dish", titleCase(log.main_dish))}
        {renderField("Protein Curry", titleCase(log.protein_curry))}
        {renderField("Veg Curry", titleCase(log.veg_curry))}
        {renderField("Soup", titleCase(log.soup_name_qty))}
        {renderField("Eggs", log.eggs_count)}
        {renderField("Salads", titleCase(log.salads_qty))}
      </View>
    </View>
  );
}

/** Day-wise entry for FOOD_SKIPPED — shows date + status only */
function FoodSkippedEntry({ date }: { date: string }) {
  return (
    <View style={styles.dayEntrySkipped} wrap={false}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayDate}>{formatDisplayDate(date)}</Text>
        <Text style={styles.dayStatusSkipped}>Food Skipped</Text>
      </View>
    </View>
  );
}

/**
 * Collapsed row for a run of consecutive unlogged days — replaces one
 * full-width card per empty day so a long gap (e.g. 12 days) doesn't turn
 * the report into pages of blank cards. Single unlogged days still render
 * with their own date for clarity.
 */
function NoDataRangeEntry({ startDate, endDate, count }: { startDate: string; endDate: string; count: number }) {
  const label =
    count === 1
      ? formatDisplayDate(startDate)
      : `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)}`;

  return (
    <View style={styles.noDataRangeRow} wrap={false}>
      <Text style={styles.noDataRangeText}>{label}</Text>
      <Text style={styles.noDataRangeCount}>
        {count === 1 ? "No Data Logged" : `${count} Days · No Data Logged`}
      </Text>
    </View>
  );
}

/**
 * Report summary — always rendered (both ACTIVE and EXPIRED) so the report
 * leads with the story (adherence rate, weight trend, daily averages)
 * instead of requiring the reader to tally every daily card themselves.
 */
function ReportSummary({ data }: { data: KitReportData }) {
  const stats = computeSummaryStats(data);
  const totalDuration = data.durationDays + data.totalSkippedDays;

  return (
    <View style={styles.summaryContainer} wrap={false}>
      <Text style={styles.summaryTitle}>Summary</Text>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCardHighlight}>
          <Text style={styles.summaryLabel}>Adherence Rate</Text>
          <Text style={styles.summaryValueHighlight}>{stats.adherenceRate}%</Text>
          <Text style={styles.summarySubtext}>
            {stats.takenCount} of {stats.loggedDays} logged days
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Meals Taken</Text>
          <Text style={styles.summaryValue}>{stats.takenCount}</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Days Skipped</Text>
          <Text style={styles.summaryValue}>{data.totalSkippedDays}</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Weight Trend</Text>
          <Text style={styles.summaryValue}>
            {stats.weightTrendLabel}
          </Text>
          {stats.weightDelta !== null && (
            <Text style={styles.summarySubtext}>
              {stats.weightStart}kg → {stats.weightEnd}kg
            </Text>
          )}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Avg. Activity</Text>
          <Text style={styles.summaryValue}>
            {stats.avgActivityMinutes !== null ? `${stats.avgActivityMinutes} min` : "—"}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Avg. Water Intake</Text>
          <Text style={styles.summaryValue}>
            {stats.avgWaterLiters !== null ? `${stats.avgWaterLiters} L` : "—"}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Duration</Text>
          <Text style={styles.summaryValue}>{totalDuration} days</Text>
        </View>

        {data.endDate && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Completion Date</Text>
            <Text style={styles.summaryValue}>{formatDisplayDate(data.endDate)}</Text>
          </View>
        )}
      </View>

      {/* Adherence bar — visual read of taken vs skipped vs unlogged across
          the whole tracked period, at a glance. */}
      <View style={styles.adherenceBarTrack}>
        {stats.takenPct > 0 && (
          <View style={[styles.adherenceBarTaken, { width: `${stats.takenPct}%` }]} />
        )}
        {stats.skippedPct > 0 && (
          <View style={[styles.adherenceBarSkipped, { width: `${stats.skippedPct}%` }]} />
        )}
      </View>
      <View style={styles.adherenceLegendRow}>
        <View style={styles.adherenceLegendItem}>
          <View style={[styles.adherenceLegendDot, { backgroundColor: COLORS.emerald }]} />
          <Text style={styles.adherenceLegendText}>Taken ({stats.takenCount})</Text>
        </View>
        <View style={styles.adherenceLegendItem}>
          <View style={[styles.adherenceLegendDot, { backgroundColor: COLORS.amber }]} />
          <Text style={styles.adherenceLegendText}>Skipped ({data.totalSkippedDays})</Text>
        </View>
        <View style={styles.adherenceLegendItem}>
          <View style={[styles.adherenceLegendDot, { backgroundColor: COLORS.slate200 }]} />
          <Text style={styles.adherenceLegendText}>Unlogged ({stats.noDataCount})</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Page footer with branding, generation timestamp, and page number.
 * Marked `fixed` so it repeats identically on every page @react-pdf/renderer
 * generates, instead of only appearing once wherever the content flow ends.
 */
function ReportFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        Generated on {formatDisplayDate(getTodayDateString())}
      </Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
      <Text style={styles.footerBrand}>ArogyaDiet</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Document Component
// ---------------------------------------------------------------------------

/**
 * Full KIT Report PDF document.
 *
 * Structure:
 * - Header: customer info cards, product name, duration, start date, status badge
 * - Day-wise entries: FOOD_TAKEN (green card), FOOD_SKIPPED (amber card), missing (neutral)
 * - Summary (EXPIRED only): card grid with totals and completion date
 * - Footer: generation date and branding
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 10.2, 10.3
 */
export function KitReportDocument({ data }: { data: KitReportData }) {
  const entries = buildDailyEntries(data);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Full-page watermark logo, behind all content, repeats on every page */}
        {LOGO_BUFFER && <Image src={LOGO_BUFFER} style={styles.watermark} fixed />}

        <ReportHeader data={data} />

        {/* Summary now leads every report (not just EXPIRED ones) — the
            reader should get the adherence story before scrolling through
            individual daily cards. */}
        <ReportSummary data={data} />

        <Text style={styles.sectionTitle}>Daily Log</Text>

        {entries.map((entry) => {
          if (entry.kind === "taken") {
            return <FoodTakenEntry key={entry.date} date={entry.date} log={entry.log} />;
          }
          if (entry.kind === "skipped") {
            return <FoodSkippedEntry key={entry.date} date={entry.date} />;
          }
          // Collapsed run of one or more consecutive unlogged days
          return (
            <NoDataRangeEntry
              key={entry.startDate}
              startDate={entry.startDate}
              endDate={entry.endDate}
              count={entry.count}
            />
          );
        })}

        <ReportFooter />
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Entry building — collapses consecutive unlogged days into single ranges
// ---------------------------------------------------------------------------

type DailyEntry =
  | { kind: "taken"; date: string; log: KitDailyLogRow }
  | { kind: "skipped"; date: string }
  | { kind: "nodata-range"; startDate: string; endDate: string; count: number };

function buildDailyEntries(data: KitReportData): DailyEntry[] {
  const entries: DailyEntry[] = [];
  let pendingRangeStart: string | null = null;
  let pendingRangeCount = 0;
  let pendingRangeEnd: string | null = null;

  const flushRange = () => {
    if (pendingRangeStart && pendingRangeEnd) {
      entries.push({
        kind: "nodata-range",
        startDate: pendingRangeStart,
        endDate: pendingRangeEnd,
        count: pendingRangeCount,
      });
    }
    pendingRangeStart = null;
    pendingRangeEnd = null;
    pendingRangeCount = 0;
  };

  for (const date of data.dateRange) {
    const log = data.dailyLogsByDate.get(date);

    if (!log) {
      if (!pendingRangeStart) pendingRangeStart = date;
      pendingRangeEnd = date;
      pendingRangeCount++;
      continue;
    }

    // Logged day breaks any in-progress unlogged run
    flushRange();

    if (log.status === "FOOD_TAKEN") {
      entries.push({ kind: "taken", date, log });
    } else {
      entries.push({ kind: "skipped", date });
    }
  }

  flushRange();
  return entries;
}

// ---------------------------------------------------------------------------
// Summary statistics
// ---------------------------------------------------------------------------

interface SummaryStats {
  takenCount: number;
  loggedDays: number;
  noDataCount: number;
  adherenceRate: number;
  takenPct: number;
  skippedPct: number;
  weightStart: number | null;
  weightEnd: number | null;
  weightDelta: number | null;
  weightTrendLabel: string;
  avgActivityMinutes: number | null;
  avgWaterLiters: number | null;
}

/** Aggregate the daily logs into report-level statistics for the summary card. */
function computeSummaryStats(data: KitReportData): SummaryStats {
  let takenCount = 0;
  let weightStart: number | null = null;
  let weightEnd: number | null = null;
  let activitySum = 0;
  let activityDaysCount = 0;
  let waterSum = 0;
  let waterDaysCount = 0;

  // dateRange is chronological, so the first/last FOOD_TAKEN rows with a
  // logged weight give us the start/end weight for the trend.
  for (const date of data.dateRange) {
    const log = data.dailyLogsByDate.get(date);
    if (!log || log.status !== "FOOD_TAKEN") continue;

    takenCount++;

    if (log.weight_kg !== null) {
      if (weightStart === null) weightStart = log.weight_kg;
      weightEnd = log.weight_kg;
    }
    if (log.physical_activity_minutes !== null) {
      activitySum += log.physical_activity_minutes;
      activityDaysCount++;
    }
    if (log.water_intake_liters !== null) {
      waterSum += log.water_intake_liters;
      waterDaysCount++;
    }
  }

  const loggedDays = takenCount + data.totalSkippedDays;
  const totalTrackedDays = data.dateRange.length;
  const noDataCount = totalTrackedDays - loggedDays;

  const adherenceRate = loggedDays > 0 ? Math.round((takenCount / loggedDays) * 100) : 0;

  const weightDelta =
    weightStart !== null && weightEnd !== null
      ? Math.round((weightEnd - weightStart) * 10) / 10
      : null;

  let weightTrendLabel = "—";
  if (weightDelta !== null) {
    if (weightDelta === 0) weightTrendLabel = "No change";
    else if (weightDelta < 0) weightTrendLabel = `${Math.abs(weightDelta)} kg lost`;
    else weightTrendLabel = `${weightDelta} kg gained`;
  }

  return {
    takenCount,
    loggedDays,
    noDataCount: Math.max(0, noDataCount),
    adherenceRate,
    takenPct: totalTrackedDays > 0 ? (takenCount / totalTrackedDays) * 100 : 0,
    skippedPct: totalTrackedDays > 0 ? (data.totalSkippedDays / totalTrackedDays) * 100 : 0,
    weightStart,
    weightEnd,
    weightDelta,
    weightTrendLabel,
    avgActivityMinutes:
      activityDaysCount > 0 ? Math.round(activitySum / activityDaysCount) : null,
    avgWaterLiters:
      waterDaysCount > 0 ? Math.round((waterSum / waterDaysCount) * 10) / 10 : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format YYYY-MM-DD to a more readable display format (DD MMM YYYY) */
function formatDisplayDate(dateStr: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [year, month, day] = dateStr.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

/** Get today's date as YYYY-MM-DD string */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Render a single field item if the value is non-null */
function renderField(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={styles.fieldItem}>
      <Text style={styles.fieldLabel}>{label}:</Text>
      <Text style={styles.fieldValue}>{String(value)}</Text>
    </View>
  );
}

/**
 * Title-case free-text customer input (e.g. "roti" / "ROTI" -> "Roti") so
 * the report reads as a polished document rather than a raw data dump.
 * Numbers and null pass through renderField's own null-check untouched.
 */
function titleCase(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  return value
    .split(/(\s+|,\s*)/)
    .map((part) =>
      /^[a-zA-Z]/.test(part)
        ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        : part
    )
    .join("");
}
