import { prChatContextFromReport } from "../../src/pr-chat-context.js";
import { mountAssistantChatBody } from "./pr-chat-render.js";

/**
 * @param {{ prChat?: { messages: { role: string, content: string }[], draft?: string, busy?: boolean, provider?: string } } | null | undefined} session
 */
export function ensurePrChatState(session) {
  if (!session) return null;
  if (!session.prChat) {
    session.prChat = { messages: [], draft: "", busy: false, provider: "" };
  }
  if (!Array.isArray(session.prChat.messages)) session.prChat.messages = [];
  return session.prChat;
}

/**
 * @param {object | null} report
 */
export function buildPrChatContext(report) {
  if (!report) return null;
  try {
    return prChatContextFromReport(report);
  } catch {
    return null;
  }
}

/**
 * @param {HTMLElement} log
 * @param {string} role
 * @param {string} text
 */
function appendBubbleToLog(log, role, text) {
  const item = document.createElement("div");
  item.className = `cedar-pr-chat-bubble cedar-pr-chat-bubble-${role}`;
  const label = role === "user" ? "You" : "Cedar";
  item.innerHTML = `<p class="cedar-pr-chat-bubble-label">${label}</p><div class="cedar-pr-chat-bubble-body"></div>`;
  const body = item.querySelector(".cedar-pr-chat-bubble-body");
  if (body instanceof HTMLElement) {
    if (role === "assistant") void mountAssistantChatBody(body, text).then(() => scrollChatLog(log));
    else body.textContent = text;
  }
  log.appendChild(item);
}

/**
 * @param {HTMLElement} log
 */
function scrollChatLog(log) {
  log.scrollTop = log.scrollHeight;
}

/**
 * @param {HTMLElement} log
 * @param {{ role: string, content: string }[]} messages
 */
function paintChatLog(log, messages) {
  log.replaceChildren();
  for (const m of messages) {
    appendBubbleToLog(log, m.role, m.content);
  }
  scrollChatLog(log);
}

/**
 * Re-attach chat UI after a full results re-render (macro / slice background updates).
 */
export function refreshPrChatUiFromSession() {
  const session = window.__cedarSession;
  const state = ensurePrChatState(session);
  if (!state) return;

  const log = document.getElementById("cedar-pr-chat-log");
  const input = document.getElementById("cedar-pr-chat-input");
  const status = document.querySelector(".cedar-pr-chat-status");
  const sendBtn = document.querySelector(".cedar-pr-chat-send");

  if (log instanceof HTMLElement) paintChatLog(log, state.messages);
  if (input instanceof HTMLTextAreaElement && state.draft && !input.value.trim()) {
    input.value = state.draft;
  }

  const busy = Boolean(state.busy);
  if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = busy;
  if (input instanceof HTMLTextAreaElement) input.disabled = busy;
  if (status instanceof HTMLElement) {
    if (busy) {
      status.hidden = false;
      status.textContent = "Thinking…";
    } else if (state.provider) {
      status.hidden = false;
      status.textContent = state.provider;
    }
  }
}

/**
 * @param {ParentNode} root
 * @param {{ getContext: () => object | null, getToken?: () => string | undefined, getSession?: () => object | null }} opts
 */
export function wirePrChatSidebar(root, opts) {
  const form = root.querySelector(".cedar-pr-chat-form");
  const input = root.querySelector(".cedar-pr-chat-input");
  const log = root.querySelector(".cedar-pr-chat-log");
  const status = root.querySelector(".cedar-pr-chat-status");
  const sendBtn = root.querySelector(".cedar-pr-chat-send");
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLTextAreaElement) || !(log instanceof HTMLElement)) {
    return;
  }

  const state = ensurePrChatState(opts.getSession?.() ?? window.__cedarSession);
  if (!state) return;

  if (state.draft) input.value = state.draft;
  paintChatLog(log, state.messages);

  const setBusy = (busy) => {
    state.busy = busy;
    if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = busy;
    input.disabled = busy;
    if (status instanceof HTMLElement) {
      status.textContent = busy ? "Thinking…" : state.provider || "";
      status.hidden = busy ? false : !state.provider;
    }
  };

  setBusy(Boolean(state.busy));

  input.addEventListener("input", () => {
    state.draft = input.value;
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    const context = opts.getContext();
    if (!context) {
      if (status instanceof HTMLElement) {
        status.hidden = false;
        status.textContent = "Run a review first.";
      }
      return;
    }

    input.value = "";
    state.draft = "";
    state.messages.push({ role: "user", content: question });
    appendBubbleToLog(log, "user", question);
    scrollChatLog(log);
    setBusy(true);

    try {
      const res = await fetch("/api/pr-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: state.messages,
          context,
          token: opts.getToken?.(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Chat failed (${res.status})`);
      }
      const reply = String(data.reply ?? "").trim() || "(No response)";
      state.messages.push({ role: "assistant", content: reply });
      state.provider = data.provider ? String(data.provider) : state.provider;
      const activeLog = document.getElementById("cedar-pr-chat-log");
      if (activeLog instanceof HTMLElement && activeLog.isConnected) {
        appendBubbleToLog(activeLog, "assistant", reply);
        scrollChatLog(activeLog);
        if (status instanceof HTMLElement && state.provider) {
          status.hidden = false;
          status.textContent = state.provider;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.messages.push({ role: "assistant", content: msg });
      const activeLog = document.getElementById("cedar-pr-chat-log");
      if (activeLog instanceof HTMLElement && activeLog.isConnected) {
        appendBubbleToLog(activeLog, "assistant", msg);
        scrollChatLog(activeLog);
      }
    } finally {
      setBusy(false);
      refreshPrChatUiFromSession();
    }
  });

  window.__cedarRefreshPrChatUi = refreshPrChatUiFromSession;
}