// server/src/adapters/persona.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const BASE = "https://api.withpersona.com/api/v1";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.PERSONA_API_KEY}`,
    "Persona-Version": env.PERSONA_API_VERSION,
  };
}

export interface PersonaInquiry {
  id: string;
  status: string;
  ageCheckPassed: boolean;
}

export async function getInquiry(inquiryId: string): Promise<PersonaInquiry> {
  const r = await fetch(`${BASE}/inquiries/${inquiryId}?include=verifications`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`Persona GET inquiry ${r.status}`);
  const body = (await r.json()) as any;
  const status: string = body.data?.attributes?.status ?? "unknown";
  const included: any[] = body.included ?? [];
  const selfie = included.find((v) => v.type === "verification/selfie");
  const checks: any[] = selfie?.attributes?.checks ?? [];
  const ageCheck = checks.find((c) => c.name === "selfie_age_comparison");
  return { id: inquiryId, status, ageCheckPassed: ageCheck?.status === "passed" };
}

export async function redactInquiry(inquiryId: string): Promise<void> {
  const r = await fetch(`${BASE}/inquiries/${inquiryId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok && r.status !== 404) throw new Error(`Persona DELETE inquiry ${r.status}`);
}

export function verifyWebhookSignature(signatureHeader: string, rawBody: string, secret: string): boolean {
  const map = new Map<string, string>();
  for (const pair of signatureHeader.split(",")) {
    const [k, v] = pair.trim().split("=");
    if (k && v) map.set(k, v);
  }
  const t = map.get("t");
  const v1 = map.get("v1");
  if (!t || !v1) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(v1, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
