/**
 * SM-2 Spaced Repetition Algorithm
 * Ported from website: C:\Users\s.bateman\chinese-word-map\index.html (lines 5877-5919)
 *
 * This algorithm determines optimal review intervals based on user performance.
 * It uses two key metrics:
 * - interval: Days until the next review
 * - easiness: Difficulty factor (1.3-4.0, default 2.5)
 *
 * The algorithm adapts to user performance:
 * - Correct answers: Increase interval, increase easiness
 * - Wrong answers: Reset interval to 1 day, decrease easiness
 */

/**
 * Calculate next review time using SM-2 algorithm
 * @param {Object} quizData - Existing quiz data for the word
 * @param {number} quality - Quality of recall (0-5 scale)
 *   - 5: Perfect recall, no hesitation
 *   - 4: Correct with slight hesitation
 *   - 3: Correct with difficulty
 *   - 2: Wrong, but remembered upon seeing answer
 *   - 1: Wrong, barely remembered
 *   - 0: Complete blackout, no recall
 * @param {string} mode - Quiz mode ('words', 'audio', or 'sentences')
 * @returns {Object} Updated quiz data with new interval and nextReview
 */
export function calculateNextReview(quizData, quality, mode = 'words') {
  // Initialize default values if this is the first review
  const data = quizData || {
    score: 0, // 0-5 performance score
    attempts: 0,
    correct: 0,
    wrong: 0,
    interval: 1, // Days until next review
    easiness: 2.5, // SM-2 easiness factor (1.3-4.0)
    consecutiveCorrect: 0, // Track streak for progressive difficulty
    lastReviewed: null,
    nextReview: null,
  };

  // Store old values for logging
  const oldInterval = data.interval;
  const oldEasiness = data.easiness;
  const oldScore = data.score;
  const oldCorrect = data.correct;

  data.attempts++;

  // Quality >= 3 is considered "correct" (recalled successfully)
  const isCorrect = quality >= 3;

  if (isCorrect) {
    data.correct++;
    data.score = Math.min(5, data.score + 1); // Increment score, cap at 5
    data.wrong = 0; // Reset wrong counter

    // Track consecutive correct answers for progressive difficulty
    data.consecutiveCorrect = (data.consecutiveCorrect || 0) + 1;

    // SM-2 Algorithm: Increase interval based on repetition count
    // Standard SM-2 intervals:
    // - First review: 1 day
    // - Second review: 6 days
    // - Third+ review: previous_interval * easiness
    if (data.correct === 1) {
      // First correct answer: schedule for 1 day
      data.interval = 1;
    } else if (data.correct === 2) {
      // Second correct answer: schedule for 6 days
      data.interval = 6;
    } else {
      // Third+ correct answer: multiply by easiness factor
      data.interval = Math.ceil(data.interval * data.easiness);
    }

    // Adjust easiness based on quality
    // Higher quality = easier word = longer intervals
    data.easiness = Math.max(1.3, data.easiness + (0.1 - (5 - quality) * 0.08));
  } else {
    // Quality < 3 means failed recall (LAPSE)
    data.wrong++;
    data.score = Math.max(0, data.score - 1); // Decrement score, floor at 0
    data.consecutiveCorrect = 0; // Reset streak

    // Anki-style lapse handling:
    // If this card was previously learned (interval > 1), reduce interval instead of resetting
    // This prevents mature cards from going all the way back to 1 day
    if (data.interval > 1 && data.correct > 0) {
      // Lapse: Reduce interval by 50%, but minimum 1 day
      data.interval = Math.max(1, Math.floor(data.interval * 0.5));
      console.log('[SM-2] Lapse detected - reducing interval to', data.interval, 'days');
    } else {
      // New card failure: Reset to 1 day
      data.interval = 1;
    }

    // Make card easier (increase future intervals)
    data.easiness = Math.max(1.3, data.easiness - 0.2);
  }

  // Set review timestamps - separate by quiz mode for independent tracking
  const now = Date.now();

  if (mode === 'words') {
    data.lastReviewedWord = now;
  } else if (mode === 'audio') {
    data.lastReviewedAudio = now;
  } else if (mode === 'sentences') {
    data.lastReviewedSentence = now;
  }

  // Keep legacy lastReviewed for backwards compatibility
  data.lastReviewed = now;
  data.nextReview = now + data.interval * 24 * 60 * 60 * 1000;

  // Log SM-2 calculation for verification
  console.log('[SM-2] Calculation:');
  console.log(`  Quality: ${quality} (${isCorrect ? 'CORRECT' : 'WRONG'})`);
  console.log(`  Correct count: ${oldCorrect} → ${data.correct}`);
  console.log(`  Score: ${oldScore} → ${data.score}`);
  console.log(`  Interval: ${oldInterval}d → ${data.interval}d`);
  console.log(`  Easiness: ${oldEasiness.toFixed(2)} → ${data.easiness.toFixed(2)}`);
  console.log(`  Next review: ${formatNextReview(data.nextReview)}`);

  return data;
}

