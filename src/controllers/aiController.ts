import { Request, Response } from "express";
import { createAIProvider, clearAIProviderCache, buildExecuteTool, buildSystemPrompt, AI_TOOLS, Message } from "../services/aiService.js";
import { logger } from "../utils/logger.js";

// Simple sliding-window rate limiter: max 10 chat requests per IP per minute
const chatAttempts = new Map<string, { count: number; windowStart: number }>();
const CHAT_RATE_WINDOW_MS = 60_000;
const CHAT_RATE_MAX = 10;

function isChatRateLimited(ip: string): boolean {
  const now = Date.now();
  // Prune expired windows
  for (const [k, r] of chatAttempts) {
    if (now - r.windowStart > CHAT_RATE_WINDOW_MS) chatAttempts.delete(k);
  }
  const record = chatAttempts.get(ip);
  if (!record) {
    chatAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (record.count >= CHAT_RATE_MAX) return true;
  record.count++;
  return false;
}

export const chatHandler = async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isChatRateLimited(ip)) {
    logger.warn("AI", `Chat rate limit exceeded for ${ip}`);
    return res.status(429).json({ error: "Too many requests. Please wait a moment before sending another message." });
  }

  const { messages } = req.body as { messages: Message[] };

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const provider = createAIProvider();
    const systemPrompt = buildSystemPrompt();
    const executeTool = buildExecuteTool();

    // Cap at 20 messages (10 turns) to avoid context overflow
    const trimmed = messages.slice(-20);

    logger.info("AI", `Chat request — ${trimmed.length} message(s)`);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out after 90 seconds. The dividend lookup may be taking too long — try again.")), 90_000)
    );
    const reply = await Promise.race([
      provider.chat(systemPrompt, trimmed, AI_TOOLS, executeTool),
      timeout,
    ]);
    res.json({ reply });
  } catch (err: any) {
    logger.error("AI", `Chat error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const testConnectionHandler = async (req: Request, res: Response) => {
  try {
    const provider = createAIProvider();
    await provider.testConnection();
    logger.info("AI", "Test connection succeeded");
    res.json({ success: true, message: "Connection successful" });
  } catch (err: any) {
    logger.error("AI", `Test connection failed: ${err.message}`);
    // Clear the cached provider so a corrected API key takes effect immediately
    clearAIProviderCache();
    res.status(400).json({ error: err.message });
  }
};
