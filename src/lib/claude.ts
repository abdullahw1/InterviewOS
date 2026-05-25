import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

export const CLAUDE_MODEL = 'gpt-4o-mini';

// gpt-4o-mini pricing per million tokens
const INPUT_COST_PER_M = 0.15;
const OUTPUT_COST_PER_M = 0.60;

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/**
 * Call OpenAI and record the cost. Returns the text response.
 * Pass `json: true` to use JSON mode.
 */
export async function chatWithClaude(opts: {
  feature: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  json?: boolean;
}): Promise<string> {
  const client = getOpenAI();
  const systemContent = opts.json
    ? `${opts.systemPrompt}\n\nRespond with valid JSON only. No markdown fences, no explanation outside the JSON.`
    : opts.systemPrompt;

  const response = await client.chat.completions.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 2000,
    ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: opts.userMessage },
    ],
  });

  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const estimatedCost =
    (inputTokens / 1_000_000) * INPUT_COST_PER_M +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;

  await prisma.costRecord.create({
    data: {
      feature: opts.feature,
      model: CLAUDE_MODEL,
      inputTokens,
      outputTokens,
      estimatedCost,
    },
  });

  return response.choices[0]?.message?.content ?? '';
}
