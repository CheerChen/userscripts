import http from "node:http";
import { readFile, mkdir, writeFile, chmod, realpath } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const stateDir = resolve(
  homedir(),
  ".local/state/userscripts-scriptcat",
);
const port = 8642;
const allowedOrigins = new Set([
  "chrome-extension://ndcooeababalnlpkfedmmbbbgkljhpjf",
  "chrome-extension://jaehimmlecjmebpekkipmpmbpfhdacom",
]);

export async function control(action, data = {}) {
  const token = (
    await readFile(resolve(stateDir, "control.token"), "utf8")
  ).trim();
  const response = await fetch(`http://127.0.0.1:${port}/control/${action}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function scriptFile(input) {
  const path = await realpath(resolve(root, input));
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel) || !path.endsWith(".user.js")) {
    throw new Error("Only .user.js files inside this repository can be synced");
  }
  const script = await readFile(path, "utf8");
  if (
    !script.includes("// ==UserScript==") ||
    !script.includes("// ==/UserScript==")
  ) {
    throw new Error("Missing userscript metadata");
  }
  return { path, script };
}

async function serve() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const token = randomBytes(32).toString("hex");
  const watched = new Map();
  const watchState = resolve(stateDir, "watched.json");
  const saveWatches = () =>
    writeFile(watchState, JSON.stringify([...watched.values()]), {
      mode: 0o600,
    });
  let client;
  let handshaken = false;
  let lastSent = null;
  const send = async (file, identity = file) => {
    if (!client || client.readyState !== WebSocket.OPEN || !handshaken) {
      throw new Error(
        "ScriptCat is not connected; open Tools and connect to ws://127.0.0.1:8642",
      );
    }
    const source = await scriptFile(file);
    const target = await scriptFile(identity);
    const uri = pathToFileURL(target.path).href;
    client.send(
      JSON.stringify({
        action: "onchange",
        data: { script: source.script, uri },
      }),
    );
    lastSent = {
      file: relative(root, source.path),
      identity: relative(root, target.path),
      at: new Date().toISOString(),
    };
    console.log(JSON.stringify({ event: "sent", ...lastSent }));
    return { sent: true, ...lastSent }; // Protocol has no install acknowledgement.
  };
  const remember = async (file) => {
    const { path } = await scriptFile(file);
    if (watched.has(path)) return;
    watched.set(path, file);
    watchFile(path, { interval: 300 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return;
      send(file).catch((error) =>
        console.error(
          JSON.stringify({ event: "sync-error", file, error: error.message }),
        ),
      );
    });
    await saveWatches();
  };
  let previousWatches = [];
  try {
    previousWatches = JSON.parse(await readFile(watchState, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const file of previousWatches) await remember(file);
  const json = (response, status, body) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(body));
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname === "/__fixture/data")
        return json(response, 200, { fixture: "gm-request-ok" });
      if (url.pathname === "/__fixture") {
        response.writeHead(200, {
          "content-type": "text/html",
          "cache-control": "no-store",
        });
        response.end(
          '<!doctype html><html><head><title>ScriptCat automation fixture</title></head><body><h1>ScriptCat automation fixture</h1><main id="fixture"></main>' +
            (url.searchParams.has("child")
              ? ""
              : '<iframe title="Cross-origin fixture" src="http://localhost:8642/__fixture?child=1"></iframe>') +
            "</body></html>",
        );
        return;
      }
      const authorization = Buffer.from(request.headers.authorization || "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        request.method !== "POST" ||
        authorization.length !== expected.length ||
        !timingSafeEqual(authorization, expected)
      ) {
        return json(response, 403, { error: "Forbidden" });
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 16384) throw new Error("Control request too large");
      }
      const data = JSON.parse(body || "{}");
      if (url.pathname === "/control/status") {
        return json(response, 200, {
          connected: !!client && handshaken,
          watched: [...watched.values()],
          lastSent,
        });
      }
      if (url.pathname === "/control/sync") {
        if (data.watch) await remember(data.file);
        return json(
          response,
          200,
          await send(data.file, data.identity || data.file),
        );
      }
      if (url.pathname === "/control/unwatch") {
        const { path } = await scriptFile(data.file);
        unwatchFile(path);
        watched.delete(path);
        await saveWatches();
        return json(response, 200, { unwatched: data.file });
      }
      return json(response, 404, { error: "Unknown command" });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  server.on("upgrade", (request, socket, head) => {
    if (
      !allowedOrigins.has(request.headers.origin) ||
      client?.readyState === WebSocket.OPEN
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws),
    );
  });
  wss.on("connection", (ws) => {
    client = ws;
    handshaken = false;
    ws.on("message", (raw) => {
      try {
        if (JSON.parse(raw.toString()).action !== "hello") return;
        handshaken = true;
        console.log(JSON.stringify({ event: "scriptcat-connected" }));
        for (const file of watched.values())
          send(file).catch((error) => console.error(error.message));
      } catch {
        ws.close(1003, "Invalid message");
      }
    });
    ws.on("close", () => {
      if (client === ws) {
        client = undefined;
        handshaken = false;
      }
    });
    ws.on("error", (error) =>
      console.error(
        JSON.stringify({ event: "ws-error", error: error.message }),
      ),
    );
    ws.send(JSON.stringify({ action: "hello" }));
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  // Publish the token only after acquiring the port, never overwrite an active server's token.
  await writeFile(resolve(stateDir, "control.token"), token, { mode: 0o600 });
  console.log(
    JSON.stringify({ event: "listening", url: `ws://127.0.0.1:${port}` }),
  );
  const stop = () => {
    for (const path of watched.keys()) unwatchFile(path);
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    server.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, file, ...flags] = process.argv.slice(2);
  try {
    if (command === "serve") await serve();
    else if (command === "status")
      console.log(JSON.stringify(await control("status"), null, 2));
    else if (command === "sync" && file)
      console.log(
        JSON.stringify(
          await control("sync", { file, watch: flags.includes("--watch") }),
          null,
          2,
        ),
      );
    else if (command === "unwatch" && file)
      console.log(JSON.stringify(await control("unwatch", { file }), null, 2));
    else
      throw new Error(
        "Usage: node dev/scriptcat.mjs serve|status|sync <file.user.js> [--watch]|unwatch <file.user.js>",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
