import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Plus, Sparkles, Tv } from "lucide-react";
import { motion } from "motion/react";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 10);
    navigate(`/room/${newRoomId}`);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    let id = roomId.trim();
    if (id.includes('/room/')) {
      id = id.split('/room/')[1];
    }
    id = id.split('?')[0].replace(/\/$/, '');
    
    if (id) {
      navigate(`/room/${id}`);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 glass-ambient-canvas overflow-hidden">
      {/* Background Organic Wave Ribbons (Inspired by reference visual) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
        {/* Upper fluid ribbon curve in cyan/teal */}
        <svg 
          className="absolute -top-32 -left-32 w-[900px] h-[750px] opacity-35 filter blur-[1px]" 
          viewBox="0 0 900 750" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            d="M50 150 C 300 50, 550 350, 850 180 C 700 550, 350 650, 50 150 Z" 
            fill="url(#ribbon-cyan)" 
          />
          <defs>
            <linearGradient id="ribbon-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#0d9488" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Lower flowing light curve with dash of ruby crimson */}
        <svg 
          className="absolute -bottom-48 -right-36 w-[1000px] h-[850px] opacity-30 filter blur-[2px]" 
          viewBox="0 0 1000 850" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            d="M950 700 C 650 800, 350 500, 100 750 C 300 250, 750 200, 950 700 Z" 
            fill="url(#ribbon-ruby)" 
          />
          <defs>
            <linearGradient id="ribbon-ruby" x1="100%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#e11d48" stopOpacity="0.4" />
              <stop offset="60%" stopColor="#be123c" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Luminous optical glow orb */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 25, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="max-w-md w-full glass-panel p-8 sm:p-10 rounded-[28px] relative z-10 text-center space-y-8"
      >
        {/* Floating pill badge */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full glass-pill text-xs font-mono text-cyan-300">
            <Sparkles size={13} className="text-cyan-400 animate-pulse" />
            <span>SYNCHRONIZED THEATER</span>
          </div>
        </div>

        {/* Brand logo & tagline */}
        <div className="space-y-2.5">
          <h1 className="text-6xl font-black tracking-tight text-white drop-shadow-md">
            ks<span className="text-red-500 drop-shadow-[0_0_24px_rgba(239,68,68,0.45)]">live</span>
          </h1>
          <p className="text-gray-300/80 text-sm sm:text-base font-medium">
            Watch movies, shows & videos together in real-time sync.
          </p>
        </div>

        {/* Action Controls */}
        <div className="space-y-4">
          <button
            onClick={createRoom}
            className="w-full flex items-center justify-center gap-2.5 glass-btn-primary text-white font-bold py-3.5 px-6 rounded-2xl transition-all transform hover:scale-[1.015] active:scale-[0.985] text-sm uppercase tracking-wider"
          >
            <Plus size={20} />
            Create Watch Room
          </button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/[0.08]"></span>
            </div>
            <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
              <span className="bg-[#0b0f19]/80 px-3 py-0.5 rounded-full border border-white/[0.06] text-gray-400 font-mono">
                Or join existing
              </span>
            </div>
          </div>

          <form onSubmit={joinRoom} className="flex gap-2">
            <input
              type="text"
              placeholder="Enter Room Code or Link..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 glass-input rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none transition-all font-mono"
            />
            <button
              type="submit"
              className="glass-btn-secondary hover:border-red-500/40 text-white px-4 py-3 rounded-2xl transition-all flex items-center justify-center group"
              title="Enter Room"
            >
              <Play size={18} fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors" />
            </button>
          </form>
        </div>

        <div className="pt-4 border-t border-white/[0.06] text-gray-400/80 text-xs font-mono">
          Smooth - unless your network acts up (so no promises).
        </div>
      </motion.div>
    </div>
  );
}
