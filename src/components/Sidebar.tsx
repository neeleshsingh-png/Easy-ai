import React, { useState } from 'react';
import {
  MessageSquare,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Sun,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  VOICE_OPTIONS,
  type Conversation,
  type VoiceName,
} from '../types/chat';
import { EasyAiLogo } from './EasyAiLogo';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  onCloseMobile: () => void;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  selectedVoice: VoiceName;
  onChangeVoice: (voice: VoiceName) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

function groupConversations(items: Conversation[]) {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 7 * 86400000;

  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Earlier', items: [] },
  ];

  for (const conv of items) {
    if (conv.updatedAt >= startOfToday) {
      groups[0].items.push(conv);
    } else if (conv.updatedAt >= startOfYesterday) {
      groups[1].items.push(conv);
    } else if (conv.updatedAt >= startOfWeek) {
      groups[2].items.push(conv);
    } else {
      groups[3].items.push(conv);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  isOpen,
  onCloseMobile,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  selectedVoice,
  onChangeVoice,
  theme,
  onToggleTheme,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = conversations
    .filter((c) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const grouped = groupConversations(filtered);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-[272px] shrink-0 flex flex-col bg-slate-50 dark:bg-[#0F141F] border-r border-slate-200 dark:border-slate-800/80 transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'
        }`}
      >
        {/* Brand & New Chat */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200/70 dark:border-slate-800/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <EasyAiLogo size={26} />
            <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              EASY AI
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            title="Close sidebar"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-4 h-4 hidden lg:block" />
            <X className="w-4 h-4 lg:hidden" />
          </button>
        </div>

        <div className="p-3 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              onNewChat();
              if (window.innerWidth < 1024) onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New chat</span>
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              aria-label="Search conversations"
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400"
            />
          </div>
        </div>

        {/* Conversation History */}
        <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-4">
          {grouped.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {searchQuery
                  ? 'No matching conversations found.'
                  : 'Your conversation history will appear here.'}
              </p>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.label}>
                <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((conv) => {
                    const isActive = conv.id === activeConversationId;
                    return (
                      <div
                        key={conv.id}
                        className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                          isActive
                            ? 'bg-slate-200/80 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectConversation(conv.id);
                            if (window.innerWidth < 1024) onCloseMobile();
                          }}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                          <span className="truncate text-[13px]">
                            {conv.title}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(conv.id);
                          }}
                          title="Delete conversation"
                          aria-label={`Delete ${conv.title}`}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-opacity cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bottom Preferences */}
        <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="sidebar-voice-select"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Voice</span>
            </label>
            <select
              id="sidebar-voice-select"
              value={selectedVoice}
              onChange={(e) => onChangeVoice(e.target.value as VoiceName)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-600 cursor-pointer"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.tone}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <span>{theme === 'dark' ? 'Dark appearance' : 'Light appearance'}</span>
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
};
