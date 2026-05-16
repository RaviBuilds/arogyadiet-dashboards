"use client";

import { type FC } from "react";

interface OperationsClientTableProps {
  data: any[]; // TODO: Define a proper type for delivery data
}

const OperationsClientTable: FC<OperationsClientTableProps> = ({ data }) => {
  return (
    <div>
      <h2 className="text-xl font-semibold">Operations Client Table</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
};

export default OperationsClientTable;
