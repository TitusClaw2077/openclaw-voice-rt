/**
 * test-worker.mjs
 *
 * Isolation test for VoiceSessionWorker.
 * Run with: node test-worker.mjs
 * Requires: OPENAI_API_KEY env var set
 * No Twilio, no OpenClaw, no phone needed.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY env var is not set");
  process.exit(1);
}

const CALL_ID = "test-call-001";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SYSTEM_PROMPT = "You are a concise, conversational voice assistant on a phone call.";

const SYSTEM_PROMPT = `You are Titus, David's AI assistant. Sharp, direct, dry humor. Keep responses to 1-3 sentences max. You are on a phone call.

IMPORTANT: If the user asks you to perform an action (check calendar, look something up, send a message, get the weather, set a reminder, find something, etc.), respond ONLY with this JSON:
{"escalate":true,"spoken":"One moment, let me check on that.","task":"brief task description"}

For normal conversation, respond with plain text only.`;

function tryParseEscalation(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.escalate === true) {
      return {
        spoken: typeof parsed.spoken === "string" ? parsed.spoken.trim() : "Let me look into that.",
        task: typeof parsed.task === "string" ? parsed.task.trim() : "unknown task"
      };
    }
  } catch {}
  return null;
}

async function ask(userMessage) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage }
  ];
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages })
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

async function runTest(label, userMessage, expectEscalation) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log(`USER: "${userMessage}"`);

  const start = Date.now();
  try {
    const raw = await ask(userMessage);
    const latency = Date.now() - start;
    const esc = tryParseEscalation(raw);

    console.log(`RAW: ${raw}`);
    console.log(`LATENCY: ${latency}ms`);

    if (esc) {
      console.log(`→ ESCALATED | spoken: "${esc.spoken}" | task: "${esc.task}"`);
    } else {
      console.log(`→ NORMAL REPLY`);
    }

    const matched = expectEscalation === !!esc;
    console.log(matched ? "✅ PASS" : `⚠️ EXPECTED ${expectEscalation ? "ESCALATION" : "NORMAL"}`);
  } catch (err) {
    console.error(`❌ ERROR: ${err.message}`);
  }
}

(async () => {
  console.log("🧪 VoiceSessionWorker Isolation Test");
  console.log(`Model: gpt-4o-mini | Key: ${OPENAI_API_KEY.slice(0,10)}...`);

  await runTest("Greeting",          "Hey, what's up?",                             false);
  await runTest("Simple question",   "How are you doing today?",                    false);
  await runTest("Weather",           "What's the weather like today?",              true);
  await runTest("Calendar check",    "Can you check my calendar for tomorrow?",     true);
  await runTest("Set a reminder",    "Remind me to call mom at 5pm",               true);
  await runTest("Topic discussion",  "Tell me something interesting about rockets", false);

  console.log(`\n${"═".repeat(60)}`);
  console.log("Done. Review:");
  console.log("  ✅ Normal replies → plain text, no JSON, low latency");
  console.log("  ✅ Tool requests  → escalation JSON + spoken ACK");
  console.log("  ✅ Latency        → target under 3000ms per turn");
  console.log(`${"═".repeat(60)}\n`);
})();
