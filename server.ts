import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PlaylistItem {
  id: string;
  title: string;
  url: string;
}

interface RoomState {
  videoUrl: string;
  playing: boolean;
  currentTime: number;
  lastUpdated: number;
  queue: PlaylistItem[];
  currentQueueIndex: number;
  subtitles: {
    name: string;
    cues: Array<{ id: number; start: number; end: number; text: string }>;
  } | null;
}

const rooms = new Map<string, RoomState>();

// Helper to get or initialize a room's state
function getOrCreateRoom(roomId: string): RoomState {
  let state = rooms.get(roomId);
  if (!state) {
    state = {
      videoUrl: "",
      playing: false,
      currentTime: 0,
      lastUpdated: Date.now(),
      queue: [],
      currentQueueIndex: -1,
      subtitles: null,
    };
    rooms.set(roomId, state);
  }
  return state;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = Number(process.env.PORT) || 3000;

  // Lightweight Health check endpoint
  app.get("/healthz", (req, res) => {
    res.status(200).send("OK");
  });

  // Google Drive Streaming Proxy endpoint
  // Bypasses the 100MB virus scan HTML warning and serves native 206 Partial Content video stream
  app.get("/api/drive-stream", async (req, res) => {
    const fileId = req.query.id as string;
    if (!fileId) {
      return res.status(400).send("Missing file id");
    }

    try {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const initialResponse = await fetch(driveUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      let downloadUrl = driveUrl;
      const contentType = initialResponse.headers.get("content-type") || "";
      const cookies = initialResponse.headers.get("set-cookie") || "";

      // Check if Google returned an HTML confirmation page (happens for files > 100MB)
      if (contentType.includes("text/html")) {
        const html = await initialResponse.text();
        const actionMatch = html.match(/action="([^"]+)"/);
        const idMatch = html.match(/name="id" value="([^"]+)"/);
        const confirmMatch = html.match(/name="confirm" value="([^"]+)"/);
        const uuidMatch = html.match(/name="uuid" value="([^"]+)"/);

        if (actionMatch && idMatch && confirmMatch && uuidMatch) {
          downloadUrl = `${actionMatch[1]}?id=${idMatch[1]}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
        } else {
          const confirmCodeMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
          if (confirmCodeMatch) {
            downloadUrl = `https://drive.google.com/uc?export=download&confirm=${confirmCodeMatch[1]}&id=${fileId}`;
          }
        }
      }

      // Forward client's Range header (for seeking / timeline scrubbing)
      const rangeHeader = req.headers.range;
      const fetchHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      if (cookies) {
        fetchHeaders["Cookie"] = cookies;
      }
      if (rangeHeader) {
        fetchHeaders["Range"] = rangeHeader;
      }

      console.log(`[drive-stream] Range requested: ${rangeHeader || "None (Full download)"} for fileId: ${fileId}`);

      const streamResponse = await fetch(downloadUrl, { headers: fetchHeaders });

      console.log(`[drive-stream] Response status: ${streamResponse.status}, Content-Range: ${streamResponse.headers.get("content-range")}, Content-Length: ${streamResponse.headers.get("content-length")}`);

      res.status(streamResponse.status);
      streamResponse.headers.forEach((val, key) => {
        // Forward useful video headers
        if (["content-type", "content-length", "content-range", "accept-ranges"].includes(key.toLowerCase())) {
          res.setHeader(key, val);
        }
      });

      // Force video/mp4 if Google sends octet-stream
      if (!res.getHeader("content-type") || res.getHeader("content-type") === "application/octet-stream") {
        res.setHeader("Content-Type", "video/mp4");
      }
      res.setHeader("Accept-Ranges", "bytes");
      // Prevent browser sparse disk cache exhaustion on long video playback
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      if (!streamResponse.body) {
        return res.status(500).send("No stream body");
      }

      // Convert Web ReadableStream to Node Readable Stream with backpressure & abort support
      const { Readable } = await import("stream");
      const nodeStream = Readable.fromWeb(streamResponse.body as any);

      req.on("close", () => {
        nodeStream.destroy();
      });
      res.on("close", () => {
        nodeStream.destroy();
      });
      nodeStream.on("error", (err) => {
        console.error("Video proxy stream error:", err);
        if (!res.headersSent) res.status(500).end();
      });

      nodeStream.pipe(res);
    } catch (err) {
      console.error("Google Drive proxy error:", err);
      if (!res.headersSent) {
        res.status(500).send("Failed to stream Google Drive file");
      }
    }
  });

  // Online Subtitles Search endpoint (Uses free OpenSubtitles REST API without API key)
  app.get("/api/subtitles/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }

    try {
      // Clean movie/video title for search and convert to lowercase (rest.opensubtitles requires lowercase to avoid 302 redirect bug)
      const cleaned = query
        .toLowerCase()
        .replace(/\.(mp4|mkv|avi|webm|mov)$/i, "")
        .replace(/[._]/g, " ")
        .replace(/\b(webrip|bluray|hdtv|1080p|720p|480p|x264|x265|aac|thenkiri\.com|downloaded\.from|complete)\b/gi, "")
        .trim();

      const searchUrl = `https://rest.opensubtitles.org/search/query-${encodeURIComponent(cleaned || query.toLowerCase())}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "TemporaryUserAgent",
          "Host": "rest.opensubtitles.org",
        },
      });

      if (response.ok) {
        const data = await response.json();
        const results = (Array.isArray(data) ? data : []).slice(0, 15).map((item: any) => ({
          id: item.IDSubtitleFile || item.IDSubtitle || Math.random().toString(),
          downloadLink: item.SubDownloadLink,
          language: item.LanguageName || item.ISO639 || "English",
          release: item.SubFileName || item.MovieName || cleaned,
          downloads: item.SubDownloadsCnt || 0,
        }));
        return res.json({ results });
      }

      return res.json({ results: [] });
    } catch (err) {
      console.error("Subtitle search error:", err);
      res.status(500).json({ error: "Failed to search subtitles" });
    }
  });

  // Download / Proxy Subtitle file with gzip decompression
  app.get("/api/subtitles/download", async (req, res) => {
    const downloadUrl = req.query.url as string;
    if (!downloadUrl) {
      return res.status(400).json({ error: "Missing download url" });
    }

    try {
      const fileRes = await fetch(downloadUrl, {
        headers: {
          "User-Agent": "TemporaryUserAgent",
        },
      });

      if (!fileRes.ok) {
        return res.status(500).json({ error: "Could not fetch subtitle" });
      }

      const { gunzipSync } = await import("zlib");
      const buffer = Buffer.from(await fileRes.arrayBuffer());

      let srtText: string;
      try {
        // Most OpenSubtitles download links are .gz compressed
        srtText = gunzipSync(buffer).toString("utf-8");
      } catch (e) {
        // Fallback if raw text
        srtText = buffer.toString("utf-8");
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(srtText);
    } catch (err) {
      console.error("Subtitle download error:", err);
      res.status(500).json({ error: "Failed to download subtitle" });
    }
  });

  // Resolve Folder / Playlist URLs (Google Drive / Dropbox folder extractor)
  app.get("/api/resolve-folder", async (req, res) => {
    const folderUrl = req.query.url as string;
    if (!folderUrl) {
      return res.status(400).json({ error: "Missing folder url" });
    }

    try {
      // 1. Dropbox Shared Folder: scrape shared files
      if (folderUrl.includes("dropbox.com")) {
        const resp = await fetch(folderUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        const html = await resp.text();
        
        // Match direct links to media files inside Dropbox folder HTML
        const matches = [...html.matchAll(/https:\/\/www\.dropbox\.com\/scl\/fi\/[a-zA-Z0-9_-]+\/[^"?]+\.(?:mp4|mkv|webm|mov|avi)\?[^"]+/g)];
        const items = Array.from(new Set(matches.map(m => m[0]))).map((link, idx) => {
          const fileNameMatch = link.match(/\/([^/?#]+\.(?:mp4|mkv|webm|mov|avi))/i);
          const title = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `Video ${idx + 1}`;
          const rawUrl = link.replace("dl=0", "raw=1");
          return {
            id: `item-${idx}-${Date.now()}`,
            title,
            url: rawUrl,
          };
        });

        return res.json({ items });
      }

      // Default: Return empty list if unsupported folder type
      return res.json({ items: [] });
    } catch (err) {
      console.error("Folder resolution error:", err);
      res.status(500).json({ error: "Failed to resolve folder" });
    }
  });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId: string) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);

      // Send current room state
      const state = getOrCreateRoom(roomId);
      socket.emit("room-state", state);
      io.to(roomId).emit("user-count", io.sockets.adapter.rooms.get(roomId)?.size || 1);
    });

    // Video Sync Events
    socket.on("video-update", (data: { roomId: string; videoUrl: string; playing: boolean; currentTime: number }) => {
      const { roomId, videoUrl, playing, currentTime } = data;
      const room = getOrCreateRoom(roomId);
      room.videoUrl = videoUrl;
      room.playing = playing;
      room.currentTime = currentTime;
      room.lastUpdated = Date.now();

      socket.to(roomId).emit("video-update", room);
    });

    // Queue / Playlist Events
    socket.on("queue-update", (data: { roomId: string; queue: PlaylistItem[]; currentQueueIndex?: number }) => {
      const room = getOrCreateRoom(data.roomId);
      room.queue = data.queue;
      if (typeof data.currentQueueIndex === "number") {
        room.currentQueueIndex = data.currentQueueIndex;
      }
      io.to(data.roomId).emit("queue-update", {
        queue: room.queue,
        currentQueueIndex: room.currentQueueIndex,
      });
    });

    socket.on("queue-select", (data: { roomId: string; index: number }) => {
      const room = getOrCreateRoom(data.roomId);
      if (room.queue[data.index]) {
        room.currentQueueIndex = data.index;
        room.videoUrl = room.queue[data.index].url;
        room.playing = true;
        room.currentTime = 0;
        room.lastUpdated = Date.now();

        io.to(data.roomId).emit("queue-select", {
          index: data.index,
          item: room.queue[data.index],
        });
        io.to(data.roomId).emit("video-update", room);
      }
    });

    // Subtitle Events (synchronized across peers)
    socket.on("subtitles-update", (data: { roomId: string; subtitles: { name: string; cues: any[] } | null }) => {
      const room = getOrCreateRoom(data.roomId);
      room.subtitles = data.subtitles;
      io.to(data.roomId).emit("subtitles-update", room.subtitles);
    });

    socket.on("sync-request", (roomId: string) => {
      const state = getOrCreateRoom(roomId);
      socket.emit("video-update", state);
    });

    // Chat Events
    socket.on("chat-message", (data: { roomId: string; id: string; text: string; sender: string }) => {
      socket.to(data.roomId).emit("chat-message", data);
    });

    // WebRTC Signaling Events
    socket.on("webrtc-signal", (data: { roomId: string; signal: any; to?: string }) => {
      const { roomId, signal, to } = data;
      if (to) {
        io.to(to).emit("webrtc-signal", { from: socket.id, signal });
      } else {
        socket.to(roomId).emit("webrtc-signal", { from: socket.id, signal });
      }
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.to(room).emit("user-left", socket.id);
          const newSize = Math.max(0, (io.sockets.adapter.rooms.get(room)?.size || 1) - 1);
          io.to(room).emit("user-count", newSize);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Garbage collection: clean up inactive rooms every 15 minutes to prevent RAM growth
  setInterval(() => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [roomId, room] of rooms.entries()) {
      const activeSockets = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      if (activeSockets === 0 && room.lastUpdated < twoHoursAgo) {
        rooms.delete(roomId);
        console.log(`Cleaned up inactive room: ${roomId}`);
      }
    }
  }, 15 * 60 * 1000);

  const distPath = path.join(process.cwd(), "dist");
  const distIndexHtml = path.join(distPath, "index.html");

  // In production (e.g. on Render), serve the prebuilt dist folder.
  // In development, run the Vite development server with HMR.
  if (fs.existsSync(distIndexHtml)) {
    console.log("Serving production build from dist folder...");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(distIndexHtml);
    });
  } else {
    console.log("Starting Vite development server...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
