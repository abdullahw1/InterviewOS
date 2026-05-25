export const OPENAI_MODEL = 'gpt-4o-mini';

export interface ModelConfig {
  analysis: string;
  analysisPremium: string;
}

export function getModelConfig(): ModelConfig {
  return {
    analysis: process.env.ANALYSIS_MODEL || OPENAI_MODEL,
    analysisPremium: process.env.ANALYSIS_PREMIUM_MODEL || 'gpt-4o',
  };
}

// Token cap constants per endpoint
export const TOKEN_CAPS = {
  grading: 2000,
  quiz: 1500,
  followUp: 1000,
} as const;
