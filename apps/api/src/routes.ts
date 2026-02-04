import type { Express, Request, Response } from "express";
import createDebug from "debug";
import type { EventRouter } from "./lib/event-router/index.js";

const debug = createDebug("hooman:chat");
import type { ContextStore } from "./lib/context/index.js";
import type { HoomanRuntime } from "./lib/hooman-runtime/index.js";
import type { ColleagueEngine } from "./lib/colleagues/index.js";
import type { Scheduler } from "./lib/scheduler/index.js";
import type { MCPClientLayer } from "./lib/mcp-client/index.js";
import type { ColleagueConfig } from "./lib/types/index.js";
import { randomUUID } from "crypto";
import { getConfig, updateConfig } from "./config.js";

interface AppContext {
  eventRouter: EventRouter;
  context: ContextStore;
  hooman: HoomanRuntime;
  colleagueEngine: ColleagueEngine;
  responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  >;
  scheduler: Scheduler;
  mcpClient: MCPClientLayer;
  pendingChatResults: Map<
    string,
    {
      resolve: (value: {
        eventId: string;
        message: {
          role: "assistant";
          text: string;
          lastAgentName?: string;
        };
      }) => void;
      reject: (reason: unknown) => void;
    }
  >;
}

let killSwitchEnabled = false;

