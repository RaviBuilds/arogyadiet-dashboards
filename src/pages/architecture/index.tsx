import type { GetServerSideProps } from "next";
import { promises as fs } from "fs";
import path from "path";
import { ArchitectureViewer, type ArchDoc } from "./viewer";

/**
 * TEMPORARY architecture viewer (isolation contract):
 * - Reads the READ-ONLY markdown sources from architecture-analysis/ at request time.
 * - Served from the root-level Pages Router so it never touches src/app/**.
 * - Publicly accessible: src/middleware.ts already returns early for /architecture*.
 * - Cleanup when done: delete pages/ + remove the /architecture bypass in middleware.
 */

const DOC_LIST: { slug: string; title: string; file: string }[] = [
  { slug: "master", title: "Master Product Map", file: "01-master-product-map.md" },
  { slug: "customer", title: "Customer", file: "02-customer-feature-map.md" },
  { slug: "rider", title: "Rider", file: "03-rider-feature-map.md" },
  { slug: "admin", title: "Admin", file: "04-admin-feature-map.md" },
  { slug: "franchise", title: "Franchise", file: "05-franchise-feature-map.md" },
  { slug: "master-portal", title: "Master", file: "06-master-feature-map.md" },
  { slug: "shared", title: "Shared Features", file: "07-shared-features.md" },
  { slug: "status", title: "Feature Status", file: "08-feature-status.md" },
  { slug: "models", title: "Models", file: "09-model-feature-links.md" },
];

async function readDoc(file: string): Promise<string> {
  try {
    return await fs.readFile(
      path.join(process.cwd(), "architecture-analysis", file),
      "utf8",
    );
  } catch {
    return `# Document unavailable\n\nCould not read \`architecture-analysis/${file}\`.`;
  }
}

export const getServerSideProps: GetServerSideProps<{
  docs: ArchDoc[];
  initialView: string;
}> = async (context) => {
  const docs = await Promise.all(
    DOC_LIST.map(async (d) => ({
      slug: d.slug,
      title: d.title,
      markdown: await readDoc(d.file),
    })),
  );

  const raw = context.query.view;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const valid = DOC_LIST.some((d) => d.slug === requested);
  const initialView = valid && requested ? requested : "master";

  return { props: { docs, initialView } };
};

export default function ArchitecturePage({
  docs,
  initialView,
}: {
  docs: ArchDoc[];
  initialView: string;
}) {
  return <ArchitectureViewer docs={docs} initialView={initialView} />;
}
