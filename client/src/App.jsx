import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, MapPin, Play, Trophy, Tv, AlertCircle, X, RefreshCw, Server, Signal, Info, Film, Timer, BarChart3, Youtube, Users, CheckCircle2, Radio, Zap, Monitor } from 'lucide-react';
import mpegts from 'mpegts.js';
import Hls from 'hls.js';
import LiveTelemetry from './components/LiveTelemetry';
import { apiBase, weekendState, feedStatusLabel } from './lib/schedule';

// --- Styles & Fonts ---
const GlobalStyles = () => (
  <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Titillium+Web:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap');
        
        :root {
            --f1-red: #ff1801;
            --f1-dark: #101010;
            --bg-dark: #000000;
            --card-bg: #151515;
            --card-border: #333333;
            --text-primary: #ffffff;
            --text-secondary: #9ca3af;
        }

        body {
            font-family: 'Titillium Web', sans-serif;
            background-color: var(--bg-dark);
            color: var(--text-primary);
            margin: 0;
            padding: 0;
            overflow-x: hidden;
        }

        /* Utility Classes */
        .bg-card { background-color: var(--card-bg); }
        .border-card { border-color: var(--card-border); }
        
        .f1-card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            transition: transform 0.2s ease, border-color 0.2s ease;
        }
        
        .f1-card:hover {
            border-color: var(--f1-red);
            transform: translateY(-2px);
        }

        .f1-btn-primary {
            background-color: var(--f1-red);
            color: white;
            font-weight: 700;
            transition: background-color 0.2s ease;
        }
        .f1-btn-primary:hover {
            background-color: #cc0000;
        }

        .f1-btn-secondary {
            background-color: transparent;
            border: 1px solid var(--card-border);
            color: var(--text-primary);
            transition: all 0.2s ease;
        }
        .f1-btn-secondary:hover {
            border-color: var(--text-primary);
            background-color: rgba(255,255,255,0.05);
        }

        .sidebar-backdrop {
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(4px);
        }

        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--bg-dark); }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--f1-red); }

        /* Animations */
        .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
        .animate-slide-in { animation: slideIn 0.3s ease-out forwards; }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        
        .live-indicator {
            width: 8px;
            height: 8px;
            background-color: var(--f1-red);
            border-radius: 50%;
            box-shadow: 0 0 0 0 rgba(255, 24, 1, 0.7);
            animation: pulse-red 2s infinite;
        }
        
        @keyframes pulse-red {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 24, 1, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(255, 24, 1, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 24, 1, 0); }
        }

        .session-row {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .session-row:last-child { border-bottom: none; }
        
        .logo-img {
            height: 32px;
            width: auto;
            object-fit: contain;
        }
        @media (min-width: 640px) {
            .logo-img { height: 40px; }
        }

        .circuit-img {
            filter: invert(1) drop-shadow(0 0 5px rgba(255,255,255,0.2));
            opacity: 0.9;
            transition: all 0.3s ease;
        }
        .circuit-img:hover {
            filter: invert(1) drop-shadow(0 0 8px rgba(255, 24, 1, 0.6));
            opacity: 1;
            transform: scale(1.05);
        }
    `}</style>
);

// --- Data Mappings ---

// Official Wikimedia Layouts - Comprehensive circuit ID mapping
// Supports both Sportstimes slugs and Ergast/Jolpica circuitIds
const CIRCUIT_IMAGES = {
  // 2026 Sportstimes Slugs
  "australian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/0/0a/Albert_Park_Circuit_2021.svg",
  "chinese-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/1/14/Shanghai_International_Racing_Circuit_track_map.svg",
  "japanese-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/e/ec/Suzuka_circuit_map--2005.svg",
  "bahrain-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Bahrain_International_Circuit--Grand_Prix_Layout.svg/640px-Bahrain_International_Circuit--Grand_Prix_Layout.svg.png",
  "saudi-arabia-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/4/4c/Jeddah_Street_Circuit_2021.svg",
  "miami-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/b/be/2022_F1_CourseLayout_Miami.svg",
  "canadian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/2/21/Circuit_Gilles_Villeneuve.svg",
  "monaco-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/5/56/Circuit_Monaco.svg",
  "barcelona-catalunya-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "austrian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/3/36/Red_Bull_Ring_moto_2022.svg",
  "british-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Silverstone_race_circuit.svg",
  "belgian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/5/54/Spa-Francorchamps_of_Belgium.svg",
  "hungarian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/9/91/Hungaroring.svg",
  "dutch-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/4/4a/Zandvoort.svg",
  "italian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/f/f8/Monza_track_map.svg",
  "spanish-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "azerbaijan-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Baku_Formula_One_circuit_map.svg",
  "singapore-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/8/8b/Marina_Bay_circuit_2023.svg",
  "us-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Austin_circuit.svg",
  "mexican-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/3/36/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez_2015.svg",
  "brazilian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/5/5c/Circuit_Interlagos.svg",
  "las-vegas-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/4/43/2023_Las_Vegas_street_circuit.svg",
  "qatar-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/c/c7/Lusail_International_Circuit_2023.svg",
  "abu-dhabi-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/d/dc/Circuit_Yas-Island.svg",

  // Ergast/Jolpica API circuitIds (for direct API responses)
  "albert_park": "https://upload.wikimedia.org/wikipedia/commons/0/0a/Albert_Park_Circuit_2021.svg",
  "shanghai": "https://upload.wikimedia.org/wikipedia/commons/1/14/Shanghai_International_Racing_Circuit_track_map.svg",
  "suzuka": "https://upload.wikimedia.org/wikipedia/commons/e/ec/Suzuka_circuit_map--2005.svg",
  "bahrain": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Bahrain_International_Circuit--Grand_Prix_Layout.svg/640px-Bahrain_International_Circuit--Grand_Prix_Layout.svg.png",
  "jeddah": "https://upload.wikimedia.org/wikipedia/commons/4/4c/Jeddah_Street_Circuit_2021.svg",
  "miami": "https://upload.wikimedia.org/wikipedia/commons/b/be/2022_F1_CourseLayout_Miami.svg",
  "villeneuve": "https://upload.wikimedia.org/wikipedia/commons/2/21/Circuit_Gilles_Villeneuve.svg",
  "monaco": "https://upload.wikimedia.org/wikipedia/commons/5/56/Circuit_Monaco.svg",
  "catalunya": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "red_bull_ring": "https://upload.wikimedia.org/wikipedia/commons/3/36/Red_Bull_Ring_moto_2022.svg",
  "silverstone": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Silverstone_race_circuit.svg",
  "spa": "https://upload.wikimedia.org/wikipedia/commons/5/54/Spa-Francorchamps_of_Belgium.svg",
  "hungaroring": "https://upload.wikimedia.org/wikipedia/commons/9/91/Hungaroring.svg",
  "zandvoort": "https://upload.wikimedia.org/wikipedia/commons/4/4a/Zandvoort.svg",
  "monza": "https://upload.wikimedia.org/wikipedia/commons/f/f8/Monza_track_map.svg",
  "madring": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "baku": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Baku_Formula_One_circuit_map.svg",
  "marina_bay": "https://upload.wikimedia.org/wikipedia/commons/8/8b/Marina_Bay_circuit_2023.svg",
  "americas": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Austin_circuit.svg",
  "rodriguez": "https://upload.wikimedia.org/wikipedia/commons/3/36/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez_2015.svg",
  "interlagos": "https://upload.wikimedia.org/wikipedia/commons/5/5c/Circuit_Interlagos.svg",
  "vegas": "https://upload.wikimedia.org/wikipedia/commons/4/43/2023_Las_Vegas_street_circuit.svg",
  "losail": "https://upload.wikimedia.org/wikipedia/commons/c/c7/Lusail_International_Circuit_2023.svg",
  "yas_marina": "https://upload.wikimedia.org/wikipedia/commons/d/dc/Circuit_Yas-Island.svg"
};

const OFFICIAL_PLAYLIST_ID = "PLfoNZDHitwjUleAqrgG-OC5gVAL2mv-Mh";

// Specific Video IDs for completed races (Fallbacks to playlist if unknown)
const HIGHLIGHT_IDS = {
  "villeneuve": "93ZnZF_zWds", // Canada 2025
  "albert_park": "stF2J_SJabs", // Australia
  "bahrain": "o2s_Y0q8v_o", // Bahrain
  "jeddah": "Vk3tW_V0q4s", // Saudi
};

const CircuitMap = ({ circuitId }) => {
  // Normalize circuit ID to handle different variations
  const normalizedId = circuitId?.toLowerCase().replace(/[-_\s]/g, '_');

  // Try to find the circuit image with various ID formats
  let imgSrc = CIRCUIT_IMAGES[circuitId] ||
    CIRCUIT_IMAGES[normalizedId] ||
    CIRCUIT_IMAGES[circuitId?.replace(/-/g, '_')] ||
    CIRCUIT_IMAGES[circuitId?.replace(/_/g, '-')] ||
    CIRCUIT_IMAGES["bahrain-grand-prix"];

  // Enhanced debugging - log all attempts
  console.group('🏁 Circuit Map Debug');
  console.log('Original circuit ID:', circuitId);
  console.log('Normalized ID:', normalizedId);
  console.log('Direct lookup (circuitId):', CIRCUIT_IMAGES[circuitId] ? '✅ Found' : '❌ Not found');
  console.log('Normalized lookup:', CIRCUIT_IMAGES[normalizedId] ? '✅ Found' : '❌ Not found');
  console.log('Final image URL:', imgSrc);
  console.log('Is Bahrain?', imgSrc === CIRCUIT_IMAGES["bahrain"]);
  console.groupEnd();

  return (
    <div className="w-full h-48 md:h-full flex items-center justify-center relative p-4">
      <img
        src={imgSrc}
        alt="Circuit Layout"
        className="circuit-img w-full h-full object-contain"
        onError={(e) => {
          console.error('❌ Circuit image failed to load:', imgSrc);
          e.target.onerror = null;
          e.target.src = CIRCUIT_IMAGES["bahrain-grand-prix"];
        }}
      />
      <div className="absolute bottom-2 right-2 text-[10px] text-[#ff1801] font-mono uppercase border border-[#ff1801] px-2 py-0.5 rounded bg-black/50 backdrop-blur-sm">
        {circuitId || 'Unknown'}
      </div>
    </div>
  );
};

// --- Video Player Components ---

const PlayerStatus = ({ status }) => {
  if (!status || status.phase === 'playing') return null;
  if (status.phase === 'loading') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-[#ff1801] animate-spin mx-auto mb-4" />
          <p className="text-white text-sm">Loading stream...</p>
          <p className="text-gray-400 text-xs mt-2">{status.detail || 'Connecting to stream server...'}</p>
        </div>
      </div>
    );
  }
  if (status.phase === 'error') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
        <div className="text-center p-8">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-white text-lg mb-2">Stream Error</p>
          <p className="text-gray-400 text-sm">{status.detail}</p>
        </div>
      </div>
    );
  }
  // Buffering / reconnecting: keep the video on screen, show a small chip
  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-black/80 border border-[#333] rounded-full px-3 py-1.5 text-xs text-white">
      <RefreshCw className="w-3 h-3 text-[#ff1801] animate-spin" />
      {status.phase === 'reconnecting' ? `Reconnecting${status.attempt > 1 ? ` (attempt ${status.attempt})` : ''}…` : 'Buffering…'}
      {status.detail && <span className="text-gray-400 hidden md:inline">{status.detail}</span>}
    </div>
  );
};

// MPEG-TS restream (mpegts.js). Live-only, so on a drop or a long stall the
// player is rebuilt automatically and rejoins the live edge without closing.
const MpegtsPlayer = ({ src }) => {
  const videoRef = useRef(null);
  const supported = mpegts.isSupported();
  const [status, setStatus] = useState(supported
    ? { phase: 'loading' }
    : { phase: 'error', detail: 'MPEG-TS playback is not supported in this browser' });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !supported) return;

    let player = null;
    let retryTimer = null;
    let attempt = 0;
    let disposed = false;
    let lastTime = -1;
    let lastProgress = Date.now();

    const create = () => {
      if (disposed) return;
      player?.destroy();
      player = mpegts.createPlayer({ type: 'mpegts', url: src, isLive: true }, {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 384 * 1024,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 8,
        liveBufferLatencyMinRemain: 2,
        autoCleanupSourceBuffer: true,
      });
      player.attachMediaElement(video);
      player.on(mpegts.Events.MEDIA_INFO, () => { attempt = 0; setStatus({ phase: 'playing' }); });
      player.on(mpegts.Events.ERROR, (type, detail) => reconnect(`${type}: ${detail}`));
      // A live stream never "completes" - the server ended it, so reconnect
      player.on(mpegts.Events.LOADING_COMPLETE, () => reconnect('Stream ended'));
      player.load();
      player.play()?.catch?.(() => { });
    };

    const reconnect = (reason) => {
      if (disposed || retryTimer) return;
      attempt += 1;
      console.warn('[Player] Reconnecting:', reason);
      setStatus({ phase: 'reconnecting', attempt, detail: reason });
      retryTimer = setTimeout(() => { retryTimer = null; create(); }, Math.min(1000 * 2 ** (attempt - 1), 10000));
    };

    // Stall watchdog: playback not advancing for 12s (and not paused by the user)
    const watchdog = setInterval(() => {
      if (video.paused || video.currentTime !== lastTime) {
        if (video.currentTime !== lastTime) setStatus(s => (s.phase === 'buffering' ? { phase: 'playing' } : s));
        lastTime = video.currentTime;
        lastProgress = Date.now();
        return;
      }
      const stalledFor = Date.now() - lastProgress;
      if (stalledFor > 3000) setStatus(s => (s.phase === 'playing' ? { phase: 'buffering' } : s));
      if (stalledFor > 12000) {
        lastProgress = Date.now();
        reconnect('Buffering too long');
      }
    }, 1000);

    create();
    return () => {
      disposed = true;
      clearInterval(watchdog);
      clearTimeout(retryTimer);
      player?.destroy();
    };
  }, [src, supported]);

  return (
    <div className="relative w-full h-full bg-black">
      <PlayerStatus status={status} />
      <video ref={videoRef} controls autoPlay playsInline className="w-full h-full bg-black object-contain" />
    </div>
  );
};

const HLS_LOAD_POLICY = (ttfb, total, retries) => ({
  default: {
    maxTimeToFirstByteMs: ttfb,
    maxLoadTimeMs: total,
    timeoutRetry: { maxNumRetry: retries, retryDelayMs: 1000, maxRetryDelayMs: 5000 },
    errorRetry: { maxNumRetry: retries, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
  },
});

// HLS player with DVR: the server keeps the last ~10 minutes of segments, so
// when the connection drops or buffers we resume from the exact segment we were
// on instead of jumping ahead and losing part of the session.
const HlsPlayer = ({ src, live }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState(() =>
    Hls.isSupported() || document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
      ? { phase: 'loading' }
      : { phase: 'error', detail: 'HLS is not supported in this browser' });
  const [behindLive, setBehindLive] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari / iOS: native HLS has its own retry logic
        video.src = src;
        const onPlaying = () => setStatus({ phase: 'playing' });
        const onWaiting = () => setStatus({ phase: 'buffering' });
        video.addEventListener('playing', onPlaying);
        video.addEventListener('waiting', onWaiting);
        return () => {
          video.removeEventListener('playing', onPlaying);
          video.removeEventListener('waiting', onWaiting);
          video.removeAttribute('src');
          video.load();
        };
      }
      return; // unsupported: error state set at mount
    }

    let hls = null;
    let disposed = false;
    let rebuildTimer = null;
    let attempt = 0;
    let mediaRecoveries = 0;
    let lastTime = -1;
    let lastProgress = Date.now();
    let nudged = false;

    // Where are we in the broadcast? (segment sequence number + offset)
    const currentPosition = () => {
      const details = hls?.levels?.[hls.currentLevel]?.details || hls?.levels?.[0]?.details;
      const frag = details?.fragments?.find(f => video.currentTime >= f.start && video.currentTime < f.start + f.duration);
      return frag ? { sn: frag.sn, offset: video.currentTime - frag.start } : null;
    };

    const create = (resume) => {
      if (disposed) return;
      hls?.destroy();
      hls = new Hls({
        autoStartLoad: !resume,
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        liveDurationInfinity: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 90,
        backBufferLength: 600,
        manifestLoadPolicy: HLS_LOAD_POLICY(30000, 30000, 12),
        playlistLoadPolicy: HLS_LOAD_POLICY(15000, 20000, 12),
        fragLoadPolicy: HLS_LOAD_POLICY(15000, 60000, 8),
      });
      hlsRef.current = hls;

      if (resume) {
        hls.once(Hls.Events.LEVEL_LOADED, (_e, { details }) => {
          const frag = details.fragments.find(f => f.sn === resume.sn);
          hls.startLoad(frag ? frag.start + resume.offset : -1);
        });
      }
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => { }));
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        attempt = 0;
        mediaRecoveries = 0;
        setStatus(s => (s.phase === 'loading' || s.phase === 'reconnecting' ? { phase: 'playing' } : s));
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
          mediaRecoveries += 1;
          hls.recoverMediaError();
          return;
        }
        rebuild(`${data.type}: ${data.details}`);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    };

    const rebuild = (reason) => {
      if (disposed || rebuildTimer) return;
      const resume = currentPosition();
      attempt += 1;
      console.warn('[Player] Rebuilding HLS player:', reason, resume);
      setStatus({ phase: 'reconnecting', attempt, detail: resume ? 'Resuming where you left off' : reason });
      rebuildTimer = setTimeout(() => { rebuildTimer = null; create(resume); }, Math.min(1000 * 2 ** (attempt - 1), 10000));
    };

    const watchdog = setInterval(() => {
      if (hls?.liveSyncPosition) setBehindLive(Math.max(0, hls.liveSyncPosition - video.currentTime));
      if (video.paused || video.currentTime !== lastTime) {
        if (video.currentTime !== lastTime) setStatus(s => (s.phase === 'buffering' ? { phase: 'playing' } : s));
        lastTime = video.currentTime;
        lastProgress = Date.now();
        nudged = false;
        return;
      }
      const stalledFor = Date.now() - lastProgress;
      if (stalledFor > 3000) setStatus(s => (s.phase === 'playing' ? { phase: 'buffering' } : s));
      if (stalledFor > 10000 && !nudged) {
        nudged = true; // first try: restart loading at the current position
        hls?.startLoad(video.currentTime);
      } else if (stalledFor > 25000) {
        lastProgress = Date.now();
        rebuild('Playback stalled');
      }
    }, 1000);

    create(null);
    return () => {
      disposed = true;
      clearInterval(watchdog);
      clearTimeout(rebuildTimer);
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  const goLive = () => {
    const hls = hlsRef.current;
    if (hls?.liveSyncPosition) videoRef.current.currentTime = hls.liveSyncPosition;
    videoRef.current.play().catch(() => { });
  };

  return (
    <div className="relative w-full h-full bg-black">
      <PlayerStatus status={status} />
      <video ref={videoRef} controls autoPlay playsInline className="w-full h-full bg-black object-contain" />
      {live && status.phase !== 'loading' && (
        <button onClick={goLive}
          className={`absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold border ${behindLive > 15 ? 'bg-black/80 border-[#333] text-gray-300 hover:text-white' : 'bg-[#ff1801]/90 border-[#ff1801] text-white'}`}>
          <span className={`w-2 h-2 rounded-full ${behindLive > 15 ? 'bg-gray-500' : 'bg-white'}`} />
          {behindLive > 15 ? `-${Math.floor(behindLive / 60)}:${String(Math.floor(behindLive % 60)).padStart(2, '0')} · GO LIVE` : 'LIVE'}
        </button>
      )}
    </div>
  );
};

const VideoPlayer = ({ src, type }) => {
  if (type === 'mpegts') return <MpegtsPlayer src={src} />;

  if (type === 'youtube') {
    // Robust Youtube Embedding
    // If it's a full URL, we use it. If it's an ID, we embed it.
    let embedSrc = src;
    if (!src.startsWith('http')) {
      const separator = src.includes('?') ? '&' : '?';
      embedSrc = `https://www.youtube.com/embed/${src}${separator}autoplay=1&modestbranding=1&rel=0&origin=${window.location.origin}`;
    }

    return (
      <iframe
        className="w-full h-full"
        src={embedSrc}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      ></iframe>
    );
  }

  if (type === 'iframe') {
    return (
      <iframe
        className="w-full h-full bg-black"
        src={src}
        title="Live Stream"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      ></iframe>
    );
  }

  return <HlsPlayer src={src} live={type === 'hls-live'} />;
};

