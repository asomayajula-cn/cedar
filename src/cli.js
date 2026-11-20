#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { runPrReviewPipeline } from "./orchestrator.js";
import { parseGitHubPrUrl, resolvePrTarget } from "./parse-pr-url.js";

const program = new Command();

program
  .name("cedar-review")
  .description("Break a GitHub PR into architectural micro-reviews, then paint the whole picture")
  .version("0.1.0");

program
  .command("review")
  .description("Partition PR by components, micro-review each slice, composite when all pass")
  .option("--url <link>", "GitHub PR link (e.g. https://github.com/o/r/pull/1)")
  .option("--owner <owner>", "GitHub owner (with --repo and --pr)")
  .option("--repo <repo>", "Repository name")
  .option("--pr <number>", "Pull request number", (v) => parseInt(v, 10))
  .option("--config <path>", "components.yaml path", path.join(process.cwd(), "components.yaml"))
  .option("--token <token>", "GitHub token (or GITHUB_TOKEN env)")
  .option("--post", "Post composite review to GitHub when ready")
  .option("--post-micro", "Post one COMMENT review per component slice")
  .option("--json <file>", "Write JSON report to file")
  .option("--out <file>", "Write markdown report to file")
  .action(async (opts) => {
    const token = opts.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("Set GITHUB_TOKEN or pass --token");
      process.exit(1);
    }

    let target;
    try {
      target = opts.url
        ? parseGitHubPrUrl(opts.url)
        : resolvePrTarget({ owner: opts.owner, repo: opts.repo, pr: opts.pr });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }

    try {
      const report = await runPrReviewPipeline({
        owner: target.owner,
        repo: target.repo,
        pr: target.pr,
        token,
        configPath: opts.config,
        post: opts.post,
        postMicro: opts.postMicro,
      });

      if (opts.out) {
        fs.writeFileSync(opts.out, report.outputMarkdown, "utf8");
        console.error(`Wrote ${opts.out}`);
      } else {
        console.log(report.outputMarkdown);
      }

      if (opts.json) {
        fs.writeFileSync(opts.json, report.toJson(), "utf8");
        console.error(`Wrote ${opts.json}`);
      }

      if (!report.gate.ready) {
        process.exit(2);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();