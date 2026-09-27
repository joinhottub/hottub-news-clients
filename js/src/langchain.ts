// LangChain.js tools (DynamicStructuredTool from @langchain/core).
//
//   import { hottubNewsTools } from "hottub-news/langchain";
//   const agent = createAgent({ model, tools: hottubNewsTools() });
//
// `@langchain/core` and `zod` are optional peer dependencies: install them in your app.
import { DynamicStructuredTool } from "@langchain/core/tools";
import { toolSpecs, type HottubToolOptions } from "./tools.js";

export type { HottubToolOptions, ToolName } from "./tools.js";

/** Hottub News tools as LangChain `DynamicStructuredTool`s. Results are strings (Markdown or JSON). */
export function hottubNewsTools(options: HottubToolOptions = {}): DynamicStructuredTool[] {
  return toolSpecs(options).map(
    (spec) =>
      new DynamicStructuredTool({
        name: spec.name,
        description: spec.description,
        schema: spec.schema,
        func: async (input: Record<string, unknown>) => {
          const out = await spec.run(input);
          return typeof out === "string" ? out : JSON.stringify(out);
        },
      }) as DynamicStructuredTool,
  );
}

export default hottubNewsTools;
