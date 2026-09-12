// server/src/adapters/backboard.ts
import { BackboardClient } from "backboard-sdk";
import { env } from "../env.js";

export interface BackboardClientLike {
  cloneAssistant(assistantId: string, opts: { name: string; copy_documents: boolean }): Promise<any>;
  createThread(assistantId: string): Promise<any>;
  sendMessage(opts: {
    assistantId: string;
    threadId: string;
    content: string;
    memory: "Auto" | "Readonly";
    stream: boolean;
    llm_provider: string;
    model_name: string;
  }): Promise<any>;
}

export interface BackboardAdapter {
  ensurePlayerAssistant(playerId: string, existingAssistantId: string | null): Promise<string>;
  createThread(assistantId: string): Promise<string>;
  ask(assistantId: string, threadId: string, content: string, deep: boolean): Promise<string>;
  remember(assistantId: string, threadId: string, fact: string): Promise<void>;
}

export function createBackboardAdapter(client: BackboardClientLike): BackboardAdapter {
  function modelFor(deep: boolean): [string, string] {
    const modelString = deep ? env.BACKBOARD_LARGE_MODEL : env.BACKBOARD_SMALL_MODEL;
    const [provider, model] = modelString.split("/");
    return [provider, model];
  }

  return {
    async ensurePlayerAssistant(playerId, existingAssistantId) {
      if (existingAssistantId) return existingAssistantId;
      const clone = await client.cloneAssistant(env.BACKBOARD_COACH_ASSISTANT_ID, {
        name: `player-${playerId}`,
        copy_documents: true,
      });
      return clone.assistantId ?? clone.assistant_id;
    },

    async createThread(assistantId) {
      const thread = await client.createThread(assistantId);
      return thread.threadId ?? thread.thread_id;
    },

    async ask(assistantId, threadId, content, deep) {
      const [provider, model] = modelFor(deep);
      const r = await client.sendMessage({
        assistantId,
        threadId,
        content,
        memory: "Readonly",
        stream: false,
        llm_provider: provider,
        model_name: model,
      });
      return r.content ?? r.message ?? "";
    },

    async remember(assistantId, threadId, fact) {
      const [provider, model] = modelFor(false);
      await client.sendMessage({
        assistantId,
        threadId,
        content: fact,
        memory: "Auto",
        stream: false,
        llm_provider: provider,
        model_name: model,
      });
    },
  };
}

const realClient = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY });
export const backboard: BackboardAdapter = createBackboardAdapter(realClient as unknown as BackboardClientLike);
