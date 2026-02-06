
import React, { useState, useEffect, useRef } from 'react';
import { protocolService } from './services/protocolService';
import { audioEngine } from './services/audioEngine';
import { AppState, Message } from './types';
import { Visualizer } from './components/Visualizer';

const App: React.FC = () => {
  const [tab, setTab] = useState<'home' | 'live' | 'vault'>('home');
  const [lang, setLang] = useState<'fa' | 'en'>('fa');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [showIntro, setShowIntro] = useState(true);
  const [isPrivacyActive, setIsPrivacyActive] = useState(false);
  
  // Live Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [userName, setUserName] = useState('');
  const [peerName, setPeerName] = useState('');
  const [connState, setConnState] = useState<AppState>(AppState.IDLE);
  const [connDetails, setConnDetails] = useState<string>('');
  const [callDuration, setCallDuration] = useState(0);
  const [sessionSummary, setSessionSummary] = useState<{ duration: number, peer: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  
  // Vault State
  const [vMsg, setVMsg] = useState('');
  const [vSender, setVSender] = useState('');
  const [vPass, setVPass] = useState('');
  const [decData, setDecData] = useState<{text: string, sender: string} | null>(null);
  const [isDec, setIsDec] = useState(false);
  const [passReq, setPassReq] = useState(false);
  const [tBits, setTBits] = useState<number[]>([]);
  const [passAttempts, setPassAttempts] = useState(0);
  const [isVaultLocked, setIsVaultLocked] = useState(false);

  // Persistent session storage for failed attempts per file (fingerprint-based)
  const vaultRegistry = useRef<Record<string, number>>({});

  const t = (fa: string, en: string) => lang === 'fa' ? fa : en;

  const getFingerprint = (bits: number[]) => {
    if (!bits || bits.length === 0) return '';
    return bits.slice(0, 100).join('') + "_" + bits.length;
  };

  // Anti-Screenshot Logic: Detect focus loss
  useEffect(() => {
    const handleBlur = () => setIsPrivacyActive(true);
    const handleFocus = () => setIsPrivacyActive(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') setIsPrivacyActive(true);
      else setIsPrivacyActive(false);
    };
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('contextmenu', preventContextMenu);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('contextmenu', preventContextMenu);
    };
  }, []);

  useEffect(() => {
    protocolService.setCallback((state: AppState, data: any) => {
      setConnState(state);
      if (data?.status) setConnDetails(data.status);
      if (data?.peerName) setPeerName(data.peerName);
      
      if(data?.incomingMessage) {
        const msg: Message = {
          id: Math.random().toString(36).substr(2, 9),
          sender: 'peer',
          text: data.incomingMessage,
          timestamp: Date.now(),
          status: 'received'
        };
        setMessages(prev => [...prev, msg]);
      }
    });
  }, []);

  useEffect(() => {
    if (connState === AppState.CONNECTED) {
      if (!timerRef.current) {
        timerRef.current = window.setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
      }
    } else if (connState === AppState.WAITING || connState === AppState.IDLE) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [connState]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const joinChannel = async () => {
    if (!userName.trim()) return;
    protocolService.setUserName(userName);
    await audioEngine.init();
    audioEngine.startLive();
    setConnState(AppState.WAITING);
    setSessionSummary(null);
  };

  const startHandshake = async () => {
    await protocolService.initiateHandshake();
  };

  const sendLive = async () => {
    if(!input || connState === AppState.SENDING) return;
    const msg: Message = { id: Math.random().toString(36).substr(2, 9), sender: 'self', text: input, timestamp: Date.now(), status: 'sending' };
    setMessages(prev => [...prev, msg]);
    await protocolService.sendMessage(input);
    setInput('');
  };

  const endCall = async () => {
    audioEngine.stopAllAudio();
    audioEngine.stopLive();
    if (connState === AppState.CONNECTED) {
      setSessionSummary({ duration: callDuration, peer: peerName || t("ناشناس", "Unknown") });
    }
    setConnState(AppState.IDLE);
    setCallDuration(0);
    setMessages([]);
    setPeerName('');
  };

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const resetVaultSession = () => {
    setDecData(null);
    setPassReq(false);
    setPassAttempts(0);
    setIsVaultLocked(false);
    setTBits([]);
  };

  const decodeFile = async (bits: number[], pass?: string) => {
    const fingerprint = getFingerprint(bits);
    if(vaultRegistry.current[fingerprint] >= 3) {
      setIsVaultLocked(true);
      return;
    }

    setIsDec(true);
    try {
      const res = await protocolService.decodeVaultFile(bits, pass);
      if(res) { 
        setDecData(res); 
        setPassReq(false);
        setPassAttempts(0);
        vaultRegistry.current[fingerprint] = 0;
      }
    } catch(e: any) {
      if(e.message === 'PASSWORD_REQUIRED') { 
        setPassReq(true); 
        setTBits(bits); 
      } else if(e.message === 'INVALID_PASSWORD') {
        const currentAttempts = (vaultRegistry.current[fingerprint] || 0) + 1;
        vaultRegistry.current[fingerprint] = currentAttempts;
        setPassAttempts(currentAttempts);
        if(currentAttempts >= 3) {
          setIsVaultLocked(true);
          setPassReq(false);
        }
      } else {
        alert(t("فایل صوتی حاوی دیتای معتبری نیست", "The audio file contains no valid data."));
      }
    } finally { setIsDec(false); }
  };

  const baseBg = theme === 'dark' ? 'bg-[#0a0a0c] text-white' : 'bg-[#f8fafc] text-slate-900';
  const cardBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-xl shadow-slate-200/50';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200';
  const mutedText = theme === 'dark' ? 'text-slate-500' : 'text-slate-600';
  const accentText = theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600';
  const overlayBg = theme === 'dark' ? 'bg-slate-900/40' : 'bg-white/90';

  return (
    <div key={lang} className={`min-h-screen ${baseBg} transition-all duration-700 font-['Vazirmatn'] ${lang === 'fa' ? 'rtl' : 'ltr'}`}>
      
      {/* Wrapper to handle Flex-based static footer */}
      <div className={`min-h-screen flex flex-col transition-all duration-500 ${isPrivacyActive ? 'privacy-hidden' : ''}`}>
        {/* Onboarding Overlay */}
        {showIntro && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md anim-fade">
            <div className={`${cardBg} anim-scale max-w-lg p-10 rounded-[2.5rem] space-y-8 shadow-2xl border-indigo-500/20`}>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-indigo-600 rounded-[1.25rem] flex items-center justify-center text-3xl shadow-lg shadow-indigo-600/20">👋</div>
                <h2 className={`text-3xl font-black tracking-tight ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("خوش آمدید", "Welcome")}</h2>
              </div>
              <div className={`space-y-5 text-base leading-relaxed opacity-90 font-medium ${theme === 'light' ? 'text-slate-600' : 'text-slate-300'}`}>
                <p>{t("آکوچت ابزاری برای انتقال متن از طریق امواج صوتی است. این برنامه به اینترنت نیاز ندارد و از میکروفون و بلندگوی دستگاه برای جابجایی اطلاعات استفاده می‌کند.", "AcouChat is a tool for transferring text via audio waves. It doesn't need internet and uses your microphone and speakers to exchange data.")}</p>
                <div className="grid grid-cols-1 gap-3">
                   <div className={`flex items-start gap-3 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} p-3 rounded-2xl`}>
                      <span className="text-indigo-400 text-lg">🛡️</span>
                      <p className="text-xs">{t("حریم خصوصی: هیچ پیامی ذخیره نمی‌شود و با بستن برنامه، تمام تاریخچه پاک خواهد شد.", "Privacy: No messages are stored. Closing the app clears everything.")}</p>
                   </div>
                   <div className={`flex items-start gap-3 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} p-3 rounded-2xl`}>
                      <span className="text-indigo-400 text-lg">🔒</span>
                      <p className="text-xs">{t("امنیت: پیام‌ها قبل از تبدیل به صدا، به صورت محلی رمزنگاری می‌شوند.", "Security: Messages are locally encrypted before conversion.")}</p>
                   </div>
                   <div className={`flex items-start gap-3 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} p-3 rounded-2xl`}>
                      <span className="text-indigo-400 text-lg">🔌</span>
                      <p className="text-xs">{t("آفلاین: این برنامه کاملاً مستقل از شبکه موبایل یا وای‌فای عمل می‌کند.", "Offline: Operates independently of mobile networks or Wi-Fi.")}</p>
                   </div>
                </div>
              </div>
              <button onClick={() => setShowIntro(false)} className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-white shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-95">
                {t("شروع کار با آکوچت", "Start AcouChat")}
              </button>
            </div>
          </div>
        )}

        <nav className={`fixed top-0 w-full z-50 backdrop-blur-2xl border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'} transition-all duration-500`}>
          <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 group cursor-pointer" onClick={() => { setTab('home'); resetVaultSession(); }}>
                      <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="10" width="2" height="4" rx="1" fill="white" />
                          <rect x="7" y="7" width="2" height="10" rx="1" fill="white" />
                          <rect x="11" y="4" width="2" height="16" rx="1" fill="white" />
                          <rect x="15" y="7" width="2" height="10" rx="1" fill="white" />
                          <rect x="19" y="10" width="2" height="4" rx="1" fill="white" />
                        </svg>
                      </div>
                      <h1 className="text-xl font-black tracking-tight">{t("آکوچت", "AcouChat")}</h1>
                  </div>
                  {/* GitHub Repo Link */}
                  <a href="https://github.com/TXMAZ2010/AcouChat" target="_blank" rel="noopener noreferrer" className={`opacity-40 hover:opacity-100 transition-opacity flex items-center justify-center ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`} title="GitHub Repository">
                    <svg height="22" width="22" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
                  </a>
              </div>
              
              <div className="flex items-center gap-2">
                  {tab !== 'home' && (
                    <button onClick={() => { setTab('home'); resetVaultSession(); }} className={`p-2.5 ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'} rounded-xl transition-all hover:scale-110 active:scale-90`} title={t("بازگشت به منو", "Home")}>🏠</button>
                  )}
                  <div className={`h-4 w-[1px] ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'} mx-1`} />
                  <button 
                    onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')} 
                    className={`w-12 h-10 flex items-center justify-center text-[10px] font-black border ${theme === 'dark' ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white shadow-sm'} rounded-xl uppercase hover:bg-indigo-50 hover:text-indigo-600 transition-all hover:scale-110 active:scale-90`}
                    title={t("تغییر زبان به انگلیسی", "Switch to Persian")}
                  >
                    {lang === 'fa' ? 'EN' : 'فا'}
                  </button>
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={`w-10 h-10 flex items-center justify-center ${theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-white border-slate-200 hover:bg-slate-50 shadow-sm'} rounded-xl border transition-all hover:scale-110 active:scale-90`}>{theme === 'dark' ? '☀️' : '🌙'}</button>
              </div>
          </div>
        </nav>

        <main className="pt-32 pb-12 px-6 max-w-5xl mx-auto flex-1 w-full">
          {tab === 'home' && (
              <div className="text-center space-y-16 anim-blur">
                  <div className="space-y-6">
                      <h2 className={`text-5xl md:text-7xl font-black ${theme === 'dark' ? 'bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent' : 'text-slate-900'} leading-tight tracking-tighter anim-fade`} style={{animationDelay: '0.1s'}}>
                          {t("ارتباط متنی از طریق صدا", "Text Communication via Sound")}
                      </h2>
                      <p className={`${mutedText} text-lg md:text-2xl font-medium max-w-3xl mx-auto opacity-0 anim-fade`} style={{animationDelay: '0.3s'}}>{t("انتقال آفلاین اطلاعات به صورت رمزنگاری شده در محیط‌های فاقد شبکه", "Encrypted offline data transfer for network-free environments.")}</p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                      <button onClick={() => setTab('live')} className={`${cardBg} p-12 rounded-[3rem] hover:shadow-2xl hover:shadow-indigo-500/10 transition-all group hover:-translate-y-2 opacity-0 anim-scale`} style={{animationDelay: '0.5s'}}>
                          <div className="text-7xl mb-8 group-hover:scale-110 group-hover:rotate-6 transition-transform">📡</div>
                          <h3 className="text-3xl font-black mb-3">{t("ارتباط زنده", "Live Link")}</h3>
                          <p className={`${mutedText} text-base leading-relaxed`}>{t("ارسال و دریافت پیام به صورت مستقیم و آنی", "Direct real-time message exchange")}</p>
                      </button>
                      <button onClick={() => { setTab('vault'); resetVaultSession(); }} className={`${cardBg} p-12 rounded-[3rem] hover:shadow-2xl hover:shadow-indigo-500/10 transition-all group hover:-translate-y-2 opacity-0 anim-scale`} style={{animationDelay: '0.6s'}}>
                          <div className="text-7xl mb-8 group-hover:scale-110 group-hover:-rotate-6 transition-transform">💾</div>
                          <h3 className="text-3xl font-black mb-3">{t("بسته‌بندی فایل", "Data Container")}</h3>
                          <p className={`${mutedText} text-base leading-relaxed`}>{t("ذخیره پیام در قالب یک فایل صوتی WAV", "Store messages as WAV audio files")}</p>
                      </button>
                  </div>
              </div>
          )}

          {tab === 'live' && (
              <div className="space-y-8 anim-fade">
                  <div className={`${cardBg} p-6 rounded-[2rem] flex items-center justify-between anim-scale`}>
                      <div className="flex items-center gap-5">
                          <div className={`w-4 h-4 rounded-full shadow-lg ${connState === AppState.CONNECTED ? 'bg-indigo-400 shadow-indigo-400/50 pulse' : (connState !== AppState.IDLE ? 'bg-green-500 animate-pulse shadow-green-500/50' : 'bg-red-500 shadow-red-500/50')}`} />
                          <div className="flex flex-col">
                            <span className="font-black text-sm tracking-widest uppercase opacity-80">
                              {connState === AppState.CONNECTED ? `${t("متصل به", "CONNECTED TO")} ${peerName}` : 
                               connState === AppState.WAITING ? t("در انتظار اتصال...", "WAITING FOR PEER...") : 
                               connState === AppState.HANDSHAKE ? t("در حال تایید هویت...", "AUTHENTICATING...") :
                               t("آفلاین", "OFFLINE")}
                            </span>
                            {connState === AppState.CONNECTED && (
                              <span className={`text-[10px] font-bold ${accentText} tracking-tighter uppercase`}>
                                {t("زمان گفتگو:", "DURATION:")} {formatDuration(callDuration)}
                              </span>
                            )}
                          </div>
                      </div>
                      <div className="flex gap-3">
                          {connState === AppState.WAITING && (
                            <button onClick={startHandshake} className="px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs transition-all hover:scale-105 active:scale-95 shadow-xl shadow-indigo-600/20">
                              {t("برقراری تماس", "START CALL")}
                            </button>
                          )}
                          {connState !== AppState.IDLE && (
                            <button onClick={endCall} className="px-6 py-4 bg-red-500 text-white rounded-2xl font-black text-xs transition-all hover:scale-105 active:scale-95 shadow-xl shadow-red-500/20">
                              {t("پایان تماس", "END CALL")}
                            </button>
                          )}
                      </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-8">
                      <div className={`${cardBg} md:col-span-2 h-[550px] rounded-[2.5rem] flex flex-col overflow-hidden shadow-2xl relative`}>
                          {connState === AppState.IDLE && (
                            <div className={`absolute inset-0 z-10 ${overlayBg} backdrop-blur-xl flex flex-col items-center justify-center p-12 text-center space-y-8 anim-fade`}>
                              {sessionSummary && (
                                <div className={`${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200 shadow-sm'} p-6 rounded-[2rem] border w-full max-w-sm mb-4 anim-scale`}>
                                  <h4 className={`text-xs font-black ${accentText} uppercase tracking-widest mb-2`}>{t("خلاصه تماس قبلی", "PREVIOUS SESSION")}</h4>
                                  <p className={`text-sm font-bold ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("با:", "With:")} {sessionSummary.peer}</p>
                                  <p className={`text-sm font-bold ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("مدت زمان:", "Duration:")} {formatDuration(sessionSummary.duration)}</p>
                                </div>
                              )}
                              <div className="w-20 h-20 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center text-4xl shadow-2xl shadow-indigo-600/30">👤</div>
                              <div className="space-y-4 max-w-sm">
                                <h3 className={`text-2xl font-black ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("نام خود را وارد کنید", "Enter Your Name")}</h3>
                                <p className={`text-xs ${mutedText} font-medium`}>{t("این نام در هنگام اتصال برای طرف مقابل نمایش داده می‌شود.", "This name will be visible to the peer during handshake.")}</p>
                                <input value={userName} onChange={e=>setUserName(e.target.value)} placeholder={t("نام شما...", "Your name...")} className={`w-full p-5 ${inputBg} rounded-2xl outline-none focus:ring-2 ring-indigo-500 transition-all font-bold text-center ${theme === 'light' ? 'text-slate-900' : 'text-white'}`} />
                              </div>
                              <button onClick={joinChannel} disabled={!userName.trim()} className="w-full max-sm py-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-2xl font-black text-white transition-all hover:scale-[1.02] active:scale-95 shadow-2xl shadow-indigo-600/30">
                                {t("ورود به شبکه صوتی", "Go Online")}
                              </button>
                            </div>
                          )}

                          <div ref={scrollRef} className="flex-1 p-8 overflow-y-auto space-y-6">
                              {messages.map(m => (
                                  <div key={m.id} className={`flex ${m.sender === 'self' ? 'justify-end' : 'justify-start'} ${lang === 'fa' ? 'anim-slide-rtl' : 'anim-slide-ltr'}`}>
                                      <div className={`max-w-[80%] p-5 rounded-[1.5rem] shadow-lg ${m.sender === 'self' ? 'bg-indigo-600 text-white rounded-tr-none' : (theme === 'dark' ? 'bg-white/10 rounded-tl-none border border-white/5' : 'bg-slate-100 text-slate-900 rounded-tl-none border border-slate-200')}`}>
                                          <div className={`flex justify-between gap-4 mb-1 text-[9px] font-black uppercase ${m.sender === 'self' ? 'text-white/60' : 'opacity-40'}`}>
                                              <span>{m.sender === 'self' ? userName : peerName}</span>
                                              <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                          </div>
                                          <p className="text-sm font-medium leading-relaxed">{m.text}</p>
                                      </div>
                                  </div>
                              ))}
                              {messages.length === 0 && connState === AppState.CONNECTED && (
                                  <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-12 anim-blur">
                                      <div className={`${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} w-20 h-20 rounded-full flex items-center justify-center mb-6`}>
                                        <span className="text-5xl">🤝</span>
                                      </div>
                                      <p className={`text-sm font-bold tracking-tight ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("ارتباط امن برقرار شد. می‌توانید گفتگو را شروع کنید.", "Secure link established. You can start chatting.")}</p>
                                  </div>
                              )}
                          </div>
                          
                          <div className={`px-8 py-2 ${theme === 'dark' ? 'bg-black/40 border-white/5' : 'bg-slate-50 border-slate-200'} border-t flex items-center justify-between`}>
                            <span className={`text-[10px] font-black uppercase tracking-wider ${theme === 'light' ? 'text-slate-500' : 'opacity-60'}`}>
                              {connState === AppState.SENDING ? t("در حال ارسال سیگنال...", "TRANSMITTING SIGNAL...") : 
                               connState === AppState.RECEIVING ? t("در حال دریافت سیگنال...", "RECEIVING SIGNAL...") :
                               connState === AppState.CONNECTED ? t("آماده برای ارسال/دریافت", "READY") : ""}
                            </span>
                            {connState === AppState.SENDING && <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />}
                          </div>

                          <div className={`p-6 ${theme === 'dark' ? 'bg-black/20' : 'bg-white border-t border-slate-100'} flex gap-3`}>
                              <input 
                                value={input} 
                                onChange={e=>setInput(e.target.value)} 
                                onKeyPress={e=>e.key==='Enter' && sendLive()} 
                                /* Fix redundant state check that caused TypeScript no-overlap error */
                                disabled={connState !== AppState.CONNECTED}
                                placeholder={t("متن پیام...", "Message text...")} 
                                className={`flex-1 ${inputBg} rounded-2xl p-4 outline-none focus:ring-2 ring-indigo-500/50 transition-all text-sm font-medium disabled:opacity-20 ${theme === 'light' ? 'text-slate-900' : 'text-white'}`} 
                              />
                              <button 
                                onClick={sendLive} 
                                /* Fix redundant state check that caused TypeScript no-overlap error */
                                disabled={connState !== AppState.CONNECTED || !input.trim()}
                                className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center hover:bg-indigo-500 transition-all hover:scale-105 active:scale-90 shadow-lg shadow-indigo-600/20 text-xl disabled:opacity-20 text-white"
                              >
                                🚀
                              </button>
                          </div>
                      </div>
                      <div className="space-y-8 anim-fade" style={{animationDelay: '0.2s'}}>
                          <div className={`${cardBg} p-8 rounded-[2.5rem] shadow-xl`}>
                              <h4 className={`text-[11px] font-black uppercase ${mutedText} mb-6 tracking-[0.2em] opacity-80`}>{t("طیف صوتی", "Audio Spectrum")}</h4>
                              <div className="rounded-2xl overflow-hidden hover:scale-105 transition-transform">
                                  <Visualizer theme={theme} />
                              </div>
                          </div>
                          <div className={`${cardBg} p-8 rounded-[2.5rem] ${theme === 'dark' ? 'bg-indigo-500/5 border-indigo-500/10' : 'bg-indigo-50/50 border-indigo-100'} shadow-xl`}>
                              <h4 className={`text-[11px] font-black uppercase ${accentText} mb-4 tracking-[0.2em]`}>{t("اطلاعات سیگنال", "Signal Info")}</h4>
                              <div className={`space-y-4 text-xs font-mono ${theme === 'dark' ? 'opacity-80' : 'text-slate-600'}`}>
                                  <div className={`flex justify-between border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'} pb-2`}><span>MODE</span> <span className="font-black">BFSK-SEC</span></div>
                                  <div className={`flex justify-between border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'} pb-2`}><span>SECURITY</span> <span className="font-black">{connState === AppState.CONNECTED ? 'ECDH-AES' : 'NONE'}</span></div>
                                  <div className={`flex justify-between border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'} pb-2`}><span>HALF-DUPLEX</span> <span className="font-black text-green-500">ENABLED</span></div>
                                  <div className="flex justify-between"><span>LINK</span> <span className={`font-black ${connState !== AppState.IDLE ? "text-green-500" : "text-red-500"}`}>{connState !== AppState.IDLE ? "ACTIVE" : "OFFLINE"}</span></div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div >
          )}

          {tab === 'vault' && (
              <div className="anim-fade space-y-10">
                  <div className="grid md:grid-cols-2 gap-10">
                      <div className={`${cardBg} p-10 rounded-[3rem] space-y-8 anim-scale shadow-2xl`} style={{animationDelay: '0.1s'}}>
                          <div className="flex items-center gap-4">
                              <span className="text-3xl">📦</span>
                              <h3 className={`text-2xl font-black ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("ساخت فایل WAV", "Create WAV File")}</h3>
                          </div>
                          <div className="space-y-5">
                              <div className="space-y-1">
                                  <label className="text-[10px] font-black uppercase opacity-40 px-2">{t("فرستنده", "Sender")}</label>
                                  <input value={vSender} onChange={e=>setVSender(e.target.value)} placeholder={t("نام فرستنده (اختیاری)", "Optional name")} className={`w-full p-4 ${inputBg} rounded-2xl text-sm outline-none focus:ring-2 ring-indigo-500/30 transition-all font-medium ${theme === 'light' ? 'text-slate-900' : 'text-white'}`} />
                              </div>
                              <div className="space-y-1">
                                  <label className="text-[10px] font-black uppercase opacity-40 px-2">{t("پیام", "Message")}</label>
                                  <textarea value={vMsg} onChange={e=>setVMsg(e.target.value)} placeholder={t("پیام شما...", "Your secure message...")} className={`w-full p-4 ${inputBg} rounded-2xl h-44 resize-none text-sm outline-none focus:ring-2 ring-indigo-500/30 transition-all font-medium ${theme === 'light' ? 'text-slate-900' : 'text-white'}`} />
                              </div>
                              <div className="space-y-1">
                                  <label className="text-[10px] font-black uppercase opacity-40 px-2">{t("رمز عبور", "Password")}</label>
                                  <input type="password" value={vPass} onChange={e=>setVPass(e.target.value)} placeholder={t("رمز عبور (اختیاری)", "Leave blank for no pass")} className={`w-full p-4 ${inputBg} rounded-2xl text-sm outline-none focus:ring-2 ring-indigo-500/30 transition-all font-medium ${theme === 'light' ? 'text-slate-900' : 'text-white'}`} />
                              </div>
                          </div>
                          <button onClick={async () => {
                              const blob = await protocolService.createVaultFile(vMsg, vSender, vPass);
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a'); a.href = url; a.download = `Message_${Date.now()}.wav`; a.click();
                              setVMsg(''); setVSender(''); setVPass('');
                          }} disabled={!vMsg} className="w-full py-5 bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl font-black text-white shadow-2xl shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-20 disabled:scale-100">
                              {t("ذخیره به صورت صوت", "Save as Audio")}
                          </button>
                      </div>

                      <div className={`${cardBg} p-10 rounded-[3rem] flex flex-col anim-scale shadow-2xl`} style={{animationDelay: '0.2s'}}>
                          <div className="flex items-center gap-4 mb-8">
                              <span className="text-3xl">🔓</span>
                              <h3 className={`text-2xl font-black ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{t("استخراج پیام", "Extract Message")}</h3>
                          </div>
                          {!decData ? (
                               <div className="flex-1 flex flex-col">
                                  {isVaultLocked ? (
                                      <div className={`flex-1 flex flex-col items-center justify-center p-10 text-center space-y-6 border-2 border-red-500/30 rounded-[2.5rem] ${theme === 'dark' ? 'bg-red-500/5' : 'bg-red-50'} anim-fade`}>
                                          <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center anim-scale">
                                              <span className="text-6xl">🔒</span>
                                          </div>
                                          <div className="space-y-2">
                                              <h4 className="text-red-500 text-xl font-black">{t("دسترسی مسدود شد", "Access Blocked")}</h4>
                                              <p className={`text-sm ${mutedText} leading-relaxed font-medium`}>{t("به دلیل ۳ بار تلاش ناموفق برای ورود رمز، دسترسی به این فایل در این نشست قطع شد.", "Access blocked after 3 failed attempts in this session.")}</p>
                                          </div>
                                          <button onClick={resetVaultSession} className={`px-8 py-4 ${theme === 'dark' ? 'bg-white/10 hover:bg-white/20' : 'bg-slate-200 hover:bg-slate-300'} rounded-2xl text-xs font-black uppercase transition-all hover:scale-105 active:scale-90`}>{t("تلاش با فایل دیگر", "Try Another File")}</button>
                                      </div>
                                  ) : (
                                      <label className={`flex-1 border-2 border-dashed ${theme === 'dark' ? 'border-indigo-500/20' : 'border-indigo-300'} rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer hover:bg-indigo-500/5 group transition-all min-h-[400px]`}>
                                          <input type="file" accept="audio/*" onChange={async (e) => {
                                              const file = e.target.files?.[0]; if(!file) return;
                                              setIsDec(true);
                                              try {
                                                  const buffer = await (new AudioContext()).decodeAudioData(await file.arrayBuffer());
                                                  const bits = await audioEngine.decodeBuffer(buffer);
                                                  const fingerprint = getFingerprint(bits);
                                                  setTBits(bits);
                                                  
                                                  const attempts = vaultRegistry.current[fingerprint] || 0;
                                                  setPassAttempts(attempts);
                                                  
                                                  if (attempts >= 3) {
                                                    setIsVaultLocked(true);
                                                  } else {
                                                    decodeFile(bits);
                                                  }
                                              } catch(err) {
                                                  alert(t("فایل صوتی نامعتبر است", "Invalid audio file"));
                                              } finally {
                                                  setIsDec(false);
                                              }
                                          }} className="hidden" />
                                          <div className={`w-24 h-24 ${theme === 'dark' ? 'bg-indigo-500/5' : 'bg-indigo-50'} rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-500/10 transition-all mb-6`}>
                                              <span className="text-6xl">{isDec ? '⏳' : '📥'}</span>
                                          </div>
                                          <span className={`text-sm font-black uppercase tracking-widest ${theme === 'light' ? 'text-indigo-600' : 'opacity-60'}`}>{isDec ? t("درحال پردازش...", "Processing...") : t("انتخاب فایل صوتی", "Select Audio File")}</span>
                                      </label>
                                  )}
                               </div>
                          ) : (
                              <div className="space-y-6 anim-scale flex-1 flex flex-col justify-center">
                                  <div className={`p-8 ${theme === 'dark' ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50 border-indigo-200'} border rounded-[2.5rem] shadow-inner relative overflow-hidden`}>
                                      <div className={`absolute top-0 right-0 w-32 h-32 ${theme === 'dark' ? 'bg-indigo-500/10' : 'bg-indigo-500/5'} blur-[60px] rounded-full -mr-16 -mt-16`} />
                                      <div className="flex justify-between items-center text-[10px] font-black text-indigo-400 mb-6 uppercase tracking-widest">
                                          <span className="flex items-center gap-2">👤 {t("فرستنده", "FROM")}: {decData.sender}</span>
                                          <span className="bg-indigo-500 text-white px-3 py-1 rounded-full text-[9px] shadow-lg shadow-indigo-500/20">{t("رمزگشایی شد", "DECRYPTED")}</span>
                                      </div>
                                      <p className={`text-2xl font-black leading-relaxed tracking-tight ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{decData.text}</p>
                                  </div>
                                  <button onClick={resetVaultSession} className={`w-full py-5 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-100 hover:bg-slate-200 text-slate-900'} rounded-2xl text-xs font-black uppercase transition-all hover:scale-[1.02] active:scale-95 border border-white/5`}>{t("پاکسازی و خروج", "Clear & Exit")}</button>
                              </div>
                          )}
                          {passReq && !isVaultLocked && (
                              <div className={`mt-6 p-6 ${theme === 'dark' ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50 border-red-200'} border rounded-[2rem] space-y-4 anim-fade`}>
                                  <div className="flex justify-between items-center">
                                      <p className="text-[11px] font-black text-red-500 uppercase tracking-wider">{t("رمز عبور فایل را وارد کنید", "Enter File Password")}</p>
                                      <span className="text-[10px] bg-red-500 text-white px-3 py-1 rounded-full font-mono font-black">{3 - passAttempts} {t("فرصت", "left")}</span>
                                  </div>
                                  <input type="password" autoFocus onKeyPress={e => e.key === 'Enter' && decodeFile(tBits, (e.target as HTMLInputElement).value)} placeholder="••••••••" className={`w-full p-4 ${theme === 'dark' ? 'bg-black/40' : 'bg-white border border-red-100'} rounded-2xl text-sm outline-none focus:ring-2 ring-red-500/30 transition-all font-black tracking-widest ${theme === 'light' ? 'text-slate-900' : 'text-white'}`} />
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          )}
        </main>

        {/* Static, Content-Flow Footer (Not Fixed) */}
        <footer className={`w-full p-12 text-center select-none flex flex-col items-center mt-auto ${theme === 'dark' ? 'opacity-30' : 'opacity-60'}`}>
            <p className={`text-[9px] font-black uppercase tracking-[0.6em] ${theme === 'dark' ? 'text-indigo-500' : 'text-indigo-600'}`}>
              Authored by <a href="https://github.com/TXMAZ2010" target="_blank" rel="noopener noreferrer" className="hover:underline transition-all">Taymaz</a>
            </p>
            <div className="mt-3">
              <a 
                href="https://www.netlify.com" 
                target="_blank" 
                rel="noopener noreferrer" 
                className={`text-[8px] font-bold uppercase tracking-widest hover:underline ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-500'}`}
              >
                This site is powered by Netlify
              </a>
            </div>
        </footer>
      </div>

      {/* Separate Privacy Shield Indicator (Outside blurred content) */}
      {isPrivacyActive && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-transparent backdrop-blur-[2px]">
          <div className="text-center space-y-4 anim-fade bg-black/30 p-12 rounded-[3rem] backdrop-blur-md border border-white/10 shadow-2xl">
            <span className="text-7xl block mb-2 drop-shadow-xl">🔒</span>
            <p className="text-white font-black text-2xl tracking-tight drop-shadow-lg">{t("حالت امن فعال است", "Privacy Mode Active")}</p>
            <p className="text-white/60 text-xs font-medium tracking-widest uppercase">{t("برای بازگشت کلیک کنید", "TAP TO RESUME")}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
