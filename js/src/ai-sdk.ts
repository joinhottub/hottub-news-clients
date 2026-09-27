// Vercel AI SDK tools (AI SDK 5+; uses `tool({ description, inputSchema, execute })`).
//
//   import { generateText, stepCountIs } from "ai";
//   import { hottubNewsTools } from "hottub-news/ai-sdk";
//   const { text } = await generateText({ model, tools: hottubNewsTools(), stopWhen: stepCountIs(5), prompt });
//
// `ai` and `zod` are optional peer dependencies: install them in your app.
import { tool, type Tool } from "ai";
import { toolSpecs, type HottubToolOptions, type ToolName } from "./tools.js";

export type { HottubToolOptions, ToolName } from "./tools.js";

/** Hottub News tools keyed by name, ready for `generateText({ tools })` / `streamText({ tools })`. */
export function hottubNewsTools(options: HottubToolOptions = {}): Partial<Record<ToolName, Tool>> {
  const out: Partial<Record<ToolName, Tool>> = {};
  for (const spec of toolSpecs(options)) {
    out[spec.name] = tool({
      description: spec.description,
      inputSchema: spec.schema,
      execute: async (input: Record<string, unknown>) => spec.run(input),
    }) as Tool;
  }
  return out;
}

export default hottubNewsTools;
