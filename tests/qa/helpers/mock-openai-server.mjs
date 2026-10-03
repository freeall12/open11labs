// QA helper: OpenAI-compatible local mock provider, loopback only.
// Source: 2026-10-03 baseline browser QA (agent A), productized 2026-10-03.
// Generates a legal WAV programmatically; zero external calls, zero real keys.
// Provider 注册一律走 API/测试（用户 2026-10-03 决定：浏览器不做凭据表单输入）。
//
// Library use:
//   import { startMockOpenAI } from "./helpers/mock-openai-server.mjs";
//   const mock = await startMockOpenAI({ port: 0 }); // ephemeral port
//   mock.port; mock.seen; // { models, speech, chat, other }
//   await mock.close();
//
// CLI use (fixed port for browser E2E against a running app server):
//   node tests/qa/helpers/mock-openai-server.mjs [port]   # default 5190
import http from "node:http";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Minimal legal WAV: 440Hz sine, 16-bit mono, 8kHz, ~0.5s. */
function wavBytes() {
  const sampleRate = 8000, seconds = 0.5;
  const n = sampleRate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round((Math.sin((2 * Math.PI * 440 * i) / sampleRate)) * 12000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * @param {{ port?: number, logPath?: string }} [opts]
 * @returns {Promise<{ server: import("node:http").Server, port: number, seen: { models: number, speech: number, chat: number, other: number }, requests: string[], close: () => Promise<void> }>}
 */
export function startMockOpenAI(opts = {}) {
  const seen = { models: 0, speech: 0, chat: 0, other: 0 };
  const requests = [];
  const logPath =
    opts.logPath ?? join(mkdtempSync(join(tmpdir(), "o11-mock-openai-")), "requests.log");

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization ?? "(none)";
      const record = `${req.method} ${req.url} auth=${auth}`;
      requests.push(record);
      appendFileSync(logPath, `${new Date().toISOString()} ${record}\n`);

      if (req.url === "/v1/models" && req.method === "GET") {
        seen.models++;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          object: "list",
          data: [{ id: "mock-tts", object: "model" }, { id: "mock-chat", object: "model" }],
        }));
      }
      if (req.url === "/v1/audio/speech" && req.method === "POST") {
        seen.speech++;
        const wav = wavBytes();
        res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
        return res.end(wav);
      }
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        seen.chat++;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          id: "chatcmpl-mock", object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "mock-chat-reply" } }],
        }));
      }
      seen.other++;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "mock: not found" } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        seen,
        requests,
        logPath,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// CLI mode.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 5190);
  const mock = await startMockOpenAI({ port });
  console.log(`mock openai-compatible on http://127.0.0.1:${mock.port} (log: ${mock.logPath})`);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}
