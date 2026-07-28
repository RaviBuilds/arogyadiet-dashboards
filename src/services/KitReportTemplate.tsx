// src/services/KitReportTemplate.tsx
//
// PDF template components for KIT report generation using @react-pdf/renderer.
//
// DUAL LOG SOURCES: a KIT customer's tracking history has two authors and the
// report shows both, clearly separated:
//   1. Customer Daily Log  — `kit_daily_logs`, self-logged every day
//                            (FOOD_TAKEN / FOOD_SKIPPED + nutrition/activity)
//   2. Dietitian Health Log — `health_logs` with `author_type = 'DIETITIAN'`,
//                            recorded on the 3-day KIT cadence
//                            (clinical parameters + remarks)
//
// Visual identity is shared with the meal-subscription Health Report
// (`HealthReportTemplate`): emerald/slate palette, logo header, dietitian
// banner, faint watermark, summary card grid, SVG trend charts, fixed footer —
// so a KIT customer's report reads as a sibling of the meal report.
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
  Svg,
  Polyline,
  Circle,
  Line,
  StyleSheet,
} from "@react-pdf/renderer";

import { fieldByKey } from "@/lib/dietitian/fieldSets";
import type { KitDailyLogRow } from "@/repositories/kitLifecycleRepository";
import type { CustomParameter, ParameterValue } from "@/types/dietitian";

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

/** One dated numeric trend point (weight, fasting sugar, ...). */
export interface KitTrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** One dated BP trend point — the composite parameter carries both readings. */
export interface KitBPTrendPoint {
  date: string; // YYYY-MM-DD
  systolic: number;
  diastolic: number;
}

/**
 * Trend series drawn in the Trends band.
 *
 * Weight is kept as two separate series on purpose: the customer's own daily
 * self-logged weight and the Dietitian's recorded weight are different
 * measurements (different scale, different time of day), so averaging them
 * into one line would invent data. Plotting both makes any drift between the
 * two visible instead of hiding it.
 */
export interface KitReportTrends {
  customerWeight: KitTrendPoint[];
  dietitianWeight: KitTrendPoint[];
  bp: KitBPTrendPoint[];
  fastingSugar: KitTrendPoint[];
}

/** One Dietitian-authored health log rendered in the Dietitian Health Log section. */
export interface KitDietitianLogEntry {
  logDate: string; // YYYY-MM-DD
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string | null;
}

