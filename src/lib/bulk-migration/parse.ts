import * as XLSX from "xlsx";

export type RawRow = Record<string, string>;

/**
 * Normalize a spreadsheet header cell into a stable row key.
 *
 * A trailing parenthetical annotation is stripped so a human-friendly template
 * header such as `allergies (optional)` maps to the same key as `allergies`.
 * This lets the collection sheets label optional fields inline without the
 * client having to keep machine-readable headers intact.
 */
function normalizeHeader(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .replace(/\s+/g, "_");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

/** Parse CSV or Excel buffer into normalized row objects (header row required). */
export function parseSpreadsheetBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): RawRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: false,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  if (matrix.length < 2) return [];

  const headers = (matrix[0] as unknown[]).map((h) =>
    normalizeHeader(cellToString(h)),
  );

  const rows: RawRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] as unknown[];
    const row: RawRow = {};
    let hasValue = false;

    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = cellToString(cells[c]);
      row[key] = val;
      if (val) hasValue = true;
    }

    if (hasValue) rows.push(row);
  }

  // Ignore reference-only sheets if user uploads multi-sheet xlsx — first sheet only
  void fileName;
  return rows;
}

export function parseCsvText(text: string): RawRow[] {
  const workbook = XLSX.read(text, { type: "string", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (matrix.length < 2) return [];

  const headers = (matrix[0] as unknown[]).map((h) =>
    normalizeHeader(cellToString(h)),
  );
  const rows: RawRow[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] as unknown[];
    const row: RawRow = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = cellToString(cells[c]);
      row[key] = val;
      if (val) hasValue = true;
    }
    if (hasValue) rows.push(row);
  }

  return rows;
}
