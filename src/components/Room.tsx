import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactPlayer from "react-player";
import { io, Socket } from "socket.io-client";
import { 
  Mic, MicOff, Share2, Users, RefreshCw,
  Send, Zap, ZapOff, Check, User, Square
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { parseVideoUrl } from "../utils/urlParser";

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

  const playerRef = useRef<HTMLVideoElement>(null);

  // Initialize Socket
  useEffect(() => {
    // Connect to the same origin automatically
    const newSocket = io({
      transports: ['polling', 'websocket']
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
      if (!isSyncing || syncLockRef.current) return;
      
      syncLockRef.current = true;
      if (data.videoUrl !== videoUrl) {
        setVideoUrl(data.videoUrl);
      }
      setPlaying(data.playing);
      
      // Only seek if the difference is significant (> 2 seconds)
      const diff = Math.abs((playerRef.current?.currentTime || 0) - data.currentTime);
      if (diff > 2 && playerRef.current) {
        playerRef.current.currentTime = data.currentTime;
      }
      
      setTimeout(() => { syncLockRef.current = false; }, 500);
    });

    newSocket.on("room-state", (data: any) => {
      setVideoUrl(data.videoUrl);
      setPlaying(data.playing);
      if (playerRef.current) {
        playerRef.current.currentTime = data.currentTime;
      }
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
  }, [roomId, isSyncing, videoUrl]);

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

      if (signal.type === "offer") {
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

    setPeers(prev => {
      const next = new Map(prev);
      next.set(userId, peer);
      return next;
    });

    return peer;
  }, [localStream, socket, roomId]);

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);
      setIsMicOn(true);

      // Notify others to start peer connection
      const offer = await new RTCPeerConnection().createOffer(); // Dummy to trigger
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
  const handlePlay = () => {
    if (syncLockRef.current) return;
    setPlaying(true);
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl,
        playing: true,
        currentTime: playerRef.current?.currentTime || 0
      });
    }
  };

  const handlePause = () => {
    if (syncLockRef.current) return;
    setPlaying(false);
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl,
        playing: false,
        currentTime: playerRef.current?.currentTime || 0
      });
    }
  };

  const handleSeek = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (syncLockRef.current) return;
    if (isSyncing) {
      socket?.emit("video-update", {
        roomId,
        videoUrl,
        playing,
        currentTime: e.currentTarget.currentTime
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

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseVideoUrl(inputUrl);
    setVideoUrl(parsed);
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
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0a0a]">
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-900 bg-[#0a0a0a]/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black tracking-tighter cursor-pointer" onClick={() => navigate("/")}>
            sk<span className="text-red-600">live</span>
          </h1>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-gray-900 rounded-full border border-gray-800 text-xs font-mono text-gray-400">
            <Users size={14} className="text-red-600" />
            <span>ROOM: {roomId}</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-900 border border-gray-800">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{isConnected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-3 py-2 bg-gray-900 hover:bg-gray-800 rounded-full transition-all text-gray-400 hover:text-white border border-gray-800"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Share2 size={16} />}
            <span className="text-sm font-medium">{copied ? "Copied!" : "Share"}</span>
          </button>
          
          <div className="h-6 w-px bg-gray-800 mx-2" />
          
          <button 
            onClick={() => setIsSyncing(!isSyncing)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm transition-all ${
              isSyncing ? "bg-red-600 text-white shadow-lg shadow-red-600/20" : "bg-gray-800 text-gray-400"
            }`}
          >
            {isSyncing ? <Zap size={16} /> : <ZapOff size={16} />}
            {isSyncing ? "SYNC ON" : "SYNC OFF"}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* Video Player Section */}
        <div className="flex-1 flex flex-col relative group">
          {!videoUrl ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <form onSubmit={handleUrlSubmit} className="max-w-2xl w-full space-y-6 text-center">
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold">Ready to watch?</h2>
                  <p className="text-gray-500">Paste a link from YouTube, Drive, Dropbox, or a direct MP4 URL.</p>
                </div>
                <div className="flex gap-2 p-2 bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl">
                  <input
                    type="text"
                    placeholder="https://..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    className="flex-1 bg-transparent px-4 py-3 focus:outline-none"
                  />
                  <button 
                    type="submit"
                    className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-xl font-bold transition-all"
                  >
                    Load Video
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex-1 bg-black relative">
              <ReactPlayer
                ref={playerRef}
                src={videoUrl}
                playing={playing}
                controls={true}
                width="100%"
                height="100%"
                onPlay={handlePlay}
                onPause={handlePause}
                onSeeked={handleSeek}
                onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) => setCurrentTime(e.currentTarget.currentTime)}
                style={{ position: "absolute", top: 0, left: 0 }}
              />
            </div>
          )}

          {/* Control Center Overlay */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 p-2 bg-[#0a0a0a]/90 backdrop-blur-xl border border-gray-800 rounded-3xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0">
            <button 
              onClick={toggleMic}
              className={`p-4 rounded-2xl transition-all ${isMicOn ? "bg-gray-800 text-white" : "bg-red-600/20 text-red-600"}`}
              title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}
            >
              {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
            </button>
            
            <div className="w-px h-10 bg-gray-800 mx-2" />
            
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-4 rounded-2xl transition-all ${isSidebarOpen ? "bg-gray-800 text-white" : "text-gray-500 hover:text-white"}`}
              title="Toggle Chat"
            >
              <Users size={24} />
            </button>
            
            {videoUrl && (
              <button 
                onClick={handleStopVideo}
                className="p-4 rounded-2xl text-red-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
                title="Stop Video globally"
              >
                <Square fill="currentColor" size={24} />
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
              className="w-80 border-l border-gray-900 bg-[#0a0a0a] flex flex-col"
            >
              <div className="p-4 border-b border-gray-900 flex items-center justify-between">
                <span className="font-bold text-sm uppercase tracking-widest text-gray-500">Room Chat</span>
                <div className="flex items-center gap-2">
                  <span className="bg-red-600/10 text-red-600 text-[10px] px-2 py-0.5 rounded-full font-bold">LIVE</span>
                  <span className="text-xs text-gray-500">{userCount} Online</span>
                </div>
              </div>
              
              {/* Participants (Audio Only) */}
              <div className="p-4 border-b border-gray-900 bg-gray-900/30">
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                  <div className="flex flex-col items-center gap-1 min-w-[60px]">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${isMicOn ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-gray-800'}`}>
                      <User size={20} className={isMicOn ? 'text-green-500' : 'text-gray-500'} />
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium">You</span>
                  </div>
                  {Array.from(remoteStreams.keys()).map(userId => (
                    <div key={userId} className="flex flex-col items-center gap-1 min-w-[60px]">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-green-500 bg-green-500/10">
                        <User size={20} className="text-green-500" />
                      </div>
                      <span className="text-[10px] text-gray-400 font-medium">{userId.substring(0, 4)}</span>
                    </div>
                  ))}
                </div>
                {!localStream && (
                  <button 
                    onClick={startCall}
                    className="w-full mt-2 py-2 bg-gray-800 hover:bg-gray-700 text-xs font-medium rounded-lg transition-all text-gray-300 flex items-center justify-center gap-2"
                  >
                    <Mic size={14} /> Join Voice Chat
                  </button>
                )}
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-600 text-xs text-center px-4">
                    No messages yet. Say hello!
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-gray-600 mb-1 px-1">{msg.isSelf ? 'You' : msg.sender}</span>
                      <div className={`px-3 py-2 rounded-2xl max-w-[85%] text-sm ${msg.isSelf ? 'bg-red-600 text-white rounded-tr-sm' : 'bg-gray-800 text-gray-200 rounded-tl-sm'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-gray-900 bg-[#0a0a0a]">
                <form onSubmit={handleSendMessage} className="flex gap-2 p-1 bg-gray-900 rounded-xl border border-gray-800 focus-within:border-gray-600 transition-all">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..." 
                    className="flex-1 bg-transparent text-sm px-3 py-2 focus:outline-none"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:hover:text-gray-400 transition-all"
                  >
                    <Send size={18} />
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
