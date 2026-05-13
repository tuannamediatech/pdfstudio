import { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  Search, 
  History as HistoryIcon, 
  Settings2, 
  Play, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  Trash2,
  User,
  LogOut,
  Loader2,
  FileAudio,
  Mic,
  Waves,
  Plus,
  Undo2,
  Redo2,
  ClipboardPaste,
  Share2
} from 'lucide-react';
import { auth, signIn, signOut } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { extractTextFromPDF, PageContent } from './services/pdfService';
import { generateAudioFromText, TTSOptions, VoiceName } from './services/ttsService';
import { createSession, getSessions, updateSession, deleteSession, ReadingSession, getVoices, createVoice, deleteVoice, updateVoice, CustomVoice, getSharedSession, updateSessionSharing } from './services/dbService';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const VOICES: VoiceName[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [voices, setVoices] = useState<CustomVoice[]>([]);
  const [activeSession, setActiveSession] = useState<ReadingSession | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showVoiceManager, setShowVoiceManager] = useState(false);
  const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
  const [editingVoiceName, setEditingVoiceName] = useState('');

  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(null);
  const [isQuickPreviewing, setIsQuickPreviewing] = useState(false);
  const [isSharedLoading, setIsSharedLoading] = useState(false);

  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const lastSavedTextRef = useRef('');
  const typingTimeoutRef = useRef<any>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<any>(null);

  const debounceAutoSave = (sessionId: string, pages: any[], settings: any) => {
    // Prevent auto-saving if user does not own the session
    if (user?.uid !== activeSession?.userId) return;
    
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await updateSession(sessionId, pages, settings);
      } catch (err) {
        console.error("Auto save failed", err);
      }
    }, 1500);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('sharedSessionId');
    if (sharedId) {
      loadSharedSession(sharedId);
    }
  }, []);

  const loadSharedSession = async (id: string) => {
    setIsSharedLoading(true);
    const session = await getSharedSession(id);
    if (session) {
      setActiveSession(session);
      setCurrentPage(0);
    } else {
      alert("Không tìm thấy dữ liệu chia sẻ hoặc bạn không có quyền truy cập.");
    }
    setIsSharedLoading(false);
  };

  useEffect(() => {
    if (activeSession) {
      setUndoStack([]);
      setRedoStack([]);
      lastSavedTextRef.current = activeSession.pages[currentPage]?.text || '';
    }
  }, [activeSession?.id, currentPage]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        fetchHistory();
        fetchVoices();
      } else {
        setSessions([]);
        setVoices([]);
        setActiveSession(null);
      }
    });
    return unsub;
  }, []);

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    const hist = await getSessions();
    setSessions(hist);
    setIsLoadingHistory(false);
  };

  const fetchVoices = async () => {
    const v = await getVoices();
    setVoices(v);
  };

  const handleQuickVoicePreview = async () => {
    if (!activeSession) return;
    setIsQuickPreviewing(true);
    try {
      const text = "Xin chào, đây là giọng nói mẫu của hệ thống.";
      const settingsWithClone = { ...activeSession.settings };
      if (activeSession.settings.clonedVoiceId) {
        const voice = voices.find(v => v.id === activeSession.settings.clonedVoiceId);
        if (voice) {
          settingsWithClone.voiceSampleBase64 = voice.sampleBase64;
        }
      }
      const url = await generateAudioFromText(text, settingsWithClone);
      const audio = new Audio(url);
      audio.play();
    } catch (error) {
      console.error(error);
    } finally {
      setIsQuickPreviewing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      const url = URL.createObjectURL(file);
      setCurrentPdfUrl(url);

      const pages = await extractTextFromPDF(file);
      const sessionId = await createSession(file.name, pages);
      if (sessionId) {
        const newSession: ReadingSession = {
          id: sessionId,
          userId: user.uid,
          fileName: file.name,
          pages,
          createdAt: new Date(),
          settings: { voice: 'Kore', speed: 1, pitch: 1 }
        };
        setActiveSession(newSession);
        setSessions([newSession, ...sessions]);
        setCurrentPage(0);
      }
    } catch (error) {
      console.error("Upload failed", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePageTextChange = (text: string) => {
    if (!activeSession) return;
    
    setRedoStack([]);
    
    const newPages = [...activeSession.pages];
    newPages[currentPage] = { ...newPages[currentPage], text };
    setActiveSession({ ...activeSession, pages: newPages });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      if (lastSavedTextRef.current !== text) {
        setUndoStack(prev => [...prev, lastSavedTextRef.current]);
        lastSavedTextRef.current = text;
      }
    }, 1000);
    
    debounceAutoSave(activeSession.id!, newPages, activeSession.settings);
  };

  const handleUndo = () => {
    if (!activeSession) return;
    const currentText = activeSession.pages[currentPage]?.text || '';
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    let previousText = '';
    if (currentText !== lastSavedTextRef.current) {
        previousText = lastSavedTextRef.current;
        setRedoStack(prev => [...prev, currentText]);
    } else if (undoStack.length > 0) {
        previousText = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        setRedoStack(prev => [...prev, currentText]);
        lastSavedTextRef.current = previousText;
    } else {
        return;
    }

    const newPages = [...activeSession.pages];
    newPages[currentPage] = { ...newPages[currentPage], text: previousText };
    setActiveSession({ ...activeSession, pages: newPages });
    debounceAutoSave(activeSession.id!, newPages, activeSession.settings);
  };

  const handleRedo = () => {
    if (!activeSession || redoStack.length === 0) return;
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    const currentText = activeSession.pages[currentPage]?.text || '';
    const nextText = redoStack[redoStack.length - 1];
    
    setUndoStack(prev => [...prev, currentText]);
    setRedoStack(prev => prev.slice(0, -1));
    lastSavedTextRef.current = nextText;
    
    const newPages = [...activeSession.pages];
    newPages[currentPage] = { ...newPages[currentPage], text: nextText };
    setActiveSession({ ...activeSession, pages: newPages });
    debounceAutoSave(activeSession.id!, newPages, activeSession.settings);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
    }
  };

  const canUndo = !!activeSession && (undoStack.length > 0 || (activeSession.pages[currentPage]?.text !== lastSavedTextRef.current));
  const canRedo = !!activeSession && redoStack.length > 0;

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && textAreaRef.current) {
        const start = textAreaRef.current.selectionStart;
        const end = textAreaRef.current.selectionEnd;
        const currentText = activeSession?.pages[currentPage]?.text || '';
        const newText = currentText.substring(0, start) + text + currentText.substring(end);
        
        handlePageTextChange(newText);
        
        setTimeout(() => {
          if (textAreaRef.current) {
             textAreaRef.current.selectionStart = textAreaRef.current.selectionEnd = start + text.length;
             textAreaRef.current.focus();
          }
        }, 0);
      } else if (text) {
        handlePageTextChange((activeSession?.pages[currentPage]?.text || '') + '\n' + text);
      }
    } catch (err) {
      alert("Vui lòng bôi đen văn bản bên trang PDF, nhấn Ctrl+C để copy, sau đó click vào khung soạn thảo và nhấn Ctrl+V để dán.");
    }
  };

  const saveChanges = async () => {
    if (!activeSession?.id) return;
    await updateSession(activeSession.id, activeSession.pages, activeSession.settings);
    fetchHistory();
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this session?")) return;
    await deleteSession(id);
    if (activeSession?.id === id) setActiveSession(null);
    fetchHistory();
  };

  const handleVoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    
    if (file.size > 500 * 1024) {
      alert("File mẫu giọng nói quá lớn (tối đa 500KB)");
      return;
    }

    setIsCloning(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const voiceId = await createVoice(file.name.split('.')[0], base64);
        if (voiceId) {
          fetchVoices();
          alert("Đã nhân bản giọng nói thành công!");
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Cloning failed", error);
    } finally {
      setIsCloning(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!activeSession) return;
    setIsGeneratingAudio(true);
    setAudioUrl(null);
    try {
      const text = activeSession.pages[currentPage].text;
      const settingsWithClone = { ...activeSession.settings };
      
      // If a cloned voice is selected, find its sample
      if (activeSession.settings.clonedVoiceId) {
        const voice = voices.find(v => v.id === activeSession.settings.clonedVoiceId);
        if (voice) {
          settingsWithClone.voiceSampleBase64 = voice.sampleBase64;
        }
      }

      const url = await generateAudioFromText(text, settingsWithClone);
      setAudioUrl(url);
    } catch (error) {
      console.error("Audio generation failed", error);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleDeleteVoice = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Xóa mẫu giọng nói này?")) return;
    await deleteVoice(id);
    if (activeSession?.settings.clonedVoiceId === id) {
      setActiveSession({
        ...activeSession,
        settings: { ...activeSession.settings, clonedVoiceId: undefined }
      });
    }
    fetchVoices();
  };

  const filteredSessions = sessions.filter(s => 
    s.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-[#0f172a] text-slate-200 font-sans relative overflow-hidden">
      {/* Background Mesh Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Sidebar */}
      <aside className="w-80 bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col z-20">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <FileAudio className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">AI Audio Studio</h1>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Tìm kiếm file đã đọc..." 
              className="w-full bg-white/10 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all backdrop-blur-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 custom-scrollbar">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-2">Lịch sử đọc</h3>
          
          {isLoadingHistory ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : filteredSessions.length > 0 ? (
            filteredSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setActiveSession(s);
                  setCurrentPage(0);
                  setAudioUrl(null);
                  setCurrentPdfUrl(null);
                }}
                className={cn(
                  "group flex flex-col p-3 rounded-xl text-left transition-all border",
                  activeSession?.id === s.id 
                    ? "bg-white/15 border-white/20 text-white shadow-lg" 
                    : "bg-transparent border-transparent hover:bg-white/5 text-slate-300"
                )}
              >
                <div className="flex items-center justify-between gap-3 w-full">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FileText className={cn("shrink-0 w-4 h-4", activeSession?.id === s.id ? "text-blue-400" : "text-slate-500")} />
                    <span className="text-sm font-medium truncate">{s.fileName}</span>
                  </div>
                  <div onClick={(e) => handleDeleteSession(s.id!, e)}>
                    <Trash2 className="w-4 h-4 text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all cursor-pointer" />
                  </div>
                </div>
                {s.createdAt && (
                  <p className="text-[10px] text-slate-500 mt-1 ml-7">
                    {new Date(s.createdAt.seconds * 1000).toLocaleDateString()} • {s.pages.length} trang
                  </p>
                )}
              </button>
            ))
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm italic">
              Chưa có dữ liệu
            </div>
          )}
        </div>

        {user && (
          <div className="p-4 border-t border-white/10 bg-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} 
                className="w-8 h-8 rounded-full border border-white/20"
                alt="User"
              />
              <div className="text-xs">
                <p className="font-semibold text-white truncate max-w-[120px]">{user.displayName || user.email}</p>
                <p className="text-slate-500">Google Account</p>
              </div>
            </div>
            <button onClick={() => signOut()} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden z-10">
        <header className="h-16 flex items-center justify-between px-8 bg-white/5 backdrop-blur-md border-b border-white/10 shrink-0">
          <div className="flex items-center gap-4">
            {activeSession ? (
              <>
                <h2 className="font-semibold text-lg text-white max-w-md truncate">
                  {user?.uid !== activeSession.userId && <span className="text-purple-400 font-bold mr-2 text-[10px] uppercase bg-purple-500/20 px-2 py-0.5 rounded">Chỉ Xem</span>}
                  {activeSession.fileName}
                </h2>
                <button 
                  onClick={saveChanges}
                  disabled={user?.uid !== activeSession.userId}
                  className="text-[10px] uppercase tracking-wider font-bold px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                  title={user?.uid !== activeSession.userId ? "Bạn không thể lưu trên bản nháp của người khác" : ""}
                >
                  Lưu bản chỉnh sửa
                </button>
                {activeSession.userId === user?.uid && (
                  <button 
                    onClick={async () => {
                      const newShared = !activeSession.isShared;
                      await updateSessionSharing(activeSession.id!, newShared);
                      setActiveSession({...activeSession, isShared: newShared});
                      if (newShared) {
                        const url = `${window.location.origin}${window.location.pathname}?sharedSessionId=${activeSession.id}`;
                        navigator.clipboard.writeText(url);
                        alert(`Đã bật chia sẻ. Link đã được copy vào clipboard:\n${url}`);
                      } else {
                        alert("Đã tắt chia sẻ.");
                      }
                    }}
                    className={cn("text-[10px] uppercase tracking-wider font-bold px-3 py-1 border rounded transition-colors flex items-center gap-1", activeSession.isShared ? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20" : "bg-purple-500/10 border-purple-500/20 text-purple-400 hover:bg-purple-500/20")}
                  >
                    <Share2 className="w-3 h-3" />
                    {activeSession.isShared ? "Đang chia sẻ" : "Chia sẻ"}
                  </button>
                )}
              </>
            ) : (
              <h2 className="font-semibold text-lg text-slate-400">Trình đọc PDF AI</h2>
            )}
          </div>

          <div className="flex items-center gap-4">
            {!user ? (
              <button 
                onClick={() => signIn()}
                className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
              >
                Đăng nhập
              </button>
            ) : (
              <div className="relative">
                <input 
                  type="file" 
                  accept="application/pdf" 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  id="pdf-upload"
                  disabled={isUploading}
                />
                <label 
                  htmlFor="pdf-upload"
                  className={cn(
                    "flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg font-medium cursor-pointer hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20",
                    isUploading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {isUploading ? "Đang xử lý..." : "Tải lên PDF"}
                </label>
              </div>
            )}
          </div>
        </header>

        <section className="flex-1 overflow-hidden p-6 flex justify-center bg-transparent">
          <AnimatePresence mode="wait">
            {!activeSession ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center text-center max-w-lg"
              >
                <div className="w-24 h-24 bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 flex items-center justify-center mb-8 shadow-2xl">
                  <FileText className="w-12 h-12 text-blue-500" />
                </div>
                <h3 className="text-3xl font-bold mb-4 text-white">Khám phá tri thức mới</h3>
                <p className="text-slate-400 mb-8 leading-relaxed text-lg">
                  Bóc tách văn bản từ PDF và chuyển đổi thành giọng nói AI sống động chỉ trong vài giây.
                </p>
                {!user && (
                    <p className="text-sm text-blue-400 bg-blue-500/10 px-6 py-2 rounded-full font-medium border border-blue-500/20">
                        Đăng nhập để bắt đầu trải nghiệm hoàn toàn miễn phí
                    </p>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="content"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-[1600px] flex gap-6 overflow-hidden h-full"
              >
                {/* PDF Preview Section */}
                <div className="flex-1 flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden relative">
                  <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[10px] font-bold tracking-tighter uppercase flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Bản gốc PDF
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-900/50 px-2 py-0.5 rounded">
                        Trang {currentPage + 1} / {activeSession.pages.length}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 relative overflow-hidden bg-slate-900/50">
                    {currentPdfUrl ? (
                      <iframe 
                        key={`${currentPdfUrl}-${currentPage}`}
                        src={`${currentPdfUrl}#page=${currentPage + 1}`}
                        className="w-full h-full border-none"
                        title="PDF Preview"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                        <FileText className="w-12 h-12 text-slate-600 mb-4" />
                        <p className="text-slate-400 text-sm mb-2">Không tìm thấy file gốc trong bộ nhớ.</p>
                        <p className="text-slate-500 text-xs mb-6 max-w-xs">Chọn lại file PDF để xem preview và copy text.</p>
                        <input 
                          type="file" 
                          accept="application/pdf"
                          id="reupload-pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setCurrentPdfUrl(URL.createObjectURL(file));
                          }}
                        />
                        <label htmlFor="reupload-pdf" className="px-5 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-sm font-medium text-white cursor-pointer transition-colors shadow-lg">
                          Tải lại file PDF gốc
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {/* Text Editor Section */}
                <div className="flex-[1.5] flex flex-col bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                  <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center bg-slate-800/50 rounded-lg p-1 border border-white/5">
                        <button 
                          disabled={currentPage === 0}
                          onClick={() => {
                            setCurrentPage(p => p - 1);
                            setAudioUrl(null);
                          }}
                          className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-30 transition-colors text-slate-300"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-bold px-3 text-white">
                          TRANG {currentPage + 1} / {activeSession.pages.length}
                        </span>
                        <button 
                          disabled={currentPage === activeSession.pages.length - 1}
                          onClick={() => {
                            setCurrentPage(p => p + 1);
                            setAudioUrl(null);
                          }}
                          className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-30 transition-colors text-slate-300"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold tracking-tighter uppercase">Đã bóc tách</span>
                    </div>
                    
                    <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1 border border-white/5">
                      <button 
                        onClick={handlePasteFromClipboard} 
                        disabled={user?.uid !== activeSession.userId}
                        className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-slate-300 flex items-center gap-1 px-2 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Dán văn bản đã copy từ PDF"
                      >
                        <ClipboardPaste className="w-4 h-4 text-purple-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider hidden xl:inline-block">Dán text</span>
                      </button>
                      <div className="w-px h-4 bg-white/10 mx-1"></div>
                      <button 
                        onClick={handleUndo} 
                        disabled={!canUndo || user?.uid !== activeSession.userId} 
                        className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-30 transition-colors text-slate-300"
                        title="Hoàn tác (Ctrl+Z)"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={handleRedo} 
                        disabled={!canRedo || user?.uid !== activeSession.userId} 
                        className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-30 transition-colors text-slate-300"
                        title="Làm lại (Ctrl+Y)"
                      >
                        <Redo2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 relative">
                    <textarea 
                      ref={textAreaRef}
                      className="w-full h-full p-8 bg-transparent text-slate-300 font-serif text-xl leading-relaxed focus:outline-none resize-none custom-scrollbar"
                      readOnly={user?.uid !== activeSession.userId}
                      onKeyDown={handleKeyDown}
                      value={activeSession.pages[currentPage].text}
                      onChange={(e) => handlePageTextChange(e.target.value)}
                      placeholder="Nội dung trang PDF..."
                    />
                  </div>
                </div>

                {/* AI Controls Sidebar */}
                <div className="w-80 shrink-0 flex flex-col gap-6">
                  <div className="p-6 bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 shadow-xl">
                    <h4 className="text-sm font-bold text-white mb-6 flex items-center gap-2">
                       <Settings2 className="w-4 h-4 text-purple-400" />
                       Cấu hình giọng đọc AI
                    </h4>

                    <div className="space-y-6">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Giọng đọc</label>
                          {!showVoiceManager && (
                            <button 
                              onClick={() => setShowVoiceManager(true)}
                              className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-bold transition-colors"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              Nhân bản giọng mới
                            </button>
                          )}
                        </div>
                        
                        <AnimatePresence>
                          {showVoiceManager && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                              animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
                              exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                              className="p-4 bg-white/5 rounded-xl border border-white/10 overflow-hidden"
                            >
                              <div className="flex justify-between items-center mb-3">
                                <h5 className="text-[10px] font-bold text-white flex items-center gap-2">
                                  <Waves className="w-3 h-3 text-purple-400" />
                                  NHÂN BẢN GIỌNG NÓI
                                </h5>
                                <button onClick={() => setShowVoiceManager(false)} className="text-[10px] text-slate-500 hover:text-white">Đóng</button>
                              </div>

                              <p className="text-[9px] text-slate-500 mb-4 leading-tight">
                                AI sẽ bóc tách đặc trưng âm thanh từ mẫu bạn cung cấp.
                              </p>
                              
                              <div className="flex flex-col gap-2">
                                {voices.map(v => (
                                  <div key={v.id} className="flex flex-col bg-white/5 p-2 rounded-lg border border-white/5 group gap-2">
                                    {editingVoiceId === v.id ? (
                                      <div className="flex items-center justify-between gap-2">
                                        <input 
                                          type="text" 
                                          autoFocus
                                          value={editingVoiceName}
                                          onChange={(e) => setEditingVoiceName(e.target.value)}
                                          className="flex-1 bg-black/30 text-white text-[10px] px-2 py-1 rounded outline-none border border-white/10"
                                        />
                                        <button 
                                          onClick={async () => {
                                            if (v.id) {
                                               await updateVoice(v.id, editingVoiceName);
                                               setEditingVoiceId(null);
                                               fetchVoices();
                                            }
                                          }} 
                                          className="text-[10px] text-green-400 font-bold hover:text-green-300"
                                        >
                                          Lưu
                                        </button>
                                        <button onClick={() => setEditingVoiceId(null)} className="text-[10px] text-slate-500 hover:text-white">
                                          Hủy
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between">
                                        <div 
                                          className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1 group/name"
                                          onClick={() => {
                                            setEditingVoiceId(v.id!);
                                            setEditingVoiceName(v.name);
                                          }}
                                          title="Nhấn để đổi tên"
                                        >
                                          <Mic className="w-3 h-3 text-blue-400 shrink-0" />
                                          <span className="text-[10px] truncate text-slate-200 group-hover/name:text-white transition-colors">{v.name}</span>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-2">
                                          <button 
                                            onClick={() => {
                                              const audio = new Audio(`data:audio/mp3;base64,${v.sampleBase64}`);
                                              audio.play();
                                            }} 
                                            title="Nghe thử bản gốc"
                                            className="flex items-center gap-1 px-2 py-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded transition-colors border border-green-500/10"
                                          >
                                            <Play className="w-2.5 h-2.5" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider">Nghe thử</span>
                                          </button>
                                          <button onClick={(e) => handleDeleteVoice(v.id!, e)} className="p-1 hover:bg-red-500/10 rounded transition-colors" title="Xóa">
                                            <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-red-500" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                                
                                <input 
                                  type="file" 
                                  id="voice-upload" 
                                  accept="audio/*" 
                                  className="hidden" 
                                  onChange={handleVoiceUpload}
                                  disabled={isCloning}
                                />
                                <label 
                                  htmlFor="voice-upload"
                                  className={cn(
                                    "flex flex-col items-center justify-center gap-2 border border-dashed p-4 rounded-xl text-[10px] transition-all",
                                    isCloning 
                                      ? "bg-blue-500/10 border-blue-500/50 text-blue-400" 
                                      : "border-white/20 text-slate-400 hover:bg-white/5 cursor-pointer hover:border-white/40"
                                  )}
                                >
                                  {isCloning ? (
                                    <>
                                      <Loader2 className="w-5 h-5 animate-spin" />
                                      <div className="text-center">
                                        <p className="font-bold mb-1 italic uppercase">Đang phân tích...</p>
                                        <p className="opacity-70">AI đang xử lý âm sắc mẫu</p>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="w-4 h-4 text-purple-400" />
                                      <span className="font-medium">Tải lên file audio mẫu (.mp3/wav)</span>
                                    </>
                                  )}
                                </label>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <select 
                          className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-2 px-3 text-sm text-white focus:ring-1 focus:ring-purple-500 outline-none backdrop-blur-md"
                          value={activeSession.settings.clonedVoiceId || activeSession.settings.voice}
                          onChange={(e) => {
                            const val = e.target.value;
                            const isCloned = voices.some(v => v.id === val);
                            if (isCloned) {
                              setActiveSession({...activeSession, settings: {...activeSession.settings, voice: 'Kore', clonedVoiceId: val}});
                            } else {
                              setActiveSession({...activeSession, settings: {...activeSession.settings, voice: val as VoiceName, clonedVoiceId: undefined}});
                            }
                          }}
                        >
                          <optgroup label="Hệ thống">
                            {VOICES.map((v) => (
                              <option key={v} value={v} className="bg-slate-900">{v}</option>
                            ))}
                          </optgroup>
                          {voices.length > 0 && (
                            <optgroup label="Đã nhân bản">
                              {voices.map((v) => (
                                <option key={v.id} value={v.id} className="bg-slate-900">Clone: {v.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Tốc độ</label>
                            <span className="text-xs font-mono font-bold text-purple-400">{activeSession.settings.speed}x</span>
                        </div>
                        <input 
                          type="range" min="0.5" max="2" step="0.1" 
                          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          value={activeSession.settings.speed}
                          onChange={(e) => setActiveSession({...activeSession, settings: {...activeSession.settings, speed: parseFloat(e.target.value)}})}
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Cao độ</label>
                            <span className="text-xs font-mono font-bold text-purple-400">{(activeSession.settings.pitch - 1).toFixed(1)}</span>
                        </div>
                        <input 
                          type="range" min="0.5" max="1.5" step="0.1" 
                          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          value={activeSession.settings.pitch}
                          onChange={(e) => setActiveSession({...activeSession, settings: {...activeSession.settings, pitch: parseFloat(e.target.value)}})}
                        />
                      </div>

                      <button 
                        onClick={handleQuickVoicePreview}
                        disabled={isQuickPreviewing}
                        className="w-full py-2 mt-2 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isQuickPreviewing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Play className="w-3 h-3"/>}
                        {isQuickPreviewing ? "Đang xử lý..." : "Nghe thử mẫu giọng này"}
                      </button>
                    </div>

                    <button 
                      onClick={handleGenerateAudio}
                      disabled={isGeneratingAudio}
                      className="w-full mt-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl font-bold shadow-lg shadow-purple-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isGeneratingAudio ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                      {isGeneratingAudio ? "Đang xử lý..." : "Nghe thử AI"}
                    </button>
                  </div>

                  {audioUrl && (
                    <motion.div 
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="p-6 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 flex flex-col gap-4 shadow-2xl"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-500/20 rounded-lg text-green-400">
                          <FileAudio className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">Xuất file MP3</p>
                          <p className="text-[10px] text-slate-400">Sẵn sàng tải xuống</p>
                        </div>
                      </div>
                      
                      <audio controls src={audioUrl} className="w-full h-8 brightness-90 saturate-50" />
                      
                      <a 
                        href={audioUrl} 
                        download={`${activeSession.fileName.split('.')[0]}_page_${currentPage + 1}.mp3`}
                        className="w-full py-2 bg-white/10 border border-white/20 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors text-center"
                      >
                        Tải xuống ngay (.mp3)
                      </a>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Footer Status */}
        <footer className="h-8 px-8 bg-white/5 border-t border-white/10 flex items-center justify-between z-20 shrink-0">
          <div className="flex items-center gap-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> 
              AI System Online
            </span>
            <span className="text-slate-600">|</span>
            <span>Gemini Flash 3.1 TTS</span>
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">
            Phát triển bởi AI Studio
          </div>
        </footer>
      </main>
    </div>
  );
}
