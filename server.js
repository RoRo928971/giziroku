/**
 * 議事録作成アプリ 用のサーバー
 *  - public/ 以下の静的ファイルを配信
 *  - POST /api/summarize で会議メモをAI整形（要 ANTHROPIC_API_KEY）
 *
 *   起動: node server.js   (または npm start)
 *   既定ポート: 3000  (環境変数 PORT で変更可)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { summarizeMinutes } = require("./lib/summarize");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const MAX_BODY = 1_000_000; // 1MB（会議メモの上限）

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

// POST /api/summarize : 会議メモをAIで議事録に整形
function handleSummarize(req, res) {
  let body = "";
  let tooLarge = false;
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) {
      tooLarge = true;
      req.destroy();
    }
  });
  req.on("end", async () => {
    if (tooLarge) {
      sendJson(res, 413, { error: "会議メモが大きすぎます（上限1MB）。" });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch (e) {
      sendJson(res, 400, { error: "リクエストの形式が不正です。" });
      return;
    }
    const text = (payload.text || "").trim();
    if (!text) {
      sendJson(res, 400, { error: "会議メモを入力してください。" });
      return;
    }
    try {
      const data = await summarizeMinutes(text, payload.context || {});
      sendJson(res, 200, { data });
    } catch (err) {
      console.error("[summarize] エラー:", err.message);
      const status = err.code === "NO_API_KEY" ? 503 : 502;
      sendJson(res, status, {
        error: err.message || "AIによる整形に失敗しました。",
      });
    }
  });
}

const server = http.createServer((req, res) => {
  // クエリ文字列を除去し、パストラバーサルを防止
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  // APIルート
  if (urlPath === "/api/summarize") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method Not Allowed" });
      return;
    }
    handleSummarize(req, res);
    return;
  }

  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`議事録作成アプリを起動しました → http://localhost:${PORT}`);
});