// --- Driver Standings Component ---
const DriverStandings = () => {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://api.jolpi.ca/ergast/f1/current/driverStandings.json')
      .then(res => res.json())
      .then(data => {
        setStandings(data.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || []);
      })
      .catch(err => console.error("Error fetching standings:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-6 border-b border-[#333] pb-4">
        <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5 md:w-6 md:h-6 text-[#ff1801]" /> Driver Standings
        </h2>
        <div className="text-xs text-gray-500 font-mono">{standings.length} DRIVERS · LIVE DATA</div>
      </div>

      {/* Same footprint as the old top-5 table: header + 5 rows visible, the rest scrolls inside */}
      <div className="bg-[#151515] border border-[#333] rounded-xl overflow-auto max-h-[357px]">
        <table className="w-full text-left border-collapse min-w-[600px] md:min-w-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#1a1a1a] text-xs uppercase text-gray-400 border-b border-[#333] h-12">
              <th className="px-4 font-bold">Pos</th>
              <th className="px-4 font-bold">Driver</th>
              <th className="px-4 font-bold">Constructor</th>
              <th className="px-4 font-bold text-right">Wins</th>
              <th className="px-4 font-bold text-right">Points</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {standings.map((driver) => (
              <tr key={driver.Driver.driverId} className="border-b border-white/5 hover:bg-white/5 transition-colors h-[61px]">
                <td className="px-4 font-mono text-[#ff1801] font-bold">{driver.position || driver.positionText}</td>
                <td className="px-4 font-bold text-white">
                  <span className={`flag-icon flag-icon-${driver.Driver.nationality.toLowerCase()} mr-2`}></span>
                  {driver.Driver.givenName} {driver.Driver.familyName}
                </td>
                <td className="px-4 text-gray-400">{driver.Constructors[0].name}</td>
                <td className="px-4 text-right font-mono text-gray-500">{driver.wins}</td>
                <td className="px-4 text-right font-bold text-white font-mono text-lg">{driver.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const Navbar = () => (
  <nav className="fixed top-0 w-full z-50 bg-[#101010] border-b border-[#333] h-16 flex items-center justify-between px-4 md:px-6 shadow-lg">
    <div className="flex items-center gap-3 overflow-hidden">
      <img
        src="https://i.ytimg.com/vi/y42PI9peurI/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLDYDLVaNMpCBv5PTN7xtqNCLGmabg"
        alt="F1 Logo"
        className="logo-img rounded-sm"
      />
      <span className="text-white font-bold text-lg md:text-xl tracking-tight ml-2 truncate">
        STREAM<span className="text-[#ff1801]">HUB</span>
      </span>
    </div>
    <div className="flex items-center gap-2 md:gap-4">
      <div className="flex items-center gap-2 px-2 md:px-3 py-1 bg-[#1a1a1a] rounded-full border border-[#333]">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        <span className="text-[10px] md:text-xs font-mono text-gray-300 hidden sm:inline">SYSTEM ONLINE</span>
      </div>
    </div>
  </nav>
);

const RaceCountdown = ({ date }) => {
  const calc = () => {
    const diff = Math.max(0, new Date(date) - new Date());
    return {
      d: Math.floor(diff / (1000 * 60 * 60 * 24)),
      h: Math.floor((diff / (1000 * 60 * 60)) % 24),
      m: Math.floor((diff / 1000 / 60) % 60),
      s: Math.floor((diff / 1000) % 60),
    };
  };
  const [time, setTime] = useState(calc);

  useEffect(() => {
    setTime(calc());
    const interval = setInterval(() => setTime(calc()), 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      {Object.entries(time).map(([unit, val]) => (
        <div key={unit} className="bg-[#1a1a1a] border border-[#333] rounded p-1 md:p-2 text-center">
          <div className="text-lg md:text-xl font-bold text-white font-mono">{String(val).padStart(2, '0')}</div>
          <div className="text-[8px] md:text-[9px] text-gray-500 uppercase">{unit}</div>
        </div>
      ))}
    </div>
  );
};

const SessionList = ({ sessions }) => {
  if (!sessions?.length) return null;

  return (
    <div className="mt-4 bg-black/40 rounded-lg p-3 border border-[#333]">
      <h4 className="text-xs font-bold uppercase text-gray-400 mb-2 flex items-center gap-2">
        <Timer className="w-3 h-3" /> Schedule
      </h4>
      <div className="space-y-1">
        {sessions.map((session) => (
          <div key={session.key} className={`session-row text-sm ${session.phase === 'live' ? 'text-white font-bold' : session.phase === 'done' ? 'text-gray-600' : 'text-gray-300'}`}>
            <span className="flex items-center gap-2">
              {session.phase === 'live' && <span className="live-indicator" />}
              {session.phase === 'done' && <CheckCircle2 className="w-3 h-3" />}
              {session.name}
            </span>
            <div className="flex gap-2 font-mono text-xs items-center">
              {session.phase === 'live' ? (
                <span className="text-[#ff1801] font-bold">LIVE NOW</span>
              ) : (
                <>
                  <span className={session.phase === 'done' ? '' : 'text-[#ff1801]'}>{session.start.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span>{session.start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Hero = ({ race, weekend, feed, onWatch }) => {
  if (!race) return null;
  const { live, next, sessions } = weekend;
  const replay = feed?.source === 'replay' && feed.session;
  const showTelemetry = !!live || !!replay;
  const liveFeedSession = feed?.session && live && feed.session.name === live.name ? feed.session : null;

  return (
    <section className="relative rounded-2xl overflow-hidden border border-[#333] bg-[#101010] mb-8 md:mb-12 shadow-2xl grid grid-cols-1 lg:grid-cols-12">
      <div className="absolute inset-0 bg-[url('https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/f_auto/q_auto/content/dam/fom-website/manual/Misc/2021-Master-Folder/F1%202021%20Generic/F1_Generic_01')] bg-cover bg-center opacity-20"></div>
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/40"></div>

      {/* Left Content: Race Info (7 cols) */}
      <div className="relative z-10 p-6 md:p-10 lg:col-span-7 flex flex-col justify-center min-h-[300px]">
        {live ? (
          <div className="flex items-center gap-3 text-[#ff1801] font-bold uppercase tracking-widest text-xs md:text-sm mb-3">
            <span className="live-indicator" /> {live.name} is live
            {liveFeedSession && <span className="text-gray-400 normal-case tracking-normal font-semibold">· {feedStatusLabel(liveFeedSession.status)}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[#ff1801] font-bold uppercase tracking-widest text-xs md:text-sm mb-3">
            <Trophy className="w-3 h-3 md:w-4 md:h-4" /> {sessions.some(s => s.phase === 'done') ? 'This Weekend' : 'Next Grand Prix'}
          </div>
        )}
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-white italic leading-none mb-4">
          {race.raceName.replace("Grand Prix", "")} <br />
          <span className="text-white text-stroke">GP</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3 md:gap-4 text-gray-400 text-base md:text-lg mb-6">
          <span className="flex items-center gap-2"><MapPin className="w-4 h-4 md:w-5 md:h-5" /> {race.Circuit.circuitName || race.Circuit.CircuitName || race.Circuit.Location?.locality}</span>
          <span className="flex items-center gap-2"><Calendar className="w-4 h-4 md:w-5 md:h-5" /> {new Date(`${race.date}T${race.time || '00:00:00Z'}`).toLocaleDateString()}</span>
        </div>
        <div className="flex gap-4">
          <button onClick={() => onWatch(race)} className="f1-btn-primary px-6 md:px-8 py-3 rounded flex items-center gap-2 shadow-lg shadow-red-900/20 text-sm md:text-base w-full md:w-auto justify-center">
            <Play className="w-4 h-4 md:w-5 md:h-5 fill-current" /> WATCH LIVE
          </button>
        </div>
      </div>

      {/* Right Content: Map & Timer (5 cols) */}
      <div className="relative z-10 lg:col-span-5 border-t lg:border-t-0 lg:border-l border-[#333] bg-black/20 backdrop-blur-sm flex flex-col">
        <div className="flex-1 flex flex-col p-4 md:p-6">
          {!showTelemetry && <CircuitMap circuitId={race.Circuit.circuitId} />}

          <div className="mt-auto pt-4 md:pt-0">
            {live ? (
              <div className="bg-[#ff1801]/10 border border-[#ff1801]/40 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="text-[#ff1801] text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Radio className="w-3 h-3" /> On air</div>
                  <div className="text-white text-2xl font-black italic">{live.name}</div>
                  <div className="text-gray-400 text-xs">Stays live until the session is finalised</div>
                </div>
                <span className="live-indicator" />
              </div>
            ) : next ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest">
                    {next.key === 'R' ? 'Lights Out' : `${next.name} starts in`}
                  </h3>
                  <span className="text-[#ff1801] text-xs font-mono">LOCAL TIME</span>
                </div>
                <RaceCountdown date={next.start.toISOString()} />
              </>
            ) : (
              <div className="text-gray-400 text-sm">Season complete</div>
            )}
            <SessionList sessions={sessions} />
          </div>
        </div>
      </div>

      {/* Live telemetry for the running session */}
      {showTelemetry && (
        <div className="relative z-10 lg:col-span-12 border-t border-[#333] bg-[#0b0b0b]/95">
          <LiveTelemetry />
        </div>
      )}
    </section>
  );
};

const ResultRow = ({ position, Driver, Constructor, Time, points, status }) => (
  <div className="flex items-center justify-between text-xs py-2 border-b border-white/5 last:border-0">
    <div className="flex items-center gap-3 flex-1">
      <span className="font-mono text-gray-500 w-4 text-center">{position}</span>
      <div className="min-w-0">
        <span className="font-bold text-white block truncate">{Driver.code}</span>
        <span className="text-gray-500 text-[10px] truncate">{Constructor.name}</span>
      </div>
    </div>
    <div className="text-right ml-2">
      <span className="block font-mono text-gray-300">{Time?.time || status}</span>
      <span className="text-[#ff1801] font-bold">+{points}</span>
    </div>
  </div>
);

const RaceCard = ({ race, isPast, onWatch, onHighlights }) => {
  const [results, setResults] = useState(null);
  const [loadingResults, setLoadingResults] = useState(false);

  useEffect(() => {
    if (isPast && !results) {
      setLoadingResults(true);
      const year = new Date(race.date).getFullYear();
      fetch(`https://api.jolpi.ca/ergast/f1/${year}/${race.round}/results.json`)
        .then(res => res.json())
        .then(data => {
          const raceResults = data.MRData.RaceTable.Races[0]?.Results?.slice(0, 5) || [];
          setResults(raceResults);
        })
        .catch(err => console.error("Failed to load results", err))
        .finally(() => setLoadingResults(false));
    }
  }, [isPast, race.date, race.round]);

  return (
    <div className="f1-card rounded-lg p-4 md:p-5 flex flex-col h-full relative overflow-hidden group min-h-[250px]">
      <div className="flex justify-between items-start mb-3">
        <span className="text-xs font-mono text-gray-500 border border-[#333] px-2 py-1 rounded">R{race.round}</span>
        {isPast && <span className="text-[10px] font-bold text-gray-600 bg-gray-900 px-2 py-1 rounded">COMPLETED</span>}
      </div>

      <h3 className="text-lg md:text-xl font-bold text-white mb-1 group-hover:text-[#ff1801] transition-colors truncate">{race.raceName.replace("Grand Prix", "GP")}</h3>
      <p className="text-sm text-gray-400 mb-4 flex items-center gap-1"><MapPin className="w-3 h-3" /> {race.Circuit.Location.locality}</p>

      {isPast ? (
        <div className="flex-1 flex flex-col">
          <div className="bg-[#1a1a1a] rounded p-3 border border-[#333] mb-4 flex-1 min-h-[150px]">
            <div className="flex items-center justify-between mb-2 border-b border-white/10 pb-1">
              <span className="text-[10px] uppercase font-bold text-gray-500">Race Results</span>
              <BarChart3 className="w-3 h-3 text-gray-500" />
            </div>
            {loadingResults ? (
              <div className="h-full flex items-center justify-center">
                <RefreshCw className="w-4 h-4 animate-spin text-gray-600" />
              </div>
            ) : results && results.length > 0 ? (
              results.map((r) => <ResultRow key={r.position} {...r} />)
            ) : (
              <div className="text-center text-xs text-gray-600 py-4">Results Pending</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-auto">
            <button
              onClick={() => onHighlights(race)}
              className="flex items-center justify-center gap-2 bg-[#cc0000] hover:bg-[#ff1801] text-white py-2 rounded text-xs font-bold transition-colors col-span-2"
            >
              <Youtube className="w-4 h-4" /> Highlights
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-auto pt-4 border-t border-[#333] flex justify-between items-center">
          <span className="text-sm text-gray-300 font-mono">{new Date(race.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <button
            onClick={() => onWatch(race)}
            className="bg-[#ff1801] text-white hover:bg-[#cc0000] px-4 py-2 rounded-full transition-colors flex items-center gap-2 text-xs font-bold uppercase"
          >
            <Play className="w-3 h-3 fill-current" /> Live
          </button>
        </div>
      )}
    </div>
  );
};

// Available F1 Channels from your Xstream provider
// UK Sky Sports F1 channels with English commentary
// Multiple quality options and providers for maximum redundancy
// All live channels route through the HLS DVR pipeline with profile=auto: the
// server copies the source when it is already browser-playable H.264 (true
// 1080p, almost no CPU) and transcodes to 1080p H.264 only when the provider
// serves HEVC/10-bit. The 10-minute DVR buffer lets playback resume in place
// after buffering or a dropped connection.
//
// Channels come from the server's /api/channels endpoint - the client only ever
// sees an opaque `key` plus display metadata, never provider hosts or
// credentials (those stay server-side in server/channels.js so they don't leak
// into this public client bundle). The server resolves the key to credentials
// for the HLS and health routes.
const streamUrlForKey = (key) => `${apiBase()}/hls/${encodeURIComponent(key)}/index.m3u8?profile=auto`;

const STATUS_STYLES = {
  ONLINE: { badge: "bg-green-900 text-green-400", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
  DEGRADED: { badge: "bg-yellow-900 text-yellow-400", card: "bg-[#1a1a1a] border-yellow-800 hover:border-yellow-600" },
  OFFLINE: { badge: "bg-red-900 text-red-400", card: "bg-[#111] border-red-950 hover:border-red-800" },
  UNKNOWN: { badge: "bg-gray-800 text-gray-400", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
  CHECKING: { badge: "bg-blue-900 text-blue-300", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
  READY: { badge: "bg-green-900 text-green-400", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
};

const StreamSidebar = ({ isOpen, onClose, race, isArchive, onPlay }) => {
  const [channels, setChannels] = useState([]);
  const [health, setHealth] = useState({});
  const [isChecking, setIsChecking] = useState(false);
  const checkRun = useRef(0);

  const isPast = !!isArchive;

  // Load the channel list (metadata only) from the server
  useEffect(() => {
    fetch(`${apiBase()}/api/channels`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => Array.isArray(data) && setChannels(data))
      .catch(() => setChannels([]));
  }, []);

  // Check every channel in parallel; each card updates as soon as its own
  // result arrives instead of waiting for the slowest provider.
  const checkAll = async (list) => {
    const run = ++checkRun.current;
    setIsChecking(true);
    setHealth(Object.fromEntries(list.map(c => [c.key, { status: 'CHECKING' }])));
    await Promise.allSettled(list.map(async (channel) => {
      let result;
      try {
        const res = await fetch(`${apiBase()}/api/stream-health?key=${encodeURIComponent(channel.key)}&probe=1`, {
          signal: AbortSignal.timeout(45000)
        });
        result = res.ok ? await res.json() : { status: 'UNKNOWN', reason: `Health API returned ${res.status}` };
      } catch (err) {
        result = { status: 'UNKNOWN', reason: err.name === 'TimeoutError' ? 'Check timed out' : 'Backend not reachable' };
      }
      if (checkRun.current === run) setHealth(prev => ({ ...prev, [channel.key]: result }));
    }));
    if (checkRun.current === run) setIsChecking(false);
  };

  // Run a check automatically whenever the live sidebar opens (and channels are loaded)
  useEffect(() => {
    if (!isOpen || isPast || !channels.length) return;
    const id = setTimeout(() => checkAll(channels), 0);
    return () => clearTimeout(id);
  }, [isOpen, isPast, channels]);

  // Early return AFTER all hooks
  if (!isOpen) return null;

  const archiveStreams = [
    { key: 'archive-full', title: "Full Race Replay", source: "Archive", quality: "1080p", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls" },
    { key: 'archive-highlights', title: "Race Highlights", source: "Archive", quality: "720p", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls" },
  ];

  const liveStreams = channels.map(c => ({
    key: c.key,
    title: c.title,
    source: c.english ? 'English commentary' : 'Live feed',
    quality: c.quality,
    url: streamUrlForKey(c.key),
    type: 'hls-live',
  }));

  const streamsToShow = isPast ? archiveStreams : liveStreams;

  return (
    <div className="fixed inset-0 z-[60] sidebar-backdrop flex justify-end">
      <div className="w-full md:max-w-md bg-[#101010] h-full border-l border-[#333] shadow-2xl animate-slide-in flex flex-col">
        <div className="p-5 border-b border-[#333] flex justify-between items-center bg-[#151515]">
          <div>
            <h2 className="font-bold text-white text-lg">
              {isPast ? "Race Archive" : "Live Feeds"}
            </h2>
            <p className="text-xs text-gray-400">{race?.raceName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#333] rounded-full text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-3">
          <div className="bg-blue-900/20 border border-blue-800 p-3 rounded text-xs text-blue-200 flex gap-2 justify-between items-center">
            <div className="flex gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <p>
                {isPast
                  ? "Archives sourced from f1live.dpdns.org"
                  : isChecking
                    ? "Checking every feed (account, signal and resolution)..."
                    : "Live UK Sky Sports F1 stream with English commentary"}
              </p>
            </div>
            {!isPast && (
              <button
                onClick={() => checkAll(channels)}
                disabled={isChecking}
                className="flex items-center gap-1 px-2 py-1 bg-blue-800/50 hover:bg-blue-700/50 rounded text-[10px] font-medium transition-colors disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                {isChecking ? 'Checking...' : 'Check Status'}
              </button>
            )}
          </div>

          {streamsToShow.map(s => {
            const h = isPast ? { status: 'READY' } : (health[s.key] || { status: 'UNKNOWN' });
            const style = STATUS_STYLES[h.status] || STATUS_STYLES.UNKNOWN;
            const src = h.source;

            return (
              <button
                key={s.key}
                onClick={() => onPlay(s)}
                className={`w-full text-left p-4 rounded border transition-all group cursor-pointer ${style.card}`}
              >
                <div className="flex justify-between items-start mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isPast ? <Film className="w-4 h-4 text-gray-400 shrink-0" /> : <Tv className="w-4 h-4 text-gray-400 shrink-0" />}
                    <span className={`font-bold truncate ${h.status === 'OFFLINE' ? "text-gray-400" : "text-white"}`}>{s.title}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 flex items-center gap-1 ${style.badge}`}>
                    {h.status === 'CHECKING' && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                    {h.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 font-mono">
                  <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {s.source}</span>
                  <span className="flex items-center gap-1"><Signal className="w-3 h-3" /> {s.quality}</span>
                  {src?.height && (
                    <span className="flex items-center gap-1" title="Resolution the provider is sending right now">
                      <Monitor className="w-3 h-3" /> Source {src.width}×{src.height}{src.fps ? `@${src.fps}` : ''} {src.codec?.toUpperCase()}
                    </span>
                  )}
                  {h.latencyMs != null && <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {h.latencyMs}ms</span>}
                </div>
                {!isPast && (h.reason || h.account) && (
                  <div className="mt-2 text-[11px] text-gray-500 flex flex-wrap gap-x-3">
                    {h.reason && <span className={h.status === 'ONLINE' ? 'text-gray-500' : 'text-yellow-500/80'}>{h.reason}</span>}
                    {h.account?.expiry && <span>Expires {h.account.expiry}</span>}
                    {h.account?.maxConnections && <span>Connections {h.account.activeConnections}/{h.account.maxConnections}</span>}
                  </div>
                )}
                {!isPast && h.status === 'OFFLINE' && (
                  <div className="mt-2 text-[11px] text-gray-400">Tap to try anyway</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1" onClick={onClose}></div>
    </div>
  );
};

const PlayerModal = ({ stream, onClose }) => {
  if (!stream) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col animate-fade-in">
      <div className="flex items-center justify-between p-4 bg-[#101010] border-b border-[#333]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {stream.type !== 'youtube' && <div className="live-indicator"></div>}
            <span className="text-[#ff1801] font-bold text-xs md:text-sm tracking-wider">
              {stream.type === 'youtube' ? 'HIGHLIGHTS' : 'LIVE'}
            </span>
          </div>
          <div className="w-px h-4 bg-[#333]"></div>
          <span className="text-white font-bold truncate max-w-[200px] md:max-w-none">{stream.title}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white hover:bg-[#333] p-2 rounded-full transition-all">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="flex-1 relative flex items-center justify-center bg-black">
        <div className="w-full max-w-6xl aspect-video bg-black shadow-2xl border border-[#222]">
          <VideoPlayer key={stream.url} src={stream.url} type={stream.type} />
        </div>
      </div>
    </div>
  );
};

// Re-render on an interval so session states (upcoming -> live -> done) update
const useNow = (intervalMs) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

const App = () => {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStream, setActiveStream] = useState(null);
  const [selectedRace, setSelectedRace] = useState(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [officialSessions, setOfficialSessions] = useState([]);
  const [feed, setFeed] = useState(null);
  const now = useNow(5000);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Primary: Try Ergast/Jolpica (Standard API)
        const year = 2026;
        const res = await fetch(`https://api.jolpi.ca/ergast/f1/${year}.json`);
        if (res.ok) {
          const data = await res.json();
          const racesData = data.MRData.RaceTable.Races;
          if (racesData && racesData.length > 0) {
            console.log("Using Jolpica API Data");
            setRaces(racesData);
            return;
          }
        }

        // Fallback 1: Sportstimes GitHub (Community Maintained Real-Time Data)
        console.log("Fetching from Sportstimes GitHub...");
        const stRes = await fetch("https://raw.githubusercontent.com/sportstimes/f1/main/_db/f1/2026.json");
        if (!stRes.ok) throw new Error("Sportstimes API failed");

        const stData = await stRes.json();
        const racesArray = stData.races || stData;

        if (!racesArray || !Array.isArray(racesArray)) throw new Error("Invalid API response format");

        const session = (iso) => (iso ? { date: iso.split('T')[0], time: iso.split('T')[1] } : undefined);
        const mappedRaces = racesArray.map(r => ({
          round: String(r.round),
          raceName: `${r.name} Grand Prix`,
          date: r.sessions.gp.split('T')[0],
          time: r.sessions.gp.split('T')[1],
          season: "2026",
          FirstPractice: session(r.sessions.fp1),
          SecondPractice: session(r.sessions.fp2),
          ThirdPractice: session(r.sessions.fp3),
          SprintQualifying: session(r.sessions.sprintQualifying),
          Sprint: session(r.sessions.sprint),
          Qualifying: session(r.sessions.qualifying),
          Circuit: {
            circuitId: r.slug,
            Location: {
              locality: r.location,
              country: r.name
            }
          }
        })).sort((a, b) => Number(a.round) - Number(b.round));

        console.log("Using Sportstimes Live Data");
        setRaces(mappedRaces);

      } catch (e) {
        console.error("All APIs failed:", e);
        // Emergency Fallback: Empty array to show error state instead of mock data
        setRaces([]);

      } finally {
        setLoading(false);
      }
    };
    fetchData();

    // Official session start/end times for every session (incl. practice)
    fetch('https://api.openf1.org/v1/sessions?year=2026')
      .then(res => (res.ok ? res.json() : []))
      .then(data => Array.isArray(data) && setOfficialSessions(data))
      .catch(err => console.warn("OpenF1 sessions unavailable, using default durations", err));
  }, []);

  // Live session status from the F1 live timing feed (via our server)
  useEffect(() => {
    let cancelled = false;
    const poll = () => fetch(`${apiBase()}/api/live/status`, { signal: AbortSignal.timeout(10000) })
      .then(res => (res.ok ? res.json() : null))
      .then(data => !cancelled && setFeed(data))
      .catch(() => !cancelled && setFeed(null));
    poll();
    const id = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const weekends = useMemo(
    () => races.map(race => ({ race, state: weekendState(race, officialSessions, now, feed) })),
    [races, officialSessions, now, feed]
  );

  // Hero = the first weekend that isn't fully finished. A race whose start
  // time has passed stays here (LIVE) until the feed says it has ended.
  const hero = useMemo(
    () => weekends.find(w => !w.state.finished) || weekends[weekends.length - 1],
    [weekends]
  );

  const openStreamMenu = (item) => {
    setSelectedRace(item);
    setSidebarOpen(true);
  };

  const playStream = (stream) => {
    setSidebarOpen(false);
    setActiveStream(stream);
  };

  const playHighlights = (race) => {
    // Open YouTube search results for the specific race highlights
    const query = `F1 ${race.season} ${race.raceName} Highlights`;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
  };

  const selectedWeekend = weekends.find(w => w.race === selectedRace);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-[#ff1801] border-t-transparent rounded-full animate-spin"></div>
        <div className="text-white font-bold tracking-widest">LOADING DATA</div>
      </div>
    </div>
  );

  return (
    <>
      <GlobalStyles />
      <div className="min-h-screen pb-20 bg-black">
        <Navbar />

        <main className="pt-24 px-4 md:px-6 max-w-7xl mx-auto">
          {hero && <Hero race={hero.race} weekend={hero.state} feed={feed} onWatch={openStreamMenu} />}

          <DriverStandings />

          <div className="flex items-center justify-between mb-6 border-b border-[#333] pb-4">
            <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 md:w-6 md:h-6 text-[#ff1801]" /> Season Calendar
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {weekends.map(({ race, state }) => (
              <RaceCard
                key={race.round}
                race={race}
                isPast={state.finished}
                onWatch={openStreamMenu}
                onHighlights={playHighlights}
              />
            ))}
          </div>
        </main>

        <StreamSidebar
          isOpen={isSidebarOpen}
          onClose={() => setSidebarOpen(false)}
          race={selectedRace}
          isArchive={selectedWeekend?.state.finished}
          onPlay={playStream}
        />

        <PlayerModal
          stream={activeStream}
          onClose={() => setActiveStream(null)}
        />
      </div>
    </>
  );
};

export default App;
