import { randomUUID } from "crypto";
import createDebug from "debug";
import { auth } from "@ai-sdk/mcp";
import {
  MCPServerStdio,
  MCPServerStreamableHttp,
  connectMcpServers,
  createMCPToolStaticFilter,
  type MCPServer,
  type MCPServers,
} from "@openai/agents";
import type { MCPConnectionsStore } from "./connections-store.js";
import {
  createOAuthProvider,
  getAndClearPendingAuthUrl,
} from "./oauth-provider.js";
import {
  type MCPConnection,
  type MCPConnectionHosted,
  type MCPConnectionStreamableHttp,
  type MCPConnectionStdio,
} from "../../types.js";
import { env } from "../../env.js";

const debug = createDebug("hooman:mcp-service");
const DEFAULT_MCP_CWD = env.MCP_STDIO_DEFAULT_CWD;
const DEFAULT_MCP_SERVER_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(env.MCP_CONNECT_TIMEOUT_MS, 120_000),
);

/**
 * Converts MCP CallToolResult ({ content: [...] }) to AI SDK ToolResultOutput format.
 * Used when resuming after approval to build the thread for generateText.
 */
export function mcpResultToToolResultOutput(result: unknown): {
  type: "text" | "json" | "content";
  value: unknown;
} {
  const r = result as {
    content?: Array<{
      type?: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
  };
  if (r?.content && Array.isArray(r.content)) {
    const value = r.content.map(
      (part: {
        type?: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }) => {
        if (part.type === "text" && typeof part.text === "string") {
          return { type: "text" as const, text: part.text };
        }
        if (part.type === "image" && part.data && part.mimeType) {
          return {
            type: "image-data" as const,
            data: part.data,
            mediaType: part.mimeType,
          };
        }
        return { type: "text" as const, text: JSON.stringify(part) };
      },
    );
    return { type: "content", value };
  }
  return { type: "json", value: result };
}

export type McpServerEntry = {
  id: string;
  connectionName: string;
  connection: MCPConnection;
  server: MCPServer;
};

export interface CreateMcpServersOptions {
  connectTimeoutMs?: number | null;
  closeTimeoutMs?: number | null;
}

function toToolFilter(c: MCPConnection) {
  return createMCPToolStaticFilter({
    allowed: c.allowedToolNames,
    blocked: c.blockedToolNames,
  });
}

function createServerForConnection(c: MCPConnection): MCPServer {
  if (c.type === "stdio") {
    const stdio = c as MCPConnectionStdio;
    return new MCPServerStdio({
      name: c.id,
      command: stdio.command,
      args: Array.isArray(stdio.args) ? stdio.args : [],
      env: stdio.env,
      cwd: stdio.cwd?.trim() || DEFAULT_MCP_CWD,
      timeout: DEFAULT_MCP_SERVER_TIMEOUT_MS,
      toolFilter: toToolFilter(c),
    });
  }

  if (c.type === "streamable_http") {
    const http = c as MCPConnectionStreamableHttp;
    return new MCPServerStreamableHttp({
      name: c.id,
      url: http.url,
      requestInit: http.headers ? { headers: http.headers } : undefined,
      timeout: http.timeout_seconds
        ? Math.max(1, http.timeout_seconds) * 1000
        : DEFAULT_MCP_SERVER_TIMEOUT_MS,
      cacheToolsList: http.cache_tools_list ?? true,
      toolFilter: toToolFilter(c),
    });
  }

  const hosted = c as MCPConnectionHosted;
  return new MCPServerStreamableHttp({
    name: c.id,
    url: hosted.server_url,
    requestInit: hosted.headers ? { headers: hosted.headers } : undefined,
    timeout: DEFAULT_MCP_SERVER_TIMEOUT_MS,
    cacheToolsList: true,
    toolFilter: toToolFilter(c),
  });
}

export async function createConnectedMcpServers(
  connections: MCPConnection[],
  options?: CreateMcpServersOptions,
): Promise<{
  connected: MCPServers;
  entries: McpServerEntry[];
  activeEntries: McpServerEntry[];
}> {
  const entries: McpServerEntry[] = connections.map((c) => ({
    id: c.id,
    connectionName:
      c.type === "hosted"
        ? (c as MCPConnectionHosted).server_label || c.id
        : c.name || c.id,
    connection: c,
    server: createServerForConnection(c),
  }));

  const connected = await connectMcpServers(
    entries.map((e) => e.server),
    {
      connectInParallel: true,
      ...(options?.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: options.connectTimeoutMs }
        : {}),
      ...(options?.closeTimeoutMs !== undefined
        ? { closeTimeoutMs: options.closeTimeoutMs }
        : {}),
    },
  );

  if (connected.failed.length > 0) {
    for (const [server, error] of connected.errors) {
      debug("MCP server %s failed to connect: %s", server.name, error.message);
    }
  }

  const activeSet = new Set(connected.active);
  const activeEntries = entries.filter((e) => activeSet.has(e.server));
  return { connected, entries, activeEntries };
}

