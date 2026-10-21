import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactPlayer from "react-player";
import { io, Socket } from "socket.io-client";
import { 
  Mic, MicOff, Share2, Users, RefreshCw,
  Send, Zap, ZapOff, Check, User, Square, Sparkles
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { parseVideoUrl } from "../utils/urlParser";
import AudioPulse from "./AudioPulse";
import CustomVideoPlayer from "./CustomVideoPlayer";

const SOCKET_URL = window.location.origin;

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  isSelf: boolean;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSyncing, setIsSyncing] = useState(true);
  const [isMicOn, setIsMicOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peers, setPeers] = useState<Map<string, RTCPeerConnection>>(new Map());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [userCount, setUserCount] = useState(1);
  const syncLockRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Playlist / Queue state
  const [queue, setQueue] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(-1);
  const [isFolderResolving, setIsFolderResolving] = useState<boolean>(false);

  // Subtitles state (synced with room)
  const [subtitles, setSubtitles] = useState<{
    name: string;
    cues: Array<{ id: number; start: number; end: number; text: string }>;
  } | null>(null);

  const playerRef = useRef<any>(null);

  const isSyncingRef = useRef(isSyncing);
  isSyncingRef.current = isSyncing;
  const videoUrlRef = useRef(videoUrl);
  videoUrlRef.current = videoUrl;

  // Initialize Socket once per room
  useEffect(() => {
    // Connect to the same origin automatically
    const newSocket = io({
      transports: ['websocket', 'polling']
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      newSocket.emit("join-room", roomId);
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    newSocket.on("video-update", (data: any) => {
      if (!isSyncingRef.current) return;
      
      if (data.videoUrl && data.videoUrl !== videoUrlRef.current) {
        setVideoUrl(data.videoUrl);
      }
      setPlaying(data.playing);
      
      if (playerRef.current && typeof data.currentTime === "number") {
        const currentPos = playerRef.current.currentTime || 0;
        const diff = Math.abs(currentPos - data.currentTime);
        // If difference is significant (> 0.8s) or video is paused, snap accurately
        if (diff > 0.8 || !data.playing) {
          playerRef.current.currentTime = data.currentTime;
        }
      }
    });

    newSocket.on("room-state", (data: any) => {
      setVideoUrl(data.videoUrl || "");
      setPlaying(data.playing || false);
      if (data.queue) setQueue(data.queue);
      if (typeof data.currentQueueIndex === "number") setCurrentQueueIndex(data.currentQueueIndex);
      if (data.subtitles) setSubtitles(data.subtitles);
      if (playerRef.current && data.currentTime) {
        playerRef.current.currentTime = data.currentTime;
      }
    });

    newSocket.on("queue-update", (data: { queue: any[]; currentQueueIndex: number }) => {
      setQueue(data.queue);
      if (typeof data.currentQueueIndex === "number") {
        setCurrentQueueIndex(data.currentQueueIndex);
      }
    });

    newSocket.on("queue-select", (data: { index: number; item: any }) => {
      setCurrentQueueIndex(data.index);
      setVideoUrl(data.item.url);
      setPlaying(true);
    });

    newSocket.on("subtitles-update", (subs: any) => {
      setSubtitles(subs);
    });

    newSocket.on("user-count", (count: number) => {
      setUserCount(count);
    });

    newSocket.on("user-left", (userId: string) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      setPeers(prev => {
        const peer = prev.get(userId);
        peer?.close();
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    });

    newSocket.on("chat-message", (data: { id: string; text: string; sender: string }) => {
      setMessages(prev => [...prev, { ...data, isSelf: false }]);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // WebRTC Signaling
  useEffect(() => {
    if (!socket || !localStream) return;

    const handleSignal = async (data: { from: string; signal: any }) => {
      const { from, signal } = data;
      let peer = peers.get(from);

      if (!peer) {
        peer = createPeer(from);
      }

      if (signal.type === "new-user") {
        if (!localStream) {
          // If we don't have our own mic, we must manually trigger negotiation 
          // to receive the new user's audio, because addTrack won't be called to fire it naturally.
          peer.addTransceiver("audio", { direction: "recvonly" });
        }
      } else if (signal.type === "offer") {
        await peer.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("webrtc-signal", { roomId, to: from, signal: answer });
      } else if (signal.type === "answer") {
        await peer.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    };

    socket.on("webrtc-signal", handleSignal);
    return () => {
      socket.off("webrtc-signal", handleSignal);
    };
  }, [socket, localStream, peers, roomId]);

  const createPeer = useCallback((userId: string) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    localStream?.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit("webrtc-signal", { roomId, to: userId, signal: { candidate: event.candidate } });
      }
    };

    peer.ontrack = (event) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.set(userId, event.streams[0]);
        return next;
      });
    };

    peer.onnegotiationneeded = async () => {
      if (peer.signalingState !== "stable") return;
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket?.emit("webrtc-signal", { roomId, to: userId, signal: peer.localDescription });
      } catch (err) {
        console.error("Error creating offer", err);
      }
    };

    setPeers(prev => {
      const next = new Map(prev);
      next.set(userId, peer);
      return next;
    });

    return peer;
  }, [localStream, socket, roomId]);

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        }, 
        video: false 
      });
      setLocalStream(stream);
      setIsMicOn(true);

      // Notify others to start peer connection
      socket?.emit("webrtc-signal", { roomId, signal: { type: "new-user" } });
    } catch (err) {
      console.error("Error accessing media devices:", err);
    }
  };

  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsMicOn(audioTrack.enabled);
    } else if (!isMicOn) {
      startCall();
    }
  };

  // Video Controls
  const handlePlay = (time?: number) => {
    setPlaying(true);
    const curr = typeof time === "number" ? time : (playerRef.current?.currentTime || 0);
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl,
        playing: true,
        currentTime: curr
      });
    }
  };

  const handlePause = (time?: number) => {
    setPlaying(false);
    const curr = typeof time === "number" ? time : (playerRef.current?.currentTime || 0);
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl,
        playing: false,
        currentTime: curr
      });
    }
  };

  const handleSeek = (seconds: number) => {
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl,
        playing,
        currentTime: seconds
      });
    }
  };

  const handleStopVideo = () => {
    setVideoUrl("");
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl: "",
        playing: false,
        currentTime: 0
      });
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = inputUrl.trim();
    if (!rawUrl) return;

    // 1. Check for multiple URLs pasted together (separated by newlines, commas, or spaces)
    const multiUrls = rawUrl.split(/[\r\n,]+/).map(u => u.trim()).filter(Boolean);
    if (multiUrls.length > 1) {
      const newItems = multiUrls.map((u, i) => {
        const parsed = parseVideoUrl(u);
        const name = decodeURIComponent(u.split("/").pop()?.split("?")[0] || `Video ${i + 1}`);
        return {
          id: `item-${Date.now()}-${i}`,
          title: name,
          url: parsed,
        };
      });

      const updatedQueue = [...queue, ...newItems];
      setQueue(updatedQueue);
      if (currentQueueIndex === -1) {
        setCurrentQueueIndex(0);
        setVideoUrl(newItems[0].url);
        if (isSyncing) {
          socket?.emit("video-update", {
            roomId,
            videoUrl: newItems[0].url,
            playing: true,
            currentTime: 0,
          });
        }
      }
      socket?.emit("queue-update", { roomId, queue: updatedQueue, currentQueueIndex: currentQueueIndex === -1 ? 0 : currentQueueIndex });
      setInputUrl("");
      return;
    }

    // 2. Check if this is a shared folder URL (Dropbox or Google Drive folder)
    if (rawUrl.includes("dropbox.com") && (rawUrl.includes("/scl/fo/") || rawUrl.includes("/sh/"))) {
      setIsFolderResolving(true);
      try {
        const res = await fetch(`/api/resolve-folder?url=${encodeURIComponent(rawUrl)}`);
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const newQueue = data.items;
          setQueue(newQueue);
          setCurrentQueueIndex(0);
          const firstVideo = newQueue[0].url;
          setVideoUrl(firstVideo);
          socket?.emit("queue-update", { roomId, queue: newQueue, currentQueueIndex: 0 });
          if (isSyncing) {
            socket?.emit("video-update", {
              roomId,
              videoUrl: firstVideo,
              playing: true,
              currentTime: 0,
            });
          }
          setInputUrl("");
          setIsFolderResolving(false);
          return;
        } else {
          alert("Dropbox protects shared folder listings from external crawlers. Please paste the direct file links into the box (you can paste multiple links at once!)");
          setIsFolderResolving(false);
          return;
        }
      } catch (err) {
        console.error("Failed to resolve folder", err);
        alert("Could not load folder. Try pasting the direct video links.");
        setIsFolderResolving(false);
        return;
      }
    }

    // 3. Normal single video URL
    const parsed = parseVideoUrl(rawUrl);
    setVideoUrl(parsed);

    // Add to single-item queue or update current queue
    const singleTitle = decodeURIComponent(rawUrl.split("/").pop()?.split("?")[0] || "Live Video");
    const singleItem = {
      id: `item-${Date.now()}`,
      title: singleTitle,
      url: parsed,
    };
    const updatedQueue = queue.length > 0 ? [...queue, singleItem] : [singleItem];
    setQueue(updatedQueue);
    setCurrentQueueIndex(updatedQueue.length - 1);
    socket?.emit("queue-update", { roomId, queue: updatedQueue, currentQueueIndex: updatedQueue.length - 1 });

    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl: parsed,
        playing: true,
        currentTime: 0
      });
    }
    setInputUrl("");
  };

  const handleQueueSelect = (index: number) => {
    if (!queue[index]) return;
    setCurrentQueueIndex(index);
    setVideoUrl(queue[index].url);
    setPlaying(true);
    socket?.emit("queue-select", { roomId, index });
  };

  const handleVideoEnded = () => {
    if (queue.length > 1 && currentQueueIndex < queue.length - 1) {
      const nextIdx = currentQueueIndex + 1;
      handleQueueSelect(nextIdx);
    }
  };

  const handleUpdateSubtitles = (newSubs: any) => {
    setSubtitles(newSubs);
    socket?.emit("subtitles-update", { roomId, subtitles: newSubs });
  };

  const handleAddToQueue = (urlText: string) => {
    const lines = urlText.split(/[\r\n,]+/).map(u => u.trim()).filter(Boolean);
    if (!lines.length) return;

    const newItems = lines.map((u, i) => {
      const parsed = parseVideoUrl(u);
      const name = decodeURIComponent(u.split("/").pop()?.split("?")[0] || `Video ${queue.length + i + 1}`);
      return {
        id: `item-${Date.now()}-${i}`,
        title: name,
        url: parsed,
      };
    });

    const updatedQueue = [...queue, ...newItems];
    setQueue(updatedQueue);
    socket?.emit("queue-update", { roomId, queue: updatedQueue, currentQueueIndex });
  };

  const handleRemoveFromQueue = (index: number) => {
    if (index < 0 || index >= queue.length) return;
    const updatedQueue = queue.filter((_, i) => i !== index);
    let newIndex = currentQueueIndex;

    if (index === currentQueueIndex) {
      if (updatedQueue.length === 0) {
        newIndex = -1;
        setVideoUrl("");
        setPlaying(false);
      } else {
        newIndex = Math.min(index, updatedQueue.length - 1);
        setVideoUrl(updatedQueue[newIndex].url);
      }
    } else if (index < currentQueueIndex) {
      newIndex = currentQueueIndex - 1;
    }

    setQueue(updatedQueue);
    setCurrentQueueIndex(newIndex);
    socket?.emit("queue-update", { roomId, queue: updatedQueue, currentQueueIndex: newIndex });
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;

    const messageData = {
      id: Math.random().toString(36).substring(2, 9),
      text: chatInput.trim(),
      sender: socket.id?.substring(0, 4) || "User"
    };

    socket.emit("chat-message", { roomId, ...messageData });
    setMessages(prev => [...prev, { ...messageData, isSelf: true }]);
    setChatInput("");
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden glass-ambient-canvas">
      {/* Hidden Audio Elements for Remote Streams */}
      {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
        <audio 
          key={userId} 
          autoPlay 
          ref={el => { if (el) el.srcObject = stream; }} 
          className="hidden"
        />
      ))}

      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.08] bg-[#070913]/70 backdrop-blur-2xl z-50 shadow-xl shadow-black/40">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black tracking-tighter cursor-pointer hover:opacity-90 transition-opacity" onClick={() => navigate("/")}>
            ks<span className="text-red-500 drop-shadow-[0_0_16px_rgba(239,68,68,0.5)]">live</span>
          </h1>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 glass-pill rounded-full text-xs font-mono text-cyan-300">
            <Users size={13} className="text-cyan-400" />
            <span>ROOM: {roomId}</span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full glass-pill">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'}`} />
            <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">{isConnected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-3.5 py-1.5 glass-pill rounded-full transition-all text-gray-300 hover:text-white"
          >
            {copied ? <Check size={15} className="text-emerald-400" /> : <Share2 size={15} />}
            <span className="text-xs font-semibold">{copied ? "Copied!" : "Share"}</span>
          </button>
          
          <div className="h-5 w-px bg-white/[0.1] mx-1" />
          
          <button 
            onClick={() => setIsSyncing(!isSyncing)}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full font-bold text-xs transition-all ${
              isSyncing ? "glass-btn-primary text-white" : "glass-pill text-gray-400 hover:text-white"
            }`}
          >
            {isSyncing ? <Zap size={15} /> : <ZapOff size={15} />}
            {isSyncing ? "SYNC ON" : "SYNC OFF"}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* Video Player Section */}
        <div className="flex-1 flex flex-col relative group">
          {!videoUrl ? (
            <div className="flex-1 flex items-center justify-center p-6 relative">
              <form onSubmit={handleUrlSubmit} className="max-w-2xl w-full glass-panel p-8 sm:p-10 rounded-3xl space-y-6 text-center">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-cyan-300 mb-1">
                    <Sparkles size={13} className="text-cyan-400" />
                    <span>SYNCHRONIZED STREAM</span>
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">Ready to watch?</h2>
                  <p className="text-gray-300/80 text-sm">Paste a link from Dropbox, Google Drive, YouTube, or direct video stream.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5 p-2 glass-input rounded-2xl">
                  <input
                    type="text"
                    placeholder="https://..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    className="flex-1 bg-transparent px-4 py-2.5 focus:outline-none text-white text-sm placeholder-gray-400 font-mono"
                  />
                  <button 
                    type="submit"
                    disabled={isFolderResolving}
                    className="glass-btn-primary disabled:opacity-50 text-white px-7 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 uppercase tracking-wider"
                  >
                    {isFolderResolving ? "Loading Folder..." : "Load Video"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex-1 bg-black relative">
              <CustomVideoPlayer
                playerRef={playerRef}
                url={videoUrl}
                playing={playing}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
                onEnded={handleVideoEnded}
                subtitles={subtitles}
                onUpdateSubtitles={handleUpdateSubtitles}
                queue={queue}
                currentQueueIndex={currentQueueIndex}
                onSelectQueueIndex={handleQueueSelect}
                onAddToQueue={handleAddToQueue}
                onRemoveFromQueue={handleRemoveFromQueue}
              />
            </div>
          )}

          {/* Control Center Overlay (Voice chat, chat toggle, stop video) */}
          <div className="absolute top-4 right-4 flex items-center gap-2 p-1.5 glass-panel rounded-2xl shadow-2xl z-30">
            <button 
              onClick={toggleMic}
              className={`p-2.5 rounded-xl transition-all ${isMicOn ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25"}`}
              title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}
            >
              {isMicOn ? <Mic size={17} /> : <MicOff size={17} />}
            </button>
            
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-2.5 rounded-xl transition-all ${isSidebarOpen ? "bg-white/[0.12] text-white" : "text-gray-400 hover:text-white hover:bg-white/[0.06]"}`}
              title="Toggle Chat"
            >
              <Users size={17} />
            </button>
            
            {videoUrl && (
              <button 
                onClick={handleStopVideo}
                className="p-2.5 rounded-xl text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all"
                title="Stop Video globally"
              >
                <Square fill="currentColor" size={17} />
              </button>
            )}
          </div>
        </div>

        {/* Sidebar / Audio & Chat */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="w-80 border-l border-white/[0.08] glass-panel rounded-none border-y-0 border-r-0 flex flex-col z-40"
            >
              <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
                <span className="font-bold text-xs uppercase tracking-widest text-gray-300">Room Chat</span>
                <div className="flex items-center gap-2">
                  <span className="glass-pill text-red-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold">LIVE</span>
                  <span className="text-xs text-gray-400 font-mono">{userCount} Online</span>
                </div>
              </div>
              
              {/* Participants (Audio Only) */}
              <div className="p-4 border-b border-white/[0.08] bg-white/[0.015]">
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                  <div className="flex flex-col items-center gap-1 min-w-[60px]">
                    <AudioPulse stream={localStream} isActive={isMicOn}>
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 z-10 relative transition-all ${isMicOn ? 'border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.5)] bg-[#070912]' : 'border-white/10 glass-pill'}`}>
                        <User size={19} className={isMicOn ? 'text-emerald-400' : 'text-gray-400'} />
                      </div>
                    </AudioPulse>
                    <span className="text-[10px] text-gray-400 font-medium">You</span>
                  </div>
                  {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
                    <div key={userId} className="flex flex-col items-center gap-1 min-w-[60px]">
                      <AudioPulse stream={stream} isActive={true}>
                        <div className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.5)] bg-[#070912] z-10 relative">
                          <User size={19} className="text-emerald-400" />
                        </div>
                      </AudioPulse>
                      <span className="text-[10px] text-gray-400 font-medium">{userId.substring(0, 4)}</span>
                    </div>
                  ))}
                </div>
                {!localStream && (
                  <button 
                    onClick={startCall}
                    className="w-full mt-2.5 py-2 glass-btn-secondary text-xs font-semibold rounded-xl text-gray-200 hover:text-white flex items-center justify-center gap-2"
                  >
                    <Mic size={14} className="text-cyan-400" /> Join Voice Chat
                  </button>
                )}
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400/60 text-xs text-center px-4 font-mono">
                    No messages yet. Say hello!
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-gray-400 mb-1 px-1">{msg.isSelf ? 'You' : msg.sender}</span>
                      <div className={`px-3.5 py-2 rounded-2xl max-w-[85%] text-xs leading-relaxed ${msg.isSelf ? 'glass-btn-primary text-white rounded-tr-sm' : 'glass-pill bg-white/[0.06] text-gray-200 rounded-tl-sm border-white/[0.08]'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-white/[0.08] bg-[#070912]/80">
                <form onSubmit={handleSendMessage} className="flex gap-2 p-1.5 glass-input rounded-2xl focus-within:border-cyan-500/50 transition-all">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..." 
                    className="flex-1 bg-transparent text-xs px-3 py-1.5 focus:outline-none text-white placeholder-gray-400"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="p-2 text-gray-400 hover:text-cyan-300 disabled:opacity-40 transition-all"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
