import path from "node:path";
import { loadComponentsConfig } from "./load-config.js";
import { partitionPrByComponents, partitionPrByAssignments } from "./partition.js";
import {
  discoverArchitecturalBreakouts,
  aiComponentsToDefs,
} from "./ai-breakouts.js";
import { aiReviewMicroSlice } from "./ai-micro-review.js";
import {
  createClient,
  fetchPullRequest,
  fetchPullRequestFiles,
  submitPullRequestReview,
} from "./github.js";
import {
  reviewMicroPr,
  mergeMicroReviewFindings,
  buildCompositeReview,
  buildWholePicture,
  buildPendingCompositeNotice,
} from "./review-engine.js";
import { formatComponentBoard, formatJsonReport } from "./format.js";
import {
  buildArchitectureDiagramMermaid,
  buildArchitectureDiagramMarkdown,
} from "./architecture-diagram.js";
import { renderReviewDiagrams } from "./diagram-graphviz.js";
import { orderMicroPrsForLayout } from "./diagram-layout.js";
import { buildDiagramGraph } from "./diagram-graph.js";

/**
 * @param {{
 *   owner: string,
 *   repo: string,
 *   pr: number,
 *   token: string,
 *   configPath?: string,
 *   post?: boolean,
 *   postMicro?: boolean,
 *   partitionMode?: 'auto' | 'ai' | 'yaml',
 *   useAiReview?: boolean,
 * }} opts
 */
export async function runPrReviewPipeline(opts) {
  const configPath = opts.configPath ?? path.join(process.cwd(), "components.yaml");
  const yamlConfig = loadComponentsConfig(configPath);

  const octokit = createClient(opts.token);
  const pull = await fetchPullRequest(octokit, {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pr,
  });
  const files = await fetchPullRequestFiles(octokit, {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pr,
  });

  const useAiBreakouts = resolvePartitionMode(opts.partitionMode) === "ai";
  const useAiReview = opts.useAiReview ?? useAiBreakouts;

  /** @type {import('./ai-breakouts.js').AiBreakoutPlan | null} */
  let breakoutPlan = null;
  let components = yamlConfig.components;
  let defaultComponent = yamlConfig.defaultComponent;

  if (useAiBreakouts) {
    breakoutPlan = await discoverArchitecturalBreakouts(files, {
      title: pull.title,
      body: pull.body ?? "",
      baseRef: pull.base.ref,
      headRef: pull.head.ref,
    });
    components = aiComponentsToDefs(breakoutPlan.components);
    defaultComponent = components[0]?.id ?? "general";
  }

  const { microPrs, multiTagged } = useAiBreakouts
    ? partitionPrByAssignments(files, components, breakoutPlan.fileAssignments, defaultComponent)
    : partitionPrByComponents(files, components, defaultComponent);

  const multiBoundaryFiles = multiTagged.map((f) => f.filename);
  const ordered = orderMicroPrsForLayout(microPrs);

  /** @type {import('./review-engine.js').MicroReviewResult[]} */
  const microResults = [];

  for (const micro of ordered) {
    let result = reviewMicroPr(micro, { multiBoundaryFiles });

    if (useAiReview && process.env.OPENROUTER_API_KEY && micro.files.length) {
      try {
        const aiFindings = await aiReviewMicroSlice(micro, {
          architectureSummary: breakoutPlan?.architectureSummary,
        });
        result = mergeMicroReviewFindings(result, micro, aiFindings);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = mergeMicroReviewFindings(result, micro, [
          {
            ruleId: "ai/unavailable",
            severity: "warning",
            message: `OpenRouter slice review failed: ${message}`,
          },
        ]);
      }
    }

    microResults.push(result);

    if (opts.postMicro && result.status !== "skipped") {
      await submitPullRequestReview(octokit, {
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.pr,
        commit_id: pull.head.sha,
        event: "COMMENT",
        body: [
          `### Micro-review · ${result.componentName}`,
          "",
          result.summaryMarkdown,
        ].join("\n"),
      });
    }
  }

  const touched = microResults.filter((r) => r.status !== "skipped");
  const allSlicesReviewed = touched.every((r) => r.status === "passed" || r.status === "failed");
  const allPassed = touched.every((r) => r.status === "passed");
  const compositeReady = allSlicesReviewed && allPassed;

  const gate = {
    headSha: pull.head.sha,
    ready: compositeReady,
    blockedReason: compositeReady
      ? undefined
      : describeBlockers(microResults),
  };

  const boardMarkdown = formatComponentBoard(microResults, gate);

  const diagramMermaid = buildArchitectureDiagramMermaid(
    ordered,
    breakoutPlan ?? undefined,
    { number: pull.number, title: pull.title },
    { owner: opts.owner, repo: opts.repo }
  );
  const diagramMarkdown = buildArchitectureDiagramMarkdown(diagramMermaid);

  const diagramGraph = buildDiagramGraph(
    ordered,
    breakoutPlan ?? undefined,
    { number: pull.number, title: pull.title },
    { owner: opts.owner, repo: opts.repo }
  );

  const { pipelineDot, pipelineSvg } = await renderReviewDiagrams({
    microPrs: ordered,
    breakouts: breakoutPlan ?? undefined,
    pull: { number: pull.number, title: pull.title },
    target: { owner: opts.owner, repo: opts.repo },
  });

  /** @type {object | null} */
  let composite = null;
  /** @type {string} */
  let outputMarkdown;

  if (compositeReady) {
    const base = buildCompositeReview(microResults, microPrs, pull);
    const wholePicture = buildWholePicture(ordered, microResults, pull);
    const body = [
      diagramMarkdown,
      "",
      "---",
      "",
      base.body,
      "",
      "---",
      "",
      wholePicture,
    ].join("\n");

    composite = {
      event: base.event,
      body,
      allPassed: base.allPassed,
    };
    outputMarkdown = [boardMarkdown, "", "---", "", body].join("\n");

    if (opts.post) {
      await submitPullRequestReview(octokit, {
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.pr,
        commit_id: pull.head.sha,
        event: base.event,
        body,
      });
    }
  } else {
    const pending = buildPendingCompositeNotice(microResults, gate);
    outputMarkdown = [boardMarkdown, "", diagramMarkdown, "", pending].join("\n");

    if (opts.post) {
      await submitPullRequestReview(octokit, {
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.pr,
        commit_id: pull.head.sha,
        event: "COMMENT",
        body: pending,
      });
    }
  }

  const processSteps = buildProcessSteps({
    useAiBreakouts,
    fileCount: files.length,
    sliceCount: microPrs.filter((m) => m.files.length > 0).length,
    microResults,
    compositeReady,
  });

  return {
    target: {
      owner: opts.owner,
      repo: opts.repo,
      pr: opts.pr,
    },
    pull: {
      title: pull.title,
      number: pull.number,
      headSha: pull.head.sha,
      baseSha: pull.base.sha,
      url: pull.html_url,
    },
    process: processSteps,
    partition: {
      mode: useAiBreakouts ? "ai" : "yaml",
      model: breakoutPlan?.model,
    },
    breakouts: {
      architectureSummary:
        breakoutPlan?.architectureSummary ??
        `YAML/heuristic partition · ${microPrs.filter((m) => m.files.length).length} slices`,
      model: breakoutPlan?.model,
      strategy: breakoutPlan?.strategy ?? (useAiBreakouts ? "ai" : "yaml"),
      components: breakoutPlan?.components ?? components.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        rationale: c.rationale,
        depends_on: c.depends_on,
      })),
      diagramMermaid,
      diagramMarkdown,
      diagramPipelineDot: pipelineDot,
      diagramPipelineSvg: pipelineSvg,
      diagramGraph,
    },
    microPrs: ordered.map((m) => ({
      componentId: m.componentId,
      componentName: m.componentName,
      virtualPrId: `vpr-${pull.number}-${m.componentId}`,
      fileCount: m.files.length,
      additions: m.additions,
      deletions: m.deletions,
      description: m.description,
      rationale: m.rationale,
      dependsOn: m.dependsOn,
      files: m.files.map((f) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    })),
    microResults,
    gate,
    composite,
    outputMarkdown,
    toJson() {
      return formatJsonReport({
        pull: this.pull,
        gate: this.gate,
        partition: this.partition,
        breakouts: this.breakouts,
        microResults: this.microResults.map(stripFindingsForJson),
        composite: this.composite
          ? { event: this.composite.event, allPassed: this.composite.allPassed }
          : null,
      });
    },
  };
}