/** Some APIs (e.g. AWS Bedrock) limit tool names to 64 chars. Prefix with short connection id and truncate if needed. */
const DEFAULT_MAX_TOOL_NAME_LEN = 64;
const DEFAULT_SHORT_CONN_ID_LEN = 8;

/** Shape for UI: tool name + connection info. name = actual tool name (e.g. read_file), not connection name. */
export type McpDiscoveredTool = {
  id: string;
  name: string;
  description?: string;
  connectionId: string;
  connectionName: string;
};

export interface ClientsToToolsResult {
  prefixedTools: Record<
    string,
    {
      description?: string;
      inputSchema?: unknown;
      execute: (args: unknown) => Promise<unknown>;
    }
  >;
  tools: McpDiscoveredTool[];
}

/**
 * Build a tools map and discovered-tools list from MCP clients. Failed client.tools() are skipped (logged at debug).
 */
export async function serversToTools(
  servers: McpServerEntry[],
  options?: {
    maxToolNameLen?: number;
    shortConnIdLen?: number;
  },
): Promise<ClientsToToolsResult> {
  const maxToolNameLen = options?.maxToolNameLen ?? DEFAULT_MAX_TOOL_NAME_LEN;
  const shortConnIdLen = options?.shortConnIdLen ?? DEFAULT_SHORT_CONN_ID_LEN;
  const prefixedTools: Record<
    string,
    {
      description?: string;
      inputSchema?: unknown;
      execute: (args: unknown) => Promise<unknown>;
    }
  > = {};
  const tools: McpDiscoveredTool[] = [];

  for (const { id, server, connectionName, connection } of servers) {
    try {
      const listed = await server.listTools();
      const allowedSet = connection.allowedToolNames?.length
        ? new Set(connection.allowedToolNames)
        : null;
      const blockedSet = new Set(connection.blockedToolNames ?? []);
      const filtered = listed.filter((t) => {
        if (blockedSet.has(t.name)) return false;
        if (allowedSet && !allowedSet.has(t.name)) return false;
        return true;
      });
      debug(
        "MCP server %s tool discovery: %d tools found, %d after filter",
        id,
        listed.length,
        filtered.length,
      );
      const shortId = id.replace(/-/g, "").slice(0, shortConnIdLen);
      const maxNameLen = maxToolNameLen - shortId.length - 1;
      for (const t of filtered) {
        const name = t.name;
        const safeName =
          name.length <= maxNameLen ? name : name.slice(0, maxNameLen);
        const prefixed = `${shortId}_${safeName}`;
        prefixedTools[prefixed] = {
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (args: unknown) => {
            const payload =
              args && typeof args === "object"
                ? (args as Record<string, unknown>)
                : {};
            const content = await server.callTool(name, payload);
            return { content };
          },
        };
        tools.push({
          id: `${id}/${name}`,
          name,
          description: t.description,
          connectionId: id,
          connectionName,
        });
      }
    } catch (err) {
      debug("MCP server %s listTools() failed: %o", id, err);
    }
  }

  return { prefixedTools, tools };
}

