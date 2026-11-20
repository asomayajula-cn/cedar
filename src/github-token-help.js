const REVIEW_DOCS =
  "https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request";

/**
 * @param {unknown} err
 * @param {{ action?: string }} [opts]
 */
export function explainGithubError(err, opts = {}) {
  const action = opts.action ?? "complete this GitHub API request";
  const status = /** @type {{ status?: number }} */ (err)?.status;
  const data = /** @type {{ response?: { data?: { message?: string, errors?: { message?: string, code?: string }[] } } } } */ (
    err
  )?.response?.data;
  const apiMsg =
    data?.message ??
    (err instanceof Error ? err.message : String(err));
  const errorDetails = Array.isArray(data?.errors)
    ? data.errors.map((e) => e?.message ?? e?.code).filter(Boolean).join("; ")
    : "";
  const fullMsg = errorDetails && !apiMsg.includes(errorDetails) ? `${apiMsg} (${errorDetails})` : apiMsg;

  if (
    status === 403 ||
    /not accessible by personal access token/i.test(apiMsg) ||
    /must have push access/i.test(apiMsg) ||
    /review cannot be created/i.test(apiMsg)
  ) {
    return {
      code: "GITHUB_TOKEN_FORBIDDEN",
      error: `Token cannot ${action}.`,
      hint: [
        "Your PAT can read the PR but not post reviews/approvals. Fix token permissions:",
        "",
        "Fine-grained token (recommended):",
        "  • Repository access: Only select repositories → include this repo",
        "  • Pull requests: Read and write",
        "  • Contents: Read (for diffs)",
        "",
        "Classic token:",
        "  • Scope repo (private repos) or public_repo (public repos only)",
        "",
        "Organization repos:",
        "  • Settings → Personal access tokens → authorize SSO for this org",
        "",
        "Then update GITHUB_TOKEN in .env (or the token field in the UI) and restart npm run dev:api.",
      ].join("\n"),
      githubMessage: apiMsg,
      docsUrl: REVIEW_DOCS,
    };
  }

  if (status === 422) {
    return {
      code: "GITHUB_REVIEW_UNPROCESSABLE",
      error: `GitHub rejected the review (${fullMsg}).`,
      hint: [
        "Common fixes:",
        "  • Re-run the Cedar review so headSha matches the latest commit",
        "  • Finish or delete any pending review you started on this PR in GitHub",
        "  • You cannot approve your own PR with some account types — use COMMENT instead",
        "  • APPROVE requires an approving review permission on the repo",
      ].join("\n"),
      githubMessage: fullMsg,
      docsUrl: REVIEW_DOCS,
    };
  }

  if (status === 401) {
    return {
      code: "GITHUB_TOKEN_UNAUTHORIZED",
      error: "GitHub token is invalid or expired.",
      hint: "Create a new PAT and set GITHUB_TOKEN in .env.",
      githubMessage: apiMsg,
      docsUrl: REVIEW_DOCS,
    };
  }

  return {
    code: "GITHUB_ERROR",
    error: apiMsg,
    hint: "",
    githubMessage: apiMsg,
    docsUrl: REVIEW_DOCS,
  };
}