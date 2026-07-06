// src/services/KitReportTemplate.tsx
//
// PDF template components for KIT report generation using @react-pdf/renderer.
// Renders a day-wise breakdown of daily log data for a KIT subscription period.
//
// Premium design with clear visual hierarchy, branded colors, and organized layout.
//
// Requirements: 9.2, 9.3, 9.4, 10.2, 10.3

import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from "@react-pdf/renderer";

import type { KitDailyLogRow } from "@/repositories/kitLifecycleRepository";

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
  primary: "#E74C3C", // Brand red
  primaryLight: "#FEF2F2",
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
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    backgroundColor: COLORS.white,
  },
  // Header Section
  headerContainer: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
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
    marginBottom: 12,
    marginTop: 8,
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
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
    borderRadius: 6,
    backgroundColor: COLORS.emeraldLight,
  },
  dayEntrySkipped: {
    marginBottom: 8,
    padding: 10,
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
    marginBottom: 6,
    paddingBottom: 6,
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
  // Fields Grid
  fieldsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  },
  fieldItem: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },
  fieldLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate600,
    marginRight: 4,
  },
  fieldValue: {
    fontSize: 8,
    color: COLORS.slate900,
  },
  // Summary Section
  summaryContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: COLORS.slate50,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 8,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  summaryCard: {
    width: "47%",
    padding: 10,
    backgroundColor: COLORS.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.slate200,
  },
  summaryLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.slate900,
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
      <Text style={styles.headerTitle}>KIT Report</Text>
      <Text style={styles.headerSubtitle}>
        Daily nutrition and activity tracking report
      </Text>

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
    <View style={styles.dayEntryTaken}>
      <View style={styles.dayHeaderTaken}>
        <Text style={styles.dayDate}>{formatDisplayDate(date)}</Text>
        <Text style={styles.dayStatusTaken}>Food Taken</Text>
      </View>
      <View style={styles.fieldsGrid}>
        {renderField("Weight (kg)", log.weight_kg)}
        {renderField("Steps", log.step_count)}
        {renderField("Activity (min)", log.physical_activity_minutes)}
        {renderField("Activity Name", log.physical_activity_name)}
        {renderField("Water (L)", log.water_intake_liters)}
        {renderField("Buttermilk", log.buttermilk_intake)}
        {renderField("Fat Consumption", log.fat_consumption)}
        {renderField("Main Dish", log.main_dish)}
        {renderField("Protein Curry", log.protein_curry)}
        {renderField("Veg Curry", log.veg_curry)}
        {renderField("Soup", log.soup_name_qty)}
        {renderField("Eggs", log.eggs_count)}
        {renderField("Salads", log.salads_qty)}
      </View>
    </View>
  );
}

/** Day-wise entry for FOOD_SKIPPED — shows date + status only */
function FoodSkippedEntry({ date }: { date: string }) {
  return (
    <View style={styles.dayEntrySkipped}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayDate}>{formatDisplayDate(date)}</Text>
        <Text style={styles.dayStatusSkipped}>Food Skipped</Text>
      </View>
    </View>
  );
}

/** Day-wise entry for missing days — shows "No Data Logged" */
function NoDataEntry({ date }: { date: string }) {
  return (
    <View style={styles.dayEntry}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayDate}>{formatDisplayDate(date)}</Text>
        <Text style={styles.dayStatusNoData}>No Data Logged</Text>
      </View>
    </View>
  );
}

/** Summary section for EXPIRED KITs */
function ReportSummary({ data }: { data: KitReportData }) {
  // Count FOOD_TAKEN days from dailyLogsByDate
  let totalDaysTakenMeal = 0;
  data.dailyLogsByDate.forEach((log) => {
    if (log.status === "FOOD_TAKEN") {
      totalDaysTakenMeal++;
    }
  });

  const totalDuration = data.durationDays + data.totalSkippedDays;

  return (
    <View style={styles.summaryContainer}>
      <Text style={styles.summaryTitle}>Summary</Text>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Meals Taken</Text>
          <Text style={styles.summaryValue}>{totalDaysTakenMeal}</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Days Skipped</Text>
          <Text style={styles.summaryValue}>{data.totalSkippedDays}</Text>
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
    </View>
  );
}

/** Page footer with branding and generation timestamp */
function ReportFooter() {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        Generated on {formatDisplayDate(getTodayDateString())}
      </Text>
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
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <ReportHeader data={data} />

        <Text style={styles.sectionTitle}>Daily Log</Text>

        {data.dateRange.map((date) => {
          const log = data.dailyLogsByDate.get(date);

          if (!log) {
            return <NoDataEntry key={date} date={date} />;
          }

          if (log.status === "FOOD_TAKEN") {
            return <FoodTakenEntry key={date} date={date} log={log} />;
          }

          // FOOD_SKIPPED — show only date and status
          return <FoodSkippedEntry key={date} date={date} />;
        })}

        {data.status === "EXPIRED" && <ReportSummary data={data} />}

        <ReportFooter />
      </Page>
    </Document>
  );
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
  if (value === null || value === undefined) return null;
  return (
    <View style={styles.fieldItem}>
      <Text style={styles.fieldLabel}>{label}:</Text>
      <Text style={styles.fieldValue}>{String(value)}</Text>
    </View>
  );
}
