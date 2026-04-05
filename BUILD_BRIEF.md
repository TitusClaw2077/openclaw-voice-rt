# Build Brief: Low-Latency Realtime Voice Conversation Engine
**Version:** 0.1 | **Status:** Draft | **Author:** Titus
**Date:** 2026-04-05

---

## Problem Statement

The current `@openclaw/voice-call` plugin works for notify-style and simple scripted calls, but delivers 5–8 second end-to-end latency per conversational turn. This makes real phone conversation feel like a slow IVR, not a live assistant. The cause is architectural: every user utterance triggers a full embedded-agent execution (session bootstrap, prompt reconstruction, tool orchestration, full TTS synthesis) before any audio plays back.

This brief describes a targeted architectural patch to the existing plugin that introduces a **persistent realtime conversation engine** as a selectable mode — leaving the current behavior intact as a fallback.

---

## Goal

Cut conversational turn latency from **5–8s** down to **~1s good turns / ~2s typical turns**.

Make Titus usable as a real phone assistant, not just a call notifier.

---

## Non-Goals (for this release)

- Replacing the entire voice-call plugin
- Supporting Telnyx / Plivo in realtime mode
- Full agentic tool use during live conversation (Phase 2)
- WebRTC-native transport
- Studio-quality voice cloning
- Multimodal / vision on calls
- Building a SIP/PBX platform

---

## Architecture

### What changes vs. what stays

**Stays:**
- Twilio webhook server + signature verification + replay protection
- Host/proxy trust controls (Tailscale/ngrok hardening)
- Media stream pre-auth throttling + start-frame timeout
- Inbound allowlist / caller ID filtering
- TTS queue serialization + barge-in clear logic
- Stale call reaper
- CLI / gateway RPC surface (`voicecall.initiate`, `.speak`, `.end`, `.status`)
- Call persistence / JSONL log
- Legacy conversation mode (current behavior)

**Adds:**
- Conversation engine abstraction layer
- `legacy-engine` (current code, moved behind interface)
- `realtime-engine` (new persistent per-call session)
- Per-call `VoiceSessionWorker`
- Streaming TTS adapter
- New config options
- Latency observability (per-turn event timeline)

---

## Data Flow (New Realtime Path)

```
Caller
  → Twilio PSTN
  → Twilio Voice Webhook (TwiML → Connect → Stream)
  → Twilio Media Stream WebSocket
  → MediaIngress (frame dispatch)
  → VoiceSessionWorker (persistent, one per active call)
      ↔ OpenAI Realtime STT (already hot, per-call WS)
      ↔ Response Engine (persistent, NOT per-turn agent startup)
      ↔ Tool Bridge (limited, deadline-enforced)
  → StreamingTTSAdapter (audio frames as generated, not after full synthesis)
  → Twilio Media Stream WebSocket
  → Caller
```

---

## Component Map

| Component | New/Changed | Responsibility |
|---|---|---|
| `VoiceCallWebhookServer` | Minimal change | Webhook + provider auth only. Stops owning response logic. |
| `MediaIngress` | Refactored | Twilio socket management, raw frame dispatch, barge-in/clear hooks. Inject stream session adapter. |
| `VoiceSessionSupervisor` | **New** | Lifecycle owner for per-call workers. Crash/restart policy. |
| `VoiceSessionWorker` | **New** | Hot in-memory actor per active call. Owns state, rolling memory, response loop, TTS stream. |
| `legacy-engine` | Refactored from current | Current behavior behind the engine interface. |
| `realtime-engine` | **New** | Persistent session, live audio in/out, barge-in, no per-turn agent startup. |
| `StreamingTTSAdapter` | **New** | Emits audio frames incrementally instead of waiting for full synthesis. |
| `ToolBridge` | **New** | Controlled tool subset, strict deadlines, cancellation. Off by default in realtime mode. |
| `TranscriptStore` | Improved | Append-only + rolling compact summary. Stops rebuilding full history each turn. |
| `response-generator.ts` | Keep, legacy only | Still used for full-agent mode / post-call summaries. Not on realtime hot path. |

---

## New Config Shape

```json
{
  "conversationEngine": "legacy | realtime",

  "realtime": {
    "provider": "openai-realtime",
    "model": "gpt-4o-realtime-preview",
    "voice": "onyx",
    "instructions": "You are Titus, David's AI assistant...",
    "toolsEnabled": false,
    "fallbackToLegacyOnError": true,
    "idleTimeoutMs": 30000,
    "maxResponseMs": 8000
  }
}
```

---

## Call State Model (Realtime Engine)

```
connecting
  → ready (stream + realtime session established)
  → user_speaking
  → finalizing_transcript
  → reasoning (model generating)
  → tool_wait (optional, gated)
  → speaking (TTS streaming)
  → interrupted (barge-in detected → back to user_speaking)
  → recovering (backend dropped → reconnecting)
  → degraded (realtime failed → legacy fallback or hangup)
  → ended
```

