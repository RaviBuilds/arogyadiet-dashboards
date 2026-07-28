// src/services/DietitianReportTemplate.tsx
//
// PDF template components for the per-customer Report_Card, rendered with
// @react-pdf/renderer. Mirrors the structure of `KitReportTemplate.tsx`
// (header, summary, body sections, fixed footer) but for the Report_Card's
// own sections: parameter table, Weight/BP/Fasting Sugar trend charts,
// adherence summary and reverse-chronological Closing_Comment history.
//
// The data shape (`DietitianReportData`) is declared here — not in the
// service — exactly as `KitReportData` is declared in `KitReportTemplate.tsx`,
// so `DietitianReportService.ts` (task 7.17) only ever imports the document
// component plus this type.
//
// Requirements: 19.2, 19.3, 19.4, 19.5, 19.7

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
import type {
  CustomerCategory,
  CustomParameter,
  ParameterValue,
} from "@/types/dietitian";

// Logo read once at module load, mirroring KitReportTemplate — this template
// only ever renders server-side via renderToBuffer in DietitianReportService.
let LOGO_BUFFER: Buffer | null = null;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
} catch {
  LOGO_BUFFER = null;
}

// ---------------------------------------------------------------------------
// Types — the Report_Card data shape (Req 19.2, 19.3, 19.4, 19.5, 19.7)
// ---------------------------------------------------------------------------

/** One date-ordered row of the parameter table (Req 19.2). */
export interface ReportCardParameterRow {
  logDate: string; // YYYY-MM-DD
  authorType: "DIETITIAN" | "CUSTOMER";
  authorName: string | null;
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
}

/** One dated Weight or Fasting Sugar trend point (Req 19.3). */
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

/** The Weight / BP / Fasting Sugar trend series (Req 19.3). */
export interface ReportCardTrends {
  weight: TrendPoint[];
  bp: BPTrendPoint[];
  fastingSugar: TrendPoint[];
}

/** The adherence summary (Req 19.4). */
export interface ReportCardAdherenceSummary {
  dietitianLogCount: number;
  pendingLogCount: number;
  selfLogCount: number;
  skippedSelfLogCount: number;
  pausedDaysCount: number;
}

/** One Closing_Comment history entry, reverse-chronological (Req 19.5). */
export interface ClosingCommentEntry {
  logDate: string; // YYYY-MM-DD
  comment: string;
  authorName: string | null;
  submittedAt: string; // ISO 8601
}

/** The full Report_Card data assembled by `DietitianReportService`. */
export interface DietitianReportData {
  customerName: string;
  customerCode: string | null;
  category: CustomerCategory;
  assignedDietitianName: string | null;
  /** Generation timestamp, pre-formatted in IST (Req 19.7). */
  generatedAtIst: string;
  parameterTable: ReportCardParameterRow[];
  trends: ReportCardTrends;
  adherence: ReportCardAdherenceSummary;
  closingComments: ClosingCommentEntry[];
}

// ---------------------------------------------------------------------------
// Brand colors — mirrors KitReportTemplate's slate/emerald palette
// ---------------------------------------------------------------------------

