// server/src/news/pipeline.ts
// The one call routes/snapshot.ts's POST /events makes: score this batch and store whatever clears
// the publish threshold. Two queries total, no matter the batch size (a multi-year fast-forward is
// still just two queries plus one insert), because assignScores (scorer.ts) does the per-event math
// in memory and priorKindCounts/runBaseline each run once for the whole batch.
import { assignScores, type ScorableEvent } from "./scorer.js";
import { insertNewsStories, priorKindCounts, runBaseline, type Db, type NewNewsStory } from "./store.js";

export async function scoreAndStoreEvents(db: Db, runId: string, events: ScorableEvent[]): Promise<number> {
  if (!events.length) return 0;
  const maxDay = Math.max(...events.map((e) => e.day));
  const [baseline, counts] = await Promise.all([runBaseline(db, runId, maxDay), priorKindCounts(db, runId, events.map((e) => e.kind))]);
  const scored = assignScores(events, baseline, counts);
  if (!scored.length) return 0;
  const branchId = runId; // root branch = run_id until server-side branching exists
  const rows: NewNewsStory[] = scored.map((e) => ({
    runId,
    branchId,
    day: e.day,
    eventKey: e.key,
    kind: e.kind,
    category: e.category,
    score: e.score,
    prominence: e.prominence,
    facts: e.payload,
  }));
  return insertNewsStories(db, rows);
}
