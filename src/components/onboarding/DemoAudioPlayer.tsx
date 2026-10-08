'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayCircle, PauseCircle, Volume2, AudioLines } from 'lucide-react';

export interface DemoAudioPlayerProps {
  /** Public path to the demo call recording, e.g. "/audio/flux-demo-call.m4a". */
  src: string;
  /** Short label shown above the player, e.g. "Hear Flux answer a real call". */
  label?: string;
}

/** Formats a duration in seconds as `m:ss`, e.g. 125 -> "2:05". Returns "0:00" for NaN/Infinity. */
function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * DemoAudioPlayer — a themed, self-contained "Listen to Demo" audio player
 * for onboarding Step 3. Wraps a real `<audio>` element (no mocked/simulated
 * playback) with custom play/pause controls and a live progress bar so new,
 * non-technical users can hear exactly what their AI receptionist sounds
 * like before deploying it.
 */
export default function DemoAudioPlayer({ src, label = 'Hear Flux answer a real call' }: DemoAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      void audio.play();
      setIsPlaying(true);
    }
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      id="demo-audio-player"
      className="p-4 sm:p-5 bg-zinc-950/70 border border-zinc-800 rounded-xl flex items-center gap-4"
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- voice demo has no spoken content requiring captions in this context */}
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        id="demo-audio-toggle-button"
        type="button"
        onClick={togglePlayback}
        aria-label={isPlaying ? 'Pause demo' : 'Play demo'}
        className="shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 flex items-center justify-center text-zinc-950 shadow-lg shadow-amber-500/25 transition-all active:scale-95 cursor-pointer"
      >
        {isPlaying ? <PauseCircle className="w-8 h-8" /> : <PlayCircle className="w-8 h-8" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-1.5">
          <AudioLines className="w-3.5 h-3.5 text-amber-400" />
          {label}
        </div>

        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
          <span>{formatDuration(currentTime)}</span>
          <span className="flex items-center gap-1">
            <Volume2 className="w-3 h-3" />
            {formatDuration(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
