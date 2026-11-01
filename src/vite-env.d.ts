/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  // Phase 24 (hrb_chatbot_service's own Phase 287) - the wake-up Lambda's
  // own Function URL, deliberately a different base URL from
  // VITE_API_BASE_URL since this one call must work even when
  // hrb-chatbot itself is fully paused. Unset until that Lambda is
  // provisioned - client.ts no-ops wakeUpChatbotService() when missing.
  readonly VITE_WAKE_UP_FUNCTION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
