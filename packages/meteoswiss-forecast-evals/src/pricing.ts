/**
 * OpenRouter prices for the token-based cost estimate (promptfoo's own `cost` field is empty for
 * OpenRouter — see summarize.ts's header). Shared by summarize.ts and summarize-symbol.ts.
 */

/** $ per million tokens, checked against openrouter.ai/api/v1/models when this suite was built.
 * Keyed by the exact provider id used in promptfooconfig*.yaml. */
export const MODEL_PRICING: Record<
  string,
  { inputPerM: number; outputPerM: number }
> = {
  "openrouter:anthropic/claude-opus-4.8": { inputPerM: 5, outputPerM: 25 },
  "openrouter:anthropic/claude-sonnet-5": { inputPerM: 2, outputPerM: 10 },
  "openrouter:openai/gpt-5.2": { inputPerM: 1.75, outputPerM: 14 },
  "openrouter:google/gemini-3.1-pro-preview": {
    inputPerM: 2,
    outputPerM: 12,
  },
  "openrouter:mistralai/mistral-large-2512": {
    inputPerM: 0.5,
    outputPerM: 1.5,
  },
  "openrouter:anthropic/claude-haiku-4.5": { inputPerM: 1, outputPerM: 5 },
  "openrouter:openai/gpt-5-mini": { inputPerM: 0.25, outputPerM: 2 },
  "openrouter:google/gemini-3.1-flash-lite": {
    inputPerM: 0.25,
    outputPerM: 1.5,
  },
  "openrouter:mistralai/mistral-medium-3.1": {
    inputPerM: 0.4,
    outputPerM: 2,
  },
  "openrouter:openai/gpt-5-nano": { inputPerM: 0.05, outputPerM: 0.4 },
  "openrouter:google/gemini-2.5-flash-lite": {
    inputPerM: 0.1,
    outputPerM: 0.4,
  },
  "openrouter:mistralai/ministral-8b-2512": {
    inputPerM: 0.15,
    outputPerM: 0.15,
  },
  "openrouter:meta-llama/llama-3.3-70b-instruct": {
    inputPerM: 0.1,
    outputPerM: 0.32,
  },
};

export type TokenUsage = {
  total?: number;
  prompt?: number;
  completion?: number;
  cached?: number;
  completionDetails?: { reasoning?: number };
};

export function estimateCost(
  providerId: string,
  tokenUsage: TokenUsage | undefined,
): number {
  const pricing = MODEL_PRICING[providerId];
  if (!pricing || !tokenUsage) return 0;
  const prompt = tokenUsage.prompt ?? 0;
  const completion = tokenUsage.completion ?? 0;
  return (
    (prompt * pricing.inputPerM + completion * pricing.outputPerM) / 1_000_000
  );
}
