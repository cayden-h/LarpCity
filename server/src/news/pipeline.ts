// server/src/news/pipeline.ts
// The one call routes/snapshot.ts's POST /events makes: score this batch and store whatever clears
// the publish threshold. A fixed, small number of queries no matter the batch size (a multi-year
// fast-forward is still just a few queries plus one insert): snapshotCheckpoints resolves each event's
// OWN net-worth baseline (not one shared number for the whole batch — see scorer.ts's assignScores doc,
// this was a real bug found in review: an early cheap event in a long fast-forward batch was being
// scored against the run's FINAL net worth instead of what the player had at the time).
import { assignScores, baselineAt, type ScorableEvent } from "./scorer.js";
import { insertNewsStories, priorKindCounts, snapshotCheckpoints, type Db, type NewNewsStory } from "./store.js";

export async function scoreAndStoreEvents(db: Db, runId: string, events: ScorableEvent[]): Promise<number> {
  if (!events.length) return 0;
  const days = events.map((e) => e.day);
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const [checkpoints, counts] = await Promise.all([
    snapshotCheckpoints(db, runId, minDay, maxDay),
    priorKindCounts(db, runId, events.map((e) => e.kind)),
  ]);
  const baselines = events.map((e) => baselineAt(e.day, checkpoints));
  const scored = assignScores(events, baselines, counts);
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
