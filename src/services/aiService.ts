import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getSetting } from "../repositories/settingsRepository.js";
import { listPortfolios } from "../repositories/portfolioRepository.js";
import { getCachedAccounts, getCachedPositions } from "../repositories/accountRepository.js";
import { fetchDividendMetadata, getCachedAllDividends, getDividendForecastForAccount } from "./dividendService.js";
import { logger } from "../utils/logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

type ExecuteToolFn = (name: string, args: Record<string, any>) => Promise<any>;

interface AIProvider {
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    executeTool: ExecuteToolFn
  ): Promise<string>;
  queryKnowledge(question: string): Promise<string>;
  testConnection(): Promise<void>;
}

// ── Tool definitions (provider-agnostic) ──────────────────────────────────────

export const AI_TOOLS: ToolDefinition[] = [
  {
    name: "list_portfolios",
    description: "List all brokerage portfolios and their accounts",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_holdings",
    description:
      "Get current stock holdings (positions) for a specific portfolio account",
    parameters: {
      type: "object",
      properties: {
        portfolioId: { type: "string", description: "The portfolio ID" },
        accountId: { type: "string", description: "The account ID" },
      },
      required: ["portfolioId", "accountId"],
    },
  },
  {
    name: "get_dividend_metadata",
    description:
      "Get dividend information (yield, frequency, amount per share, ex-date) for a stock symbol",
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Stock ticker symbol, e.g. AAPL or TD.TO",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_all_dividends",
    description:
      "Get all upcoming dividend events across all portfolios and accounts",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_dividend_forecast",
    description: "Get the dividend income forecast for a specific portfolio account",
    parameters: {
      type: "object",
      properties: {
        portfolioId: { type: "string", description: "The portfolio ID" },
        accountId: { type: "string", description: "The account ID" },
      },
      required: ["portfolioId", "accountId"],
    },
  },
];

// ── Tool execution ─────────────────────────────────────────────────────────────

