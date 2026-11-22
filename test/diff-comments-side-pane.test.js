import "./helpers/linkedom-globals.js";
import assert from "node:assert/strict";
import { createPatch } from "diff";
import { html as diff2html } from "diff2html";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import { diffRowSidePane, rowMatchesCommentAnchor } from "../web/src/diff-comments.js";

/**
 * @param {string} patch
 */
function sideBySideDoc(patch) {
  const body = diff2html(patch, { outputFormat: "side-by-side", drawFileList: false });
  const { document } = parseHTML(
    `<div class="cedar-diff2html" data-diff-format="side-by-side">${body}</div>`
  );
  return document;
}

describe("diff2html side-by-side comment anchors", () => {
  it("detects LEFT and RIGHT panes without legacy diff2html class names", () => {
    const patch = createPatch("a.js", "line1\nline2\n", "line1\nline2-changed\n", "", "", {
      context: 1,
    });
    const doc = sideBySideDoc(patch);
    assert.equal(doc.querySelector(".d2h-file-side-diff-left"), null);
    assert.equal(doc.querySelector(".d2h-file-side-diff-right"), null);

    const panes = doc.querySelectorAll(".d2h-files-diff > .d2h-file-side-diff");
    assert.equal(panes.length, 2);

    const delRow = panes[0].querySelector("tr td.d2h-del")?.closest("tr");
    const insRow = panes[1].querySelector("tr td.d2h-ins")?.closest("tr");
    assert.ok(delRow instanceof doc.defaultView.HTMLElement);
    assert.ok(insRow instanceof doc.defaultView.HTMLElement);
    assert.equal(diffRowSidePane(delRow), "LEFT");
    assert.equal(diffRowSidePane(insRow), "RIGHT");
  });

  it("matches RIGHT anchors only on the new-file pane", () => {
    const patch = createPatch("a.js", "line1\nline2\n", "line1\nline2-changed\n", "", "", {
      context: 1,
    });
    const doc = sideBySideDoc(patch);
    const panes = doc.querySelectorAll(".d2h-files-diff > .d2h-file-side-diff");
    const delRow = panes[0].querySelector("tr td.d2h-del")?.closest("tr");
    const insRow = panes[1].querySelector("tr td.d2h-ins")?.closest("tr");

    assert.ok(delRow);
    assert.ok(insRow);
    assert.equal(rowMatchesCommentAnchor(delRow, 2, "RIGHT"), false);
    assert.equal(rowMatchesCommentAnchor(insRow, 2, "RIGHT"), true);
    assert.equal(rowMatchesCommentAnchor(delRow, 2, "LEFT"), true);
    assert.equal(rowMatchesCommentAnchor(insRow, 2, "LEFT"), false);
  });
});