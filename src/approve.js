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

  const headSha = pull.head.sha;
  const event = opts.event ?? (opts.scope === "pr" ? "APPROVE" : "COMMENT");

  const defaultBody =
    opts.scope === "slice"
      ? `**Cedar · micro-PR approved**\n\nSlice \`${opts.componentId}\` (${opts.componentName ?? opts.componentId}) reviewed and approved in Cedar.`
      : `**Cedar · complete PR approval**\n\nAll architectural micro-PR slices reviewed. Architecture read is green @ \`${headSha.slice(0, 7)}\`.`;

  const { review, meta } = await submitPullRequestReview(octokit, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pr,
    commit_id: headSha,
    event,
    body: opts.body ?? defaultBody,
  });

  /** @type {string | undefined} */
  let hint;
  if (meta.authorCommentFallback) {
    hint =
      "You are the PR author — GitHub only allows a review comment, not a green Approve button, from the author.";
  } else if (meta.approveFallbackComment) {
    hint = "This repo rejected an Approve review; Cedar posted a review comment with your sign-off instead.";
  } else if (meta.idempotent) {
    hint = "You already approved this pull request on GitHub.";
  }

  return {
    target,
    review: {
      id: review.id,
      state: review.state,
      html_url: review.html_url,
      commit_id: review.commit_id ?? headSha,
    },
    hint,
    meta,
  };
}