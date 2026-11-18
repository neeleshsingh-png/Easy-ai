import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Globe,
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  X,
  AlertCircle,
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  VOICE_OPTIONS,
  type LiveTranscriptEntry,
  type VoiceName,
} from '../types/chat';
import { EasyAiLogo } from './EasyAiLogo';

interface VoiceLiveModalProps {
  isOpen: boolean;
  language: string;
  voice: VoiceName;
  onChangeLanguage: (code: string) => void;
  onChangeVoice: (voice: VoiceName) => void;
  onClose: (transcripts: LiveTranscriptEntry[]) => void;
}

type ConnectionState = 'connecting' | 'listening' | 'speaking' | 'muted' | 'error';

function downsampleBuffer(
  buffer: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < buffer.length;
      i++
    ) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export const VoiceLiveModal: React.FC<VoiceLiveModalProps> = ({
  isOpen,
  language,
  voice,
  onChangeLanguage,
  onChangeVoice,
  onClose,
}) => {
  const [status, setStatus] = useState<ConnectionState>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<LiveTranscriptEntry[]>([]);

  const isMutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const transcriptsEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptsRef = useRef<LiveTranscriptEntry[]>([]);

  const activeUserEntryIdRef = useRef<string | null>(null);
  const activeAiEntryIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (status !== 'error' && status !== 'connecting') {
      if (isMuted) {
        setStatus('muted');
      } else if (activeSourcesRef.current.size > 0) {
        setStatus('speaking');
      } else {
        setStatus('listening');
      }
    }
  }, [isMuted, status]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
    transcriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const stopAllPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // ignore already stopped
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const cleanupSession = useCallback(() => {
    stopAllPlayback();
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
  }, [stopAllPlayback]);

  // Connect live voice WebSocket + audio pipeline
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setStatus('connecting');
    setErrorMsg(null);
    activeUserEntryIdRef.current = null;
    activeAiEntryIdRef.current = null;

    const startLive = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;

        const inputCtx = new AudioContext({ sampleRate: 16000 });
        const outputCtx = new AudioContext({ sampleRate: 24000 });
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
        inputCtxRef.current = inputCtx;
        outputCtxRef.current = outputCtx;
        nextStartTimeRef.current = outputCtx.currentTime;

        const inputAnalyser = inputCtx.createAnalyser();
        inputAnalyser.fftSize = 128;
        inputAnalyserRef.current = inputAnalyser;

        const outputAnalyser = outputCtx.createAnalyser();
        outputAnalyser.fftSize = 128;
        outputAnalyser.connect(outputCtx.destination);
        outputAnalyserRef.current = outputAnalyser;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/live?language=${encodeURIComponent(
          language
        )}&voice=${encodeURIComponent(voice)}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(inputAnalyser);
        inputAnalyser.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (event) => {
          if (
            cancelled ||
            isMutedRef.current ||
            ws.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          const inputData = event.inputBuffer.getChannelData(0);
          const downsampled = downsampleBuffer(
            inputData,
            inputCtx.sampleRate,
            16000
          );
          const base64 = float32ToPcm16Base64(downsampled);
          ws.send(JSON.stringify({ type: 'audio', data: base64 }));
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(event.data) as {
              type: string;
              data?: string;
              text?: string;
              message?: string;
            };

            if (msg.type === 'ready') {
              setStatus(isMutedRef.current ? 'muted' : 'listening');
            } else if (msg.type === 'audio' && msg.data && outputCtxRef.current) {
              setStatus('speaking');
              const floatSamples = base64PcmToFloat32(msg.data);
              const buffer = outputCtxRef.current.createBuffer(
                1,
                floatSamples.length,
                24000
              );
              buffer.getChannelData(0).set(floatSamples);

              const bufferSource = outputCtxRef.current.createBufferSource();
              bufferSource.buffer = buffer;
              if (outputAnalyserRef.current) {
                bufferSource.connect(outputAnalyserRef.current);
              } else {
                bufferSource.connect(outputCtxRef.current.destination);
              }

              const now = outputCtxRef.current.currentTime;
              const startAt = Math.max(now, nextStartTimeRef.current);
              bufferSource.start(startAt);
              nextStartTimeRef.current = startAt + buffer.duration;

              activeSourcesRef.current.add(bufferSource);
              bufferSource.onended = () => {
                activeSourcesRef.current.delete(bufferSource);
                if (activeSourcesRef.current.size === 0 && !cancelled) {
                  setStatus(isMutedRef.current ? 'muted' : 'listening');
                }
              };
            } else if (msg.type === 'interrupted') {
              stopAllPlayback();
              activeAiEntryIdRef.current = null;
              setStatus(isMutedRef.current ? 'muted' : 'listening');
            } else if (msg.type === 'inputTranscript' && msg.text) {
              const incoming = msg.text;
              activeAiEntryIdRef.current = null;
              setTranscripts((prev) => {
                if (activeUserEntryIdRef.current) {
                  return prev.map((entry) =>
                    entry.id === activeUserEntryIdRef.current
                      ? { ...entry, text: entry.text + incoming }
                      : entry
                  );
                }
                const newId = `live-u-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 6)}`;
                activeUserEntryIdRef.current = newId;
                return [
                  ...prev,
                  {
                    id: newId,
                    role: 'user',
                    text: incoming.trimStart(),
                    timestamp: Date.now(),
                  },
                ];
              });
            } else if (msg.type === 'outputTranscript' && msg.text) {
              const incoming = msg.text;
              activeUserEntryIdRef.current = null;
              setTranscripts((prev) => {
                if (activeAiEntryIdRef.current) {
                  return prev.map((entry) =>
                    entry.id === activeAiEntryIdRef.current
                      ? { ...entry, text: entry.text + incoming }
                      : entry
                  );
                }
                const newId = `live-a-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 6)}`;
                activeAiEntryIdRef.current = newId;
                return [
                  ...prev,
                  {
                    id: newId,
                    role: 'assistant',
                    text: incoming.trimStart(),
                    timestamp: Date.now(),
                  },
                ];
              });
            } else if (msg.type === 'turnComplete') {
              activeUserEntryIdRef.current = null;
              activeAiEntryIdRef.current = null;
            } else if (msg.type === 'error') {
              setStatus('error');
              setErrorMsg(
                msg.message || 'Voice connection encountered an error.'
              );
            }
          } catch {
            // ignore malformed message
          }
        };

        ws.onerror = () => {
          if (!cancelled) {
            setStatus('error');
            setErrorMsg(
              'Unable to connect to real-time voice service. Please check your connection.'
            );
          }
        };
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Microphone access is required for real-time voice interaction.'
          );
        }
      }
    };

    startLive();

    return () => {
      cancelled = true;
      cleanupSession();
    };
  }, [isOpen, language, voice, cleanupSession, stopAllPlayback]);

  // 60fps Canvas Acoustic Ring Visualizer
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const dataArray = new Uint8Array(64);
    let phase = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const size = 220;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;

      let energy = 0;
      const activeAnalyser =
        status === 'speaking'
          ? outputAnalyserRef.current
          : !isMutedRef.current
          ? inputAnalyserRef.current
          : null;

      if (activeAnalyser) {
        activeAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        energy = sum / (dataArray.length * 255);
      }

      if (!prefersReducedMotion) {
        phase += 0.03 + energy * 0.08;
      }

      const baseRadius = 56;
      const pulse = prefersReducedMotion ? 0 : energy * 22;

      // Outer subtle ring
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius + 24 + pulse * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle =
        status === 'speaking'
          ? 'rgba(20, 184, 166, 0.25)'
          : status === 'error'
          ? 'rgba(239, 68, 68, 0.28)'
          : 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Dynamic harmonic ring
      ctx.beginPath();
      const points = 64;
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const binIndex = Math.floor((i / points) * 24);
        const binValue = activeAnalyser ? dataArray[binIndex] / 255 : 0;
        const wave = prefersReducedMotion
          ? 0
          : Math.sin(angle * 4 + phase) * (2.5 + energy * 10) + binValue * 14;
        const r = baseRadius + 6 + wave;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle =
        status === 'speaking'
          ? '#14b8a6'
          : status === 'muted'
          ? '#64748b'
          : status === 'error'
          ? '#ef4444'
          : '#0d9488';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Inner solid core
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius - 6 + pulse * 0.25, 0, Math.PI * 2);
      ctx.fillStyle =
        status === 'speaking'
          ? 'rgba(20, 184, 166, 0.16)'
          : status === 'error'
          ? 'rgba(239, 68, 68, 0.14)'
          : 'rgba(13, 148, 136, 0.12)';
      ctx.fill();

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isOpen, status]);

  if (!isOpen) return null;

  const statusText =
    status === 'connecting'
      ? 'Connecting real-time voice...'
      : status === 'speaking'
      ? 'EASY AI is speaking'
      : status === 'muted'
      ? 'Microphone muted'
      : status === 'error'
      ? 'Connection interrupted'
      : 'Listening — speak naturally';

  const handleEnd = () => {
    cleanupSession();
    const finalTranscripts = transcriptsRef.current.filter(
      (t) => t.text.trim().length > 0
    );
    setTranscripts([]);
    onClose(finalTranscripts);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100"
      role="dialog"
      aria-modal="true"
      aria-label="EASY AI Real-Time Voice Mode"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 sm:px-8 h-16 border-b border-slate-800/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <EasyAiLogo size={26} />
          <span className="font-display font-semibold text-base tracking-tight whitespace-nowrap">
            EASY AI Voice
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={language}
              onChange={(e) => onChangeLanguage(e.target.value)}
              aria-label="Voice language"
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.nativeName})
                </option>
              ))}
            </select>
          </div>

          <div className="hidden sm:flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={voice}
              onChange={(e) => onChangeVoice(e.target.value as VoiceName)}
              aria-label="Voice persona"
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleEnd}
            aria-label="Close voice mode"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Center Visualizer & Live Transcript */}
      <div className="flex-1 overflow-hidden flex flex-col items-center justify-between px-4 py-6 max-w-2xl w-full mx-auto">
        <div className="flex flex-col items-center justify-center pt-2 pb-4 shrink-0">
          <div className="relative flex items-center justify-center w-[220px] h-[220px]">
            <canvas
              ref={canvasRef}
              className="w-[220px] h-[220px]"
              aria-hidden="true"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <EasyAiLogo size={40} />
            </div>
          </div>

          <p className="mt-2 text-sm font-medium text-slate-200">{statusText}</p>
          <p className="mt-1 text-xs text-slate-400">
            Interrupt anytime by speaking · Multilingual supported
          </p>

          <div className="sm:hidden flex items-center justify-center gap-2 mt-3">
            <select
              value={language}
              onChange={(e) => onChangeLanguage(e.target.value)}
              aria-label="Voice language"
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-teal-500 cursor-pointer max-w-[160px]"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
            <select
              value={voice}
              onChange={(e) => onChangeVoice(e.target.value as VoiceName)}
              aria-label="Voice persona"
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {errorMsg && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-900/70 bg-red-950/50 px-3.5 py-2.5 text-xs text-red-200 max-w-md text-center">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Live Transcript Feed */}
        <div className="w-full flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 space-y-3">
          {transcripts.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center px-4">
              <p className="text-xs text-slate-500">
                Live conversation transcript will appear here as you speak with
                EASY AI.
              </p>
            </div>
          ) : (
            transcripts.map((item) => (
              <div
                key={item.id}
                className={`flex flex-col ${
                  item.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <span className="text-[11px] text-slate-500 mb-1">
                  {item.role === 'user' ? 'You' : 'EASY AI'}
                </span>
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                    item.role === 'user'
                      ? 'bg-slate-800 text-slate-100'
                      : 'bg-teal-950/50 border border-teal-800/50 text-teal-50'
                  }`}
                >
                  {item.text}
                </div>
              </div>
            ))
          )}
          <div ref={transcriptsEndRef} />
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="px-6 py-5 border-t border-slate-800/80 flex items-center justify-center gap-5 shrink-0">
        <button
          type="button"
          onClick={() => setIsMuted((m) => !m)}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-xl font-medium text-sm transition-colors cursor-pointer whitespace-nowrap ${
            isMuted
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
              : 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700'
          }`}
        >
          {isMuted ? (
            <>
              <MicOff className="w-4 h-4" />
              <span>Unmute mic</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              <span>Mute mic</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleEnd}
          className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-colors cursor-pointer whitespace-nowrap"
        >
          <PhoneOff className="w-4 h-4" />
          <span>End &amp; save to chat</span>
        </button>
      </div>
    </div>
  );
};
