import React, { useState } from 'react';
import { Check, Copy, RefreshCw, Square, Volume2, AlertCircle, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { EasyAiLogo } from './EasyAiLogo';
import { MarkdownMessage } from './MarkdownMessage';

interface ChatMessageRowProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isLatestAssistant?: boolean;
  isSpeakingThis?: boolean;
  isLoadingSpeech?: boolean;
  onSpeak: (message: ChatMessage) => void;
  onStopSpeak: () => void;
  onRegenerate?: () => void;
}

export const ChatMessageRow: React.FC<ChatMessageRowProps> = ({
  message,
  isStreaming = false,
  isLatestAssistant = false,
  isSpeakingThis = false,
  isLoadingSpeech = false,
  onSpeak,
  onStopSpeak,
  onRegenerate,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  if (message.role === 'user') {
    return (
      <div className="flex justify-end w-full">
        <div className="max-w-[82%] sm:max-w-[74%] flex flex-col items-end gap-2">
          {message.image && (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
              <img
                src={`data:${message.image.mimeType};base64,${message.image.base64}`}
                alt={message.image.name || 'Uploaded attachment'}
                className="max-h-60 w-auto object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          {message.content && (
            <div className="rounded-2xl rounded-br-sm bg-slate-100 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/60 px-4 py-2.5 text-[15px] leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
              {message.content}
            </div>
          )}
          {message.viaVoice && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Spoken via Voice
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3.5 w-full group">
      <div className="shrink-0 mt-0.5">
        <EasyAiLogo size={28} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 font-display">
            EASY AI
          </span>
          {message.viaVoice && (
            <>
              <span aria-hidden="true" className="text-xs text-slate-400">
                ·
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Voice response
              </span>
            </>
          )}
        </div>

        {message.error ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 px-3.5 py-3 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{message.content}</span>
          </div>
        ) : message.content ? (
          <MarkdownMessage content={message.content} />
        ) : isStreaming ? (
          <div className="flex items-center gap-2 py-1 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
            <span>Thinking...</span>
          </div>
        ) : null}

        {isStreaming && message.content && (
          <span
            className="inline-block w-2 h-4 ml-1 align-middle bg-teal-600 dark:bg-teal-400 animate-pulse rounded-xs"
            aria-hidden="true"
          />
        )}

        {!isStreaming && message.content && !message.error && (
          <div className="flex items-center gap-1 mt-2.5 -ml-1.5 opacity-90 sm:opacity-75 sm:group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy response"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors cursor-pointer whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  <span className="text-teal-600 dark:text-teal-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={isSpeakingThis ? onStopSpeak : () => onSpeak(message)}
              disabled={isLoadingSpeech && !isSpeakingThis}
              title={isSpeakingThis ? 'Stop reading aloud' : 'Read aloud'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isSpeakingThis
                  ? 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              {isLoadingSpeech ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Preparing audio...</span>
                </>
              ) : isSpeakingThis ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Listen</span>
                </>
              )}
            </button>

            {isLatestAssistant && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                title="Regenerate answer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
