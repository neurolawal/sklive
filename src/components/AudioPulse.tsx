import { useEffect, useState, ReactNode } from "react";

interface AudioPulseProps {
  stream: MediaStream | null;
  children: ReactNode;
  isActive: boolean;
}

export default function AudioPulse({ stream, children, isActive }: AudioPulseProps) {
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (!stream || !isActive) {
      setVolume(0);
      return;
    }

    // Initialize AudioContext to analyze frequency
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    
    // We only want the AUDIO tracks to analyze
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      audioCtx.close().catch(console.error);
      return;
    }

    const audioStream = new MediaStream(audioTracks);
    const source = audioCtx.createMediaStreamSource(audioStream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationId: number;

    const updateVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      setVolume(avg); // Scale is roughly 0 to 255
      animationId = requestAnimationFrame(updateVolume);
    };
    
    updateVolume();

    return () => {
      cancelAnimationFrame(animationId);
      source.disconnect();
      audioCtx.close().catch(console.error);
    };
  }, [stream, isActive]);

  // Normal human speech maps to ~0-120 in this array scope
  const scale = 1 + (Math.min(volume, 100) / 100) * 0.4; // Ring expands up to 40%
  const glowOpacity = Math.min(volume, 100) / 100;

  return (
    <div className="relative flex items-center justify-center">
      <div 
        className="absolute w-full h-full rounded-full transition-all duration-75 pointer-events-none"
        style={{ 
          backgroundColor: '#22c55e',
          transform: `scale(${scale})`, 
          opacity: glowOpacity * 0.4 + (isActive ? 0.1 : 0),
          filter: `blur(${4 + volume/20}px)`
        }} 
      />
      <div className="relative z-10 w-full h-full flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