/**
 * Determine quiz difficulty direction based on performance
 * Progressive difficulty: Start with CN→EN, then EN→CN after 3 consecutive correct
 * @param {Object} quizData - Quiz data for the word
 * @returns {string} 'chinese-to-english' or 'english-to-chinese'
 */
export function getQuizDirection(quizData) {
  if (!quizData || !quizData.consecutiveCorrect) {
    return 'chinese-to-english'; // Default: show Chinese, recall English
  }

  // After 3 consecutive correct answers, flip direction for harder challenge
  if (quizData.consecutiveCorrect >= 3) {
    return 'english-to-chinese'; // Show English, recall Chinese
  }

  return 'chinese-to-english';
}

/**
 * Prioritize quiz items by due date and difficulty
 * Returns items in order: overdue → due today → struggling → new words → future
 * @param {Array} items - Array of quiz items with quizData
 * @returns {Array} Sorted array by priority (highest first)
 */
export function prioritizeQuizItems(items) {
  const now = Date.now();
  const today = new Date().setHours(23, 59, 59, 999);

  return items.map((item) => {
    const quizData = item.quizData;

    // Calculate priority score (higher = more urgent)
    let priority = 0;

    if (!quizData) {
      // New word: medium priority
      priority = 50;
    } else {
      // Overdue (past nextReview): highest priority
      if (quizData.nextReview && now >= quizData.nextReview) {
        const daysOverdue = Math.floor(
          (now - quizData.nextReview) / (24 * 60 * 60 * 1000)
        );
        priority = 100 + daysOverdue * 10; // More overdue = higher priority
      }
      // Due today: high priority
      else if (quizData.nextReview && quizData.nextReview <= today) {
        priority = 90;
      }
      // Struggling (score < 2): high priority
      else if (quizData.score < 2) {
        priority = 80;
      }
      // Recently wrong: medium-high priority
      else if (
        quizData.wrong > 0 &&
        now - quizData.lastReviewed < 24 * 60 * 60 * 1000
      ) {
        priority = 70;
      }
      // Learning (score 2-3): medium priority
      else if (quizData.score < 4) {
        priority = 60;
      }
      // Good (score 4): low-medium priority
      else if (quizData.score === 4) {
        priority = 40;
      }
      // Mastered (score 5): low priority
      else {
        priority = 30;
      }
    }

    return { ...item, priority };
  }).sort((a, b) => b.priority - a.priority); // Sort descending by priority
}

/**
 * Convert quality rating to user-friendly label
 * @param {number} quality - Quality rating (0-5)
 * @returns {string} Label
 */
export function getQualityLabel(quality) {
  const labels = {
    5: 'Perfect!',
    4: 'Good',
    3: 'Okay',
    2: 'Hard',
    1: 'Very Hard',
    0: 'Forgot',
  };
  return labels[quality] || 'Unknown';
}

/**
 * Get recommended quality rating based on correct/wrong and timing
 * Helper function to suggest quality when user marks answer as correct/wrong
 * @param {boolean} isCorrect - Whether answer was correct
 * @param {number} thinkingTime - Time taken to answer (milliseconds)
 * @returns {number} Suggested quality (0-5)
 */
export function suggestQuality(isCorrect, thinkingTime = 0) {
  if (!isCorrect) {
    // Wrong answers: quality 0-2 based on whether they recognized it
    // For now, default to 1 (barely remembered)
    return 1;
  }

  // Correct answers: quality 3-5 based on speed
  if (thinkingTime < 3000) {
    return 5; // Fast recall (< 3 seconds)
  } else if (thinkingTime < 7000) {
    return 4; // Medium speed (3-7 seconds)
  } else {
    return 3; // Slow recall (> 7 seconds)
  }
}

/**
 * Format next review date as human-readable string
 * @param {number} timestamp - Next review timestamp
 * @returns {string} Human-readable format
 */
export function formatNextReview(timestamp) {
  if (!timestamp) return 'Not scheduled';

  const now = Date.now();
  const diff = timestamp - now;

  if (diff < 0) return 'Overdue';

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days === 0 && hours < 1) return 'Within the hour';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 30) return `In ${Math.floor(days / 7)} weeks`;
  if (days < 60) return 'Next month';
  return `In ${Math.floor(days / 30)} months`;
}
