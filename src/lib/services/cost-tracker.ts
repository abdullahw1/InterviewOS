import { prisma } from '@/lib/prisma';

// Claude Haiku 4.5 pricing per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 1.0, output: 5.0 };
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export async function trackedOpenAICall<T>(
  feature: string,
  model: string,
  apiCall: () => Promise<T>,
  getUsage: (result: T) => { inputTokens: number; outputTokens: number }
): Promise<T> {
  const result = await apiCall();
  const usage = getUsage(result);
  const estimatedCost = estimateCost(model, usage.inputTokens, usage.outputTokens);

  await prisma.costRecord.create({
    data: {
      feature,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost,
    },
  });

  return result;
}
