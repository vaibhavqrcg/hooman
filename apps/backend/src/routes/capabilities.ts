import type { Express, Request, Response } from "express";
import createDebug from "debug";
import { randomUUID } from "crypto";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types.js";
import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
} from "../agents/skills-cli.js";

const debug = createDebug("hooman:routes:capabilities");

export function registerCapabilityRoutes(app: Express, ctx: AppContext): void {
  const { mcpConnectionsStore } = ctx;

  app.get(
    "/api/capabilities/available",
    async (_req: Request, res: Response) => {
      const connections = await mcpConnectionsStore.getAll();
      const capabilities = connections.map((c) => ({
        integrationId: c.id,
        capability:
          c.type === "hosted"
            ? c.server_label || c.id
            : (c as { name?: string }).name || c.id,
      }));
      res.json({ capabilities });
    },
  );

  app.get("/api/mcp/connections", async (_req: Request, res: Response) => {
    const connections = await mcpConnectionsStore.getAll();
    res.json({ connections });
  });

  app.post(
    "/api/mcp/connections",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as Partial<MCPConnection> & { id?: string };
      if (!body?.type) {
        res.status(400).json({ error: "Missing connection type." });
        return;
      }
      const id = body.id?.trim() || randomUUID();
      const created_at = new Date().toISOString();
      let conn: MCPConnection;
      if (body.type === "hosted") {
        const serverUrl =
          typeof body.server_url === "string" ? body.server_url.trim() : "";
        if (!serverUrl) {
          res
            .status(400)
            .json({ error: "Server URL is required for hosted MCP." });
          return;
        }
        const c: MCPConnectionHosted = {
          id,
          type: "hosted",
          server_label: body.server_label ?? "",
          server_url: serverUrl,
          require_approval: body.require_approval ?? "never",
          streaming: body.streaming ?? false,
          created_at,
        };
        conn = c;
      } else if (body.type === "streamable_http") {
        const c: MCPConnectionStreamableHttp = {
          id,
          type: "streamable_http",
          name: body.name ?? "",
          url: body.url ?? "",
          headers: body.headers,
          timeout_seconds: body.timeout_seconds,
          cache_tools_list: body.cache_tools_list ?? true,
          max_retry_attempts: body.max_retry_attempts,
          created_at,
        };
        conn = c;
      } else if (body.type === "stdio") {
        const c: MCPConnectionStdio = {
          id,
          type: "stdio",
          name: body.name ?? "",
          command: body.command ?? "",
          args: Array.isArray(body.args) ? body.args : [],
          env:
            body.env && typeof body.env === "object"
              ? (body.env as Record<string, string>)
              : undefined,
          cwd:
            typeof body.cwd === "string" && body.cwd.trim()
              ? body.cwd.trim()
              : undefined,
          created_at,
        };
        conn = c;
      } else {
        res.status(400).json({
          error: `Unknown connection type: ${(body as { type?: string }).type}`,
        });
        return;
      }
      await mcpConnectionsStore.addOrUpdate(conn);
      res.status(201).json({ connection: conn });
    },
  );

  app.patch(
    "/api/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      const id = getParam(req, "id");
      const existing = await mcpConnectionsStore.getById(id);
      if (!existing) {
        res.status(404).json({ error: "MCP connection not found." });
        return;
      }
      const patch = req.body as Partial<MCPConnection>;
      const merged = {
        ...existing,
        ...patch,
        id: existing.id,
      } as MCPConnection;
      await mcpConnectionsStore.addOrUpdate(merged);
      res.json({ connection: merged });
    },
  );

  app.delete(
    "/api/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await mcpConnectionsStore.remove(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "MCP connection not found." });
        return;
      }
      res.status(204).send();
    },
  );

  app.get("/api/skills/list", async (_req: Request, res: Response) => {
    try {
      const skills = await listSkillsFromFs();
      res.json({ skills });
    } catch (err) {
      debug("skills list error: %o", err);
      res.status(500).json({
        skills: [],
        error: (err as Error).message,
      });
    }
  });

  app.get("/api/skills/:id/content", async (req: Request, res: Response) => {
    const id =
      typeof req.params.id === "string"
        ? req.params.id
        : (req.params.id?.[0] ?? "");
    if (!id) {
      res.status(400).json({ error: "Missing skill id." });
      return;
    }
    try {
      const content = await getSkillContent(id);
      if (content === null) {
        res.status(404).json({ error: "Skill not found." });
        return;
      }
      res.json({ content });
    } catch (err) {
      debug("skills content error: %o", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/skills/add", async (req: Request, res: Response) => {
    const body = req.body as { package?: string; skills?: string[] };
    const pkg = body?.package;
    if (!pkg || typeof pkg !== "string" || !pkg.trim()) {
      res.status(400).json({ error: "Missing or invalid 'package'." });
      return;
    }
    try {
      const result = await addSkill({
        package: pkg.trim(),
        skills: Array.isArray(body?.skills) ? body.skills : undefined,
      });
      res.json({
        output: result.stdout,
        error: result.stderr.trim() || undefined,
        code: result.code,
      });
    } catch (err) {
      debug("skills add error: %o", err);
      res.status(500).json({
        output: "",
        error: (err as Error).message,
        code: 1,
      });
    }
  });

  app.post("/api/skills/remove", async (req: Request, res: Response) => {
    const body = req.body as { skills?: string[] };
    const skills = Array.isArray(body?.skills) ? body.skills : [];
    if (skills.length === 0) {
      res.status(400).json({ error: "Missing or invalid 'skills' array." });
      return;
    }
    try {
      const result = await removeSkills(skills);
      res.json({
        output: result.stdout,
        error: result.stderr.trim() || undefined,
        code: result.code,
      });
    } catch (err) {
      debug("skills remove error: %o", err);
      res.status(500).json({
        output: "",
        error: (err as Error).message,
        code: 1,
      });
    }
  });
}
