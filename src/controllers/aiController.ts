import { Request, Response } from "express";
import { createAIProvider, buildExecuteTool, buildSystemPrompt, AI_TOOLS, Message } from "../services/aiService.js";
import { logger } from "../utils/logger.js";

export const chatHandler = async (req: Request, res: Response) => {
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
    const reply = await provider.chat(systemPrompt, trimmed, AI_TOOLS, executeTool);
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
    res.status(400).json({ error: err.message });
  }
};