/**
 * @param {'auto' | 'ai' | 'yaml' | undefined} explicit
 */
function resolvePartitionMode(explicit) {
  const mode = explicit ?? process.env.CEDAR_PARTITION_MODE ?? "auto";
  if (mode === "yaml") return "yaml";
  if (mode === "ai") return "ai";
  return process.env.OPENROUTER_API_KEY ? "ai" : "yaml";
}

/**
 * @param {import('./review-engine.js').MicroReviewResult} r
 */
function stripFindingsForJson(r) {
  return {
    componentId: r.componentId,
    status: r.status,
    filesReviewed: r.filesReviewed,
    blockerCount: r.findings.filter((f) => f.severity === "blocker").length,
    warningCount: r.findings.filter((f) => f.severity === "warning").length,
  };
}

/**
 * @param {import('./review-engine.js').MicroReviewResult[]} microResults
 */
/**
 * @param {{
 *   useAiBreakouts: boolean,
 *   fileCount: number,
 *   sliceCount: number,
 *   microResults: import('./review-engine.js').MicroReviewResult[],
 *   compositeReady: boolean,
 * }} ctx
 */
function buildProcessSteps(ctx) {
  const microDone = ctx.microResults.filter((r) => r.status !== "skipped");
  const microPass = microDone.every((r) => r.status === "passed");

  return [
    {
      id: "fetch",
      label: "Fetch PR diff",
      status: "done",
      detail: `${ctx.fileCount} files`,
    },
    {
      id: "breakouts",
      label: ctx.useAiBreakouts ? "AI architectural breakouts" : "Map components (yaml)",
      status: "done",
      detail: `${ctx.sliceCount} slices`,
    },
    {
      id: "micro",
      label: "Micro-PR reviews",
      status: microPass ? "done" : microDone.some((r) => r.status === "failed") ? "blocked" : "done",
      detail: `${microDone.length} reviewed`,
    },
    {
      id: "approve-slices",
      label: "Approve each micro-PR",
      status: "pending",
      detail: "Your sign-off per slice",
    },
    {
      id: "composite",
      label: "Whole-picture composite",
      status: ctx.compositeReady ? "done" : "blocked",
      detail: ctx.compositeReady ? "Ready" : "Waiting on clean slices",
    },
    {
      id: "approve-pr",
      label: "Approve PR on GitHub",
      status: "pending",
      detail: "After all slices approved",
    },
  ];
}

function describeBlockers(microResults) {
  const failed = microResults.filter((r) => r.status === "failed");
  if (failed.length) {
    return `blocked — fix ${failed.map((f) => f.componentId).join(", ")} before whole-picture review`;
  }
  const pending = microResults.filter((r) => r.status !== "skipped" && r.status !== "passed");
  if (pending.length) {
    return "waiting for all component slices to finish";
  }
  return "composite not ready";
}