import { Link } from "@/lib/router";

interface RelatedRef {
  id: string;
  name: string;
  known: boolean;
}

interface RelatedEvent {
  event: string;
  direction: "publish" | "wait";
  feature: RelatedRef;
}

interface Related {
  subflows: RelatedRef[];
  dependents: RelatedRef[];
  details: RelatedRef[];
  detailedIn: RelatedRef[];
  events: RelatedEvent[];
}

function RefList({ refs }: { refs: RelatedRef[] }) {
  if (refs.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="list-disc pl-5 text-sm">
      {refs.map((r) => (
        <li key={r.id}>
          {r.known ? (
            <Link to={`/features/${encodeURIComponent(r.id)}`} className="hover:underline">
              {r.name}
            </Link>
          ) : (
            <>
              {r.name} <span className="text-muted-foreground">(not found in this workspace)</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RelatedTab({ related }: { related: Related }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-semibold">Subflows called</h3>
        <RefList refs={related.subflows} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Dependents (call this as a subflow)</h3>
        <RefList refs={related.dependents} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Detail flows (referenced via steps' details)</h3>
        <RefList refs={related.details ?? []} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Detailed in (features whose steps cite this one)</h3>
        <RefList refs={related.detailedIn ?? []} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Shared events</h3>
        {related.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {related.events.map((e) => (
              <li key={`${e.event}-${e.direction}-${e.feature.id}`}>
                <strong>{e.event}</strong> —{" "}
                <Link
                  to={`/features/${encodeURIComponent(e.feature.id)}`}
                  className="hover:underline"
                >
                  {e.feature.name}
                </Link>{" "}
                {e.direction === "wait" ? "waits for it" : "publishes it"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
