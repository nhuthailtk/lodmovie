import Explorer from "@/components/explorer";
import { PageHeader } from "@/components/ui";
import { MO, RESOURCE } from "@/lib/config";
import { isSafeIri } from "@/lib/rdf";

export const metadata = { title: "Explore the graph" };

const DEFAULT = `${RESOURCE}movie/tt0107290`;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { uri } = await searchParams;
  const candidate = typeof uri === "string" ? uri : "";
  const start = isSafeIri(candidate) && (candidate.startsWith(RESOURCE) || candidate.startsWith(MO)) ? candidate : DEFAULT;
  return (
    <div>
      <PageHeader eyebrow="Explore" title="Triple explorer">
        <p>
          Every circle is a resource and every arrow a triple. Click a node to load its neighbours, drag to rearrange, double-click to open its page.
          Dashed circles are other datasets reached through <code>owl:sameAs</code> — the 5th star.
        </p>
      </PageHeader>
      <Explorer start={start} />
    </div>
  );
}
