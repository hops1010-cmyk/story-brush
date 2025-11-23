import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { BookOpen, Sparkles, PlusCircle, User, Bot, Send, Paintbrush } from 'lucide-react';

// ==========================================
// 1. TYPES & CONFIGURATION
// ==========================================

export enum Sender {
  User = 'user',
  Assistant = 'assistant',
}

export enum MessageType {
  Text = 'text',
  Image = 'image',
}

export interface Message {
  id: string;
  sender: Sender;
  type: MessageType;
  content: string; // Text content or Base64 image data
  timestamp: number;
}

export enum AppState {
  Setup = 'SETUP',           // Waiting for story topic
  Writing = 'WRITING',       // AI is writing a chapter
  WaitingForArt = 'WAITING_FOR_ART', // AI waiting for user prompt
  Painting = 'PAINTING',     // AI generating image
}

// ==========================================
// 2. GEMINI AI SERVICE
// ==========================================

// Initialize the Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
You are "StoryBrush," a collaborative Book Agent. 
You are the Writer, and the User is the Art Director.

Your goal is to co-create an illustrated book with the user.

The Workflow Loop:
1. **Write Chapter:** You generate the next chapter of the story.
   - Constraint: Keep it under 150 words.
   - Style: Adapt the writing style to match the genre implied by the user's topic.
   - Formatting: Use bold text for the Chapter Title.

2. **Pause for Art Direction:** Immediately after the text, ask the user to describe what the illustration for this page should look like.
   - Output EXACTLY this phrase at the end: "🎨 **Art Director:** Please describe the illustration for this chapter. What do you see?"

Tone:
- Adapt your personality to fit the genre.
- Be supportive but professional.
`;

let chatSession: Chat | null = null;

const startStorySession = (): Chat => {
  chatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.8,
    },
  });
  return chatSession;
};

const sendMessageToWriter = async (message: string): Promise<string> => {
  if (!chatSession) throw new Error("Chat session not initialized.");
  try {
    const response: GenerateContentResponse = await chatSession.sendMessage({ message });
    return response.text || "I'm having trouble writing right now. Let's try again.";
  } catch (error) {
    console.error("Error sending message to writer:", error);
    throw error;
  }
};

const generateIllustration = async (userDescription: string, storyContext: string): Promise<string> => {
  try {
    const prompt = `
      Create a high-quality photorealistic image.
      Scene Description: ${userDescription}
      Story Context: ${storyContext}
      Directives:
      1. **Style**: Photorealistic, cinematic lighting, 8k resolution, highly detailed, photography style.
      2. **Mood**: Adapt the lighting and atmosphere to the story's genre, but maintain a realistic look.
      3. **Character Consistency**: Ensure the main characters match previous descriptions in the context.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: prompt }] },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Error generating illustration:", error);
    throw error;
  }
};

// ==========================================
// 3. COMPONENTS
// ==========================================