export interface McpService {
  getAllConnections(): Promise<MCPConnection[]>;
  getConnectionById(id: string): Promise<MCPConnection | null>;
  addConnection(
    body: Partial<MCPConnection> & { id?: string },
  ): Promise<MCPConnection>;
  updateConnection(
    id: string,
    patch: Partial<MCPConnection>,
  ): Promise<MCPConnection>;
  removeConnection(id: string): Promise<boolean>;
  getOAuthCallbackUrl(): string;
  startOAuth(
    connectionId: string,
  ): Promise<{ status: "already_authorized" } | { authorizationUrl: string }>;
  completeOAuth(code: string, state: string): Promise<"AUTHORIZED" | "FAILED">;
  maskConnection(
    c: MCPConnection,
  ): MCPConnection & { oauth_has_tokens?: boolean };
}

export function createMcpService(store: MCPConnectionsStore): McpService {
  return {
    async getAllConnections() {
      return store.getAll();
    },

    async getConnectionById(id: string) {
      return store.getById(id);
    },

    async addConnection(body) {
      if (!body.type) {
        throw new Error("Missing connection type.");
      }
      const id = body.id?.trim() || randomUUID();
      const created_at = new Date().toISOString();
      let conn: MCPConnection;

      if (body.type === "hosted") {
        const serverUrl =
          typeof body.server_url === "string" ? body.server_url.trim() : "";
        if (!serverUrl)
          throw new Error("Server URL is required for hosted MCP.");
        conn = {
          id,
          type: "hosted",
          server_label: body.server_label ?? "",
          server_url: serverUrl,
          allowedToolNames: Array.isArray(body.allowedToolNames)
            ? body.allowedToolNames.map(String).filter(Boolean)
            : undefined,
          blockedToolNames: Array.isArray(body.blockedToolNames)
            ? body.blockedToolNames.map(String).filter(Boolean)
            : undefined,
          headers: body.headers,
          oauth: body.oauth,
          enabled: body.enabled !== false,
          created_at,
        } as MCPConnectionHosted;
      } else if (body.type === "streamable_http") {
        conn = {
          id,
          type: "streamable_http",
          name: body.name ?? "",
          url: body.url ?? "",
          allowedToolNames: Array.isArray(body.allowedToolNames)
            ? body.allowedToolNames.map(String).filter(Boolean)
            : undefined,
          blockedToolNames: Array.isArray(body.blockedToolNames)
            ? body.blockedToolNames.map(String).filter(Boolean)
            : undefined,
          headers: body.headers,
          timeout_seconds: body.timeout_seconds,
          cache_tools_list: body.cache_tools_list ?? true,
          max_retry_attempts: body.max_retry_attempts,
          oauth: body.oauth,
          enabled: body.enabled !== false,
          created_at,
        } as MCPConnectionStreamableHttp;
      } else if (body.type === "stdio") {
        conn = {
          id,
          type: "stdio",
          name: body.name ?? "",
          command: body.command ?? "",
          args: Array.isArray(body.args) ? body.args : [],
          allowedToolNames: Array.isArray(body.allowedToolNames)
            ? body.allowedToolNames.map(String).filter(Boolean)
            : undefined,
          blockedToolNames: Array.isArray(body.blockedToolNames)
            ? body.blockedToolNames.map(String).filter(Boolean)
            : undefined,
          env:
            body.env && typeof body.env === "object"
              ? (body.env as Record<string, string>)
              : undefined,
          cwd:
            typeof body.cwd === "string" && body.cwd.trim()
              ? body.cwd.trim()
              : undefined,
          enabled: body.enabled !== false,
          created_at,
        } as MCPConnectionStdio;
      } else {
        throw new Error(`Unknown connection type: ${body.type}`);
      }

      await store.addOrUpdate(conn);
      return conn;
    },

    async updateConnection(id, patch) {
      const existing = await store.getById(id);
      if (!existing) throw new Error("MCP connection not found.");

      const merged = {
        ...existing,
        ...patch,
        id: existing.id,
      } as MCPConnection;

      if (merged.type === "streamable_http" || merged.type === "hosted") {
        const existingHttp = existing as
          | MCPConnectionHosted
          | MCPConnectionStreamableHttp;
        const mergedHttp = merged as
          | MCPConnectionHosted
          | MCPConnectionStreamableHttp;

        if (
          mergedHttp.headers?.Authorization === "Bearer ***" &&
          existingHttp.headers?.Authorization
        ) {
          mergedHttp.headers = {
            ...mergedHttp.headers,
            Authorization: existingHttp.headers.Authorization,
          };
        }
        if (
          mergedHttp.oauth?.client_secret === "***" &&
          existingHttp.oauth?.client_secret
        ) {
          mergedHttp.oauth = {
            ...mergedHttp.oauth,
            client_secret: existingHttp.oauth.client_secret,
          };
        }

        const patchAny = patch as any;
        if (patchAny.oauth_tokens === undefined)
          mergedHttp.oauth_tokens = existingHttp.oauth_tokens;
        if (patchAny.oauth_code_verifier === undefined)
          mergedHttp.oauth_code_verifier = existingHttp.oauth_code_verifier;
        if (patchAny.oauth_client_information === undefined)
          mergedHttp.oauth_client_information =
            existingHttp.oauth_client_information;
      }

      await store.addOrUpdate(merged);
      return merged;
    },

    async removeConnection(id) {
      const ok = await store.remove(id);
      return ok;
    },

    getOAuthCallbackUrl() {
      const base = env.API_BASE_URL.replace(/\/$/, "");
      return `${base}/api/capabilities/mcp/oauth/callback`;
    },

    async startOAuth(connectionId) {
      const existing = await store.getById(connectionId);
      if (
        !existing ||
        (existing.type !== "streamable_http" && existing.type !== "hosted") ||
        !existing.oauth?.redirect_uri
      ) {
        throw new Error("Connection not found or not OAuth-enabled.");
      }

      const serverUrl = getOAuthServerUrlForAuth(existing);
      const provider = createOAuthProvider(connectionId, store, existing);

      const result = await auth(provider, { serverUrl });
      if (result === "AUTHORIZED") return { status: "already_authorized" };

      const authorizationUrl = getAndClearPendingAuthUrl(connectionId);
      if (!authorizationUrl)
        throw new Error("Authorization URL not available. Please try again.");

      return { authorizationUrl };
    },

    async completeOAuth(code, state) {
      const connectionId = state;
      const existing = await store.getById(connectionId);
      if (
        !existing ||
        (existing.type !== "streamable_http" && existing.type !== "hosted") ||
        !existing.oauth?.redirect_uri
      ) {
        throw new Error("Invalid state or connection.");
      }

      const serverUrl = getOAuthServerUrlForAuth(existing);
      const provider = createOAuthProvider(connectionId, store, existing);

      const result = await auth(provider, {
        serverUrl,
        authorizationCode: code,
      });
      if (result !== "AUTHORIZED") return "FAILED";

      const updated = await store.getById(connectionId);
      if (
        updated &&
        (updated.type === "streamable_http" || updated.type === "hosted") &&
        updated.oauth_code_verifier
      ) {
        await store.addOrUpdate({ ...updated, oauth_code_verifier: undefined });
      }
      return "AUTHORIZED";
    },

    maskConnection(c) {
      if (c.type !== "streamable_http" && c.type !== "hosted") {
        return c;
      }
      const http = c as MCPConnectionHosted | MCPConnectionStreamableHttp;
      const hasTokens = Boolean(http.oauth_tokens?.access_token);
      const out: MCPConnection & { oauth_has_tokens?: boolean } = {
        ...http,
        oauth_has_tokens: http.oauth ? hasTokens : undefined,
      };
      const outRecord = out as unknown as Record<string, unknown>;
      delete outRecord.oauth_tokens;
      delete outRecord.oauth_code_verifier;
      delete outRecord.oauth_client_information;
      if (out.oauth?.client_secret) {
        out.oauth = { ...out.oauth, client_secret: "***" };
      }
      if (out.headers?.Authorization) {
        out.headers = { ...out.headers, Authorization: "Bearer ***" };
      }
      return out;
    },
  };
}

function getMcpServerUrl(
  c: MCPConnectionHosted | MCPConnectionStreamableHttp,
): string {
  return c.type === "hosted" ? c.server_url : c.url;
}

function getOAuthServerUrlForAuth(
  c: MCPConnectionHosted | MCPConnectionStreamableHttp,
): string {
  const override = c.oauth?.authorization_server_url?.trim();
  return override && override.length > 0 ? override : getMcpServerUrl(c);
}
