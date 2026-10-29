import Anthropic from "@anthropic-ai/sdk";
import type { Diagnosis } from "./diagnose.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Optional: ask Claude to explain a failure in plain English.
 * Only runs when ANTHROPIC_API_KEY is set. Input is the masked log context, never the raw log.
 * Returns null when there is no key, or the model declines.
 */
export async function explain(d: Diagnosis, jobName: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const msg = await client.beta.messages.create({
    model: process.env.CI_DOCTOR_MODEL ?? DEFAULT_MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system:
      "You explain failed GitHub Actions jobs to developers. Reply in 3 short lines: what failed, the likely cause, and the fix. Plain English, no preamble. If the log is not enough to tell, say so.",
    messages: [
      {
        role: "user",
        content: `Job: ${jobName}\nCategory guess: ${d.category}\n\nLog lines before the first error (secrets masked):\n\n${d.context.join("\n")}`,
      },
    ],
  });
  if (msg.stop_reason === "refusal") return null;
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  return text || null;
}
