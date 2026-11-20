import { Octokit } from "@octokit/rest";

/**
 * @param {string} token
 * @returns {Octokit}
 */
export function createClient(token) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  return new Octokit({ auth: token });
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number }} pr
 */
export async function fetchPullRequest(octokit, pr) {
  const { data } = await octokit.pulls.get({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
  });
  return data;
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number }} pr
 * @returns {Promise<import('./partition.js').PrFile[]>}
 */
export async function fetchPullRequestFiles(octokit, pr) {
  /** @type {import('./partition.js').PrFile[]} */
  const all = [];
  let page = 1;
  for (;;) {
    const { data } = await octokit.pulls.listFiles({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      per_page: 100,
      page,
    });
    if (!data.length) break;
    for (const f of data) {
      all.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        previous_filename: f.previous_filename,
      });
    }
    if (data.length < 100) break;
    page += 1;
  }
  return all;
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number, commit_id: string, event: 'COMMENT'|'APPROVE'|'REQUEST_CHANGES', body: string, comments?: object[] }} opts
 */
export async function submitPullRequestReview(octokit, opts) {
  const { data } = await octokit.pulls.createReview({
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pull_number,
    commit_id: opts.commit_id,
    event: opts.event,
    body: opts.body,
    comments: opts.comments,
  });
  return data;
}