export function buildExecuteTool(): ExecuteToolFn {
  return async (name: string, args: Record<string, any>) => {
    logger.debug("AI", `Tool call: ${name}(${JSON.stringify(args)})`);
    try {
      switch (name) {
        case "list_portfolios": {
          const portfolios = listPortfolios();
          return portfolios.map((p) => {
            const accounts = getCachedAccounts(p.id);
            return {
              id: p.id,
              name: p.name,
              accounts: accounts
                .filter((a) => a.isActive)
                .map((a) => ({ id: a.id, name: a.customName || a.name, type: a.type })),
            };
          });
        }

        case "get_holdings": {
          const { accountId } = args;
          const positions = getCachedPositions(accountId);
          return { accountId, positions };
        }

        case "get_dividend_metadata": {
          const { symbol } = args;
          const data = await fetchDividendMetadata(symbol);
          if (data) {
            return { success: true, source: "financial_provider", symbol, ...data };
          }
          // No financial provider returned data — ask the AI model directly
          logger.debug("AI", `No provider data for ${symbol}, querying AI knowledge`);
          try {
            const provider = createAIProvider();
            const answer = await provider.queryKnowledge(
              `Give me the current dividend information for the stock ticker ${symbol}. ` +
              `Include: annual dividend yield (%), payment frequency (monthly/quarterly/semi-annual/annual), ` +
              `amount per share per payment, and the most recent ex-dividend date if known. ` +
              `Be concise and factual. Note if any values are estimates or uncertain.`
            );
            return { success: true, source: "ai_knowledge", symbol, summary: answer };
          } catch (aiErr: any) {
            return { success: false, error: `No dividend data found for ${symbol} and AI fallback failed: ${aiErr.message}` };
          }
        }

        case "get_all_dividends": {
          const dividends = getCachedAllDividends();
          if (!dividends || dividends.length === 0) {
            return {
              success: false,
              error: "No dividend data cached yet. The background job may not have run yet.",
            };
          }
          return { success: true, count: dividends.length, dividends };
        }

        case "get_dividend_forecast": {
          const { portfolioId, accountId } = args;
          const portfolios = listPortfolios();
          const portfolio = portfolios.find((p) => String(p.id) === String(portfolioId));
          if (!portfolio) {
            return { success: false, error: `Portfolio ${portfolioId} not found` };
          }
          const forecast = await getDividendForecastForAccount(portfolio, accountId);
          return { success: true, events: forecast };
        }

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      logger.error("AI", `Tool ${name} failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  };
}

// ── System prompt ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const portfolios = listPortfolios();
  const portfolioContext =
    portfolios.length === 0
      ? "No brokerage portfolios are currently connected."
      : `Connected portfolios:\n${portfolios
          .map((p) => {
            const accounts = getCachedAccounts(p.id).filter((a) => a.isActive);
            const accountList = accounts.length
              ? accounts.map((a) => `  - ${a.customName || a.name} (ID: ${a.id})`).join("\n")
              : "  (no active accounts)";
            return `- ${p.name} (ID: ${p.id})\n${accountList}`;
          })
          .join("\n")}`;

  return `You are an AI assistant embedded in CentralFolio, a personal portfolio and dividend tracking application.

You help the user understand their investment holdings, dividend income, and portfolio performance. You have access to live portfolio data through the tools available to you.

${portfolioContext}

Guidelines:
- Use tools to fetch live data before answering questions about holdings or dividends
- When a tool returns { success: false }, relay the error message honestly to the user rather than guessing
- Format monetary values with 2 decimal places and appropriate currency context
- Keep responses concise and focused on investment-relevant information
- If asked about something unrelated to finance or this portfolio, politely stay on topic`;
}

// ── Claude provider ────────────────────────────────────────────────────────────

class ClaudeProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || "claude-sonnet-4-6";
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    executeTool: ExecuteToolFn
  ): Promise<string> {
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    let currentMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    for (let i = 0; i < 10; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: anthropicTools,
      });

      if (response.stop_reason !== "tool_use") {
        const textBlock = response.content.find((b) => b.type === "text") as
          | Anthropic.TextBlock
          | undefined;
        return textBlock?.text ?? "";
      }

      currentMessages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await executeTool(block.name, block.input as Record<string, any>);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }
      currentMessages.push({ role: "user", content: toolResults });
    }

    return "Sorry, I reached the maximum number of steps. Please try again.";
  }

  async queryKnowledge(question: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      messages: [{ role: "user", content: question }],
    });
    const block = response.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
    return block?.text ?? "";
  }

  async testConnection(): Promise<void> {
    await this.client.messages.create({
      model: this.model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    });
  }
}

// ── OpenAI provider (also handles self-hosted OpenAI-compatible endpoints) ─────

class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || "no-key",
      ...(baseURL ? { baseURL } : {}),
    });
    this.model = model || "gpt-4o";
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    executeTool: ExecuteToolFn
  ): Promise<string> {
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const currentMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    ];

    for (let i = 0; i < 10; i++) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: currentMessages,
        tools: openaiTools,
        tool_choice: "auto",
      });

      const choice = response.choices[0];

      if (choice.finish_reason !== "tool_calls") {
        return choice.message.content ?? "";
      }

      currentMessages.push(choice.message);

      for (const toolCall of choice.message.tool_calls ?? []) {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          // leave args empty
        }
        const result = await executeTool(toolCall.function.name, args);
        currentMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    return "Sorry, I reached the maximum number of steps. Please try again.";
  }

  async queryKnowledge(question: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: question }],
      max_tokens: 512,
    });
    return response.choices[0]?.message.content ?? "";
  }

  async testConnection(): Promise<void> {
    await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 10,
    });
  }
}

// ── Gemini provider ────────────────────────────────────────────────────────────

class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model || "gemini-2.0-flash";
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    executeTool: ExecuteToolFn
  ): Promise<string> {
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    // Build full contents array (Gemini maintains state via contents)
    const contents: any[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    for (let i = 0; i < 10; i++) {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations }],
        },
      });

      const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
      const funcCallParts = parts.filter((p) => p.functionCall);

      if (funcCallParts.length === 0) {
        return parts.find((p) => p.text)?.text ?? "";
      }

      // Append model turn
      contents.push({ role: "model", parts });

      // Execute calls and collect results
      const resultParts: any[] = [];
      for (const part of funcCallParts) {
        const fc = part.functionCall;
        const result = await executeTool(fc.name, fc.args ?? {});
        resultParts.push({
          functionResponse: { name: fc.name, response: { result } },
        });
      }
      contents.push({ role: "user", parts: resultParts });
    }

    return "Sorry, I reached the maximum number of steps. Please try again.";
  }

  async queryKnowledge(question: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: question }] }],
    });
    return response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text ?? "";
  }

  async testConnection(): Promise<void> {
    await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    });
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createAIProvider(): AIProvider {
  const provider = getSetting("ai_provider");
  const apiKey = getSetting("ai_api_key") ?? "";
  const model = getSetting("ai_model") ?? "";
  const baseURL = getSetting("ai_base_url") ?? undefined;

  if (!provider) {
    throw new Error("No AI provider configured. Please set one up in Settings → Keys & Providers.");
  }

  switch (provider) {
    case "claude":
      return new ClaudeProvider(apiKey, model);
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "gemini":
      return new GeminiProvider(apiKey, model);
    case "self-hosted":
      if (!baseURL) throw new Error("Base URL is required for self-hosted providers.");
      return new OpenAIProvider(apiKey, model, baseURL);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