const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.sender === Sender.User;
  const isImage = message.type === MessageType.Image;

  return (
    <div className={`flex w-full mb-6 px-2 sm:px-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex w-full ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
        <div className={`
          flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm mt-1
          ${isUser ? 'bg-indigo-100 text-indigo-600' : 'bg-accent text-white'}
        `}>
          {isUser ? <User size={16} /> : <Bot size={16} />}
        </div>

        <div className={`
          relative px-5 py-4 shadow-sm text-lg leading-relaxed flex-1
          ${isUser 
            ? 'bg-white text-slate-800 rounded-2xl rounded-tr-sm border border-slate-100' 
            : 'bg-white text-slate-800 rounded-2xl rounded-tl-sm border border-slate-100 font-serif'}
          ${isImage ? 'p-2' : ''}
        `}>
          {isImage ? (
            <div className="rounded-lg overflow-hidden w-full">
              <img 
                src={message.content} 
                alt="Generated illustration" 
                className="w-full h-auto object-cover rounded-lg border border-slate-100"
              />
              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-bold text-accent flex items-center shadow-sm">
                <Sparkles size={12} className="mr-1" /> Illustrated
              </div>
            </div>
          ) : (
            <div className="prose prose-stone prose-lg max-w-none w-full">
              <ReactMarkdown
                components={{
                  strong: ({node, ...props}) => <span className="font-bold text-accent" {...props} />,
                  p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const InputArea: React.FC<{ onSend: (text: string) => void; appState: AppState; disabled: boolean }> = ({ onSend, appState, disabled }) => {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled && (appState === AppState.Setup || appState === AppState.WaitingForArt)) {
      inputRef.current?.focus();
    }
  }, [appState, disabled]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const getPlaceholder = () => {
    switch (appState) {
      case AppState.Setup: return "Example: A cyber-noir thriller in Neo-Tokyo...";
      case AppState.WaitingForArt: return "Describe the scene (e.g., 'A cloaked figure in the rain')...";
      case AppState.Writing: return "StoryBrush is writing...";
      case AppState.Painting: return "Creating artwork...";
      default: return "Type here...";
    }
  };

  const getButtonIcon = () => appState === AppState.WaitingForArt ? <Paintbrush size={20} /> : <Send size={20} />;
  const getButtonText = () => appState === AppState.WaitingForArt ? "Illustrate" : "Send";

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-stone-200 p-2 sm:p-4 pb-6 z-10">
      <div className="w-full">
        <form onSubmit={handleSubmit} className="relative flex items-center gap-3">
          <div className="relative flex-grow">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={disabled}
              placeholder={getPlaceholder()}
              className="w-full pl-4 pr-4 py-4 rounded-xl sm:rounded-full border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all shadow-sm text-lg font-sans disabled:bg-stone-100 disabled:text-stone-400"
            />
            {appState === AppState.Setup && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none hidden sm:block">
                    <Sparkles size={18} />
                </div>
            )}
          </div>
          <button
            type="submit"
            disabled={disabled || !input.trim()}
            className={`
              flex items-center justify-center gap-2 px-6 py-4 rounded-xl sm:rounded-full font-bold transition-all shadow-md flex-shrink-0
              ${disabled || !input.trim() 
                ? 'bg-stone-200 text-stone-400 cursor-not-allowed' 
                : 'bg-slate-800 hover:bg-slate-700 text-white active:scale-95'}
            `}
          >
            {getButtonIcon()}
            <span className="hidden sm:inline">{getButtonText()}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

// ==========================================
// 4. MAIN APP COMPONENT
// ==========================================

const generateId = () => Math.random().toString(36).substr(2, 9);

const INITIAL_MESSAGE: Message = {
  id: 'init',
  sender: Sender.Assistant,
  type: MessageType.Text,
  content: "Hello! I am **StoryBrush**, your creative partner. \n\nI'm ready to write a new book with you. It can be any genre—Fantasy, Sci-Fi, Mystery, Romance, Horror, or anything you like! \n\nWhat should our story be about?",
  timestamp: Date.now(),
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [appState, setAppState] = useState<AppState>(AppState.Setup);
  const [lastChapterText, setLastChapterText] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    scrollToBottom();
    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages, appState]);

  useEffect(() => {
    startStorySession();
  }, []);

  const addMessage = (sender: Sender, type: MessageType, content: string) => {
    setMessages(prev => [...prev, {
      id: generateId(),
      sender,
      type,
      content,
      timestamp: Date.now(),
    }]);
  };

  const handleNewStory = () => {
    setMessages([INITIAL_MESSAGE]);
    setAppState(AppState.Setup);
    setLastChapterText("");
    startStorySession();
  };

  const handleUserSend = async (text: string) => {
    if (appState === AppState.Setup) {
      addMessage(Sender.User, MessageType.Text, text);
      setAppState(AppState.Writing);
      try {
        const response = await sendMessageToWriter(`The story is about: ${text}. Let's begin!`);
        addMessage(Sender.Assistant, MessageType.Text, response);
        setLastChapterText(response);
        setAppState(AppState.WaitingForArt);
      } catch (error) {
        addMessage(Sender.Assistant, MessageType.Text, "I encountered an issue starting the story. Please try again.");
        setAppState(AppState.Setup);
      }
    } else if (appState === AppState.WaitingForArt) {
      addMessage(Sender.User, MessageType.Text, text);
      setAppState(AppState.Painting);
      try {
        const imageUrl = await generateIllustration(text, lastChapterText);
        addMessage(Sender.Assistant, MessageType.Image, imageUrl);
        setAppState(AppState.Writing);
        const nextChapterPrompt = `The Art Director has provided the illustration for the previous chapter. It depicts: "${text}". Please write the next chapter now.`;
        const nextChapterResponse = await sendMessageToWriter(nextChapterPrompt);
        addMessage(Sender.Assistant, MessageType.Text, nextChapterResponse);
        setLastChapterText(nextChapterResponse);
        setAppState(AppState.WaitingForArt);
      } catch (error) {
        addMessage(Sender.Assistant, MessageType.Text, "I was unable to generate that illustration. Could you provide a different description?");
        setAppState(AppState.WaitingForArt);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-800 relative bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')]">
      <header className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-b border-stone-200 z-20 h-16 flex items-center justify-center shadow-sm">
        <div className="flex items-center gap-2 text-accent">
          <BookOpen className="w-6 h-6" />
          <h1 className="text-2xl font-serif font-bold text-slate-800 tracking-tight">StoryBrush</h1>
        </div>
        <button 
          onClick={handleNewStory}
          className="absolute right-4 sm:right-8 top-1/2 -translate-y-1/2 text-stone-500 hover:text-slate-800 hover:bg-stone-100 px-3 py-1.5 rounded-full transition-all flex items-center gap-2 text-sm font-medium"
          title="Start a new story"
        >
          <PlusCircle size={18} />
          <span className="hidden sm:inline">New Story</span>
        </button>
      </header>

      <main className="flex-grow pt-24 pb-32 w-full">
        <div className="w-full space-y-4">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {appState === AppState.Writing && (
            <div className="flex items-center gap-2 text-stone-500 italic animate-pulse px-6">
              <Sparkles size={16} />
              <span>Writing next chapter...</span>
            </div>
          )}
          {appState === AppState.Painting && (
            <div className="flex items-center gap-2 text-stone-500 italic animate-pulse px-6">
              <Sparkles size={16} />
              <span>Generating illustration...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <InputArea 
        onSend={handleUserSend} 
        appState={appState} 
        disabled={appState === AppState.Writing || appState === AppState.Painting} 
      />
    </div>
  );
};

export default App;
