import type { ViewFilter } from "@/lib/api";

export type FilterDslKey = "repo" | "status" | "age" | "source";
export type FilterDslOperator = "=" | ">" | "<" | ":";

export interface FilterDslFieldTerm {
  type: "field";
  key: FilterDslKey;
  operator: FilterDslOperator;
  value: string;
  values: string[];
}

export interface FilterDslTextTerm {
  type: "text";
  value: string;
}

export type FilterDslTerm = FilterDslFieldTerm | FilterDslTextTerm;

export interface FilterDslAst {
  terms: FilterDslTerm[];
  text: string[];
}

export interface FilterDslResult {
  ast: FilterDslAst;
  query: ViewFilter;
  titleQuery: string;
}

const FIELD_KEYS = new Set<FilterDslKey>(["repo", "status", "age", "source"]);

export function parseFilterDsl(input: string): FilterDslResult {
  const terms = tokenize(input).map(parseToken);
  const ast: FilterDslAst = {
    terms,
    text: terms.flatMap((term) => term.type === "text" ? [term.value] : []),
  };

  return {
    ast,
    query: astToQuery(ast),
    titleQuery: ast.text.join(" "),
  };
}

export function astToQuery(ast: FilterDslAst): ViewFilter {
  const query: ViewFilter = {};

  for (const term of ast.terms) {
    if (term.type !== "field") continue;
    if (term.values.length !== 1) continue;

    const value = term.values[0];
    if (!value) continue;

    if (term.key === "age") {
      const age = ageTermToQuery(term);
      if (age) query.age = age;
      continue;
    }

    if (term.key === "repo") query.repo = value;
    if (term.key === "status") query.status = value;
    if (term.key === "source") query.source = value;
  }

  return query;
}

function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

function parseToken(token: string): FilterDslTerm {
  const match = /^([A-Za-z][A-Za-z0-9_-]*)([:=<>])(.+)$/.exec(token);
  if (!match) return { type: "text", value: token };

  const rawKey = match[1]!.toLowerCase();
  if (!isFieldKey(rawKey)) return { type: "text", value: token };

  const operator = match[2] as FilterDslOperator;
  const value = match[3]!.trim();
  if (!value) return { type: "text", value: token };

  return {
    type: "field",
    key: rawKey,
    operator,
    value,
    values: value.split(",").map((part) => part.trim()).filter(Boolean),
  };
}

function isFieldKey(key: string): key is FilterDslKey {
  return FIELD_KEYS.has(key as FilterDslKey);
}

function ageTermToQuery(term: FilterDslFieldTerm): string | undefined {
  if (term.operator !== ">") return undefined;
  const days = Number(term.value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return undefined;
  return `older-${days}`;
}
