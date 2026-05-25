import { chatWithClaude } from '@/lib/claude';

/**
 * Simple chat completion using Claude Haiku.
 * Pass `json: true` to instruct the model to return JSON only.
 */
export async function chatCompletion(opts: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  feature?: string;
}): Promise<string> {
  return chatWithClaude({
    feature: opts.feature ?? 'llm-chat',
    systemPrompt: opts.systemPrompt,
    userMessage: opts.userMessage,
    maxTokens: opts.maxTokens,
    json: opts.json,
  });
}
