# Surface F — Telegram Approval Channel

Date: 2026-07-10
Status: **PASS** — Live Telegram CONFIRM approval confirmed working

## Setup

1. Create bot via [@BotFather](https://t.me/BotFather) → get `TELEGRAM_BOT_TOKEN`
2. Send `/start` to your bot → get `TELEGRAM_CHAT_ID` from `getUpdates`
3. Store in `.env` (excluded from git)

## Test Results

| Test | Method | Result |
|---|---|---|
| Bot connectivity | `getMe` API | OK — `@browser_agentu_bot` |
| Send message | `sendMessage` API | OK — message delivered to chat |
| Approve callback | Real Telegram click | **PASS** — `allow — Human approved via telegram` (24.4s) |
| Deny callback | Mock test | **PASS** — `deny — Approval timed out or denied` |
| Timeout (no response) | Mock test | **PASS** — returns `false` after timeout |
| Lazy Bot init | Mock test | **PASS** — Bot created on first `request()` call |
| Ignore other messages | Mock test | **PASS** — only responds to the correct `message_id` |

## Live Approve Test Flow

```
1. createHookServer({ approvalChannel: new TelegramApprovalChannel(token, chatId) })
2. SessionStart → mints token
3. PreToolUse with CONFIRM policy → channel.request() called
4. Bot sends Telegram message with Approve/Deny inline buttons
5. Channel polls getUpdates() every ~1s until timeout or callback
6. User clicks Approve → callback_query with data="warden_approve"
7. Channel returns true → handler returns "allow"
```

## Notes

- Default timeout: 60s (capped at 60s by `Math.min(req.timeoutMs, 60_000)`)
- Uses `grammy` library for Bot API
- Polls via `getUpdates` (no webhook needed — simpler for testing)
- Stale callbacks from previous tests can interfere (same bot token) — fix by calling `getUpdates` with high offset before test

## Raw logs

```
{"timestamp":"...","level":"INFO","component":"hook-server","message":"Warden hook server initializing.","port":18451,"logLevel":"INFO","dbPath":"memory","approvalChannel":"TelegramApprovalChannel","sharedSecretAuth":"disabled"}
Result (24.4s): allow — Human approved via telegram
```
