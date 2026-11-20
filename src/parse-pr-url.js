/**
 * @param {string} input
 * @returns {{ owner: string, repo: string, pr: number, url: string }}
 */
export function parseGitHubPrUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    throw new Error("PR link is required");
  }

  let href = trimmed;
  if (!/^https?:\/\//i.test(href)) {
    href = `https://${href.replace(/^\/+/, "")}`;
  }

  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    throw new Error("Invalid PR link URL");
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "github.com") {
    throw new Error("Only github.com pull request links are supported");
  }

  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error("Expected a link like https://github.com/owner/repo/pull/123");
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const pr = parseInt(match[3], 10);

  if (!Number.isFinite(pr) || pr < 1) {
    throw new Error("Invalid pull request number in link");
  }

  return {
    owner,
    repo,
    pr,
    url: `https://github.com/${owner}/${repo}/pull/${pr}`,
  };
}

/**
 * Resolve owner/repo/pr from API body (link or discrete fields).
 * @param {{ owner?: string, repo?: string, pr?: number|string, prUrl?: string, url?: string, link?: string }} body
 */
export function resolvePrTarget(body) {
  const link = body?.prUrl ?? body?.url ?? body?.link;
  if (link) {
    return parseGitHubPrUrl(link);
  }

  const { owner, repo, pr } = body ?? {};
  if (owner && repo && pr != null && pr !== "") {
    return {
      owner: String(owner).trim(),
      repo: String(repo).trim(),
      pr: Number(pr),
      url: `https://github.com/${owner}/${repo}/pull/${pr}`,
    };
  }

  throw new Error("Provide a GitHub PR link or owner, repo, and pr");
}