const COLORS = {
  primary: "#059669",
  primaryLight: "#ECFDF5",
  emerald: "#059669",
  emeraldBorder: "#A7F3D0",
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  amber: "#D97706",
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
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  infoCard: {
    flex: 1,
    minWidth: "22%",
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.slate900,
    marginBottom: 8,
    marginTop: 4,
  },
  // Adherence summary
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
  // Parameter table entries
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
  entryAuthorBadgeDietitian: {
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
  entryAuthorBadgeCustomer: {
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
  noParametersText: {
    fontSize: 7.5,
    color: COLORS.slate400,
    fontStyle: "italic",
  },
  // Closing comment history
  commentCard: {
    marginBottom: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.slate200,
    borderRadius: 6,
    backgroundColor: COLORS.slate50,
  },
  commentHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  commentDate: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLORS.slate900,
  },
  commentAuthor: {
    fontSize: 7.5,
    color: COLORS.slate500,
  },
  commentText: {
    fontSize: 8,
    color: COLORS.slate700,
    lineHeight: 1.4,
  },
  emptySectionText: {
    fontSize: 8.5,
    color: COLORS.slate400,
    fontStyle: "italic",
    marginBottom: 10,
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

function ReportHeader({ data }: { data: DietitianReportData }) {
  return (
    <View style={styles.headerContainer}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.headerTitle}>Report Card</Text>
          <Text style={styles.headerSubtitle}>
            Health log history, trends and adherence summary
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
          <Text style={styles.infoLabel}>Customer Code</Text>
          <Text style={styles.infoValue}>{data.customerCode ?? "—"}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Category</Text>
          <Text style={styles.infoValue}>{data.category}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Dietitian</Text>
          <Text style={styles.infoValue}>{data.assignedDietitianName ?? "Unassigned"}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Generated</Text>
          <Text style={styles.infoValue}>{data.generatedAtIst}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Adherence summary (Req 19.4)
// ---------------------------------------------------------------------------

function AdherenceSummarySection({ data }: { data: DietitianReportData }) {
  const a = data.adherence;
  return (
    <View style={styles.summaryContainer} wrap={false}>
      <Text style={styles.sectionTitle}>Adherence Summary</Text>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Dietitian Logs</Text>
          <Text style={styles.summaryValue}>{a.dietitianLogCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pending Logs</Text>
          <Text style={styles.summaryValue}>{a.pendingLogCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Self Logs</Text>
          <Text style={styles.summaryValue}>{a.selfLogCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Skipped Self Logs</Text>
          <Text style={styles.summaryValue}>{a.skippedSelfLogCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Paused Days</Text>
          <Text style={styles.summaryValue}>{a.pausedDaysCount}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Trend charts (Req 19.3) — simple SVG line charts, no external chart lib
// ---------------------------------------------------------------------------

const CHART_WIDTH = 150;
const CHART_HEIGHT = 70;
const CHART_PAD = 6;

/** Maps a value onto the chart's y-axis (inverted — SVG y grows downward). */
function scaleY(value: number, min: number, max: number): number {
  if (max === min) return CHART_HEIGHT / 2;
  const t = (value - min) / (max - min);
  return CHART_PAD + (1 - t) * (CHART_HEIGHT - 2 * CHART_PAD);
}

/** Maps an index over `count` points onto the chart's x-axis. */
function scaleX(index: number, count: number): number {
  if (count <= 1) return CHART_WIDTH / 2;
  return CHART_PAD + (index / (count - 1)) * (CHART_WIDTH - 2 * CHART_PAD);
}

/** Single-series line chart for Weight or Fasting Sugar. */
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

/** Two-series line chart for BP (systolic + diastolic share one y-scale). */
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

function TrendChartsSection({ data }: { data: DietitianReportData }) {
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
// Parameter table (Req 19.2)
// ---------------------------------------------------------------------------

/** Formats one recorded parameter value using the shared field table for units. */
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

function ParameterEntryCard({ row }: { row: ReportCardParameterRow }) {
  const keys = Object.keys(row.parameters);
  const hasCustomParameters = row.customParameters.length > 0;

  return (
    <View style={styles.entryCard} wrap={false}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>{formatDisplayDate(row.logDate)}</Text>
        <Text
          style={
            row.authorType === "DIETITIAN"
              ? styles.entryAuthorBadgeDietitian
              : styles.entryAuthorBadgeCustomer
          }
        >
          {row.authorType === "DIETITIAN"
            ? row.authorName
              ? `Dietitian · ${row.authorName}`
              : "Dietitian"
            : "Self Log"}
        </Text>
      </View>

      {keys.length === 0 && !hasCustomParameters ? (
        <Text style={styles.noParametersText}>No parameter values recorded</Text>
      ) : (
        <View style={styles.fieldsGrid}>
          {keys.map((key) => {
            const field = fieldByKey(key);
            const label = field?.label ?? key;
            return (
              <View style={styles.fieldItem} key={key}>
                <Text style={styles.fieldLabel}>{label}:</Text>
                <Text style={styles.fieldValue}>{formatParameterValue(row.parameters[key])}</Text>
              </View>
            );
          })}
          {row.customParameters.map((cp, i) => (
            <View style={styles.fieldItem} key={`custom-${i}-${cp.label}`}>
              <Text style={styles.fieldLabel}>{cp.label}:</Text>
              <Text style={styles.fieldValue}>
                {cp.value}
                {cp.unit ? ` ${cp.unit}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ParameterTableSection({ data }: { data: DietitianReportData }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Health Log History</Text>
      {data.parameterTable.length === 0 ? (
        <Text style={styles.emptySectionText}>No health logs recorded yet</Text>
      ) : (
        data.parameterTable.map((row, i) => (
          <ParameterEntryCard row={row} key={`${row.logDate}-${i}`} />
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Closing_Comment history (Req 19.5) — reverse chronological, author-labelled
// ---------------------------------------------------------------------------

function ClosingCommentHistorySection({ data }: { data: DietitianReportData }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Closing Comment History</Text>
      {data.closingComments.length === 0 ? (
        <Text style={styles.emptySectionText}>No closing comments recorded</Text>
      ) : (
        data.closingComments.map((entry, i) => (
          <View style={styles.commentCard} key={`${entry.logDate}-${i}`} wrap={false}>
            <View style={styles.commentHeaderRow}>
              <Text style={styles.commentDate}>{formatDisplayDate(entry.logDate)}</Text>
              <Text style={styles.commentAuthor}>{entry.authorName ?? "Unknown"}</Text>
            </View>
            <Text style={styles.commentText}>{entry.comment}</Text>
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function ReportFooter() {
  return (
    <View style={styles.footer} fixed>
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
 * Full Report_Card PDF document.
 *
 * Structure (Req 19.7 — every element the export must include):
 * - Header: customer name, customer code, Customer_Category, assigned
 *   Dietitian name, generation timestamp in IST
 * - Adherence summary
 * - Trend charts: Weight, BP, Fasting Sugar
 * - Parameter table: date-ordered Health_Log entries
 * - Closing_Comment history: reverse-chronological, author-labelled
 * - Footer: branding and page number
 */
export function DietitianReportDocument({ data }: { data: DietitianReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {LOGO_BUFFER && <Image src={LOGO_BUFFER} style={styles.watermark} fixed />}

        <ReportHeader data={data} />
        <AdherenceSummarySection data={data} />
        <TrendChartsSection data={data} />
        <ParameterTableSection data={data} />
        <ClosingCommentHistorySection data={data} />

        <ReportFooter />
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
