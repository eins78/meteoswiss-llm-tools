/**
 * promptfoo custom provider — access method A: the MCP server.
 *
 * Connects an MCP SDK client to a locally running meteoswiss-mcp instance
 * (MCP_SKILLS_MCP_URL, default http://localhost:3105/mcp — started by
 * scripts/run-mcp-skills.sh), advertises ALL of the server's tools to the model exactly
 * as `tools/list` returns them (schemas + full descriptions — that context IS the MCP
 * token overhead being measured), and dispatches tool calls over the live connection.
 *
 * A fresh client session per callApi keeps promptfoo's concurrency simple; session setup
 * is ~milliseconds against multi-second LLM calls and the server supports concurrent
 * sessions (factory pattern, one McpServer instance per session).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { contentToText } from "./mcp-content.js";
import { runAgentLoop, type ToolDefinition } from "./openrouter-agent.js";
import {
  commonSystemPrompt,
  parseModelConfig,
  toProviderResponse,
  type CallContext,
  type ModelConfig,
  type ProviderOptions,
  type ProviderResponse,
} from "./provider-common.js";

const MCP_URL = process.env.MCP_SKILLS_MCP_URL ?? "http://localhost:3105/mcp";
const USE_INSTRUCTIONS = process.env.MCP_SKILLS_INSTRUCTIONS === "true";

export default class McpMethodProvider {
  private readonly options: ProviderOptions;
  private readonly modelConfig: ModelConfig;

  constructor(options: ProviderOptions) {
    this.options = options;
    this.modelConfig = parseModelConfig(options);
  }

  id(): string {
    return this.options.label ?? `mcp-method:${this.modelConfig.model}`;
  }

  async callApi(
    prompt: string,
    context: CallContext,
  ): Promise<ProviderResponse> {
    const client = new Client({ name: "mcp-vs-skills-eval", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
    try {
      const listed = await client.listTools();
      const tools: ToolDefinition[] = listed.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema as Record<string, unknown>,
        },
      }));

      // A client puts the server's `instructions` (the initialize result) into the model's
      // context, as Claude Code does under "MCP Server Instructions". The harness did not:
      // MCP_SKILLS_INSTRUCTIONS=true injects them the same way, so a run can be compared
      // with and without. Off by default, so earlier numbers stay comparable.
      const serverInstructions = client.getInstructions();
      const withInstructions =
        USE_INSTRUCTIONS &&
        serverInstructions !== undefined &&
        serverInstructions !== ""
          ? `\n\nMCP Server Instructions (meteoswiss-mcp):\n${serverInstructions}`
          : "";

      const result = await runAgentLoop({
        model: this.modelConfig.model,
        systemPrompt: `${commonSystemPrompt()}\nYou have MeteoSwiss weather tools available (MCP).${withInstructions}`,
        userMessage: prompt,
        tools,
        maxTokens: this.modelConfig.maxTokens,
        extraBody: this.modelConfig.extraBody,
        dispatchTool: async (name, args) => {
          const callResult = await client.callTool({
            name,
            arguments: args,
          });
          return contentToText(callResult.content);
        },
      });
      return toProviderResponse(result, "mcp", this.modelConfig.model, context);
    } finally {
      await client.close().catch(() => {});
    }
  }
}
