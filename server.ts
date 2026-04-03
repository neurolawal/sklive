import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomState {
  videoUrl: string;
  playing: boolean;
  currentTime: number;
  lastUpdated: number;
}

const rooms = new Map<string, RoomState>();

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId: string) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);

      // Send current room state if it exists
      const state = rooms.get(roomId);
      if (state) {
        socket.emit("room-state", state);
      }
      io.to(roomId).emit("user-count", io.sockets.adapter.rooms.get(roomId)?.size || 1);
    });

    // Video Sync Events
    socket.on("video-update", (data: { roomId: string; videoUrl: string; playing: boolean; currentTime: number }) => {
      const { roomId, videoUrl, playing, currentTime } = data;
      const state = { videoUrl, playing, currentTime, lastUpdated: Date.now() };
      rooms.set(roomId, state);
      socket.to(roomId).emit("video-update", state);
    });

    socket.on("sync-request", (roomId: string) => {
      const state = rooms.get(roomId);
      if (state) {
        socket.emit("video-update", state);
      }
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

  const distPath = path.join(process.cwd(), "dist");

  // If the compiled frontend exists (Render builds it), force production mode so Vite dev server never eats up RAM.
  if (fs.existsSync(distPath) || process.env.NODE_ENV === "production") {
    console.log("Serving production build from dist folder...");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
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
