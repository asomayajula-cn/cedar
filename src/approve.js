import { createClient, fetchPullRequest, submitPullRequestReview } from "./github.js";
import { resolvePrTarget } from "./parse-pr-url.js";

/**
 * @param {{
 *   prUrl?: string,
 *   owner?: string,
 *   repo?: string,
 *   pr?: number,
 *   token: string,
 *   scope: 'slice' | 'pr',
 *   componentId?: string,
 *   componentName?: string,
 *   event?: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES',
 *   body?: string,
 *   headSha?: string,
 * }} opts
 */
export async function submitGithubApproval(opts) {
  const target = opts.prUrl
    ? resolvePrTarget({ prUrl: opts.prUrl })
    : resolvePrTarget({ owner: opts.owner, repo: opts.repo, pr: opts.pr });

  const octokit = createClient(opts.token);
  const pull = await fetchPullRequest(octokit, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pr,
  });

  const headSha = opts.headSha ?? pull.head.sha;
  const event = opts.event ?? (opts.scope === "pr" ? "APPROVE" : "COMMENT");

  const defaultBody =
    opts.scope === "slice"
      ? `**Cedar · micro-PR approved**\n\nSlice \`${opts.componentId}\` (${opts.componentName ?? opts.componentId}) reviewed and approved in Cedar.`
      : `**Cedar · complete PR approval**\n\nAll architectural micro-PR slices reviewed. Whole-picture composite is green @ \`${headSha.slice(0, 7)}\`.`;

  const review = await submitPullRequestReview(octokit, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pr,
    commit_id: headSha,
    event,
    body: opts.body ?? defaultBody,
  });

  return {
    target,
    review: {
      id: review.id,
      state: review.state,
      html_url: review.html_url,
      commit_id: review.commit_id,
    },
  };
}