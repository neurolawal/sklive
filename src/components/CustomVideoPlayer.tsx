import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactPlayer from "react-player";
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX,
  Maximize, Minimize, Subtitles, ListVideo, Search,
  Upload, Check, X, SkipForward, SkipBack, Loader2, Trash2,
  Clock, Edit3
} from "lucide-react";
import { SubtitleCue, formatTime, parseSubtitleFile, parseHumanTimeInput } from "../utils/subtitleParser";

interface PlaylistItem {
  id: string;
  title: string;
  url: string;
}

interface CustomVideoPlayerProps {
  playerRef?: React.RefObject<any>;
  url: string;
  playing: boolean;
  onPlay: (time?: number) => void;
  onPause: (time?: number) => void;
  onSeek: (seconds: number) => void;
  onEnded: () => void;
  // Subtitle props
  subtitles: { name: string; cues: SubtitleCue[] } | null;
  onUpdateSubtitles: (subtitles: { name: string; cues: SubtitleCue[] } | null) => void;
  // Queue props
  queue: PlaylistItem[];
  currentQueueIndex: number;
  onSelectQueueIndex: (index: number) => void;
  onAddToQueue: (urlText: string) => void;
  onRemoveFromQueue: (index: number) => void;
}

export default function CustomVideoPlayer({
  playerRef: externalPlayerRef,
  url,
  playing,
  onPlay,
  onPause,
  onSeek,
  onEnded,
  subtitles,
  onUpdateSubtitles,
  queue,
  currentQueueIndex,
  onSelectQueueIndex,
  onAddToQueue,
  onRemoveFromQueue,
}: CustomVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackPlayerRef = useRef<any>(null);
  const playerRef = externalPlayerRef || fallbackPlayerRef;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimeUpdateRef = useRef<number>(0);

  // Anti-stall & buffer recovery watchdog
  const [isBuffering, setIsBuffering] = useState(false);
  const stallWatchdogRef = useRef<NodeJS.Timeout | null>(null);

  const handleBufferStart = () => {
    setIsBuffering(true);
    if (stallWatchdogRef.current) clearTimeout(stallWatchdogRef.current);
    if (playing) {
      // Auto-nudge if stream hangs in buffer for > 3.5 seconds
      stallWatchdogRef.current = setTimeout(() => {
        forceUnstickBuffer();
      }, 3500);
    }
  };

  const handleBufferEnd = () => {
    setIsBuffering(false);
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
  };

  const forceUnstickBuffer = () => {
    if (!playerRef.current) return;
    try {
      const curr = playerRef.current.currentTime || 0;
      playerRef.current.currentTime = curr + 0.05;
      playerRef.current.play?.().catch(() => {});
    } catch (e) {
      console.warn("Unstick attempt error:", e);
    }
  };

  // Jump to Timestamp modal state
  const [isJumpModalOpen, setIsJumpModalOpen] = useState(false);
  const [jumpTimeInput, setJumpTimeInput] = useState("");
  const [jumpError, setJumpError] = useState("");

  const openJumpModal = () => {
    setJumpTimeInput(formatTime(currentTime));
    setJumpError("");
    setIsJumpModalOpen(true);
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseHumanTimeInput(jumpTimeInput);
    if (parsed === null || isNaN(parsed) || parsed < 0) {
      setJumpError("Invalid format. Use MM:SS or HH:MM:SS (e.g. 35:20)");
      return;
    }
    const target = Math.min(duration || Infinity, parsed);
    setCurrentTime(target);
    if (playerRef.current) {
      playerRef.current.currentTime = target;
    }
    onSeek(target);
    setIsJumpModalOpen(false);
  };

  const handleQuickJump = (deltaSeconds: number) => {
    const target = Math.max(0, Math.min(duration || Infinity, currentTime + deltaSeconds));
    setCurrentTime(target);
    if (playerRef.current) {
      playerRef.current.currentTime = target;
    }
    onSeek(target);
    setIsJumpModalOpen(false);
  };

  // Direct toggle play without echo loops
  const handleTogglePlay = () => {
    const curr = playerRef.current?.currentTime ?? currentTime;
    if (playing) {
      onPause(curr);
    } else {
      onPlay(curr);
    }
  };

  // Keyboard controls (Space to toggle play/pause, Left/Right arrow to skip 10s)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handleSkip(10);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handleSkip(-10);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playing, currentTime, duration]);

  // Subtitle search modal
  const [isSubtitleModalOpen, setIsSubtitleModalOpen] = useState(false);
  const [subtitleSearchQuery, setSubtitleSearchQuery] = useState("");
  const [isSearchingSubtitles, setIsSearchingSubtitles] = useState(false);
  const [subtitleResults, setSubtitleResults] = useState<any[]>([]);
  const [isDownloadingSub, setIsDownloadingSub] = useState<string | null>(null);

  // Playlist drawer inside video
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const [playlistInput, setPlaylistInput] = useState("");

  // Current active subtitle text
  const currentSubtitleText = useMemo(() => {
    if (!subtitles || !subtitles.cues || subtitles.cues.length === 0) return null;
    const activeCue = subtitles.cues.find(
      cue => currentTime >= cue.start && currentTime <= cue.end
    );
    return activeCue ? activeCue.text : null;
  }, [subtitles, currentTime]);

  // Hide controls after inactivity
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.error);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.error);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Skip seconds
  const handleSkip = (seconds: number) => {
    const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
    setCurrentTime(newTime);
    if (playerRef.current) {
      playerRef.current.currentTime = newTime;
    }
    onSeek(newTime);
  };

  // Timeline scrubber
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (playerRef.current) {
      playerRef.current.currentTime = newTime;
    }
    onSeek(newTime);
  };

  // Upload local subtitle (.srt, .vtt)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const cues = parseSubtitleFile(text);
        onUpdateSubtitles({
          name: file.name,
          cues,
        });
        setIsSubtitleModalOpen(false);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Auto-populate video title and search as soon as subtitle modal is opened
  const openSubtitleModal = () => {
    setIsSubtitleModalOpen(true);
    let title = "";
    if (queue[currentQueueIndex]) {
      title = queue[currentQueueIndex].title;
    } else if (url) {
      title = url.split("/").pop()?.split("?")[0] || "";
    }

    // Clean title for search
    const cleanTitle = decodeURIComponent(title)
      .replace(/\.(mp4|mkv|avi|webm|mov)$/i, "")
      .replace(/[._]/g, " ")
      .replace(/\b(WEBRip|BluRay|HDTV|1080p|720p|480p|x264|x265|AAC|THENKIRI\.COM|DOWNLOADED\.FROM)\b/gi, "")
      .trim();

    setSubtitleSearchQuery(cleanTitle);

    if (cleanTitle) {
      setIsSearchingSubtitles(true);
      fetch(`/api/subtitles/search?q=${encodeURIComponent(cleanTitle)}`)
        .then((res) => res.json())
        .then((data) => setSubtitleResults(data.results || []))
        .catch(console.error)
        .finally(() => setIsSearchingSubtitles(false));
    }
  };

  // Search Online Subtitles manually
  const handleSearchSubtitles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subtitleSearchQuery.trim()) return;

    setIsSearchingSubtitles(true);
    try {
      const res = await fetch(`/api/subtitles/search?q=${encodeURIComponent(subtitleSearchQuery)}`);
      const data = await res.json();
      setSubtitleResults(data.results || []);
    } catch (err) {
      console.error("Failed to search subtitles", err);
    } finally {
      setIsSearchingSubtitles(false);
    }
  };

  // Download selected subtitle from search
  const handleSelectOnlineSubtitle = async (result: any) => {
    if (!result.downloadLink) return;
    setIsDownloadingSub(result.id);
    try {
      const res = await fetch(`/api/subtitles/download?url=${encodeURIComponent(result.downloadLink)}`);
      const text = await res.text();
      const cues = parseSubtitleFile(text);
      onUpdateSubtitles({
        name: `${result.release} (${result.language})`,
        cues,
      });
      setIsSubtitleModalOpen(false);
    } catch (err) {
      console.error("Failed to download subtitle", err);
    } finally {
      setIsDownloadingSub(null);
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full h-full bg-black select-none overflow-hidden group flex items-center justify-center"
    >
      {/* Video Element */}
      <ReactPlayer
        ref={playerRef}
        src={url}
        playing={playing}
        controls={false}
        width="100%"
        height="100%"
        preload="metadata"
        playsInline
        volume={isMuted ? 0 : volume}
        onEnded={onEnded}
        onWaiting={handleBufferStart}
        onStalled={handleBufferStart}
        onPlaying={handleBufferEnd}
        onCanPlay={handleBufferEnd}
        onSeeked={(e: any) => {
          handleBufferEnd();
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onTimeUpdate={(e: any) => {
          handleBufferEnd();
          const now = performance.now();
          if (now - lastTimeUpdateRef.current > 250) {
            lastTimeUpdateRef.current = now;
            setCurrentTime(e.currentTarget.currentTime);
          }
        }}
        onLoadedMetadata={(e: any) => setDuration(e.currentTarget.duration || 0)}
        style={{ position: "absolute", top: 0, left: 0 }}
      />

      {/* Buffering Indicator with instant Unstick button */}
      {isBuffering && playing && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/85 backdrop-blur-md border border-white/10 px-3.5 py-1.5 rounded-full text-xs text-white shadow-2xl">
          <Loader2 size={13} className="animate-spin text-red-500" />
          <span>Buffering...</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              forceUnstickBuffer();
            }}
            className="ml-1 bg-white/10 hover:bg-white/20 active:scale-95 px-2 py-0.5 rounded text-[10px] font-bold text-red-400 hover:text-red-300 transition-all"
            title="Click to flush browser media buffer and resume stream"
          >
            ⚡ Unstick
          </button>
        </div>
      )}

      {/* Center Big Play/Pause Indicator on Click */}
      <div
        onClick={handleTogglePlay}
        className="absolute inset-0 cursor-pointer flex items-center justify-center z-10"
      >
        {!playing && (
          <div className="w-20 h-20 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-2xl backdrop-blur-md transform transition-all hover:scale-110">
            <Play fill="white" size={36} className="ml-1" />
          </div>
        )}
      </div>

      {/* Subtitles Overlay */}
      {currentSubtitleText && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 max-w-[80%] text-center z-20 pointer-events-none transition-all">
          <span className="bg-black/80 text-white text-lg md:text-2xl font-medium px-4 py-1.5 rounded-lg leading-relaxed shadow-lg border border-white/10 backdrop-blur-sm whitespace-pre-wrap">
            {currentSubtitleText}
          </span>
        </div>
      )}

      {/* Custom Control Bar Overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 z-30 transition-opacity duration-300 ${
          showControls || !playing ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrubber Progress Bar */}
        <div className="relative mb-3 flex items-center group/scrubber cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleScrubberChange}
            className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-red-600 hover:h-2.5 transition-all"
          />
        </div>

        {/* Buttons and Time Display */}
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={handleTogglePlay}
              className="p-2 hover:bg-white/10 rounded-full transition-all"
              title={playing ? "Pause (Space)" : "Play (Space)"}
            >
              {playing ? <Pause size={22} fill="white" /> : <Play size={22} fill="white" />}
            </button>

            {/* Skip Backward 10s */}
            <button
              onClick={() => handleSkip(-10)}
              className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-300 hover:text-white"
              title="Skip back 10 seconds"
            >
              <RotateCcw size={20} />
            </button>

            {/* Skip Forward 10s */}
            <button
              onClick={() => handleSkip(10)}
              className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-300 hover:text-white"
              title="Skip ahead 10 seconds"
            >
              <RotateCw size={20} />
            </button>

            {/* Next Video in Queue */}
            {queue.length > 1 && (
              <button
                onClick={() => {
                  const nextIdx = (currentQueueIndex + 1) % queue.length;
                  onSelectQueueIndex(nextIdx);
                }}
                className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-300 hover:text-white"
                title="Next Video in Queue"
              >
                <SkipForward size={20} />
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center gap-2 group/volume">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-300 hover:text-white"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  setIsMuted(false);
                }}
                className="w-16 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-red-600 opacity-0 group-hover/volume:opacity-100 transition-opacity"
              />
            </div>

            {/* Time Stamp with Direct Edit/Jump Button */}
            <div className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 px-2.5 py-1 rounded-lg border border-white/10 transition-all">
              <span className="text-xs font-mono text-gray-300">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button
                type="button"
                onClick={openJumpModal}
                className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-white/20 transition-all flex items-center gap-1"
                title="Jump to specific timestamp in video (syncs with partner)"
              >
                <Clock size={12} className="text-red-400" />
                <span className="text-[10px] font-semibold text-gray-400 hover:text-white uppercase tracking-wider hidden sm:inline">Jump</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Subtitles Toggle & Setup */}
            <button
              onClick={openSubtitleModal}
              className={`p-2 rounded-full transition-all flex items-center gap-1.5 text-xs font-semibold px-3 ${
                subtitles
                  ? "bg-red-600 text-white shadow-md shadow-red-600/30"
                  : "bg-white/10 text-gray-300 hover:text-white hover:bg-white/20"
              }`}
              title="Subtitles / Closed Captions"
            >
              <Subtitles size={18} />
              <span>{subtitles ? "CC ON" : "CC"}</span>
            </button>

            {/* Playlist Drawer Toggle */}
            {queue.length > 0 && (
              <button
                onClick={() => setIsPlaylistOpen(!isPlaylistOpen)}
                className={`p-2 rounded-full transition-all flex items-center gap-1.5 text-xs font-semibold px-3 ${
                  isPlaylistOpen
                    ? "bg-red-600 text-white"
                    : "bg-white/10 text-gray-300 hover:text-white hover:bg-white/20"
                }`}
                title="Playlist / Queue"
              >
                <ListVideo size={18} />
                <span>{queue.length}</span>
              </button>
            )}

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-300 hover:text-white"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Playlist Drawer (Slide-in over video) */}
      {isPlaylistOpen && queue.length > 0 && (
        <div className="absolute right-0 top-0 bottom-16 w-80 bg-black/90 backdrop-blur-xl border-l border-white/10 z-40 p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
            <h3 className="font-bold text-sm tracking-wide text-white uppercase flex items-center gap-2">
              <ListVideo size={16} className="text-red-600" />
              Playlist ({queue.length})
            </h3>
            <button
              onClick={() => setIsPlaylistOpen(false)}
              className="p-1 hover:bg-white/10 rounded-full text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-3">
            {queue.map((item, idx) => (
              <div
                key={item.id}
                className={`p-3 rounded-xl cursor-pointer text-xs flex items-center gap-2 group/item transition-all ${
                  idx === currentQueueIndex
                    ? "bg-red-600 text-white font-bold shadow-lg"
                    : "bg-white/5 hover:bg-white/10 text-gray-300"
                }`}
              >
                <div
                  onClick={() => onSelectQueueIndex(idx)}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <span className="font-mono opacity-60">{idx + 1}.</span>
                  <span className="truncate flex-1">{item.title}</span>
                  {idx === currentQueueIndex && <Play size={12} fill="white" />}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromQueue(idx);
                  }}
                  className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-white/10 rounded-md transition-all opacity-80 hover:opacity-100"
                  title="Remove from playlist"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Add to Playlist Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!playlistInput.trim()) return;
              onAddToQueue(playlistInput.trim());
              setPlaylistInput("");
            }}
            className="pt-3 border-t border-white/10 flex flex-col gap-2"
          >
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              Add More Videos (Paste link(s))
            </span>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Paste video URL(s)..."
                value={playlistInput}
                onChange={(e) => setPlaylistInput(e.target.value)}
                className="flex-1 bg-white/10 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-600"
              />
              <button
                type="submit"
                disabled={!playlistInput.trim()}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              >
                Add
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Subtitles Modal */}
      {isSubtitleModalOpen && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#121212] border border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6 text-white">
            <div className="flex items-center justify-between border-b border-gray-800 pb-4">
              <div className="flex items-center gap-2">
                <Subtitles className="text-red-600" size={24} />
                <h3 className="text-lg font-bold">Subtitles & Captions</h3>
              </div>
              <button
                onClick={() => setIsSubtitleModalOpen(false)}
                className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Currently Active Subtitle */}
            {subtitles && (
              <div className="p-3 bg-red-600/10 border border-red-600/30 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-red-400 uppercase font-bold tracking-wider block">
                    Active Subtitle Track
                  </span>
                  <span className="text-sm font-semibold truncate block max-w-xs">{subtitles.name}</span>
                </div>
                <button
                  onClick={() => onUpdateSubtitles(null)}
                  className="text-xs bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg font-bold"
                >
                  Turn Off
                </button>
              </div>
            )}

            {/* Option 1: Upload Local File */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                1. Upload Subtitle File (.srt, .vtt)
              </label>
              <input
                type="file"
                ref={fileInputRef}
                accept=".srt,.vtt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-gray-200 transition-all"
              >
                <Upload size={16} /> Choose file from your computer
              </button>
            </div>

            {/* Option 2: Search Online */}
            <div className="space-y-3 pt-2 border-t border-gray-800">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                2. Search Free Subtitles Online
              </label>
              <form onSubmit={handleSearchSubtitles} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter movie / show title..."
                  value={subtitleSearchQuery}
                  onChange={(e) => setSubtitleSearchQuery(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-800 px-4 py-2 rounded-xl text-sm focus:outline-none focus:border-red-600"
                />
                <button
                  type="submit"
                  disabled={isSearchingSubtitles || !subtitleSearchQuery.trim()}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2"
                >
                  {isSearchingSubtitles ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  Search
                </button>
              </form>

              {/* Search Results List */}
              {subtitleResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {subtitleResults.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-3 bg-gray-900/60 hover:bg-gray-800/80 border border-gray-800/80 rounded-xl flex items-center justify-between text-xs transition-all"
                    >
                      <div className="truncate flex-1 mr-3">
                        <span className="font-semibold block truncate">{sub.release}</span>
                        <span className="text-gray-500 text-[10px] uppercase">
                          Lang: {sub.language} • Downloads: {sub.downloads}
                        </span>
                      </div>
                      <button
                        onClick={() => handleSelectOnlineSubtitle(sub)}
                        disabled={isDownloadingSub === sub.id}
                        className="bg-gray-800 hover:bg-red-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-all"
                      >
                        {isDownloadingSub === sub.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Check size={12} />
                        )}
                        Load
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Jump to Specific Timestamp Modal */}
      {isJumpModalOpen && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#121212] border border-gray-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="text-red-500" size={20} />
                <h3 className="text-base font-bold">Jump to Timestamp</h3>
              </div>
              <button
                onClick={() => setIsJumpModalOpen(false)}
                className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-xs text-gray-400">
              Enter any timestamp to jump and sync both viewers instantly.
              <div className="mt-1 font-mono text-gray-300">
                Current: <span className="text-red-400">{formatTime(currentTime)}</span> / {formatTime(duration)}
              </div>
            </div>

            <form onSubmit={handleJumpSubmit} className="space-y-3">
              <div>
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. 45:20, 1:15:00, or 90"
                  value={jumpTimeInput}
                  onChange={(e) => {
                    setJumpTimeInput(e.target.value);
                    if (jumpError) setJumpError("");
                  }}
                  className="w-full bg-gray-900 border border-gray-800 focus:border-red-600 rounded-xl px-3.5 py-2.5 text-base font-mono text-center tracking-wider text-white focus:outline-none transition-all"
                />
                {jumpError && (
                  <p className="text-red-400 text-xs mt-1.5 text-center font-medium">{jumpError}</p>
                )}
              </div>

              {/* Quick Jump Shortcuts */}
              <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                <button
                  type="button"
                  onClick={() => handleQuickJump(-300)}
                  className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-[11px] font-mono text-gray-300 hover:text-white transition-all"
                >
                  -5m
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickJump(-60)}
                  className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-[11px] font-mono text-gray-300 hover:text-white transition-all"
                >
                  -1m
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickJump(60)}
                  className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-[11px] font-mono text-gray-300 hover:text-white transition-all"
                >
                  +1m
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickJump(300)}
                  className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-[11px] font-mono text-gray-300 hover:text-white transition-all"
                >
                  +5m
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickJump(900)}
                  className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-[11px] font-mono text-gray-300 hover:text-white transition-all"
                >
                  +15m
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsJumpModalOpen(false)}
                  className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl text-xs font-bold text-gray-400 hover:text-white transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-red-600/30 flex items-center justify-center gap-1.5"
                >
                  <Clock size={14} />
                  Jump & Sync
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
