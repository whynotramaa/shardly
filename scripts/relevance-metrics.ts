/** Binary/graded metrics at a declared cutoff; unreturned relevant documents stay in IDCG and recall. */
export function rankingMetrics(ids: string[], grades: Record<string, number>, cutoff: number) {
  if (!Number.isSafeInteger(cutoff) || cutoff < 1 || new Set(ids).size !== ids.length || Object.values(grades).some(grade => !Number.isFinite(grade) || grade < 0)) throw new Error("invalid ranking or judgments");
  const selected = ids.slice(0, cutoff);
  const relevant = Object.values(grades).filter(grade => grade > 0).length;
  const dcg = (values: number[]) => values.slice(0, cutoff).reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const ideal = dcg(Object.values(grades).sort((a, b) => b - a));
  const first = selected.findIndex(id => (grades[id] ?? 0) > 0);
  return { mrr: first < 0 ? 0 : 1 / (first + 1), ndcg: ideal ? dcg(selected.map(id => grades[id] ?? 0)) / ideal : 0, recall: relevant ? selected.filter(id => (grades[id] ?? 0) > 0).length / relevant : 0 };
}
