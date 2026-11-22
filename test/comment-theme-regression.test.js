import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { renderReviewCommentHtml } from "../web/src/comment-html.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("review comment theme regression", () => {
  it("loads dedicated day and night comment stylesheets from the web entry", () => {
    const main = read("web/src/main.js");
    assert.match(main, /theme-comments-night\.css/);
    assert.match(main, /theme-comments-day\.css/);
    assert.ok(main.indexOf("theme-comments-night.css") < main.indexOf("theme-comments-day.css"));
  });

  it("night theme stylesheet scopes prose and diff chrome", () => {
    const css = read("web/src/theme-comments-night.css");
    assert.match(css, /html\[data-theme="night"\]\s+\.cedar-comment-theme/);
    assert.match(css, /html:not\(\[data-theme="day"\]\)\s+\.cedar-comment-theme/);
    assert.match(css, /#d4d4d8/);
    assert.match(css, /\.cedar-diff-comment-thread/);
    assert.match(css, /\.cedar-findings-list\s+\.cedar-review-comment-body/);
  });

  it("day theme stylesheet scopes prose and diff chrome", () => {
    const css = read("web/src/theme-comments-day.css");
    assert.match(css, /html\[data-theme="day"\]\s+\.cedar-comment-theme/);
    assert.match(css, /#27272a/);
    assert.match(css, /\.cedar-diff-comment-thread-cell/);
    assert.match(css, /\.cedar-findings-list\s+\.cedar-review-comment-card/);
  });

  it("base style.css does not hardcode night prose colors on comment HTML", () => {
    const css = read("web/src/style.css");
    const block = css.slice(css.indexOf(".cedar-comment-html code"), css.indexOf(".cedar-macro-dismissed"));
    assert.doesNotMatch(block, /text-zinc-300/);
    assert.doesNotMatch(block, /text-sky-400/);
  });

  it("theme day/night comment sheets own findings card and suggested-change chrome", () => {
    const day = read("web/src/theme-comments-day.css");
    const night = read("web/src/theme-comments-night.css");
    const base = read("web/src/style.css");
    assert.match(day, /\.cedar-suggested-change-label/);
    assert.match(night, /\.cedar-suggested-change-label/);
    assert.match(day, /\.cedar-findings-list\s+\.cedar-review-comment-card/);
    assert.match(night, /\.cedar-findings-list\s+\.cedar-review-comment-card/);
    assert.doesNotMatch(
      base,
      /\.cedar-findings-list\s+\.cedar-review-comment-card\s*\{[^}]*linear-gradient/s
    );
  });

  it("theme-day.css defers comment chrome to theme-comments-day.css", () => {
    const themeDay = read("web/src/theme-day.css");
    assert.doesNotMatch(themeDay, /\.cedar-findings-list\s+\.cedar-review-comment-card/);
    assert.match(themeDay, /theme-comments-day/);
  });

  it("findings cards mark comment bodies with cedar-comment-theme", () => {
    const ui = read("web/src/review-findings-ui.js");
    assert.match(
      ui,
      /cedar-review-comment-body cedar-comment-html cedar-comment-theme/
    );
  });

  it("renderReviewCommentHtml wraps lead and suggested change in cedar-comment-theme", () => {
    const html = renderReviewCommentHtml("Issue here.\n\n**Suggested change:**\n```\nfix();\n```");
    assert.match(html, /cedar-comment-theme/);
    assert.match(html, /cedar-review-comment-lead cedar-comment-html cedar-comment-theme/);
    assert.match(html, /cedar-suggested-change-body cedar-comment-html cedar-comment-theme/);
  });
});