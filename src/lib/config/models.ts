export interface ModelConfig {
  embedding: string;
  transcription: string;
  analysis: string;
  analysisPremium: string;
}

export function getModelConfig(): ModelConfig {
  return {
    embedding: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    transcription: process.env.TRANSCRIPTION_MODEL || 'whisper-1',
    analysis: process.env.ANALYSIS_MODEL || 'gpt-4o-mini',
    analysisPremium: process.env.ANALYSIS_PREMIUM_MODEL || 'gpt-4o',
  };
}

// Token cap constants per endpoint
export const TOKEN_CAPS = {
  grading: 2000,
  quiz: 1500,
  followUp: 1000,
} as const;
