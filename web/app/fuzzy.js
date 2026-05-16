// Port of src/tui/fuzzy.ts — fzf-style fuzzy matcher.

function fuzzyMatch(query, candidate) {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  const indices = [];
  let score = 0;
  let qi = 0;
  let lastMatch = -2;

  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) {
      indices.push(i);
      score += 1;
      if (lastMatch === i - 1) score += 5;
      if (i === 0 || /[^a-z0-9]/i.test(c[i - 1])) score += 4;
      score += 1 / (i + 1);
      lastMatch = i;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return { score, indices };
}

function fuzzyMatchMulti(query, candidate) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, indices: [] };
  let total = 0;
  const idx = new Set();
  for (const term of terms) {
    const m = fuzzyMatch(term, candidate);
    if (!m) return null;
    total += m.score;
    for (const i of m.indices) idx.add(i);
  }
  return { score: total, indices: [...idx].sort((a, b) => a - b) };
}

function fuzzyFilter(tasks, query) {
  if (!query.trim()) {
    return tasks.map((task) => ({ task, score: 0, titleIndices: [] }));
  }
  const out = [];
  for (const task of tasks) {
    const hay = `${task.title} ${task.repo} ${task.assignee} ${task.source_type} ${task.body || ""}`;
    const m = fuzzyMatchMulti(query, hay);
    if (!m) continue;
    const titleMatch = fuzzyMatchMulti(query, task.title);
    out.push({ task, score: m.score, titleIndices: titleMatch?.indices ?? [] });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

window.fuzzy = { fuzzyMatch, fuzzyMatchMulti, fuzzyFilter };
