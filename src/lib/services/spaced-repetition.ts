// SM-2 Spaced Repetition Algorithm
// Based on SuperMemo 2 algorithm

export interface SM2Input {
  repetitions: number;
  easeFactor: number;
  interval: number;
  quality: number; // 0-5 scale
}

export interface SM2Output {
  repetitions: number;
  easeFactor: number;
  interval: number;
  nextReviewDate: Date;
}

export function calculateNextReview(input: SM2Input): SM2Output {
  const { repetitions, easeFactor, interval, quality } = input;
  
  let newRepetitions = repetitions;
  let newEaseFactor = easeFactor;
  let newInterval = interval;
  
  // If quality < 3, reset the learning process
  if (quality < 3) {
    newRepetitions = 0;
    newInterval = 1;
  } else {
    // Increase repetition count
    newRepetitions = repetitions + 1;
    
    // Calculate new interval
    if (newRepetitions === 1) {
      newInterval = 1;
    } else if (newRepetitions === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * easeFactor);
    }
  }
  
  // Update ease factor
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  
  // Ease factor should not be less than 1.3
  if (newEaseFactor < 1.3) {
    newEaseFactor = 1.3;
  }
  
  // Calculate next review date
  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);
  
  return {
    repetitions: newRepetitions,
    easeFactor: newEaseFactor,
    interval: newInterval,
    nextReviewDate,
  };
}

// Helper to determine quality based on result string
export function resultToQuality(result: string): number {
  const resultMap: Record<string, number> = {
    'easy': 5,
    'good': 4,
    'medium': 3,
    'hard': 2,
    'again': 1,
    'failed': 0,
  };
  
  return resultMap[result.toLowerCase()] || 3;
}
