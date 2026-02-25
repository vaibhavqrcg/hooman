/**
 * Hooman agent run via Vercel AI SDK (ToolLoopAgent + tools). No personas; MCP and skills attached to main flow.
 */
import { getHoomanModel } from "./model-provider.js";
import { ToolLoopAgent, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { createSkillService } from "../capabilities/skills/skills-service.js";
import type { AuditLogEntry, ChannelMeta, MCPConnection } from "../types.js";
import { getConfig, getFullStaticAgentInstructionsAppend } from "../config.js";
import { buildChannelContext } from "../channels/shared.js";
import {
  buildAgentSystemPrompt,
  buildUserContentParts,
} from "../utils/prompts.js";
import type { MCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import {
  createMcpClients,
  clientsToTools,
} from "../capabilities/mcp/mcp-service.js";
import { truncateForMax } from "../utils/helpers.js";
import createDebug from "debug";

const debug = createDebug("hooman:hooman-runner");
const DEBUG_TOOL_LOG_MAX = 200; // max chars for args/result in logs
const AUDIT_TOOL_PAYLOAD_MAX = 100; // max chars for tool args/result in audit log

/** @deprecated Use ModelMessage[] for full AI SDK format. */
export type AgentInputItem = {
  role: "user" | "assistant" | "system";
  content: string;
};

/** Build AI SDK messages for this turn (user message + assistant tool/text from result) for storage in recollect. */
function buildTurnMessagesFromResult(
  newUserMessage: ModelMessage,
  result: { steps?: unknown[]; text?: string },
): ModelMessage[] {
  const out: ModelMessage[] = [newUserMessage];
  const steps = result.steps ?? [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as { toolCalls?: unknown[]; toolResults?: unknown[] };
    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];
    if (calls.length > 0) {
      const toolCalls = calls.map((c, j) => {
        const x = c as Record<string, unknown>;
        return {
          toolCallId: (x.toolCallId as string) ?? `call_${i}_${j}`,
          toolName: (x.toolName as string) ?? (x.name as string) ?? "unknown",
          args: (x.args ?? x.input ?? {}) as Record<string, unknown>,
        };
      });
      out.push({ role: "assistant", content: [], toolCalls } as ModelMessage);
    }
    if (results.length > 0) {
      const content = results.map((r, j) => {
        const x = r as Record<string, unknown>;
        return {
          type: "tool-result" as const,
          toolCallId: (x.toolCallId as string) ?? `call_${i}_${j}`,
          result: x.result ?? x.output,
        };
      });
      out.push({ role: "tool", content } as unknown as ModelMessage);
    }
  }
  const finalText = (result.text ?? "").trim();
  if (finalText.length > 0) {
    out.push({ role: "assistant", content: finalText });
  }
  return out;
}

export interface RunChatOptions {
  channelMeta?: ChannelMeta;
  sessionId?: string;
  attachments?: Array<{
    name: string;
    contentType: string;
    data: string;
  }>;
}

export interface RunChatResult {
  finalOutput: string;
  /** Full AI SDK messages for this turn (user + assistant with tool calls/results). Store via context.addTurnMessages for recollect. */
  turnMessages?: ModelMessage[];
}

export interface DiscoveredTool {
  name: string;
  description?: string;
  connectionId: string;
  connectionName: string;
}

/** MCP clients to close after run. */
export interface HoomanRunnerSession {
  runChat(
    thread: ModelMessage[],
    newUserMessage: string,
    options?: RunChatOptions,
  ): Promise<RunChatResult>;
  closeMcp: () => Promise<void>;
  tools: DiscoveredTool[];
}

export type AuditLogAppender = {
  appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void>;
};

export async function createHoomanRunner(options?: {
  connections?: MCPConnection[];
  mcpConnectionsStore?: MCPConnectionsStore;
  auditLog?: AuditLogAppender;
  sessionId?: string;
}): Promise<HoomanRunnerSession> {
  const config = getConfig();
  const model = getHoomanModel(config);

  const allConnections: MCPConnection[] = options?.connections ?? [];

  const [skillsSection, mcpClients] = await Promise.all([
    (async () => {
      const skillService = createSkillService();
      return skillService.getSkillsMetadataSection();
    })(),
    createMcpClients(allConnections, {
      mcpConnectionsStore: options?.mcpConnectionsStore,
    }),
  ]);

  const { prefixedTools, tools } = await clientsToTools(
    mcpClients,
    allConnections,
  );

  const agentTools = { ...prefixedTools };

  const fullSystem = buildAgentSystemPrompt({
    userInstructions: (config.AGENT_INSTRUCTIONS ?? "").trim(),
    staticAppend: getFullStaticAgentInstructionsAppend(),
    skillsSection,
    sessionId: options?.sessionId,
  });

  async function closeMcp(): Promise<void> {
    for (const { client, id } of mcpClients) {
      try {
        debug("Closing MCP client: %s", id);
        await client.close();
      } catch (e) {
        debug("MCP client %s close error: %o", id, e);
      }
    }
  }

  return {
    tools,
    async runChat(thread, newUserMessage, runOptions) {
      const input: ModelMessage[] = [];
      const channelContext = buildChannelContext(runOptions?.channelMeta);
      if (channelContext?.trim()) {
        input.push({
          role: "user",
          content: `[Channel context] This message originated from an external channel. Your reply will be delivered there automatically; compose a clear response.\n${channelContext.trim()}\n\n---`,
        });
      }
      input.push(...thread);
      const lastUserContent = buildUserContentParts(
        newUserMessage,
        runOptions?.attachments,
      );
      const newUserMsg: ModelMessage = {
        role: "user",
        content:
          lastUserContent.length === 1 && lastUserContent[0].type === "text"
            ? lastUserContent[0].text
            : lastUserContent,
      };
      input.push(newUserMsg);

      const maxSteps = getConfig().MAX_TURNS ?? 999;
      const agent = new ToolLoopAgent({
        model,
        instructions: fullSystem,
        tools: agentTools as ConstructorParameters<
          typeof ToolLoopAgent
        >[0]["tools"],
        stopWhen: stepCountIs(maxSteps),
        experimental_onToolCallStart({ toolCall }) {
          const name =
            toolCall.toolName ?? (toolCall as { name?: string }).name;
          const input =
            (toolCall as { input?: unknown }).input ??
            (toolCall as { args?: unknown }).args;
          debug(
            "Tool call: %s args=%s",
            name,
            truncateForMax(input, DEBUG_TOOL_LOG_MAX),
          );
          if (options?.auditLog) {
            void options.auditLog.appendAuditEntry({
              type: "tool_call_start",
              payload: {
                toolName: name,
                input: truncateForMax(input, AUDIT_TOOL_PAYLOAD_MAX),
              },
            });
          }
        },
        experimental_onToolCallFinish({ toolCall, success, output, error }) {
          const name =
            toolCall.toolName ?? (toolCall as { name?: string }).name;
          const result = success ? output : error;
          debug(
            "Tool result: %s result=%s",
            name,
            truncateForMax(result, DEBUG_TOOL_LOG_MAX),
          );
          if (options?.auditLog) {
            void options.auditLog.appendAuditEntry({
              type: "tool_call_end",
              payload: {
                toolName: name,
                result:
                  result !== undefined
                    ? truncateForMax(result, AUDIT_TOOL_PAYLOAD_MAX)
                    : "(no result)",
              },
            });
          }
        },
        onFinish(finishResult) {
          const steps = finishResult.steps ?? [];
          const stepCount = steps.length;
          const totalToolCalls = steps.reduce(
            (n, s) => n + (Array.isArray(s.toolCalls) ? s.toolCalls.length : 0),
            0,
          );
          const finishReason =
            typeof finishResult.finishReason === "string"
              ? finishResult.finishReason
              : String(finishResult.finishReason ?? "unknown");
          debug(
            "Run finished: steps=%d toolCalls=%d finishReason=%s",
            stepCount,
            totalToolCalls,
            finishReason,
          );
          if (options?.auditLog) {
            void options.auditLog.appendAuditEntry({
              type: "run_summary",
              payload: {
                stepCount,
                totalToolCalls,
                finishReason,
              },
            });
          }
        },
      });
      const result = await agent.generate({ messages: input });

      const turnMessages = buildTurnMessagesFromResult(newUserMsg, result);

      const text =
        result.text ?? (typeof result.finishReason === "string" ? "" : "");

      return {
        finalOutput: text,
        turnMessages,
      };
    },
    closeMcp,
  };
}
