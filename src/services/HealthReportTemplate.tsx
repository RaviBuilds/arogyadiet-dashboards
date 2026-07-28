// src/services/HealthReportTemplate.tsx
//
// PDF template for the Health Report — used for a MEAL subscription and for an
// ACCOMMODATION stay,
// rendered with @react-pdf/renderer. Shares the KIT report's visual identity
// (emerald/slate palette, logo header, faint watermark, fixed footer, info-card
// grid, summary cards) so a meal customer's report looks like a sibling of the
// KIT report — but the body is the Dietitian-authored health-log history for
// the subscription, not KIT daily logs.
//
// Only DIETITIAN-authored values appear here (the assembling service filters
// to `author_type = 'DIETITIAN'`), and the assigned Dietitian's name is shown
// prominently in the header.

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
import type { CustomParameter, ParameterValue } from "@/types/dietitian";

// Logo read once at module load, mirroring KitReportTemplate — this template
// only ever renders server-side via renderToBuffer in HealthReportService.
let LOGO_BUFFER: Buffer | null = null;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
} catch {
  LOGO_BUFFER = null;
}

// ---------------------------------------------------------------------------
// Types — the report data shape
// ---------------------------------------------------------------------------

/** One dated Weight or Fasting Sugar trend point. */
export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** One dated BP trend point — the composite parameter carries both readings. */
export interface BPTrendPoint {
  date: string; // YYYY-MM-DD
  systolic: number;
  diastolic: number;
}

/** The Weight / BP / Fasting Sugar trend series. */
export interface HealthReportTrends {
  weight: TrendPoint[];
  bp: BPTrendPoint[];
  fastingSugar: TrendPoint[];
}

/** One date-ordered row of the Dietitian health-log parameter table. */
export interface HealthReportLogEntry {
  logDate: string; // YYYY-MM-DD
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string | null;
}

/** The full data the health report renders. */
export interface HealthReportData {
  customerName: string;
  /** The plan / package / stay name shown in the second info card. */
  planName: string;
  /** Label for that card — "Plan" for a meal subscription, "Stay" for a stay. */
  planLabel?: string;
  /** Sub-heading under the report title. */
  reportSubtitle?: string;
  subscriptionCode: string | null;
  dietitianName: string | null;
  durationDays: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  status: string;
  generatedAtIst: string;
  totalDietitianLogs: number;
  trends: HealthReportTrends;
  entries: HealthReportLogEntry[];
}

// ---------------------------------------------------------------------------
// Brand colors — mirrors KitReportTemplate's slate/emerald palette
// ---------------------------------------------------------------------------

