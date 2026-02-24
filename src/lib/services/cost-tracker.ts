import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import OpenAI from 'openai';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Pricing per 1M tokens (as of 2024)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'whisper-1': { input: 0.006, output: 0 }, // per minute, approximated
};

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] || { input: 0, output: 0 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
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

export type { OpenAI };
