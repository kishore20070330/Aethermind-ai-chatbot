import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatHeader } from './components/ChatHeader';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { CanvasDrawer } from './components/CanvasDrawer';
import { SettingsModal } from './components/SettingsModal';
import { PromptSuggestions } from './components/PromptSuggestions';
import {
  loadChats,
  saveChats,
  loadActiveChatId,
  saveActiveChatId,
  loadSettings,
  saveSettings,
  DEFAULT_PERSONAS,
} from './services/storage';
import { streamAIResponse } from './services/aiEngine';

export function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [activePersona, setActivePersona] = useState(DEFAULT_PERSONAS[0]);
  const [isWebSearch, setIsWebSearch] = useState(false);
  const [isReasoning, setIsReasoning] = useState(false);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [canvasCode, setCanvasCode] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef(null);

  // Initial Load from localStorage
  useEffect(() => {
    const loadedChats = loadChats();
    setChats(loadedChats);

    const activeId = loadActiveChatId();
    if (activeId && loadedChats.some((c) => c.id === activeId)) {
      setActiveChatId(activeId);
    } else if (loadedChats.length > 0) {
      setActiveChatId(loadedChats[0].id);
    }
  }, []);

  // Save chats on change
  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  // Apply Theme attribute to HTML document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme || 'cyber-neon');
  }, [settings.theme]);

  // Active chat instance
  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const messages = activeChat ? activeChat.messages : [];

  // Scroll to bottom when messages update
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Create New Chat
  const handleNewChat = () => {
    const newId = 'chat_' + Date.now();
    const newChat = {
      id: newId,
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      pinned: false,
      personaId: activePersona.id,
      messages: [],
    };
    const updated = [newChat, ...chats];
    setChats(updated);
    setActiveChatId(newId);
    saveActiveChatId(newId);
  };

  // Select Chat
  const handleSelectChat = (id) => {
    setActiveChatId(id);
    saveActiveChatId(id);
  };

  // Delete Chat
  const handleDeleteChat = (id) => {
    const updated = chats.filter((c) => c.id !== id);
    setChats(updated);
    if (activeChatId === id) {
      const nextId = updated.length > 0 ? updated[0].id : null;
      setActiveChatId(nextId);
      saveActiveChatId(nextId);
    }
  };

  // Pin Chat
  const handlePinChat = (id) => {
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  };

  // Export Chat to Markdown
  const handleExportChat = (id) => {
    const targetChat = chats.find((c) => c.id === id);
    if (!targetChat) return;

    let mdText = `# ${targetChat.title || 'Conversation Export'}\n\n`;
    targetChat.messages.forEach((msg) => {
      mdText += `### ${msg.role === 'user' ? 'User' : 'AetherMind AI'}\n${msg.content}\n\n---\n\n`;
    });

    const blob = new Blob([mdText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(targetChat.title || 'chat').toLowerCase().replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Send Message & Stream AI Response
  const handleSendMessage = async ({ text, imageAttachment }) => {
    let currentChatId = activeChatId;
    let updatedChats = [...chats];

    // Auto-create chat if none active
    if (!currentChatId || !chats.some((c) => c.id === currentChatId)) {
      currentChatId = 'chat_' + Date.now();
      const newChat = {
        id: currentChatId,
        title: text.slice(0, 30) || 'New Chat',
        createdAt: new Date().toISOString(),
        pinned: false,
        personaId: activePersona.id,
        messages: [],
      };
      updatedChats = [newChat, ...chats];
      setActiveChatId(currentChatId);
      saveActiveChatId(currentChatId);
    }

    const userMsgId = 'msg_' + Date.now();
    const userMsg = {
      id: userMsgId,
      role: 'user',
      content: text,
      imageAttachment,
      timestamp: new Date().toISOString(),
    };

    const aiMsgId = 'msg_ai_' + Date.now();
    const initialAiMsg = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      personaId: activePersona.id,
    };

    // Update title if first message
    const chatIndex = updatedChats.findIndex((c) => c.id === currentChatId);
    if (chatIndex !== -1) {
      if (updatedChats[chatIndex].messages.length === 0) {
        updatedChats[chatIndex].title = text.slice(0, 32) || 'New Conversation';
      }
      updatedChats[chatIndex].messages.push(userMsg, initialAiMsg);
    }

    setChats(updatedChats);
    setIsLoading(true);

    // Stream AI Response
    await streamAIResponse({
      prompt: text,
      imageAttachment,
      persona: activePersona,
      isReasoning,
      isWebSearch,
      settings,
      onChunk: (chunkText) => {
        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== currentChatId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === aiMsgId ? { ...m, content: chunkText } : m
              ),
            };
          })
        );
      },
      onComplete: (fullText) => {
        setIsLoading(false);
        // If the AI generated HTML/CSS code snippet, set canvas code
        if (
          fullText.includes('```html') ||
          fullText.toLowerCase().includes('<!doctype html')
        ) {
          const match = fullText.match(/```html\n([\s\S]*?)```/);
          if (match && match[1]) {
            setCanvasCode(match[1]);
          }
        }
      },
      onError: (err) => {
        setIsLoading(false);
        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== currentChatId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === aiMsgId
                  ? {
                    ...m,
                    content: `⚠️ Error generating response: ${err.message}`,
                  }
                  : m
              ),
            };
          })
        );
      },
    });
  };

  // Toggle Bookmark
  const handleBookmarkToggle = (msgId) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== activeChatId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, bookmarked: !m.bookmarked } : m
          ),
        };
      })
    );
  };

  // Open Canvas Code Sandbox
  const handleOpenCanvasCode = (code) => {
    setCanvasCode(code);
    setIsCanvasOpen(true);
  };

  // Clear All Data
  const handleClearAllData = () => {
    if (confirm('Are you sure you want to delete all chat history?')) {
      setChats([]);
      setActiveChatId(null);
      localStorage.clear();
      setIsSettingsOpen(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onPinChat={handlePinChat}
        onExportChat={handleExportChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Stage */}
      <main className="main-stage">
        {/* Top Header */}
        <ChatHeader
          activePersona={activePersona}
          onSelectPersona={setActivePersona}
          isWebSearch={isWebSearch}
          onToggleWebSearch={() => setIsWebSearch(!isWebSearch)}
          isReasoning={isReasoning}
          onToggleReasoning={() => setIsReasoning(!isReasoning)}
          isCanvasOpen={isCanvasOpen}
          onToggleCanvas={() => setIsCanvasOpen(!isCanvasOpen)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />

        {/* Chat Messages Viewport */}
        <div className="chat-viewport">
          {!activeChat || messages.length === 0 ? (
            <PromptSuggestions
              onSelectPrompt={(prompt) => handleSendMessage({ text: prompt })}
            />
          ) : (
            <div className="messages-inner">
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  persona={activePersona}
                  onOpenCanvasCode={handleOpenCanvasCode}
                  onBookmarkToggle={handleBookmarkToggle}
                />
              ))}

              {isLoading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 16px',
                  }}
                >
                  <div
                    className="msg-avatar ai"
                    style={{ background: activePersona.bgGradient }}
                  >
                    {activePersona.badge}
                  </div>
                  <div className="typing-indicator">
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <ChatInput
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          isWebSearch={isWebSearch}
          isReasoning={isReasoning}
        />
      </main>

      {/* Canvas Drawer */}
      <CanvasDrawer
        isOpen={isCanvasOpen}
        onClose={() => setIsCanvasOpen(false)}
        code={canvasCode}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={(newSet) => {
          setSettings(newSet);
          saveSettings(newSet);
        }}
        onClearAllData={handleClearAllData}
      />
    </div>
  );
}

export default App;
