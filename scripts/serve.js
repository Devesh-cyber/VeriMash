// Tiny static file server for the frontend (no dependencies).
// Binds to 0.0.0.0 so phones on the same Wi-Fi can open it.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DIR = path.join(__dirname, "..", "frontend");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function serve(port = Number(process.env.PORT || 8080)) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const file = path.normalize(path.join(DIR, p));
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, "0.0.0.0");
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`\nFrontend:  http://localhost:${port}`);
  for (const ip of lan) console.log(`On Wi-Fi:  http://${ip}:${port}`);
  return server;
}

module.exports = { serve };
if (require.main === module) serve();
