// Which lines the narration pack builder (build-narration.ts) sends to
// ElevenLabs: only the ones with no clip yet. A line already in the pack,
// with its clip on disk, is kept as it is and costs nothing; a line that is
// gone from the game has its clip dropped. No DOM or network here, so the
// plan is testable on its own.

export interface PackEntry {
  file: string;
  words: { word: string; start: number }[];
}

export interface PackPlan {
  /** Lines already voiced, kept exactly as they are. */
  keep: Record<string, PackEntry>;
  /** Lines to voice now, in the game's order, each once. */
  voice: string[];
  /** Clip files of lines the game no longer says. */
  drop: string[];
}

/**
 * The plan for `lines` (every line the game can say, from allLines()) against the
 * pack's current index. `hasClip` says whether a clip file is on disk.
 */
export function planPack(lines: readonly string[], existing: Record<string, PackEntry>, hasClip: (file: string) => boolean): PackPlan {
  const current = new Set(lines);
  const keep: Record<string, PackEntry> = {};
  const voice: string[] = [];
  for (const line of current) {
    const entry = existing[line];
    if (entry && hasClip(entry.file)) keep[line] = entry;
    else voice.push(line);
  }
  const kept = new Set(Object.values(keep).map((e) => e.file));
  const drop = [...new Set(Object.entries(existing).filter(([line, e]) => !current.has(line) && !kept.has(e.file)).map(([, e]) => e.file))];
  return { keep, voice, drop };
}
