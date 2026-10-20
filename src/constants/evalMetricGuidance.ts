// 2026-10-19 - pulled out of ExplainabilityModal.tsx so PipelineStepper's
// own golden-dataset-gate metrics (aggregated across 25 cases, not one
// live message) can show the exact same "what it means"/"how to improve"
// guidance instead of a second, drifting copy of the same text.

// Retrieval metric tuning guidance - grounded in this project's own real,
// tunable knobs (not generic RAG advice): chunking strategies
// (ai/doc_processing/chunking/text_chunker.py), search strategies
// (ai/rag_pipeline/query_retrieval/retriever.py), and the settings that
// actually exist (RAG_DEFAULT_TOP_K, RAG_MIN_PINECONE_SCORE, etc.).
export const RETRIEVAL_METRIC_GUIDANCE: Record<"precision" | "recall" | "f1", { what: string; why: string; tune: string[] }> = {
  precision: {
    what: "Out of the pieces of text (\"chunks\") pulled from your documents to answer this question, how many actually helped? A low score means some unrelated chunks got mixed in with the useful ones.",
    why: "In the \"Golden dataset reference\" panel below, a low score like 0.200 is expected and not a problem: that test only counts 1 correct document per question, so the math can never score above 0.200 no matter how good retrieval is - Recall is the number that actually matters there. The LIVE score above (for this real question) has no such limit, so a low number there is worth a closer look.",
    tune: [
      "Lower \"Top K\" in Settings - pulls in fewer, more selective chunks",
      "Raise the minimum match score so weak, barely-related matches get filtered out",
      "Try the \"MMR\" retrieval strategy, which avoids pulling in repetitive/overlapping chunks",
      "When documents are uploaded, use a smaller chunk size so each chunk stays focused on one topic instead of mixing in unrelated neighboring text.",
    ],
  },
  recall: {
    what: "Out of everything in your documents that could actually answer this question, how much did the system find? A low score means the right answer exists in the knowledge base but didn't come back in the search results.",
    why: "In the offline test below, this is the number that has to pass (at least 0.6) before anything can be released. For a real live question (above), there's no way to know for sure what \"everything relevant\" is, so the number shown is an ESTIMATE based on checking a wider set of candidate chunks, not a guaranteed exact value - hover the live panel's own caption for the pool size it checked. Either way, a low recall usually means something upstream: the right document isn't indexed yet, got split awkwardly so part of the answer is missing, or just didn't rank high enough to make the cut.",
    tune: [
      "Raise \"Top K\" in Settings - pulls in more chunks, raising the odds the right one is included",
      "Turn on \"Multi-Query\" - rephrases the question a few different ways before searching, which can catch a chunk the original wording missed",
      "Try the \"Hybrid\" retrieval strategy, which also catches exact keyword matches a meaning-based search alone can miss",
      "When documents are uploaded, chunk them so a complete answer stays together instead of getting split across chunk boundaries",
      "Double check the document was actually re-processed after it was last changed.",
    ],
  },
  f1: {
    what: "One score that balances Precision and Recall together - it drops if EITHER one is weak, even when the other looks great.",
    why: "In the offline test below, Precision is capped low by design (see Precision above), so F1 is capped along with it there too - check Recall first before worrying about a low offline F1. The live F1 (above) is calculated directly from the live Precision/Recall numbers next to it, so it carries the same \"estimate\" caveat Recall has.",
    tune: [
      "Usually this is about finding the right \"Top K\" balance, not one single fix - too low favors Precision over Recall, too high does the opposite.",
      "Make sure the chunking approach matches the document's own structure (a table-heavy document needs different handling than plain paragraphs) before fine-tuning Top K further.",
    ],
  },
};

// Phase 223 - same spirit as RETRIEVAL_METRIC_GUIDANCE, for the other half
// of eval scoring: is the ANSWER good, given whatever context it got.
// Grounded in this project's own real knobs, not generic RAG advice.
export const RESPONSE_METRIC_GUIDANCE: Record<"groundedness" | "completeness", { what: string; why: string; tune: string[] }> = {
  groundedness: {
    what: "Does the answer actually come from the documents it was given, or did the AI add something that isn't really in them (called a \"hallucination\")?",
    why: "The AI is already told to only use the documents it was given and never invent information. So a low score here usually doesn't mean the instructions are wrong - it usually means the documents handed to it didn't clearly contain what it needed, so it filled the gap itself. Check the Retrieval Eval Score tab first.",
    tune: [
      "Check the Retrieval Eval Score tab first - weak retrieval is very often the real cause, not a prompt problem",
      "Lower \"Temperature\" in Settings - makes answers more conservative and less likely to drift away from the given documents",
      "A more focused chunking approach at upload time reduces confusing or incomplete context the AI has to guess around.",
    ],
  },
  completeness: {
    what: "Does the answer cover everything that was actually asked, not just the easiest part of the question?",
    why: "A low score here usually means the question needed more information than what was actually retrieved - either because it was really two questions in one, or because the full answer was spread across more chunks/documents than the system pulled in.",
    tune: [
      "Raise \"Top K\" in Settings - brings in more context for the AI to work with",
      "Turn on \"Multi-Query\" so the question gets rephrased a few different ways before searching, catching anything the original wording missed",
      "Try the \"Hybrid\" or \"MMR\" retrieval strategy for broader coverage",
      "If the question was really two questions in one, check the Engineering Trace tab to confirm it was actually split into separate sub-questions.",
    ],
  },
};
