import { createTwoFilesPatch } from "diff";
import { isCollection, isMap, isScalar, parseDocument, type Document } from "yaml";
import type { Finding, PatchOp, WorkflowFile } from "./types.js";

/** Make sure every map on `path` exists. `pull_request:` with no value becomes `pull_request: {}`. */
function ensureMaps(doc: Document, path: (string | number)[]) {
  for (let i = 1; i <= path.length; i++) {
    const sub = path.slice(0, i);
    const node = doc.getIn(sub, true);
    if (node === undefined || (isScalar(node) && node.value === null)) doc.setIn(sub, doc.createNode({}));
    else if (!isCollection(node)) throw new Error(`Cannot patch ${sub.join(".")}: it is not a map or list`);
  }
}

function apply(doc: Document, op: PatchOp) {
  if (op.op === "set") {
    ensureMaps(doc, op.path.slice(0, -1));
    doc.setIn(op.path, doc.createNode(op.value));
    return;
  }
  const parent = op.path.length ? doc.getIn(op.path, true) : doc.contents;
  if (!isMap(parent)) throw new Error(`Cannot patch ${op.path.join(".") || "root"}: not a map`);
  if (parent.has(op.key)) return;
  const pair = doc.createPair(op.key, op.value);
  const at = parent.items.findIndex((p) => isScalar(p.key) && p.key.value === op.after);
  if (at === -1) parent.items.push(pair);
  else parent.items.splice(at + 1, 0, pair);
}

/** Apply ops through the yaml Document API, so comments and key order stay as they were. */
export function applyPatch(content: string, ops: PatchOp[]): string {
  const doc = parseDocument(content);
  for (const op of ops) apply(doc, op);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
  diff: string;
  rules: string[];
}

export function planFixes(files: WorkflowFile[], findings: Finding[]): FileChange[] {
  const changes: FileChange[] = [];
  for (const file of files) {
    const mine = findings.filter((f) => f.file === file.path && f.patch.length > 0);
    if (!mine.length) continue;
    const after = applyPatch(
      file.content,
      mine.flatMap((f) => f.patch),
    );
    if (after === file.content) continue;
    changes.push({
      path: file.path,
      before: file.content,
      after,
      diff: createTwoFilesPatch(`a/${file.path}`, `b/${file.path}`, file.content, after, "", "", { context: 2 }),
      rules: [...new Set(mine.map((f) => f.rule))],
    });
  }
  return changes;
}
