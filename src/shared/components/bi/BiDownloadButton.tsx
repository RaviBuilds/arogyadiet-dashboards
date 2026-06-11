"use client";

import { useCallback, useState } from "react";
import { Download, FileSpreadsheet, Image as ImageIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import * as XLSX from "xlsx";

interface ExportDataRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface BiDownloadButtonProps {
  /** Data to export as Excel */
  data: ExportDataRow[];
  /** File name (without extension) */
  fileName: string;
  /** Reference to the chart container for image export */
  chartRef?: React.RefObject<HTMLDivElement | null>;
  /** Custom column headers mapping { dataKey: "Display Name" } */
  columnHeaders?: Record<string, string>;
}

export function BiDownloadButton({
  data,
  fileName,
  chartRef,
  columnHeaders,
}: BiDownloadButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleExcelDownload = useCallback(() => {
    if (!data || data.length === 0) return;

    // Apply column header mapping if provided
    let exportData = data;
    if (columnHeaders) {
      exportData = data.map((row) => {
        const mappedRow: ExportDataRow = {};
        for (const [key, value] of Object.entries(row)) {
          const header = columnHeaders[key] || key;
          mappedRow[header] = value;
        }
        return mappedRow;
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

    // Auto-width columns
    const colWidths = Object.keys(exportData[0] || {}).map((key) => ({
      wch: Math.max(
        key.length,
        ...exportData.map((row) => String(row[key] ?? "").length)
      ) + 2,
    }));
    worksheet["!cols"] = colWidths;

    XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split("T")[0]}.xlsx`);
    setIsOpen(false);
  }, [data, fileName, columnHeaders]);

  const handleImageDownload = useCallback(async () => {
    if (!chartRef?.current) return;

    try {
      // Dynamically import html2canvas
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });

      const link = document.createElement("a");
      link.download = `${fileName}_${new Date().toISOString().split("T")[0]}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      // Fallback: try SVG export from recharts
      const svgElement = chartRef.current.querySelector("svg");
      if (svgElement) {
        const svgData = new XMLSerializer().serializeToString(svgElement);
        const blob = new Blob([svgData], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${fileName}_${new Date().toISOString().split("T")[0]}.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    }
    setIsOpen(false);
  }, [chartRef, fileName]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 text-xs h-8"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1.5" align="end" sideOffset={4}>
        <button
          onClick={handleExcelDownload}
          disabled={!data || data.length === 0}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
          Download Excel
        </button>
        {chartRef && (
          <button
            onClick={handleImageDownload}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
          >
            <ImageIcon className="h-3.5 w-3.5 text-blue-600" />
            Download Image
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