export function registerRoutes(app: Express, ctx: AppContext): void {
  const {
    eventRouter,
    context,
    hooman,
    colleagueEngine,
    scheduler,
    mcpClient,
    pendingChatResults,
  } = ctx;

  // Health
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", killSwitch: killSwitchEnabled });
  });

  // Configuration (Settings UI: API key, embedding model, LLM model only; QDRANT_URL and PORT are .env-only)
  app.get("/api/config", (_req: Request, res: Response) => {
    const c = getConfig();
    res.json({
      OPENAI_API_KEY: c.OPENAI_API_KEY,
      OPENAI_MODEL: c.OPENAI_MODEL,
      OPENAI_EMBEDDING_MODEL: c.OPENAI_EMBEDDING_MODEL,
      OPENAI_WEB_SEARCH: c.OPENAI_WEB_SEARCH,
    });
  });

  app.patch("/api/config", (req: Request, res: Response): void => {
    const patch = req.body as Record<string, unknown>;
    if (!patch || typeof patch !== "object") {
      res.status(400).json({ error: "Invalid body." });
      return;
    }
    const updated = updateConfig({
      OPENAI_API_KEY: patch.OPENAI_API_KEY as string | undefined,
      OPENAI_MODEL: patch.OPENAI_MODEL as string | undefined,
      OPENAI_EMBEDDING_MODEL: patch.OPENAI_EMBEDDING_MODEL as
        | string
        | undefined,
      OPENAI_WEB_SEARCH: patch.OPENAI_WEB_SEARCH as boolean | undefined,
    });
    res.json(updated);
  });

  // Chat history (context reads from MongoDB when set, else Mem0)
  app.get("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.pageSize), 10) || 50),
    );
    const result = await context.getMessages(userId, { page, pageSize });
    res.json(result);
  });

  // Clear chat history and Mem0 memory (via context)
  app.delete("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    await context.clearAll(userId);
    res.json({ cleared: true });
  });

  // Chat: dispatch message.sent to Event Router → chat handler runs agents-runner and resolves pending (PRD: event-driven path)
  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    if (killSwitchEnabled) {
      res.status(503).json({ error: "Hooman is paused (kill switch)." });
      return;
    }
    const text = req.body?.text as string;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing or invalid 'text'." });
      return;
    }
    const eventId = randomUUID();
    const userId = "default";

    const resultPromise = new Promise<{
      eventId: string;
      message: { role: "assistant"; text: string; lastAgentName?: string };
    }>((resolve, reject) => {
      pendingChatResults.set(eventId, { resolve, reject });
    });

    await eventRouter.dispatch(
      {
        source: "api",
        type: "message.sent",
        payload: { text, userId },
      },
      { correlationId: eventId },
    );

    try {
      const result = await resultPromise;
      res.json({
        eventId: result.eventId,
        message: result.message,
      });
    } catch (err) {
      debug("chat handler error: %o", err);
      res.status(500).json({
        eventId,
        message: {
          role: "assistant" as const,
          text: "Something went wrong. Check API logs.",
        },
      });
    }
  });

  // SSE stream for live responses (optional)
  app.get("/api/chat/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const unsub = hooman.onResponseReceived(
      (payload: { type: string; text?: string }) => {
        if (payload.type === "response") {
          res.write(
            `data: ${JSON.stringify({ type: "response", text: payload.text })}\n\n`,
          );
          res.flushHeaders?.();
        }
      },
    );
    req.on("close", () => unsub());
  });

  // Colleagues: CRUD
  app.get("/api/colleagues", (_req: Request, res: Response) => {
    res.json({ colleagues: colleagueEngine.getAll() });
  });

  app.post(
    "/api/colleagues",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as ColleagueConfig;
      if (!body?.id) {
        res.status(400).json({ error: "Missing colleague id." });
        return;
      }
      await colleagueEngine.addOrUpdate(body);
      res.status(201).json({ colleague: colleagueEngine.getById(body.id) });
    },
  );

  app.patch(
    "/api/colleagues/:id",
    async (req: Request, res: Response): Promise<void> => {
      const existing = colleagueEngine.getById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: "Colleague not found." });
        return;
      }
      await colleagueEngine.addOrUpdate({
        ...existing,
        ...req.body,
        id: req.params.id,
      });
      res.json({ colleague: colleagueEngine.getById(req.params.id) });
    },
  );

  app.delete(
    "/api/colleagues/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await colleagueEngine.remove(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Colleague not found." });
        return;
      }
      res.status(204).send();
    },
  );

  // Audit log
  app.get("/api/audit", (_req: Request, res: Response) => {
    res.json({ entries: hooman.getAuditLog() });
  });

  // Kill switch
  app.get("/api/safety/kill-switch", (_req: Request, res: Response) => {
    res.json({ enabled: killSwitchEnabled });
  });

  app.post("/api/safety/kill-switch", (req: Request, res: Response) => {
    killSwitchEnabled = Boolean(req.body?.enabled);
    res.json({ enabled: killSwitchEnabled });
  });

  // Capability approval: grant via MCP client
  app.get("/api/capabilities", (_req: Request, res: Response) => {
    res.json({ capabilities: mcpClient.listGranted() });
  });

  app.post("/api/capabilities/approve", (req: Request, res: Response): void => {
    const { integration, capability } = req.body ?? {};
    if (!integration || !capability) {
      res.status(400).json({ error: "Missing integration or capability." });
      return;
    }
    mcpClient.grantCapability(integration, capability);
    res.json({ approved: true, capabilities: mcpClient.listGranted() });
  });

  app.post("/api/capabilities/revoke", (req: Request, res: Response): void => {
    const { integration, capability } = req.body ?? {};
    if (!integration || !capability) {
      res.status(400).json({ error: "Missing integration or capability." });
      return;
    }
    mcpClient.revokeCapability(integration, capability);
    res.json({ capabilities: mcpClient.listGranted() });
  });

  // Scheduling
  app.get("/api/schedule", (_req: Request, res: Response) => {
    res.json({ tasks: scheduler.list() });
  });

  app.post(
    "/api/schedule",
    async (req: Request, res: Response): Promise<void> => {
      if (killSwitchEnabled) {
        res.status(503).json({ error: "Hooman is paused (kill switch)." });
        return;
      }
      const { execute_at, intent, context } = req.body ?? {};
      if (!execute_at || !intent) {
        res.status(400).json({ error: "Missing execute_at or intent." });
        return;
      }
      const id = await scheduler.schedule({
        execute_at,
        intent,
        context: typeof context === "object" ? context : {},
      });
      res.status(201).json({ id, execute_at, intent, context: context ?? {} });
    },
  );

  app.delete(
    "/api/schedule/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await scheduler.cancel(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Scheduled task not found." });
        return;
      }
      res.status(204).send();
    },
  );
}
