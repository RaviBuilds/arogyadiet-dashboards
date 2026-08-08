// src/services/ShopReceiptTemplate.tsx
//
// PDF template for a Shop Sale Receipt — the customer-facing proof of purchase
// for one shop order (`addon_orders`), rendered with @react-pdf/renderer.
// Mirrors the visual identity and server-only rendering conventions of
// `KitReportTemplate.tsx` (logo buffer read at module load, StyleSheet, fixed
// footer) so a receipt looks like a sibling of the existing documents.
//
// DELIBERATELY NOT A GST TAX INVOICE. This document has no GSTIN, no HSN codes,
// no CGST/SGST split and no gapless sequential invoice series — all of which a
// compliant Indian tax invoice requires. It is titled "Sale Receipt" and uses
// the order's own short code as its reference so it can never be mistaken for
// one. Upgrading to a tax invoice is an additive change to this template plus a
// real invoice-number sequence.

import fs from "fs";
import path from "path";

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

// Read the logo into a Buffer at module load. @react-pdf/renderer treats a
// plain string `src` as a URL and would try to fetch a filesystem path, so the
// raw Buffer is passed instead. Missing asset degrades to a text-only header
// rather than failing generation.
let LOGO_BUFFER: Buffer | null = null;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
} catch {
  LOGO_BUFFER = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One priced line on the receipt. */
export interface ShopReceiptLine {
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  /** quantity * unitPrice */
  lineTotal: number;
}

/** Everything the receipt renders. Assembled by `ShopReceiptService`. */
export interface ShopReceiptData {
  /** Short human-facing reference, derived from the order id (e.g. "635E8F"). */
  receiptNumber: string;
  /** Full order id, printed small for support lookups. */
  orderId: string;
  /** ISO timestamp the order was created. */
  issuedAt: string;

  /** Issuing clinic name, or null when the order carries no clinic stamp. */
  clinicName: string | null;

  buyerName: string;
  buyerMobile: string | null;
  buyerAddress: string | null;
  /** True for a walk-in counter sale (no subscription). */
  isWalkIn: boolean;

  lines: ShopReceiptLine[];

  /** Sum of line totals before tax/discount/delivery. */
  subtotal: number;
  taxAmount: number;
  taxPercent: number | null;
  discountAmount: number;
  deliveryCharge: number;
  total: number;

  paymentMethod: string | null;
  paymentStatus: string | null;
  /** e.g. "CLINIC_PICKUP" — how the goods were handed over. */
  fulfillmentStatus: string | null;
  /** Name of the staff member who recorded the sale, when known. */
  soldBy: string | null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const COLORS = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  panel: "#f8fafc",
  accent: "#059669",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9.5,
    color: COLORS.body,
    fontFamily: "Helvetica",
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingBottom: 12,
    marginBottom: 16,
  },
  logo: { width: 116, height: 48, objectFit: "contain" },
  brandFallback: { fontSize: 16, fontFamily: "Helvetica-Bold", color: COLORS.ink },
  headerRight: { alignItems: "flex-end" },
  docTitle: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    marginBottom: 2,
  },
  docMeta: { fontSize: 8.5, color: COLORS.muted },

  partyRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  partyCard: {
    flex: 1,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 4,
    padding: 10,
  },
  partyLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.faint,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  partyName: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    marginBottom: 2,
  },
  partyLine: { fontSize: 8.5, color: COLORS.muted, marginBottom: 1 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.ink,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  row: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  td: { fontSize: 9, color: COLORS.body },
  tdName: { fontSize: 9, color: COLORS.ink, fontFamily: "Helvetica-Bold" },
  tdSku: { fontSize: 7.5, color: COLORS.faint },

  colItem: { flex: 3.2 },
  colQty: { flex: 0.8, textAlign: "right" },
  colRate: { flex: 1.2, textAlign: "right" },
  colAmount: { flex: 1.3, textAlign: "right" },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: 232 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3.5,
  },
  totalsLabel: { fontSize: 9, color: COLORS.muted },
  totalsValue: { fontSize: 9, color: COLORS.body },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.ink,
    marginTop: 5,
    paddingTop: 6,
  },
  grandLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: COLORS.ink },
  grandValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.ink },

  paidBadge: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#a7f3d0",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  paidText: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: COLORS.accent },

  notice: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 8,
  },
  noticeText: { fontSize: 7.5, color: COLORS.faint, lineHeight: 1.5 },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 6,
  },
  footerText: { fontSize: 7.5, color: COLORS.faint },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rupee amount with two decimals and thousands separators. */
