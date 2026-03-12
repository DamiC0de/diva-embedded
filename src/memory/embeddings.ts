/**
 * Simple text similarity for memory search.
 * Uses basic TF-IDF-like approach without external dependencies.
 */

/** Tokenize text into normalized words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\sàâäéèêëïîôùûüÿçœæ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Compute simple cosine similarity between two texts.
 * @param a - First text
 * @param b - Second text
 * @returns Similarity score between 0 and 1
 */
export function textSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const vocab = new Set([...tokensA, ...tokensB]);
  const vecA: number[] = [];
  const vecB: number[] = [];

  for (const word of vocab) {
    vecA.push(tokensA.filter((t) => t === word).length);
    vecB.push(tokensB.filter((t) => t === word).length);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
