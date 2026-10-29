import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node, type YAMLMap } from "yaml";
import type { WorkflowFile } from "./types.js";

export interface ParsedWorkflow {
  path: string;
  doc: Document.Parsed;
  lines: LineCounter;
  name: string;
  triggers: string[];
  jobs: { key: string; name: string; node: YAMLMap }[];
}

export function parseWorkflow(file: WorkflowFile): ParsedWorkflow {
  const lines = new LineCounter();
  const doc = parseDocument(file.content, { lineCounter: lines, keepSourceTokens: true });
  if (doc.errors.length) throw new Error(`${file.path}: ${doc.errors[0]!.message}`);

  const jobsNode = doc.get("jobs");
  const jobs: ParsedWorkflow["jobs"] = [];
  if (isMap(jobsNode)) {
    for (const pair of jobsNode.items) {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
      if (!isMap(pair.value)) continue;
      const name = pair.value.get("name");
      jobs.push({ key, name: typeof name === "string" ? name : key, node: pair.value });
    }
  }

  const rawName = doc.get("name");
  return {
    path: file.path,
    doc,
    lines,
    name: typeof rawName === "string" ? rawName : file.path,
    triggers: triggersOf(doc.get("on")),
    jobs,
  };
}

function triggersOf(on: unknown): string[] {
  if (isScalar(on)) return [String(on.value)];
  if (isSeq(on)) return on.items.map((i) => String(isScalar(i) ? i.value : i));
  if (isMap(on)) return on.items.map((p) => String(isScalar(p.key) ? p.key.value : p.key));
  if (typeof on === "string") return [on];
  return [];
}

/** 1-based line of a node, or of the file start when unknown. */
export function lineOf(wf: ParsedWorkflow, node: unknown): number {
  const range = (node as Node | undefined)?.range;
  return range ? wf.lines.linePos(range[0]).line : 1;
}

/** Line of `key:` inside a map (the key, not its value). */
export function keyLine(wf: ParsedWorkflow, map: YAMLMap, key: string): number {
  const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key);
  return pair ? lineOf(wf, pair.key) : lineOf(wf, map);
}

/** Release and deploy workflows: we never change their triggers on our own. */
export function isReleaseWorkflow(wf: ParsedWorkflow): boolean {
  if (wf.triggers.some((t) => t === "release" || t === "deployment")) return true;
  return /release|deploy|publish/i.test(`${wf.name} ${wf.path}`);
}

export interface Step {
  index: number;
  uses?: string;
  run?: string;
  shell?: string;
  node: YAMLMap;
}

export function stepsOf(job: YAMLMap): Step[] {
  const steps = job.get("steps");
  if (!isSeq(steps)) return [];
  return steps.items.flatMap((item, index) => {
    if (!isMap(item)) return [];
    const uses = item.get("uses");
    const run = item.get("run");
    const shell = item.get("shell");
    return [
      {
        index,
        node: item,
        uses: typeof uses === "string" ? uses : undefined,
        run: typeof run === "string" ? run : undefined,
        shell: typeof shell === "string" ? shell : undefined,
      },
    ];
  });
}

/** `runs-on` as text. Expressions like `${{ matrix.os }}` come back as written. */
export function runsOn(job: YAMLMap): string {
  const v = job.get("runs-on");
  if (typeof v === "string") return v;
  if (isSeq(v)) return v.items.map((i) => String(isScalar(i) ? i.value : i)).join(",");
  return "";
}