function money(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Turns FULFILLMENT_STATUS style codes into readable words. */
function humanize(value: string | null): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function ShopReceiptDocument({ data }: { data: ShopReceiptData }) {
  const handover = humanize(data.fulfillmentStatus);
  const method = humanize(data.paymentMethod);
  const isPaid = (data.paymentStatus ?? "").toUpperCase() === "PAID";

  return (
    <Document
      title={`Sale Receipt ${data.receiptNumber}`}
      author="ArogyaDiet"
      subject="Shop sale receipt"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {LOGO_BUFFER ? (
              // react-pdf's Image renders into a PDF, not the DOM, and accepts
              // no alt prop; the jsx-a11y rule cannot tell the two apart.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image style={styles.logo} src={LOGO_BUFFER} />
            ) : (
              <Text style={styles.brandFallback}>ArogyaDiet</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>Sale Receipt</Text>
            <Text style={styles.docMeta}>No. {data.receiptNumber}</Text>
            <Text style={styles.docMeta}>{formatDateTime(data.issuedAt)}</Text>
          </View>
        </View>

        {/* Seller / buyer */}
        <View style={styles.partyRow}>
          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>SOLD BY</Text>
            <Text style={styles.partyName}>
              {data.clinicName ?? "ArogyaDiet"}
            </Text>
            {data.clinicName ? (
              <Text style={styles.partyLine}>ArogyaDiet</Text>
            ) : null}
            {data.soldBy ? (
              <Text style={styles.partyLine}>Recorded by {data.soldBy}</Text>
            ) : null}
          </View>

          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>
              {data.isWalkIn ? "BUYER (WALK-IN)" : "BUYER"}
            </Text>
            <Text style={styles.partyName}>{data.buyerName}</Text>
            {data.buyerMobile ? (
              <Text style={styles.partyLine}>{data.buyerMobile}</Text>
            ) : null}
            {data.buyerAddress ? (
              <Text style={styles.partyLine}>{data.buyerAddress}</Text>
            ) : null}
          </View>
        </View>

        {/* Items */}
        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.colItem]}>ITEM</Text>
          <Text style={[styles.th, styles.colQty]}>QTY</Text>
          <Text style={[styles.th, styles.colRate]}>RATE</Text>
          <Text style={[styles.th, styles.colAmount]}>AMOUNT</Text>
        </View>

        {data.lines.map((line, index) => (
          <View key={`${line.productName}-${index}`} style={styles.row}>
            <View style={styles.colItem}>
              <Text style={styles.tdName}>{line.productName}</Text>
              {line.sku ? <Text style={styles.tdSku}>{line.sku}</Text> : null}
            </View>
            <Text style={[styles.td, styles.colQty]}>{line.quantity}</Text>
            <Text style={[styles.td, styles.colRate]}>
              {money(line.unitPrice)}
            </Text>
            <Text style={[styles.td, styles.colAmount]}>
              {money(line.lineTotal)}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{money(data.subtotal)}</Text>
            </View>

            {data.discountAmount > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Discount</Text>
                <Text style={styles.totalsValue}>
                  -{money(data.discountAmount)}
                </Text>
              </View>
            ) : null}

            {data.taxAmount > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>
                  Tax
                  {data.taxPercent ? ` (${data.taxPercent}%)` : ""}
                </Text>
                <Text style={styles.totalsValue}>{money(data.taxAmount)}</Text>
              </View>
            ) : null}

            {data.deliveryCharge > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Delivery</Text>
                <Text style={styles.totalsValue}>
                  {money(data.deliveryCharge)}
                </Text>
              </View>
            ) : null}

            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={styles.grandValue}>{money(data.total)}</Text>
            </View>
          </View>
        </View>

        {isPaid ? (
          <View style={styles.paidBadge}>
            <Text style={styles.paidText}>
              PAID{method ? ` · ${method}` : ""}
              {handover ? ` · ${handover}` : ""}
            </Text>
          </View>
        ) : null}

        {/* Notice */}
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            This is a sale receipt confirming the items listed above were
            purchased and handed over. It is not a GST tax invoice.
          </Text>
          <Text style={styles.noticeText}>Order reference: {data.orderId}</Text>
        </View>

        {/* Footer — repeats on every page */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            ArogyaDiet · Receipt {data.receiptNumber}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export default ShopReceiptDocument;