const COLORS = {
  primary: "#059669",
  primaryLight: "#ECFDF5",
  emerald: "#059669",
  emeraldLight: "#ECFDF5",
  emeraldBorder: "#A7F3D0",
  amber: "#D97706",
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
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 56,
    fontSize: 9,
    fontFamily: "Helvetica",
    backgroundColor: COLORS.white,
  },
  watermark: {
    position: "absolute",
    top: 335,
    left: "15%",
    width: "70%",
    opacity: 0.1,
  },
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
    height: 38,
  },
  // Dietitian banner — the assigned Dietitian's name shown prominently at the
  // very top of the report body, per the requirement.
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
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  infoCard: {
    flex: 1,
    minWidth: "30%",
    padding: 10,
    backgroundColor: COLORS.slate50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.slate200,
  },
  infoLabel: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: COLORS.slate500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 10.5,
    fontWeight: "bold",
    color: COLORS.slate900,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
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
  statusBadgeInactive: {
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
  statusTextInactive: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 8,
    marginTop: 4,
  },
  // Summary
  summaryContainer: {
    marginBottom: 14,
    padding: 12,
    backgroundColor: COLORS.slate50,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 8,
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
  // Trend charts
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
    gap: 10,
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
  // Health-log entry cards
  entryCard: {
    marginBottom: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.white,
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.slate200,
  },
  entryDate: {
    fontSize: 9.5,
    fontWeight: "bold",
    color: COLORS.slate900,
  },
  entryBadge: {
    fontSize: 7,
    fontWeight: "bold",
    color: COLORS.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
    backgroundColor: COLORS.primaryLight,
  },
  fieldsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  fieldItem: {
    width: "33.33%",
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 1.5,
    paddingRight: 6,
  },
  // Full-width row for long free-text parameters (e.g. Dietitian/Doctor
  // Remarks, Any Emergency Medication) so the value wraps beneath its label
  // instead of overflowing its column and colliding with the next one.
  fieldItemFull: {
    width: "100%",
    flexDirection: "column",
    paddingVertical: 2,
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
    flex: 1,
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
    paddingVertical: 24,
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
// Header
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(["ACTIVE"]);

function ReportHeader({ data }: { data: HealthReportData }) {
  const isActive = ACTIVE_STATUSES.has(data.status.toUpperCase());
  return (
    <View style={styles.headerContainer}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.headerTitle}>Health Report</Text>
          <Text style={styles.headerSubtitle}>
            {data.reportSubtitle ??
              "Dietitian-recorded health tracking for your meal subscription"}
          </Text>
        </View>
        {LOGO_BUFFER && <Image src={LOGO_BUFFER} style={styles.headerLogo} />}
      </View>

      {/* Assigned Dietitian shown at the top, per requirement. */}
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
          <Text style={styles.infoLabel}>{data.planLabel ?? "Plan"}</Text>
          <Text style={styles.infoValue}>{data.planName}</Text>
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
        {data.endDate && (
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>End Date</Text>
            <Text style={styles.infoValue}>{formatDisplayDate(data.endDate)}</Text>
          </View>
        )}
        <View style={isActive ? styles.statusBadgeActive : styles.statusBadgeInactive}>
          <Text style={isActive ? styles.statusTextActive : styles.statusTextInactive}>
            {data.status}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function ReportSummary({ data }: { data: HealthReportData }) {
  const weightStart = data.trends.weight[0]?.value ?? null;
  const weightEnd = data.trends.weight[data.trends.weight.length - 1]?.value ?? null;
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

  const latestBp = data.trends.bp[data.trends.bp.length - 1];
  const latestSugar = data.trends.fastingSugar[data.trends.fastingSugar.length - 1];

  return (
    <View style={styles.summaryContainer} wrap={false}>
      <Text style={styles.sectionTitle}>Summary</Text>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCardHighlight}>
          <Text style={styles.summaryLabel}>Dietitian Logs</Text>
          <Text style={styles.summaryValueHighlight}>{data.totalDietitianLogs}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Weight Trend</Text>
          <Text style={styles.summaryValue}>{weightTrendLabel}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest BP</Text>
          <Text style={styles.summaryValue}>
            {latestBp ? `${latestBp.systolic}/${latestBp.diastolic}` : "—"}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest Fasting Sugar</Text>
          <Text style={styles.summaryValue}>
            {latestSugar ? `${latestSugar.value} mg/dL` : "—"}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest Weight</Text>
          <Text style={styles.summaryValue}>
            {weightEnd !== null ? `${weightEnd} kg` : "—"}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Duration</Text>
          <Text style={styles.summaryValue}>{data.durationDays} days</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Trend charts — simple SVG line charts, no external chart lib
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

function SingleTrendChart({
  title,
  points,
  color,
  unit,
}: {
  title: string;
  points: readonly TrendPoint[];
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
        <Line
          x1={CHART_PAD}
          y1={CHART_HEIGHT - CHART_PAD}
          x2={CHART_WIDTH - CHART_PAD}
          y2={CHART_HEIGHT - CHART_PAD}
          stroke={COLORS.slate200}
          strokeWidth={0.5}
        />
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
        <Text style={styles.trendAxisText}>{formatDisplayDate(points[points.length - 1].date)}</Text>
      </View>
      <Text style={styles.trendAxisText}>
        Range: {min}
        {unit} – {max}
        {unit}
      </Text>
    </View>
  );
}

function BPTrendChart({ points }: { points: readonly BPTrendPoint[] }) {
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
        <Line
          x1={CHART_PAD}
          y1={CHART_HEIGHT - CHART_PAD}
          x2={CHART_WIDTH - CHART_PAD}
          y2={CHART_HEIGHT - CHART_PAD}
          stroke={COLORS.slate200}
          strokeWidth={0.5}
        />
        {points.length > 1 && (
          <>
            <Polyline points={systolicLine} stroke={COLORS.amber} strokeWidth={1.5} fill="none" />
            <Polyline points={diastolicLine} stroke={COLORS.blue} strokeWidth={1.5} fill="none" />
          </>
        )}
        {points.map((p, i) => (
          <React.Fragment key={p.date}>
            <Circle cx={scaleX(i, points.length)} cy={scaleY(p.systolic, min, max)} r={1.6} fill={COLORS.amber} />
            <Circle cx={scaleX(i, points.length)} cy={scaleY(p.diastolic, min, max)} r={1.6} fill={COLORS.blue} />
          </React.Fragment>
        ))}
      </Svg>
      <View style={styles.trendAxisRow}>
        <Text style={styles.trendAxisText}>{formatDisplayDate(points[0].date)}</Text>
        <Text style={styles.trendAxisText}>{formatDisplayDate(points[points.length - 1].date)}</Text>
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

function TrendChartsSection({ data }: { data: HealthReportData }) {
  const hasAnyTrend =
    data.trends.weight.length > 0 ||
    data.trends.bp.length > 0 ||
    data.trends.fastingSugar.length > 0;
  if (!hasAnyTrend) return null;

  return (
    <View style={styles.trendContainer} wrap={false}>
      <Text style={styles.sectionTitle}>Trends</Text>
      <View style={styles.trendRow}>
        <SingleTrendChart title="Weight" points={data.trends.weight} color={COLORS.emerald} unit="kg" />
        <BPTrendChart points={data.trends.bp} />
        <SingleTrendChart
          title="Fasting Sugar"
          points={data.trends.fastingSugar}
          color={COLORS.amber}
          unit="mg/dL"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Health-log entry cards
// ---------------------------------------------------------------------------

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

function LogEntryCard({ entry }: { entry: HealthReportLogEntry }) {
  const allKeys = Object.keys(entry.parameters);
  // Free-text parameters get a full-width row so long values wrap cleanly;
  // everything else stays in the compact 3-column grid.
  const gridKeys = allKeys.filter((key) => fieldByKey(key)?.kind !== "text");
  const textKeys = allKeys.filter((key) => fieldByKey(key)?.kind === "text");
  const hasCustom = entry.customParameters.length > 0;
  const comment = entry.closingComment?.trim();

  return (
    <View style={styles.entryCard} wrap={false}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>{formatDisplayDate(entry.logDate)}</Text>
        <Text style={styles.entryBadge}>Dietitian Log</Text>
      </View>

      {allKeys.length === 0 && !hasCustom ? (
        <Text style={styles.noParametersText}>No parameter values recorded</Text>
      ) : (
        <>
          <View style={styles.fieldsGrid}>
            {gridKeys.map((key) => {
              const field = fieldByKey(key);
              const label = field?.label ?? key;
              return (
                <View style={styles.fieldItem} key={key}>
                  <Text style={styles.fieldLabel}>{label}:</Text>
                  <Text style={styles.fieldValue}>{formatParameterValue(entry.parameters[key])}</Text>
                </View>
              );
            })}
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
          {textKeys.map((key) => {
            const field = fieldByKey(key);
            const label = field?.label ?? key;
            return (
              <View style={styles.fieldItemFull} key={key}>
                <Text style={styles.fieldLabel}>{label}:</Text>
                <Text style={styles.fieldValueFull}>
                  {formatParameterValue(entry.parameters[key])}
                </Text>
              </View>
            );
          })}
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

function LogEntriesSection({ data }: { data: HealthReportData }) {
  return (
    <View>
      {/* minPresenceAhead keeps the heading from being stranded alone at the
          bottom of a page — it breaks to the next page unless there's room for
          the first entry to follow it. */}
      <Text style={styles.sectionTitle} minPresenceAhead={90}>
        Health Log History
      </Text>
      {data.entries.length === 0 ? (
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateText}>
            Your dietitian has not recorded any health logs for this subscription yet.
          </Text>
        </View>
      ) : (
        data.entries.map((entry, i) => <LogEntryCard entry={entry} key={`${entry.logDate}-${i}`} />)
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

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

export function HealthReportDocument({ data }: { data: HealthReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {LOGO_BUFFER && <Image src={LOGO_BUFFER} style={styles.watermark} fixed />}

        <ReportHeader data={data} />
        <ReportSummary data={data} />
        <TrendChartsSection data={data} />
        <LogEntriesSection data={data} />

        <ReportFooter generatedAtIst={data.generatedAtIst} />
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format YYYY-MM-DD to a more readable display format (DD MMM YYYY). */
function formatDisplayDate(dateStr: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [year, month, day] = dateStr.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}