---

## Latency Budget (Target)

| Segment | Budget |
|---|---|
| Telephony transport | 100–200ms |
| VAD turn-end decision | 150–250ms |
| STT finalize | 100–200ms |
| Model first token | 150–300ms |
| TTS first chunk ready | 100–200ms |
| Playout to caller | 100–200ms |
| **Total speech-end → first audio p95** | **< 1200ms** |

Current typical: 5000–8000ms.

---

## Milestones

### M0 — Observability & Feature Flag (Low effort, ~2–3 days)
**Do this first. Measure before changing anything.**

- Add per-call latency event timeline to call JSONL:
  - stream connected
  - first speech detected
  - final transcript received
  - model response start
  - first audio byte out
  - response end
  - barge-in events
  - reconnect events
- Add `conversationEngine` config key (defaults to `legacy`)
- Gate all new code behind the flag

**Deliverable:** Can measure current latency per segment. Zero behavior change.

---

### M1 — Engine Abstraction (Medium effort, ~3–5 days)
**Structural refactor. No user-visible change.**

New interface:
```typescript
interface ConversationEngine {
  onCallConnected(call: CallRecord): Promise<void>
  onSpeechStart(callId: string): void
  onFinalTranscript(callId: string, text: string): Promise<void>
  speak(callId: string, text: string): Promise<void>
  interrupt(callId: string): void
  onCallEnded(callId: string): Promise<void>
}
```

Changes:
- Move current behavior into `src/conversation/legacy-engine.ts`
- `src/webhook.ts` delegates response callbacks to engine instead of owning them
- `src/media-stream.ts` injects a per-call stream session adapter
- `src/runtime.ts` instantiates and wires the selected engine

**Deliverable:** Current behavior fully intact via `legacy-engine`. New engine slot is wired but empty.

---

### M2 — Realtime Engine MVP, Twilio-Only, No Tools (High effort, ~1–2 weeks)
**This is the release that changes how it feels.**

Core pieces:
- `src/conversation/realtime-engine.ts`
- Persistent per-call realtime session (WebSocket to OpenAI Realtime or equivalent)
- Live inbound audio forwarding from MediaIngress
- Live outbound assistant audio streaming back to Twilio
- Barge-in: speech start → cancel TTS → clear Twilio buffer
- Transcript mirroring into CallRecord
- Initial greeting / outbound intro on connect
- Worker crash/restart via supervisor

Key constraints:
- Twilio provider only
- Tools disabled
- `fallbackToLegacyOnError: true` when realtime unavailable

**Deliverable:** `conversationEngine: realtime` produces fast, natural phone conversation with no tool access.

---

### M3 — Fallback & Resiliency (Medium/High effort, ~3–5 days)
**Don't strand calls.**

- If realtime session drops → attempt reconnect with call summary context
- If reconnect fails → play "One second, bear with me" → fall back to legacy
- If TTS fails → fall back to TwiML `<Say>`
- Rate limiting for unknown inbound callers
- Stuck session detection/reaping
- Reconnect telemetry

**Deliverable:** Degraded sessions recover or fail gracefully. No dead air.

---

### M4 — Limited Tool Support (High effort, ~2 weeks)
**Do this after M2 and M3 are stable.**

Two options (recommend starting with Option A):

**Option A — Escalation pattern**
- Realtime engine handles conversation
- When tool use is needed, assistant says "One second, let me check that"
- Escalates to background tool worker
- Returns result to realtime session
- Resumes conversation

**Option B — Inline fast-tool bridge**
- Small allowlist of safe/fast tools
- Called inline with strict deadline (< 2s)
- Fallback: acknowledge and defer if tool is too slow

**Deliverable:** Titus can do simple tool-backed tasks (check calendar, send a message) without stalling the call.

---

## Security Checklist

Items the realtime engine must preserve or add:

- [ ] Twilio webhook signature verification on every request (no weakening)
- [ ] Replay protection cache (no weakening)
- [ ] Media stream pre-auth throttling (keep + extend to per-call)
- [ ] Stream auth token scoped to individual call (single-use or expiry policy)
- [ ] Explicit cleanup of realtime session/WS on call end or disconnect
- [ ] Rate limiting for unauthenticated inbound callers
- [ ] Tool surface restricted by default on live calls
- [ ] No broad tool access for unknown inbound callers
- [ ] Transcript retention policy configuration
- [ ] Inbound caller prompt injection mitigation (sanitize transcript before injecting into model context)
- [ ] Cross-call session contamination prevention (caller number → session key must not leak context between calls)

---

## Validation / Acceptance Criteria

