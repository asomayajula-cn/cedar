import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPrReviewPipeline } from "./orchestrator.js";
import { resolvePrTarget } from "./parse-pr-url.js";
import { submitGithubApproval } from "./approve.js";
import { explainGithubError } from "./github-token-help.js";
import { DEFAULT_OPENROUTER_MODEL, resolveOpenRouterModel } from "./default-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = Number(process.env.PORT ?? 3847);

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasToken: Boolean(process.env.GITHUB_TOKEN),
    hasOpenRouter: Boolean(process.env.OPENROUTER_API_KEY),
    partitionMode: process.env.CEDAR_PARTITION_MODE ?? "auto",
    openRouterModel: resolveOpenRouterModel(),
    defaultOpenRouterModel: DEFAULT_OPENROUTER_MODEL,
    githubTokenHint:
      "Reviews/approvals need Pull requests: Read and write (fine-grained) or repo scope (classic).",
  });
});

app.post("/api/review", async (req, res) => {
  const { post, postMicro } = req.body ?? {};
  const token = req.body?.token ?? process.env.GITHUB_TOKEN;

  let target;
  try {
    target = resolvePrTarget(req.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
    return;
  }

  if (!token) {
    res.status(400).json({ error: "Set GITHUB_TOKEN on the server or pass token in the request" });
    return;
  }

  try {
    const report = await runPrReviewPipeline({
      owner: target.owner,
      repo: target.repo,
      pr: target.pr,
      token,
      configPath: path.join(root, "components.yaml"),
      post: Boolean(post),
      postMicro: Boolean(postMicro),
    });

    res.json({
      target: report.target,
      pull: report.pull,
      process: report.process,
      gate: report.gate,
      partition: report.partition,
      breakouts: report.breakouts,
      microPrs: report.microPrs,
      microResults: report.microResults,
      composite: report.composite,
      outputMarkdown: report.outputMarkdown,
    });
  } catch (err) {
    const explained = explainGithubError(err, { action: "read this pull request" });
    res.status(/** @type {{ status?: number }} */ (err)?.status ?? 500).json(explained);
  }
});

app.post("/api/approve", async (req, res) => {
  const token = req.body?.token ?? process.env.GITHUB_TOKEN;
  const { scope, componentId, componentName, headSha, event, body, prUrl } = req.body ?? {};

  if (!token) {
    res.status(400).json({ error: "GitHub token required" });
    return;
  }
  if (!scope || !["slice", "pr"].includes(scope)) {
    res.status(400).json({ error: "scope must be slice or pr" });
    return;
  }
  if (scope === "slice" && !componentId) {
    res.status(400).json({ error: "componentId required for slice approval" });
    return;
  }

  try {
    const result = await submitGithubApproval({
      prUrl,
      owner: req.body?.owner,
      repo: req.body?.repo,
      pr: req.body?.pr,
      token,
      scope,
      componentId,
      componentName,
      headSha,
      event,
      body,
    });
    res.json(result);
  } catch (err) {
    const explained = explainGithubError(err, { action: "create a pull request review" });
    const status = /** @type {{ status?: number }} */ (err)?.status === 403 ? 403 : 500;
    res.status(status).json(explained);
  }
});

const webDist = path.join(root, "dist/web");
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(port, () => {
  console.log(`cedar API http://127.0.0.1:${port}`);
});