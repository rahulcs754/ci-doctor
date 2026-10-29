import type { Octokit } from "@octokit/rest";
import type { FileChange } from "./fix.js";
import type { Repo } from "./source.js";
import type { Finding } from "./types.js";

export function prBody(changes: FileChange[], findings: Finding[]): string {
  const fixed = findings.filter((f) => f.patch.length && changes.some((c) => c.path === f.file));
  const warns = findings.filter((f) => f.level === "warn");
  const lines = [
    "CI Doctor found these fixes in the last scan of GitHub Actions runs.",
    "",
    "## Changes",
    "",
    ...fixed.map((f) => `- \`${f.rule}\` in \`${f.file}\`: ${f.message}${f.minutesSaved ? ` (about ${f.minutesSaved} min saved)` : ""}`),
  ];
  if (warns.length) lines.push("", "## Worth a look (not changed)", "", ...warns.map((f) => `- \`${f.file}:${f.line}\`: ${f.message}`));
  lines.push("", "Check the CI run on this PR before merging.");
  return lines.join("\n");
}

/**
 * Commits the changed workflow files to a new branch and opens a PR.
 * Editing `.github/workflows` needs a token with the `workflow` scope; the default
 * GITHUB_TOKEN inside Actions cannot do it.
 */
export async function openFixPr(octokit: Octokit, repo: Repo, changes: FileChange[], findings: Finding[]): Promise<string> {
  const { data: info } = await octokit.repos.get({ ...repo });
  const base = info.default_branch;
  const { data: ref } = await octokit.git.getRef({ ...repo, ref: `heads/${base}` });
  const branch = `ci-doctor/fixes-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`;
  await octokit.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: ref.object.sha });

  for (const c of changes) {
    const { data: current } = await octokit.repos.getContent({ ...repo, path: c.path, ref: base });
    const sha = !Array.isArray(current) && current.type === "file" ? current.sha : undefined;
    await octokit.repos.createOrUpdateFileContents({
      ...repo,
      path: c.path,
      branch,
      sha,
      message: `ci: ${c.rules.join(", ")} in ${c.path.split("/").pop()}`,
      content: Buffer.from(c.after, "utf8").toString("base64"),
    });
  }

  const { data: pr } = await octokit.pulls.create({
    ...repo,
    base,
    head: branch,
    title: `ci: speed up GitHub Actions (${changes.length} file${changes.length > 1 ? "s" : ""})`,
    body: prBody(changes, findings),
  });
  return pr.html_url;
}
