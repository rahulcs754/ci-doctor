import { fileURLToPath } from "node:url";
import { FixtureSource } from "../src/source.js";
import { parseWorkflow } from "../src/workflow.js";

export const SAMPLE = fileURLToPath(new URL("./fixtures/sample", import.meta.url));
export const sample = () => new FixtureSource(SAMPLE);
export const wf = (content: string, path = ".github/workflows/x.yml") => parseWorkflow({ path, content });
