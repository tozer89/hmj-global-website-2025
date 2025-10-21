import { createServer } from "http";
import { promises as fs } from "fs";
import { extname, join, resolve } from "path";

const port = Number(process.env.PORT || 4173);
const root = resolve("admin-v2");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const safePath = pathname.replace(/\.\.+/g, "");
    const relativePath = safePath
      .replace(/^\/?admin-v2\/?/, "")
      .replace(/^\//, "");
    const target = relativePath === "" || safePath.endsWith("/") ? "index.html" : relativePath;
    const filePath = join(root, target);

    let data;
    try {
      data = await fs.readFile(filePath);
    } catch (error) {
      // Single-page fallback
      data = await fs.readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": mimeTypes[".html"] });
      res.end(data);
      return;
    }

    const ext = extname(filePath);
    const contentType = mimeTypes[ext] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Preview server error: ${error.message}`);
  }
});

server.listen(port, () => {
  console.log(`Admin v2 preview available at http://localhost:${port}/admin-v2/`);
});