### State machine correctness
- [ ] Call answered → stream connected → worker created
- [ ] User speaks → transcript final → response begins without agent startup overhead
- [ ] Barge-in detected → TTS cancels within 250ms → Twilio clear sent
- [ ] Stream disconnects transiently → reconnect attempted before call end
- [ ] Call ends → all resources (realtime session, WS, worker, memory) cleaned up
- [ ] Concurrent calls handled independently, no shared mutable state

### Latency
- [ ] Measure speech-end → first audio p50 and p95 before and after
- [ ] p95 < 1200ms in good conditions
- [ ] Degraded mode still responds (with apology) within 5s

### Twilio behavior
- [ ] Outbound call initiates, connects, plays greeting
- [ ] Inbound call from allowlisted number connects correctly
- [ ] TwiML `<Connect><Stream>` connects and stays stable for 5+ minute calls
- [ ] Barge-in sends `<Clear>` to Twilio correctly
- [ ] Call ends cleanly via hangup (caller or bot-initiated)
- [ ] Twilio `<Gather>` path still works in legacy mode

### Security
- [ ] Replayed webhook is rejected (replay cache)
- [ ] Invalid Twilio signature rejected
- [ ] Stream with invalid token rejected
- [ ] Unknown inbound caller blocked when inboundPolicy=allowlist
- [ ] Call ends → realtime session WS closed
- [ ] Prompt injection attempt via voice does not leak workspace context

### Failure recovery
- [ ] Realtime backend drops → reconnect attempt fires
- [ ] Reconnect fails → fallback to legacy or graceful hangup, no dead air
- [ ] STT connection fails → call does not become a zombie
- [ ] TTS fails → fallback to TwiML `<Say>` or brief apology

### Observability
- [ ] Per-call event timeline available in JSONL log
- [ ] Per-segment latency logged (STT, model, TTS, total)
- [ ] Reconnects, barge-ins, fallback-activations counted
- [ ] Fatal errors surfaced with callId + providerCallId correlation

---

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Tool use in realtime is hard | High | Defer to M4. Keep M2 tool-free. |
| Twilio reconnect behavior is unpredictable | High | Short disconnect grace window + reconnect timeout. |
| OpenAI Realtime API availability/cost | Medium | `fallbackToLegacyOnError: true` |
| Barge-in timing causes double-response | Medium | Strict state machine, suppress stale completions |
| Cross-call context leak via phone number key | Medium | Explicit scope per callId, not per phone number |
| Persistent sessions are more expensive | Low/Medium | Measure actual cost. Cap maxConcurrentCalls. |
| Media path control (Twilio `<Gather>` vs live stream) split | Medium | Realtime mode never uses `<Gather>`. Legacy mode keeps it. |

---

## Suggested Coding Task Sequence

For a coding agent (Claude Code / Codex):

1. **M0:** Add `ConversationLatencyLog` to CallRecord. Log timestamps per turn in JSONL. Add `conversationEngine` feature flag.

2. **M1a:** Create `src/conversation/base.ts` with `ConversationEngine` interface.

3. **M1b:** Move current `handleInboundResponse()` into `src/conversation/legacy-engine.ts` that implements the interface.

4. **M1c:** Refactor `src/webhook.ts` to delegate `onFinalTranscript` to the engine. Refactor `src/media-stream.ts` to inject session adapter.

5. **M1d:** Update `src/runtime.ts` to wire selected engine via config.

6. **M2a:** Implement `VoiceSessionWorker` and `VoiceSessionSupervisor`.

7. **M2b:** Implement `realtime-engine.ts`. Persistent per-call WebSocket session. Live audio forwarding in/out.

8. **M2c:** Implement `StreamingTTSAdapter` that emits audio incrementally.

9. **M2d:** Add barge-in state handling. Cancel + clear on speech start while speaking.

10. **M3:** Add reconnect logic, fallback policy, rate limiting.

11. **M4:** Design tool bridge API. Implement escalation pattern.

---

## Open Questions

- Which model should own the live loop: OpenAI Realtime end-to-end, or STT + text model + TTS?
- Should this ship as an in-plugin update or eventually a new `@openclaw/voice-call-rt` package?
- What's the acceptable cost per call minute at scale?
- Should transcripts be retained by default or opt-in?
- Full duplex vs strict half-duplex? (PSTN quality generally favors half-duplex reliability)

---

## Bottom Line

The current plugin is not bad. It just has the wrong hot path for conversation.

The fix is architectural:
- persistent live session per call
- streaming audio out as generated
- fast model
- barge-in
- degrade gracefully

This is a real engineering project, not a config tweak. Estimated total effort (solo engineer):
- **M0–M2 (usable realtime voice):** 3–4 weeks
- **M3 (production resiliency):** +1 week
- **M4 (tool support):** +2–3 weeks

The good news: **the foundations are there**. This isn't a rewrite. It's a targeted structural patch with a new engine bolted in next to the existing one.
