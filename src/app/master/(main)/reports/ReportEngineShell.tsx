"use client";

import { useState, useTransition } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  FileBarChart,
  Download,
  Play,
  Calendar,
} from "lucide-react";
import { generateReport } from "@/actions/master-actions/biReportActions";
import type {
  ReportSegment,
  TimeframeFormat,
  ReportResult,
  ReportTrendPoint,
} from "@/types/bi-dashboard";
import { Button } from "@/components/ui/button";

const SEGMENTS: { value: ReportSegment; label: string }[] = [
  { value: "customers", label: "Customers" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "finance", label: "Finance" },
  { value: "inventory", label: "Inventory" },
];

const TIMEFRAMES: { value: TimeframeFormat; label: string; description: string }[] = [
  { value: "wow", label: "Week-over-Week", description: "Last 12 weeks side-by-side" },
  { value: "mom", label: "Month-over-Month", description: "Last 12 months side-by-side" },
  { value: "yoy", label: "Year-over-Year", description: "Last 3 years comparison" },
];

export default function ReportEngineShell() {
  const [segment, setSegment] = useState<ReportSegment>("finance");
  const [timeframe, setTimeframe] = useState<TimeframeFormat>("mom");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    startTransition(async () => {
      const data = await generateReport({ segment, timeframe });
      setResult(data);
    });
  };

  const handleExport = () => {
    if (!result) return;

    const headers = ["Period", "Value"];
    const rows = result.trendData.map((d) => `${d.period},${d.value}`);
    const csv = [headers.join(","), ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${segment}_${timeframe}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <FileBarChart className="h-4 w-4 text-red-600" />
          <h3 className="text-sm font-semibold text-slate-800">Report Configuration</h3>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Segment Selector */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">
              1. Business Segment
            </label>
            <div className="flex flex-wrap gap-2">
              {SEGMENTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSegment(s.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    segment === s.value
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe Selector */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">
              2. Timeframe Format
            </label>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTimeframe(t.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    timeframe === t.value
                      ? "bg-red-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {TIMEFRAMES.find((t) => t.value === timeframe)?.description}
            </p>
          </div>

          {/* Generate Button */}
          <div className="flex items-end">
            <Button
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white gap-2 h-11"
            >
              {isPending ? (
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Generate Report
            </Button>
          </div>
        </div>
      </div>

      {/* Report Output */}
      {result && (
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                {SEGMENTS.find((s) => s.value === segment)?.label} —{" "}
                {TIMEFRAMES.find((t) => t.value === timeframe)?.label}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {result.totalRecords.toLocaleString("en-IN")} total records · Generated{" "}
                {new Date(result.generatedAt).toLocaleString("en-IN")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-2 border-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </Button>
          </div>

          {/* Trend Chart */}
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.trendData} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => {
                    if (segment === "finance") {
                      return v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v}`;
                    }
                    return v.toLocaleString();
                  }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    fontSize: "12px",
                  }}
                  formatter={(value) => {
                    if (segment === "finance") {
                      return [`₹${Number(value).toLocaleString("en-IN")}`, "Revenue"];
                    }
                    return [Number(value).toLocaleString("en-IN"), result.trendData[0]?.label || "Count"];
                  }}
                />
                <Bar
                  dataKey="value"
                  name={result.trendData[0]?.label || "Value"}
                  fill={segment === "finance" ? "#059669" : "#dc2626"}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Data Table Preview */}
          <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-auto max-h-[200px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2.5 px-4 text-xs font-semibold text-slate-500 uppercase">
                      Period
                    </th>
                    <th className="text-right py-2.5 px-4 text-xs font-semibold text-slate-500 uppercase">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.trendData.map((point, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2 px-4 text-sm text-slate-700">
                        {point.period}
                      </td>
                      <td className="py-2 px-4 text-right text-sm font-semibold text-slate-800">
                        {segment === "finance"
                          ? `₹${point.value.toLocaleString("en-IN")}`
                          : point.value.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