export interface KitReportData {
  customerName: string;
  kitProductName: string;
  /** Assigned Dietitian, shown in the header banner. `null` when unassigned. */
  dietitianName: string | null;
  durationDays: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD (tracker_end_date for EXPIRED)
  status: "ACTIVE" | "EXPIRED";
  totalSkippedDays: number;
  /** All customer daily log rows for this subscription, keyed by log_date */
  dailyLogsByDate: Map<string, KitDailyLogRow>;
  /** All dates from start to end (or current date) inclusive */
  dateRange: string[];
  /** Dietitian-authored health logs inside the KIT tracker window, date ascending. */
  dietitianEntries: KitDietitianLogEntry[];
  /** Trend series derived from both log sources. */
  trends: KitReportTrends;
  /** Display string for the footer, e.g. "29 Jul 2026, 02:32 am IST". */
  generatedAtIst: string;
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
  // Dietitian banner — the assigned Dietitian named at the top of the body, so
  // the reader knows who authored the Dietitian Health Log section below.
  dietitianBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
  },
  dietitianBannerLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dietitianBannerName: {
    fontSize: 11,
    fontWeight: "bold",
    color: COLORS.slate900,
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
  sectionHeaderBlock: {
    marginTop: 6,
    marginBottom: 8,
  },
  sectionTitleTight: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 7.5,
    color: COLORS.slate500,
  },
  // Log-source legend — names the two authors up front so a reader never has
  // to guess whether a value came from the customer or the Dietitian.
  sourceLegend: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.slate50,
  },
  sourceLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  sourceLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceLegendText: {
    fontSize: 7,
    color: COLORS.slate600,
  },
  sourceLegendStrong: {
    fontSize: 7,
    fontWeight: "bold",
    color: COLORS.slate700,
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
  // Trend charts — plain SVG line charts, no chart library
  trendContainer: {
    marginBottom: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 8,
    backgroundColor: COLORS.white,
  },
  trendRow: {
    flexDirection: "row",
    gap: 10,
  },
  trendCard: {
    flex: 1,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.slate50,
  },
  trendTitle: {
    fontSize: 8.5,
    fontWeight: "bold",
    color: COLORS.slate700,
    marginBottom: 6,
  },
  trendEmpty: {
    fontSize: 8,
    color: COLORS.slate400,
    fontStyle: "italic",
    paddingVertical: 18,
    textAlign: "center",
  },
  trendAxisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  trendAxisText: {
    fontSize: 6.5,
    color: COLORS.slate500,
  },
  trendLegendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  trendLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  trendLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  trendLegendText: {
    fontSize: 7,
    color: COLORS.slate600,
  },
  // Dietitian health-log entry cards
  dietitianEntryCard: {
    marginBottom: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: COLORS.blueLight,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.blue,
    borderRadius: 6,
    backgroundColor: COLORS.white,
  },
  dietitianEntryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
  },
  dietitianEntryBadge: {
    fontSize: 7,
    fontWeight: "bold",
    color: COLORS.blue,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.blue,
    backgroundColor: COLORS.blueLight,
  },
  // Full-width row for long free-text parameters (Dietitian/Doctor Remarks,
  // Any Emergency Medication) so the value wraps beneath its label instead of
  // overflowing its column into the neighbouring one.
  fieldItemFull: {
    width: "100%",
    flexDirection: "column",
    paddingVertical: 2,
    paddingRight: 6,
  },
  fieldValueFull: {
    fontSize: 7.5,
    color: COLORS.slate900,
    marginTop: 1,
  },
  noParametersText: {
    fontSize: 7.5,
    color: COLORS.slate400,
    fontStyle: "italic",
  },
  commentBlock: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.slate100,
  },
  commentLabel: {
    fontSize: 7,
    fontWeight: "bold",
    color: COLORS.slate500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  commentText: {
    fontSize: 8,
    color: COLORS.slate700,
    lineHeight: 1.4,
  },
  emptyStateCard: {
    marginBottom: 8,
    paddingVertical: 20,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.slate50,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 9,
    color: COLORS.slate500,
    textAlign: "center",
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
            Daily customer tracking and dietitian-recorded health log
          </Text>
        </View>
        {LOGO_BUFFER && <Image src={LOGO_BUFFER} style={styles.headerLogo} />}
      </View>

      {/* Assigned Dietitian — the author of the Dietitian Health Log section. */}
      <View style={styles.dietitianBanner}>
        <Text style={styles.dietitianBannerLabel}>Dietitian</Text>
        <Text style={styles.dietitianBannerName}>
          {data.dietitianName ?? "Not yet assigned"}
        </Text>
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
          <Text style={styles.summaryLabel}>Customer Logs</Text>
          <Text style={styles.summaryValue}>{stats.loggedDays}</Text>
          <Text style={styles.summarySubtext}>
            {stats.takenCount} taken · {data.totalSkippedDays} skipped
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Dietitian Logs</Text>
          <Text style={styles.summaryValue}>{data.dietitianEntries.length}</Text>
          <Text style={styles.summarySubtext}>3-day cadence</Text>
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
          <Text style={styles.summaryLabel}>Latest Weight</Text>
          <Text style={styles.summaryValue}>
            {stats.latestWeight !== null ? `${stats.latestWeight} kg` : "—"}
          </Text>
          {stats.latestWeightSource && (
            <Text style={styles.summarySubtext}>{stats.latestWeightSource}</Text>
          )}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest BP</Text>
          <Text style={styles.summaryValue}>
            {stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"}
          </Text>
          <Text style={styles.summarySubtext}>mmHg · dietitian</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest Fasting Sugar</Text>
          <Text style={styles.summaryValue}>
            {stats.latestFastingSugar !== null ? `${stats.latestFastingSugar}` : "—"}
          </Text>
          <Text style={styles.summarySubtext}>mg/dL · dietitian</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Avg. Activity</Text>
          <Text style={styles.summaryValue}>
            {stats.avgActivityMinutes !== null ? `${stats.avgActivityMinutes} min` : "—"}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Avg. Steps</Text>
          <Text style={styles.summaryValue}>
            {stats.avgStepCount !== null ? formatCompactNumber(stats.avgStepCount) : "—"}
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
 * Names the two log authors before either section appears, so no value in the
 * report is ambiguous about where it came from.
 */
function LogSourceLegend({ data }: { data: KitReportData }) {
  const stats = { customerLogs: countCustomerLogs(data), dietitianLogs: data.dietitianEntries.length };
  return (
    <View style={styles.sourceLegend} wrap={false}>
      <View style={styles.sourceLegendItem}>
        <View style={[styles.sourceLegendDot, { backgroundColor: COLORS.emerald }]} />
        <Text style={styles.sourceLegendStrong}>Customer Daily Log</Text>
        <Text style={styles.sourceLegendText}>
          self-logged daily · {stats.customerLogs} entries
        </Text>
      </View>
      <View style={styles.sourceLegendItem}>
        <View style={[styles.sourceLegendDot, { backgroundColor: COLORS.blue }]} />
        <Text style={styles.sourceLegendStrong}>Dietitian Health Log</Text>
        <Text style={styles.sourceLegendText}>
          recorded every 3rd day · {stats.dietitianLogs} entries
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Trend charts — plain SVG line charts, mirroring HealthReportTemplate
// ---------------------------------------------------------------------------

const CHART_WIDTH = 150;
const CHART_HEIGHT = 70;
const CHART_PAD = 6;

function scaleY(value: number, min: number, max: number): number {
  if (max === min) return CHART_HEIGHT / 2;
  const t = (value - min) / (max - min);
  return CHART_PAD + (1 - t) * (CHART_HEIGHT - 2 * CHART_PAD);
}

function scaleX(index: number, count: number): number {
  if (count <= 1) return CHART_WIDTH / 2;
  return CHART_PAD + (index / (count - 1)) * (CHART_WIDTH - 2 * CHART_PAD);
}

/** Baseline drawn under every chart so a single-point series still reads as a chart. */
function ChartBaseline() {
  return (
    <Line
      x1={CHART_PAD}
      y1={CHART_HEIGHT - CHART_PAD}
      x2={CHART_WIDTH - CHART_PAD}
      y2={CHART_HEIGHT - CHART_PAD}
      stroke={COLORS.slate200}
      strokeWidth={0.5}
    />
  );
}

/**
 * Weight chart carrying both authors' series on one shared scale — the
 * customer's daily self-logged weight and the Dietitian's recorded weight.
 * Each series keeps its own x-spacing because the two are logged on different
 * cadences (daily vs every 3rd day).
 */
function WeightTrendChart({
  customer,
  dietitian,
}: {
  customer: readonly KitTrendPoint[];
  dietitian: readonly KitTrendPoint[];
}) {
  const allValues = [...customer, ...dietitian].map((p) => p.value);
  if (allValues.length === 0) {
    return (
      <View style={styles.trendCard}>
        <Text style={styles.trendTitle}>Weight</Text>
        <Text style={styles.trendEmpty}>No data recorded</Text>
      </View>
    );
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const line = (points: readonly KitTrendPoint[]) =>
    points.map((p, i) => `${scaleX(i, points.length)},${scaleY(p.value, min, max)}`).join(" ");

  const axisDates = [...customer, ...dietitian].map((p) => p.date).sort();

  return (
    <View style={styles.trendCard} wrap={false}>
      <Text style={styles.trendTitle}>Weight (kg)</Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <ChartBaseline />
        {customer.length > 1 && (
          <Polyline points={line(customer)} stroke={COLORS.emerald} strokeWidth={1.5} fill="none" />
        )}
        {dietitian.length > 1 && (
          <Polyline points={line(dietitian)} stroke={COLORS.blue} strokeWidth={1.5} fill="none" />
        )}
        {customer.map((p, i) => (
          <Circle
            key={`c-${p.date}`}
            cx={scaleX(i, customer.length)}
            cy={scaleY(p.value, min, max)}
            r={1.6}
            fill={COLORS.emerald}
          />
        ))}
        {dietitian.map((p, i) => (
          <Circle
            key={`d-${p.date}`}
            cx={scaleX(i, dietitian.length)}
            cy={scaleY(p.value, min, max)}
            r={1.6}
            fill={COLORS.blue}
          />
        ))}
      </Svg>
      <View style={styles.trendAxisRow}>
        <Text style={styles.trendAxisText}>{formatDisplayDate(axisDates[0])}</Text>
        <Text style={styles.trendAxisText}>
          {formatDisplayDate(axisDates[axisDates.length - 1])}
        </Text>
      </View>
      <Text style={styles.trendAxisText}>
        Range: {min}kg – {max}kg
      </Text>
      <View style={styles.trendLegendRow}>
        <View style={styles.trendLegendItem}>
          <View style={[styles.trendLegendDot, { backgroundColor: COLORS.emerald }]} />
          <Text style={styles.trendLegendText}>Customer</Text>
        </View>
        <View style={styles.trendLegendItem}>
          <View style={[styles.trendLegendDot, { backgroundColor: COLORS.blue }]} />
          <Text style={styles.trendLegendText}>Dietitian</Text>
        </View>
      </View>
    </View>
  );
}

/** Single-series numeric chart (Fasting Sugar). */
function SingleTrendChart({
  title,
  points,
  color,
  unit,
}: {
  title: string;
  points: readonly KitTrendPoint[];
  color: string;
  unit: string;
}) {
  if (points.length === 0) {
    return (
      <View style={styles.trendCard}>
        <Text style={styles.trendTitle}>{title}</Text>
        <Text style={styles.trendEmpty}>No data recorded</Text>
      </View>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const polylinePoints = points
    .map((p, i) => `${scaleX(i, points.length)},${scaleY(p.value, min, max)}`)
    .join(" ");

  return (
    <View style={styles.trendCard} wrap={false}>
      <Text style={styles.trendTitle}>{title}</Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <ChartBaseline />
        {points.length > 1 && (
          <Polyline points={polylinePoints} stroke={color} strokeWidth={1.5} fill="none" />
        )}
        {points.map((p, i) => (
          <Circle
            key={p.date}
            cx={scaleX(i, points.length)}
            cy={scaleY(p.value, min, max)}
            r={1.6}
            fill={color}
          />
        ))}
      </Svg>
      <View style={styles.trendAxisRow}>
        <Text style={styles.trendAxisText}>{formatDisplayDate(points[0].date)}</Text>
        <Text style={styles.trendAxisText}>
          {formatDisplayDate(points[points.length - 1].date)}
        </Text>
      </View>
      <Text style={styles.trendAxisText}>
        Range: {min}
        {unit} – {max}
        {unit}
      </Text>
    </View>
  );
}

/** Blood-pressure chart — systolic and diastolic on a shared scale. */
function BPTrendChart({ points }: { points: readonly KitBPTrendPoint[] }) {
  if (points.length === 0) {
    return (
      <View style={styles.trendCard}>
        <Text style={styles.trendTitle}>Blood Pressure</Text>
        <Text style={styles.trendEmpty}>No data recorded</Text>
      </View>
    );
  }

  const allValues = points.flatMap((p) => [p.systolic, p.diastolic]);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const systolicLine = points
    .map((p, i) => `${scaleX(i, points.length)},${scaleY(p.systolic, min, max)}`)
    .join(" ");
  const diastolicLine = points
    .map((p, i) => `${scaleX(i, points.length)},${scaleY(p.diastolic, min, max)}`)
    .join(" ");

  return (
    <View style={styles.trendCard} wrap={false}>
      <Text style={styles.trendTitle}>Blood Pressure</Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <ChartBaseline />
        {points.length > 1 && (
          <>
            <Polyline points={systolicLine} stroke={COLORS.amber} strokeWidth={1.5} fill="none" />
            <Polyline points={diastolicLine} stroke={COLORS.blue} strokeWidth={1.5} fill="none" />
          </>
        )}
        {points.map((p, i) => (
          <React.Fragment key={p.date}>
            <Circle
              cx={scaleX(i, points.length)}
              cy={scaleY(p.systolic, min, max)}
              r={1.6}
              fill={COLORS.amber}
            />
            <Circle
              cx={scaleX(i, points.length)}
              cy={scaleY(p.diastolic, min, max)}
              r={1.6}
              fill={COLORS.blue}
            />
          </React.Fragment>
        ))}
      </Svg>
      <View style={styles.trendAxisRow}>
        <Text style={styles.trendAxisText}>{formatDisplayDate(points[0].date)}</Text>
        <Text style={styles.trendAxisText}>
          {formatDisplayDate(points[points.length - 1].date)}
        </Text>
      </View>
      <View style={styles.trendLegendRow}>
        <View style={styles.trendLegendItem}>
          <View style={[styles.trendLegendDot, { backgroundColor: COLORS.amber }]} />
          <Text style={styles.trendLegendText}>Systolic</Text>
        </View>
        <View style={styles.trendLegendItem}>
          <View style={[styles.trendLegendDot, { backgroundColor: COLORS.blue }]} />
          <Text style={styles.trendLegendText}>Diastolic</Text>
        </View>
      </View>
    </View>
  );
}

/** Trends band — rendered only when at least one series has a point. */
function TrendChartsSection({ data }: { data: KitReportData }) {
  const { customerWeight, dietitianWeight, bp, fastingSugar } = data.trends;
  const hasAnyTrend =
    customerWeight.length > 0 ||
    dietitianWeight.length > 0 ||
    bp.length > 0 ||
    fastingSugar.length > 0;
  if (!hasAnyTrend) return null;

  return (
    <View style={styles.trendContainer} wrap={false}>
      <Text style={styles.sectionTitle}>Trends</Text>
      <View style={styles.trendRow}>
        <WeightTrendChart customer={customerWeight} dietitian={dietitianWeight} />
        <BPTrendChart points={bp} />
        <SingleTrendChart
          title="Fasting Sugar"
          points={fastingSugar}
          color={COLORS.amber}
          unit="mg/dL"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dietitian Health Log section
// ---------------------------------------------------------------------------

/** Render one recorded Health_Log parameter value as display text. */
function formatParameterValue(value: ParameterValue): string {
  if ("systolic" in value) {
    return `${value.systolic}/${value.diastolic} ${value.unit}`;
  }
  if (typeof value.value === "boolean") {
    return value.value ? "Yes" : "No";
  }
  if (typeof value.value === "number") {
    return value.unit ? `${value.value} ${value.unit}` : `${value.value}`;
  }
  return value.value;
}

function DietitianLogEntryCard({ entry }: { entry: KitDietitianLogEntry }) {
  const allKeys = Object.keys(entry.parameters);
  // Free-text parameters get a full-width row so long values wrap cleanly;
  // everything else stays in the compact 3-column grid.
  const gridKeys = allKeys.filter((key) => fieldByKey(key)?.kind !== "text");
  const textKeys = allKeys.filter((key) => fieldByKey(key)?.kind === "text");
  const hasCustom = entry.customParameters.length > 0;
  const comment = entry.closingComment?.trim();

  return (
    <View style={styles.dietitianEntryCard} wrap={false}>
      <View style={styles.dietitianEntryHeader}>
        <Text style={styles.dayDate}>{formatDisplayDate(entry.logDate)}</Text>
        <Text style={styles.dietitianEntryBadge}>Dietitian Log</Text>
      </View>

      {allKeys.length === 0 && !hasCustom ? (
        <Text style={styles.noParametersText}>No parameter values recorded</Text>
      ) : (
        <>
          <View style={styles.fieldsGrid}>
            {gridKeys.map((key) => (
              <View style={styles.fieldItem} key={key}>
                <Text style={styles.fieldLabel}>{fieldByKey(key)?.label ?? key}:</Text>
                <Text style={styles.fieldValue}>
                  {formatParameterValue(entry.parameters[key])}
                </Text>
              </View>
            ))}
            {entry.customParameters.map((cp, i) => (
              <View style={styles.fieldItem} key={`custom-${i}-${cp.label}`}>
                <Text style={styles.fieldLabel}>{cp.label}:</Text>
                <Text style={styles.fieldValue}>
                  {cp.value}
                  {cp.unit ? ` ${cp.unit}` : ""}
                </Text>
              </View>
            ))}
          </View>
          {textKeys.map((key) => (
            <View style={styles.fieldItemFull} key={key}>
              <Text style={styles.fieldLabel}>{fieldByKey(key)?.label ?? key}:</Text>
              <Text style={styles.fieldValueFull}>
                {formatParameterValue(entry.parameters[key])}
              </Text>
            </View>
          ))}
        </>
      )}

      {comment && (
        <View style={styles.commentBlock}>
          <Text style={styles.commentLabel}>Dietitian Remarks</Text>
          <Text style={styles.commentText}>{comment}</Text>
        </View>
      )}
    </View>
  );
}

function DietitianLogSection({ data }: { data: KitReportData }) {
  return (
    <View>
      {/* minPresenceAhead keeps the heading from being stranded alone at the
          bottom of a page — it breaks to the next page unless there's room for
          the first entry to follow it. */}
      <View style={styles.sectionHeaderBlock} minPresenceAhead={90}>
        <Text style={styles.sectionTitleTight}>Dietitian Health Log</Text>
        <Text style={styles.sectionSubtitle}>
          Clinical parameters recorded by your dietitian on the 3-day KIT cadence
        </Text>
      </View>
      {data.dietitianEntries.length === 0 ? (
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateText}>
            Your dietitian has not recorded any health logs for this KIT period yet.
          </Text>
        </View>
      ) : (
        data.dietitianEntries.map((entry, i) => (
          <DietitianLogEntryCard entry={entry} key={`${entry.logDate}-${i}`} />
        ))
      )}
    </View>
  );
}

/**
 * Page footer with branding, generation timestamp, and page number.
 * Marked `fixed` so it repeats identically on every page @react-pdf/renderer
 * generates, instead of only appearing once wherever the content flow ends.
 */
function ReportFooter({ generatedAtIst }: { generatedAtIst: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Generated on {generatedAtIst}</Text>
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
 * - Header: dietitian banner, customer info cards, product, duration, status
 * - Summary: adherence, dual log counts, weight/BP/sugar highlights, averages
 * - Trends: weight (customer + dietitian series), blood pressure, fasting sugar
 * - Log source legend: names both authors before either section
 * - Customer Daily Log: FOOD_TAKEN (green), FOOD_SKIPPED (amber), collapsed gaps
 * - Dietitian Health Log: 3-day-cadence clinical parameters + remarks
 * - Footer: generation timestamp, page number, branding
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

        <TrendChartsSection data={data} />

        <LogSourceLegend data={data} />

        <View style={styles.sectionHeaderBlock} minPresenceAhead={90}>
          <Text style={styles.sectionTitleTight}>Customer Daily Log</Text>
          <Text style={styles.sectionSubtitle}>
            Nutrition and activity self-logged by the customer each day
          </Text>
        </View>

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

        <DietitianLogSection data={data} />

        <ReportFooter generatedAtIst={data.generatedAtIst} />
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
  /** Most recent weight from either author, whichever is dated later. */
  latestWeight: number | null;
  /** Which author supplied `latestWeight` — shown as card subtext. */
  latestWeightSource: string | null;
  avgActivityMinutes: number | null;
  avgStepCount: number | null;
  avgWaterLiters: number | null;
  latestBp: KitBPTrendPoint | null;
  latestFastingSugar: number | null;
}

/** Aggregate the daily logs into report-level statistics for the summary card. */
function computeSummaryStats(data: KitReportData): SummaryStats {
  let takenCount = 0;
  let weightStart: number | null = null;
  let weightEnd: number | null = null;
  let weightEndDate: string | null = null;
  let activitySum = 0;
  let activityDaysCount = 0;
  let stepSum = 0;
  let stepDaysCount = 0;
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
      weightEndDate = date;
    }
    if (log.physical_activity_minutes !== null) {
      activitySum += log.physical_activity_minutes;
      activityDaysCount++;
    }
    if (log.step_count !== null) {
      stepSum += log.step_count;
      stepDaysCount++;
    }
    if (log.water_intake_liters !== null) {
      waterSum += log.water_intake_liters;
      waterDaysCount++;
    }
  }

  // The Dietitian's own weight readings extend the trend window — the earliest
  // reading from either author anchors the start, the latest anchors the end,
  // so "Weight Trend" reflects everything recorded, not just self-logs.
  const dietitianWeight = data.trends.dietitianWeight;
  const firstDietitianWeight = dietitianWeight[0] ?? null;
  const lastDietitianWeight = dietitianWeight[dietitianWeight.length - 1] ?? null;

  const firstCustomerWeightDate = data.dateRange.find((date) => {
    const log = data.dailyLogsByDate.get(date);
    return log?.status === "FOOD_TAKEN" && log.weight_kg !== null;
  }) ?? null;

  if (
    firstDietitianWeight &&
    (firstCustomerWeightDate === null || firstDietitianWeight.date < firstCustomerWeightDate)
  ) {
    weightStart = firstDietitianWeight.value;
  }

  let latestWeightSource: string | null = weightEnd !== null ? "Customer log" : null;
  if (
    lastDietitianWeight &&
    (weightEndDate === null || lastDietitianWeight.date >= weightEndDate)
  ) {
    weightEnd = lastDietitianWeight.value;
    latestWeightSource = "Dietitian log";
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

  const bpSeries = data.trends.bp;
  const sugarSeries = data.trends.fastingSugar;

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
    latestWeight: weightEnd,
    latestWeightSource,
    avgActivityMinutes:
      activityDaysCount > 0 ? Math.round(activitySum / activityDaysCount) : null,
    avgStepCount: stepDaysCount > 0 ? Math.round(stepSum / stepDaysCount) : null,
    avgWaterLiters:
      waterDaysCount > 0 ? Math.round((waterSum / waterDaysCount) * 10) / 10 : null,
    latestBp: bpSeries[bpSeries.length - 1] ?? null,
    latestFastingSugar: sugarSeries[sugarSeries.length - 1]?.value ?? null,
  };
}

/** Count of days the customer logged anything (taken or skipped). */
function countCustomerLogs(data: KitReportData): number {
  let count = 0;
  for (const date of data.dateRange) {
    if (data.dailyLogsByDate.has(date)) count++;
  }
  return count;
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

/**
 * Compact a large count for a summary card, e.g. 20000 -> "20k". Step counts
 * run into five digits and would otherwise overflow the card's fixed width.
 */
function formatCompactNumber(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  const rounded = Math.round(thousands * 10) / 10;
  return `${rounded}k`;
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
