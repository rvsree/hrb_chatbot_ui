import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Drives real multi-turn conversations from hrb_chatbot_service's own
// resources/golden_dataset/golden_dataset_conversational.json through the
// REAL live UI (TEST_BASE_URL=https://hrb-chatbot-ui.rvsree.dev) - not a
// direct API call. The point is to exercise the whole real stack exactly
// as a real user would: login -> Gateway -> backend -> conversation memory
// (Redis STM/LTM) -> the chosen mode's real pipeline (genai-rag's fixed
// retrieve-then-generate, single-agentic-rag's ReAct tool-calling loop, or
// multi-agentic-rag's LangGraph Planner/domain-agents/Reviewer graph) ->
// back to the rendered message bubble.
//
// This reads the dataset from a SIBLING checkout of hrb_chatbot_service
// (../../hrb_chatbot_service, matching how this workspace actually has
// both repos checked out side by side) - not copied into this repo, since
// hrb_chatbot_service owns the one real golden dataset. Skips cleanly if
// that sibling checkout isn't present, same convention
// admin-doc-links.spec.ts already uses for a missing prerequisite.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(
  __dirname,
  "../../hrb_chatbot_service/resources/golden_dataset/golden_dataset_conversational.json",
);

interface ConversationalTurn {
  query: string;
  expects_keywords_any?: string[];
  expect_decline?: boolean;
  requires_memory_of_turn?: number | null;
  note?: string;
}

interface ConversationalCase {
  id: string;
  category: string;
  mode: "genai-rag" | "single-agentic-rag" | "multi-agentic-rag";
  persona: { employee_id: string; full_name: string; role: string };
  turns: ConversationalTurn[];
}

function loadDataset(): ConversationalCase[] {
  const raw = readFileSync(DATASET_PATH, "utf-8");
  return (JSON.parse(raw) as { cases: ConversationalCase[] }).cases;
}

let dataset: ConversationalCase[] = [];
try {
  dataset = loadDataset();
} catch {
  dataset = [];
}

// Declining language the input/output guardrails actually use - matches
// hrb_chatbot_service's own guardrails_input.py/guardrails_output.py
// prompts (CODING-STANDARDS.md's own refusal convention), not guessed.
const DECLINE_PATTERNS = [
  /blocked by a safety check/i,
  /i don't have (that|this|any) information/i,
  /i don't know/i,
  /outside (the scope|what i can help with)/i,
  /i can('t| not) (help|assist) with/i,
  /not something i can answer/i,
  /not (available|found) in (the|my) knowledge base/i,
];

async function login(page: Page, persona: ConversationalCase["persona"]) {
  await page.goto("/login");
  await page.locator("#employee-id").fill(persona.employee_id);
  await page.locator("#full-name").fill(persona.full_name);
  await page.locator("#role").selectOption(persona.role);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/chat/);
}

async function selectMode(page: Page, mode: ConversationalCase["mode"]) {
  // #mode-select lives inside the Settings popup modal (moved there
  // 2026-10-21, per ConversationSidebar.tsx) - it isn't in the DOM/visible
  // until the gear-icon "Settings" button is clicked. Found live: the
  // first version of this test timed out 30s waiting for #mode-select
  // because it tried to select it on the bare chat page.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#mode-select").selectOption(mode);
  await page.getByRole("button", { name: "Close" }).click();
}

async function sendTurn(page: Page, query: string): Promise<string> {
  const textarea = page.locator("textarea");
  await textarea.fill(query);
  await page.locator('button[type="submit"]').click();

  // Wait for the typing indicator to appear then disappear - a real
  // genai-rag/single-agentic/multi-agentic call can take 10-60s (measured
  // live this session), so this needs real headroom, not a short default.
  await page.locator(".message-typing").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  await page.locator(".message-typing").waitFor({ state: "hidden", timeout: 90_000 });

  const assistantMessages = page.locator(".message.message-assistant .message-text");
  const lastMessage = assistantMessages.last();
  await expect(lastMessage).toBeVisible();
  return lastMessage.innerText();
}

