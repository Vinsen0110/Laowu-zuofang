import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const bundle = await read("assets/index-B2KJ37fm.js");
const storage = await read("app-state-storage.js");

test("the canvas ships without the chat panel or local agent", () => {
    assert.doesNotMatch(bundle, /chatSessions|activeChatId|tool-chat|tool-agent|canvas-agent-|agentUrl|127\.0\.0\.1:17371/);
    assert.doesNotMatch(storage, /canvas-agent-/);
});

test("text generation still uses the Chat Completions endpoint", () => {
    assert.match(bundle, /\/chat\/completions/);
    assert.match(bundle, /async function prepareTextChatMessages\(/);
});
