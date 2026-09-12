import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

const client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });
const CACHE_DIR = path.join(process.cwd(), ".cache", "voice");

export function buildCaptions(characters: string[], starts: number[]): { word: string; start: number }[] {
  const words: { word: string; start: number }[] = [];
  let current = "";
  let wordStart = starts[0] ?? 0;
  characters.forEach((ch, i) => {
    if (ch === " ") {
      if (current) words.push({ word: current, start: wordStart });
      current = "";
      wordStart = starts[i + 1] ?? wordStart;
    } else {
      if (!current) wordStart = starts[i] ?? wordStart;
      current += ch;
    }
  });
  if (current) words.push({ word: current, start: wordStart });
  return words;
}

/** Word start times from a timestamped TTS response (the SDK returns camelCase fields). */
export function captionsFromResponse(
  result: Pick<ElevenLabs.AudioWithTimestampsResponse, "alignment" | "normalizedAlignment">,
): { word: string; start: number }[] {
  const alignment = result.alignment ?? result.normalizedAlignment;
  return buildCaptions(alignment?.characters ?? [], alignment?.characterStartTimesSeconds ?? []);
}

async function readCache(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function getSignedVoiceUrl(): Promise<string> {
  const r = (await client.conversationalAi.conversations.getSignedUrl({
    agentId: env.ELEVENLABS_AGENT_ID,
  })) as any;
  return r.signedUrl ?? r.signed_url;
}

export async function speak(
  voiceId: string,
  text: string,
): Promise<{ audioBase64: string; words: { word: string; start: number }[] }> {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash("sha256").update(`tts|${voiceId}|eleven_flash_v2_5|${text}`).digest("hex");
  const audioFile = path.join(CACHE_DIR, `${key}.mp3`);
  const captionsFile = path.join(CACHE_DIR, `${key}.json`);

  const cachedAudio = await readCache(audioFile);
  if (cachedAudio) {
    const cachedCaptions = await readFile(captionsFile, "utf8").catch(() => "[]");
    return { audioBase64: cachedAudio.toString("base64"), words: JSON.parse(cachedCaptions) };
  }

  const result = await client.textToSpeech.convertWithTimestamps(voiceId, {
    text,
    modelId: "eleven_flash_v2_5",
  });
  const audioBase64 = result.audioBase64;
  const words = captionsFromResponse(result);

  const buffer = Buffer.from(audioBase64, "base64");
  await writeFile(audioFile, buffer);
  await writeFile(captionsFile, JSON.stringify(words));

  return { audioBase64, words };
}

export async function soundEffect(promptText: string, durationSeconds: number): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash("sha256").update(`sfx|${promptText}|${durationSeconds}`).digest("hex");
  const file = path.join(CACHE_DIR, `${key}.mp3`);

  const cached = await readCache(file);
  if (cached) return cached.toString("base64");

  const audio = (await client.textToSoundEffects.convert({
    text: promptText,
    durationSeconds,
    promptInfluence: 0.5,
  })) as AsyncIterable<Buffer>;
  const buffer = await streamToBuffer(audio);
  await writeFile(file, buffer);
  return buffer.toString("base64");
}