function matchesAny(responseText: string, keywords: string[]): boolean {
  const lower = responseText.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function looksLikeADecline(responseText: string): boolean {
  return DECLINE_PATTERNS.some((pattern) => pattern.test(responseText));
}

// playwright.config.ts's own default test timeout is 30s - fine for
// click-and-assert UI tests, nowhere near enough for a real LLM round
// trip (measured 10-60s per turn this session) plus login/page-load
// overhead. Each test below sets its own generous timeout explicitly.
test.describe("state management - conversation survives a reload", () => {
  // Proves conversation memory is real server-side state (Postgres
  // conversation_store + Redis STM/LTM), not just React state that a
  // reload would wipe - identity persists via localStorage (see
  // IdentityContext.tsx), but the conversation itself must come back from
  // a real GET /v1/conversations + GET /v1/conversations/{id} call.
  test("a conversation's history is still there after a hard reload", async ({ page }) => {
    test.setTimeout(120_000);
    const persona = { employee_id: "EMP045", full_name: "Edward Edwards", role: "employee" };
    await login(page, persona);
    // Explicit - the default is multi-agentic-rag, not genai-rag; this test
    // only cares about persistence, so the fastest real mode is enough.
    await selectMode(page, "genai-rag");

    const question = "What percentage does JPMorgan Chase match on my 401(k) contributions?";
    const firstAnswer = await sendTurn(page, question);
    expect(matchesAny(firstAnswer, ["100%", "dollar-for-dollar", "5%"])).toBe(true);

    await page.reload();
    await page.waitForURL(/\/chat/);

    const conversationItem = page.locator(".conversation-item").first();
    await expect(conversationItem).toBeVisible({ timeout: 15_000 });
    await conversationItem.click();

    const userMessages = page.locator(".message.message-user .message-text");
    await expect(userMessages.last()).toContainText(question, { timeout: 15_000 });

    const assistantMessages = page.locator(".message.message-assistant .message-text");
    const restoredAnswer = await assistantMessages.last().innerText();
    expect(
      matchesAny(restoredAnswer, ["100%", "dollar-for-dollar", "5%"]),
      "The restored answer after reload should be the same real answer, re-fetched from the server, not blank or re-generated differently",
    ).toBe(true);
  });
});

test.describe("golden dataset - conversational", () => {
  test.skip(dataset.length === 0, "golden_dataset_conversational.json not found - check out hrb_chatbot_service as a sibling directory");

  for (const conversation of dataset) {
    test(`${conversation.id} (${conversation.mode}, ${conversation.category})`, async ({ page }) => {
      // Up to 3 turns, each up to 90s for a real LLM round trip (more for
      // multi-agentic-rag's own multi-step graph), plus login/mode-select.
      test.setTimeout(5 * 60_000);
      await login(page, conversation.persona);

      // Always select explicitly - ChatPage.tsx's own default is
      // "multi-agentic-rag" (confirmed by reading its useState call), not
      // "genai-rag" as this test originally assumed, so a genai-rag case
      // left unselected was silently running as multi-agentic-rag instead.
      await selectMode(page, conversation.mode);

      const turnResponses: string[] = [];

      for (let turnIndex = 0; turnIndex < conversation.turns.length; turnIndex++) {
        const turn = conversation.turns[turnIndex];
        const responseText = await sendTurn(page, turn.query);
        turnResponses.push(responseText);

        if (turn.expect_decline) {
          expect(
            looksLikeADecline(responseText),
            `Turn ${turnIndex} ("${turn.query}") expected a decline/refusal, got: ${responseText.slice(0, 200)}`,
          ).toBe(true);
          continue;
        }

        if (turn.expects_keywords_any && turn.expects_keywords_any.length > 0) {
          const memoryNote =
            turn.requires_memory_of_turn != null
              ? ` (depends on remembering turn ${turn.requires_memory_of_turn})`
              : "";
          expect(
            matchesAny(responseText, turn.expects_keywords_any),
            `Turn ${turnIndex} ("${turn.query}")${memoryNote} - expected one of [${turn.expects_keywords_any.join(", ")}], got: ${responseText.slice(0, 300)}`,
          ).toBe(true);
        }
      }
    });
  }
});
