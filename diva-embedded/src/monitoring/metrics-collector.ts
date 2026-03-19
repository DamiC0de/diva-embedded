/**
 * Metrics Collector — Story 11.1, 11.4
 * Collects conversational quality metrics and API costs.
 */

import { log } from "./logger.js";

interface InteractionMetric {
  timestamp: number;
  correlationId: string;
  speakerId: string;
  sttConfidence: number;
  responseTimeMs: number;
  wasCorrection: boolean;
  wasRepetition: boolean;
  tokensUsed: number;
  backend: string;
}

interface DailyMetrics {
  date: string;
  totalInteractions: number;
  avgSttConfidence: number;
  avgResponseTimeMs: number;
  corrections: number;
  repetitions: number;
  totalTokens: number;
  estimatedCostEur: number;
}

const metrics: InteractionMetric[] = [];
const TOKEN_COST_EUR = 0.000003; // ~$3 per 1M input tokens, rough estimate

export function recordInteractionMetric(metric: Partial<InteractionMetric> & { correlationId: string; speakerId: string }): void {
  metrics.push({
    timestamp: Date.now(),
    sttConfidence: 0,
    responseTimeMs: 0,
    wasCorrection: false,
    wasRepetition: false,
    tokensUsed: 0,
    backend: "claude",
    ...metric,
  });

  // Keep max 10000 metrics in memory (flush to DB periodically)
  if (metrics.length > 10000) {
    metrics.splice(0, metrics.length - 5000);
  }
}

export function getDailyMetrics(date?: string): DailyMetrics {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const dayStart = new Date(targetDate).getTime();
  const dayEnd = dayStart + 86400000;

  const dayMetrics = metrics.filter(m => m.timestamp >= dayStart && m.timestamp < dayEnd);

  const totalTokens = dayMetrics.reduce((sum, m) => sum + m.tokensUsed, 0);

  return {
    date: targetDate,
    totalInteractions: dayMetrics.length,
    avgSttConfidence: dayMetrics.length > 0
      ? dayMetrics.reduce((sum, m) => sum + m.sttConfidence, 0) / dayMetrics.length
      : 0,
    avgResponseTimeMs: dayMetrics.length > 0
      ? dayMetrics.reduce((sum, m) => sum + m.responseTimeMs, 0) / dayMetrics.length
      : 0,
    corrections: dayMetrics.filter(m => m.wasCorrection).length,
    repetitions: dayMetrics.filter(m => m.wasRepetition).length,
    totalTokens,
    estimatedCostEur: totalTokens * TOKEN_COST_EUR,
  };
}

export function getMonthlyEstimatedCost(): number {
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const recentTokens = metrics
    .filter(m => m.timestamp > thirtyDaysAgo)
    .reduce((sum, m) => sum + m.tokensUsed, 0);
  return recentTokens * TOKEN_COST_EUR;
}

export function isBudgetWarning(monthlyBudgetEur = 8): boolean {
  return getMonthlyEstimatedCost() > monthlyBudgetEur * 0.8;
}

export function isBudgetCritical(monthlyBudgetEur = 8): boolean {
  return getMonthlyEstimatedCost() > monthlyBudgetEur;
}
