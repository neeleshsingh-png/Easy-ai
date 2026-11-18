import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  Globe,
  ImagePlus,
  Loader2,
  Mic,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  type ChatMessage,
  type Conversation,
  type ImageAttachment,
  type LiveTranscriptEntry,
  type ResponseDepth,
  type VoiceName,
} from './types/chat';
import { EasyAiLogo } from './components/EasyAiLogo';
import { Sidebar } from './components/Sidebar';
import { ChatMessageRow } from './components/ChatMessageRow';
import { VoiceLiveModal } from './components/VoiceLiveModal';

const STORAGE_KEYS = {
  conversations: 'easy_ai_conversations_v1',
  theme: 'easy_ai_theme_v1',
  language: 'easy_ai_language_v1',
  voice: 'easy_ai_voice_v1',
};

const STARTER_PROMPTS = [
  {
    title: 'Explain a complex topic simply',
    prompt: 'Explain how quantum computing differs from classical computing using an everyday analogy.',
    category: 'Science & Learning',
  },
  {
    title: 'Write & debug code',
    prompt: 'Write a clean TypeScript debounce utility function with proper types and a usage example.',
    category: 'Engineering',
  },
  {
    title: 'Multilingual translation & tone',
    prompt: 'Translate "Welcome! How can I help you today?" into Hindi, Spanish, French, and Japanese with pronunciation tips.',
    category: 'Languages',
  },
  {
    title: 'Plan & organize',
    prompt: 'Create a focused 3-day itinerary for a first-time visitor to Tokyo covering food, neighborhoods, and transit.',
    category: 'Planning',
  },
];

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildTitleFromText(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Image conversation';
  return cleaned.length > 42 ? `${cleaned.slice(0, 42)}...` : cleaned;
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.conversations);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  });

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.theme);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  const [language, setLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.language) || 'auto';
    } catch {
      return 'auto';
    }
  });

  const [voice, setVoice] = useState<VoiceName>(() => {
    try {
      return (
        (localStorage.getItem(STORAGE_KEYS.voice) as VoiceName) || 'Zephyr'
      );
    } catch {
      return 'Zephyr';
    }
  });

  const [depth, setDepth] = useState<ResponseDepth>('balanced');
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  // Dictation state
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // TTS read-aloud state
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null
  );
  const [loadingSpeechId, setLoadingSpeechId] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Persist conversations, language, voice
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.conversations,
        JSON.stringify(conversations)
      );
    } catch {
      // ignore storage quota errors
    }
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.language, language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.voice, voice);
    } catch {
      // ignore
    }
  }, [voice]);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || null;

  // Auto-scroll chat feed
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length, isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputText]);

  const stopSpeechPlayback = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
      ttsAudioRef.current = null;
    }
    setSpeakingMessageId(null);
    setLoadingSpeechId(null);
  }, []);

  const handleSpeakMessage = useCallback(
    async (msg: ChatMessage) => {
      stopSpeechPlayback();
      setLoadingSpeechId(msg.id);

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg.content, voice }),
        });
        const data = (await res.json()) as {
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        };

        if (!res.ok || !data.audioBase64) {
          throw new Error(data.error || 'Failed to generate audio.');
        }

        const audio = new Audio(
          `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`
        );
        ttsAudioRef.current = audio;
        setLoadingSpeechId(null);
        setSpeakingMessageId(msg.id);

        audio.onended = () => {
          setSpeakingMessageId(null);
          ttsAudioRef.current = null;
        };
        audio.onerror = () => {
          setSpeakingMessageId(null);
          ttsAudioRef.current = null;
        };

        await audio.play();
      } catch (err) {
        console.error('Read aloud failed:', err);
        setLoadingSpeechId(null);
        setSpeakingMessageId(null);
      }
    },
    [stopSpeechPlayback, voice]
  );

  const streamAssistantResponse = useCallback(
    async (
      convId: string,
      historyForApi: ChatMessage[],
      assistantMessageId: string,
      langCode: string,
      selectedDepth: ResponseDepth
    ) => {
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setIsStreaming(true);

      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            messages: historyForApi.map((m) => ({
              role: m.role,
              content: m.content,
              image: m.image
                ? { mimeType: m.image.mimeType, base64: m.image.base64 }
                : undefined,
            })),
            language: langCode,
            depth: selectedDepth,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const payload = JSON.parse(jsonStr) as {
                text?: string;
                done?: boolean;
                error?: string;
              };

              if (payload.error) {
                throw new Error(payload.error);
              }

              if (payload.text) {
                accumulated += payload.text;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === convId
                      ? {
                          ...c,
                          updatedAt: Date.now(),
                          messages: c.messages.map((m) =>
                            m.id === assistantMessageId
                              ? { ...m, content: accumulated }
                              : m
                          ),
                        }
                      : c
                  )
                );
              }
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                !parseErr.message.includes('JSON')
              ) {
                throw parseErr;
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to reach EASY AI. Please try again.';

        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          content: m.content || message,
                          error: !m.content,
                        }
                      : m
                  ),
                }
              : c
          )
        );
      } finally {
        streamAbortRef.current = null;
        setIsStreaming(false);
      }
    },
    []
  );

  const handleSendMessage = useCallback(
    async (overridePrompt?: string) => {
      if (isStreaming) return;
      const text = (overridePrompt ?? inputText).trim();
      const currentAttachment = overridePrompt ? null : attachment;
      if (!text && !currentAttachment) return;

      stopSpeechPlayback();
      setDictationError(null);

      const userMessage: ChatMessage = {
        id: createId('msg-u'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
        image: currentAttachment || undefined,
      };

      const assistantPlaceholder: ChatMessage = {
        id: createId('msg-a'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };

      if (!overridePrompt) {
        setInputText('');
        setAttachment(null);
      }

      let targetConvId = activeConversationId;
      let historyForApi: ChatMessage[] = [];

      if (!targetConvId) {
        targetConvId = createId('conv');
        const newConv: Conversation = {
          id: targetConvId,
          title: buildTitleFromText(text),
          messages: [userMessage, assistantPlaceholder],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          language,
        };
        historyForApi = [userMessage];
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(targetConvId);
      } else {
        const existing = conversations.find((c) => c.id === targetConvId);
        historyForApi = [...(existing?.messages || []), userMessage].filter(
          (m) => !m.error
        );
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? {
                  ...c,
                  title:
                    c.messages.length === 0
                      ? buildTitleFromText(text)
                      : c.title,
                  updatedAt: Date.now(),
                  messages: [...c.messages, userMessage, assistantPlaceholder],
                }
              : c
          )
        );
      }

      await streamAssistantResponse(
        targetConvId,
        historyForApi,
        assistantPlaceholder.id,
        language,
        depth
      );
    },
    [
      activeConversationId,
      attachment,
      conversations,
      depth,
      inputText,
      isStreaming,
      language,
      stopSpeechPlayback,
      streamAssistantResponse,
    ]
  );

  const handleStopStreaming = () => {
    streamAbortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleRegenerate = useCallback(async () => {
    if (!activeConversation || isStreaming) return;
    const msgs = activeConversation.messages;
    if (msgs.length === 0) return;

    const lastMsg = msgs[msgs.length - 1];
    const trimmedMsgs =
      lastMsg.role === 'assistant' ? msgs.slice(0, -1) : msgs.slice();

    if (trimmedMsgs.length === 0) return;

    stopSpeechPlayback();
    const assistantPlaceholder: ChatMessage = {
      id: createId('msg-a'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };

    const historyForApi = trimmedMsgs.filter((m) => !m.error);

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? {
              ...c,
              updatedAt: Date.now(),
              messages: [...trimmedMsgs, assistantPlaceholder],
            }
          : c
      )
    );

    await streamAssistantResponse(
      activeConversation.id,
      historyForApi,
      assistantPlaceholder.id,
      language,
      depth
    );
  }, [
    activeConversation,
    depth,
    isStreaming,
    language,
    stopSpeechPlayback,
    streamAssistantResponse,
  ]);

  const handleNewChat = () => {
    handleStopStreaming();
    stopSpeechPlayback();
    setActiveConversationId(null);
    setInputText('');
    setAttachment(null);
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  };

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.split(',')[1];
      if (base64) {
        setAttachment({
          name: file.name,
          mimeType: file.type || 'image/png',
          base64,
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleToggleDictation = async () => {
    setDictationError(null);

    if (isDictating) {
      mediaRecorderRef.current?.stop();
      setIsDictating(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 100) return;

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const res = String(reader.result || '');
              resolve(res.split(',')[1] || '');
            };
            reader.onerror = () => reject(new Error('Failed to read audio.'));
            reader.readAsDataURL(blob);
          });

          const resp = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType,
              language,
            }),
          });
          const data = (await resp.json()) as { text?: string; error?: string };
          if (!resp.ok) {
            throw new Error(data.error || 'Transcription failed.');
          }
          if (data.text) {
            setInputText((prev) =>
              prev.trim() ? `${prev.trim()} ${data.text}` : data.text || ''
            );
            textareaRef.current?.focus();
          }
        } catch (err) {
          setDictationError(
            err instanceof Error ? err.message : 'Could not transcribe audio.'
          );
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsDictating(true);
    } catch (err) {
      setDictationError(
        err instanceof Error
          ? err.message
          : 'Microphone access denied. Please allow microphone access.'
      );
    }
  };

  const handleCloseVoiceModal = (transcripts: LiveTranscriptEntry[]) => {
    setIsVoiceModalOpen(false);
    if (transcripts.length === 0) return;

    const converted: ChatMessage[] = transcripts.map((t) => ({
      id: createId(t.role === 'user' ? 'msg-u' : 'msg-a'),
      role: t.role,
      content: t.text,
      createdAt: t.timestamp,
      viaVoice: true,
    }));

    if (activeConversationId) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: [...c.messages, ...converted],
              }
            : c
        )
      );
    } else {
      const firstUser = transcripts.find((t) => t.role === 'user');
      const newConv: Conversation = {
        id: createId('conv'),
        title: buildTitleFromText(firstUser?.text || 'Voice conversation'),
        messages: converted,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language,
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newConv.id);
    }
  };

  const messages = activeConversation?.messages || [];
  const latestAssistantIndex = [...messages]
    .reverse()
    .findIndex((m) => m.role === 'assistant');
  const latestAssistantId =
    latestAssistantIndex >= 0
      ? messages[messages.length - 1 - latestAssistantIndex].id
      : null;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Left Conversation Sidebar */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        isOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        onSelectConversation={(id) => {
          handleStopStreaming();
          stopSpeechPlayback();
          setActiveConversationId(id);
        }}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        selectedVoice={voice}
        onChangeVoice={setVoice}
        theme={theme}
        onToggleTheme={() =>
          setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
        }
      />

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Top Bar Contract: 3 clean zones */}
        <header className="h-14 px-4 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-4 shrink-0 bg-white/90 dark:bg-[#0B0F17]/90 backdrop-blur-sm">
          {/* Zone 1: Brand / Active Thread Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
                aria-label="Open sidebar"
                className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-2 min-w-0">
              {!sidebarOpen && <EasyAiLogo size={24} className="shrink-0" />}
              <h1 className="font-display font-semibold text-sm sm:text-base tracking-tight text-slate-900 dark:text-slate-100 truncate">
                {activeConversation ? activeConversation.title : 'EASY AI'}
              </h1>
            </div>
          </div>

          {/* Zone 2: Multilingual Selector */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Globe
              className="w-3.5 h-3.5 text-slate-400 hidden sm:block"
              aria-hidden="true"
            />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Response language"
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400 cursor-pointer max-w-[165px] sm:max-w-none"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.nativeName})
                </option>
              ))}
            </select>
          </div>

          {/* Zone 3: Primary Voice Mode CTA */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                stopSpeechPlayback();
                setIsVoiceModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <AudioLines className="w-3.5 h-3.5" />
              <span>Voice mode</span>
            </button>
          </div>
        </header>

        {/* Scrollable Chat Viewport */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-6">
          {messages.length === 0 ? (
            <div className="max-w-3xl mx-auto h-full flex flex-col justify-center py-10">
              <div className="flex flex-col items-center text-center mb-9">
                <EasyAiLogo size={48} className="mb-4" />
                <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 text-balance max-w-xl">
                  Ask anything, in any language.
                </h2>
                <p className="mt-2.5 text-sm sm:text-[15px] text-slate-500 dark:text-slate-400 max-w-md">
                  Type a question, attach an image, or launch real-time voice
                  interaction across 20+ languages.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => handleSendMessage(item.prompt)}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-teal-500/60 dark:hover:border-teal-400/60 hover:bg-slate-50/70 dark:hover:bg-slate-900 transition-colors cursor-pointer group"
                  >
                    <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">
                      {item.category}
                    </div>
                    <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                      {item.title}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-6 space-y-7">
              {messages.map((msg, idx) => (
                <ChatMessageRow
                  key={msg.id}
                  message={msg}
                  isStreaming={isStreaming && idx === messages.length - 1}
                  isLatestAssistant={msg.id === latestAssistantId}
                  isSpeakingThis={speakingMessageId === msg.id}
                  isLoadingSpeech={loadingSpeechId === msg.id}
                  onSpeak={handleSpeakMessage}
                  onStopSpeak={stopSpeechPlayback}
                  onRegenerate={handleRegenerate}
                />
              ))}
              <div ref={messagesEndRef} className="h-2" />
            </div>
          )}
        </main>

        {/* Bottom Composer Dock */}
        <footer className="px-4 sm:px-6 pt-2 pb-4 bg-white dark:bg-[#0B0F17] shrink-0">
          <div className="max-w-3xl mx-auto">
            {dictationError && (
              <div className="mb-2 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
                <span>{dictationError}</span>
                <button
                  type="button"
                  onClick={() => setDictationError(null)}
                  className="p-0.5 hover:opacity-70 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827] focus-within:border-teal-600 dark:focus-within:border-teal-500 transition-colors p-2.5 sm:p-3">
              {/* Image attachment preview */}
              {attachment && (
                <div className="mb-2.5 flex items-center gap-3 px-2">
                  <div className="relative inline-block">
                    <img
                      src={`data:${attachment.mimeType};base64,${attachment.base64}`}
                      alt={attachment.name}
                      className="h-16 w-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      aria-label="Remove image"
                      className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-slate-900 text-white hover:bg-red-600 transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {attachment.name}
                  </span>
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask EASY AI anything..."
                aria-label="Message EASY AI"
                className="w-full resize-none bg-transparent px-1.5 py-1 text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none max-h-[180px]"
              />

              <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                {/* Left composer controls: Attach Image + Depth Segmented Switch */}
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImagePick}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach image"
                    aria-label="Attach image"
                    className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>

                  <div
                    className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-200/60 dark:bg-slate-800/80"
                    role="group"
                    aria-label="Response depth"
                  >
                    {(['fast', 'balanced', 'deep'] as ResponseDepth[]).map(
                      (mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setDepth(mode)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                            depth === mode
                              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          {mode}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Right composer controls: Dictate, Live Voice, Send/Stop */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleToggleDictation}
                    disabled={isTranscribing || isStreaming}
                    title={isDictating ? 'Stop recording' : 'Voice dictation'}
                    aria-label={
                      isDictating ? 'Stop voice recording' : 'Start voice dictation'
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      isDictating
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                    }`}
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
                    ) : isDictating ? (
                      <>
                        <Square className="w-3 h-3 fill-current" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      stopSpeechPlayback();
                      setIsVoiceModalOpen(true);
                    }}
                    title="Real-time voice conversation"
                    aria-label="Real-time voice conversation"
                    className="p-2 rounded-lg text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/60 transition-colors cursor-pointer"
                  >
                    <AudioLines className="w-4 h-4" />
                  </button>

                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handleStopStreaming}
                      title="Stop generating"
                      aria-label="Stop generating"
                      className="p-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSendMessage()}
                      disabled={!inputText.trim() && !attachment}
                      title="Send message"
                      aria-label="Send message"
                      className="p-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-white dark:text-slate-950 transition-colors cursor-pointer"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
              EASY AI can make mistakes. Verify important information.
            </p>
          </div>
        </footer>
      </div>

      {/* Real-Time Duplex Voice Mode Overlay */}
      <VoiceLiveModal
        isOpen={isVoiceModalOpen}
        language={language}
        voice={voice}
        onChangeLanguage={setLanguage}
        onChangeVoice={setVoice}
        onClose={handleCloseVoiceModal}
      />
    </div>
  );
}
