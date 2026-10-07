import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Calendar, MapPin, Play, Pause, Trophy, Tv, AlertCircle, X, RefreshCw, Server, Signal, Info, Film, Timer, BarChart3, Youtube, Users, CheckCircle2, Radio, Zap, Monitor, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2, ChevronDown, PanelRightOpen, PanelRightClose, Activity, Settings } from 'lucide-react';
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
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-black/80 border border-[#333] rounded-full px-3 py-1.5 text-xs text-white whitespace-nowrap">
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
const formatDuration = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

const ControlButton = ({ onClick, title, children, active }) => (
  <button onClick={onClick} title={title} aria-label={title}
    className={`p-2 rounded-full transition-colors ${active ? 'text-[#ff1801]' : 'text-white/90 hover:text-white'} hover:bg-white/10`}>
    {children}
  </button>
);

const StatRow = ({ label, value }) => (
  <div className="flex justify-between gap-6"><span className="text-gray-500">{label}</span><span className="text-gray-200">{value}</span></div>
);

const HlsPlayer = ({ src, live }) => {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimer = useRef(null);
  // Our server's media playlists don't declare codecs/bitrate, so measure them
  const mediaInfoRef = useRef({ codecs: '', bitrate: 0 });
  const [status, setStatus] = useState(() =>
    Hls.isSupported() || document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
      ? { phase: 'loading' }
      : { phase: 'error', detail: 'HLS is not supported in this browser' });
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [timeline, setTimeline] = useState({ start: 0, end: 0, current: 0, buffered: 0 });
  const [stats, setStats] = useState(null);
  const [hover, setHover] = useState(null); // seek bar hover { pct, time }
  const [levels, setLevels] = useState([]);          // ABR renditions from the master playlist
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [manualLevel, setManualLevel] = useState(-1); // -1 = Auto
  const [qualityOpen, setQualityOpen] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);
  // Set when the viewer deliberately rewinds into the DVR window; suppresses
  // the automatic catch-up so we don't fight them.
  const userRewoundRef = useRef(false);

  // --- Playback engine (hls.js with resume-in-place recovery) ---
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
        // Adaptive bitrate: pick the rendition from measured bandwidth with
        // headroom, so a viewer whose connection drops below the top bitrate
        // switches to a lighter 1080p rendition instead of stalling.
        startLevel: -1,
        abrEwmaDefaultEstimate: 4_000_000,
        abrBandWidthFactor: 0.8,     // use 80% of measured bandwidth when switching down/staying
        abrBandWidthUpFactor: 0.6,   // be cautious stepping up
        abrMaxWithRealBitrate: true,
        capLevelToPlayerSize: false, // keep 1080p even in the 70% split view
        testBandwidth: true,
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
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setLevels(data.levels.map((l, i) => ({ index: i, height: l.height, bitrate: l.bitrate, fps: l.frameRate })));
        video.play().catch(() => { });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, { level }) => setCurrentLevel(level));
      hls.on(Hls.Events.BUFFER_CODECS, (_e, data) => {
        mediaInfoRef.current.codecs = [data.video?.codec, data.audio?.codec].filter(Boolean).join(' / ');
      });
      hls.on(Hls.Events.FRAG_LOADED, (_e, { frag }) => {
        const bytes = frag.stats?.total || frag.stats?.loaded;
        if (bytes && frag.duration) mediaInfoRef.current.bitrate = (bytes * 8) / frag.duration;
      });
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

  // --- UI state: timeline, stats, play/volume/fullscreen sync ---
  useEffect(() => {
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      const hls = hlsRef.current;
      const seek = v.seekable;
      const start = seek.length ? seek.start(0) : 0;
      const seekEnd = seek.length ? seek.end(seek.length - 1) : (Number.isFinite(v.duration) ? v.duration : 0);
      const end = Math.max(live ? (hls?.liveSyncPosition ?? seekEnd) : seekEnd, v.currentTime);
      let bufferedEnd = v.currentTime;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) bufferedEnd = v.buffered.end(i);
      }
      setTimeline({ start, end, current: v.currentTime, buffered: bufferedEnd });

      // Live catch-up (end = hls.js live sync position, ~8s behind the edge)
      if (live && hls && !v.paused) {
        const behind = Math.max(0, end - v.currentTime);
        const ahead = bufferedEnd - v.currentTime;
        if (userRewoundRef.current && behind < 3) userRewoundRef.current = false;
        if (!userRewoundRef.current && behind > 60) {
          v.currentTime = end; // long outage: rejoin live
          v.playbackRate = 1;
        } else if (!userRewoundRef.current && behind > 6 && ahead > 4) {
          if (v.playbackRate !== 1.08) v.playbackRate = 1.08;
        } else if (v.playbackRate !== 1 && (behind < 1.5 || ahead < 2 || userRewoundRef.current)) {
          v.playbackRate = 1;
        }
        setCatchingUp(v.playbackRate > 1);
      }
      const quality = v.getVideoPlaybackQuality?.();
      const level = hls?.levels?.[hls.currentLevel >= 0 ? hls.currentLevel : 0];
      setStats({
        width: v.videoWidth,
        height: v.videoHeight,
        buffer: Math.max(0, bufferedEnd - v.currentTime),
        bandwidth: hls?.bandwidthEstimate || 0,
        bitrate: level?.bitrate || mediaInfoRef.current.bitrate,
        codecs: [level?.videoCodec, level?.audioCodec].filter(Boolean).join(' / ') || mediaInfoRef.current.codecs,
        dropped: quality?.droppedVideoFrames ?? 0,
        frames: quality?.totalVideoFrames ?? 0,
      });
    }, 500);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => { setPlaying(!v.paused); setMuted(v.muted); setVolume(v.volume); };
    const events = ['play', 'pause', 'playing', 'volumechange'];
    events.forEach(e => v.addEventListener(e, sync));
    const onFullscreen = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      events.forEach(e => v.removeEventListener(e, sync));
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // --- Actions ---
  const togglePlay = () => { const v = videoRef.current; if (v.paused) v.play().catch(() => { }); else v.pause(); };
  const toggleMute = () => { const v = videoRef.current; v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.5; };
  const changeVolume = (value) => { const v = videoRef.current; v.volume = value; v.muted = value === 0; };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    else containerRef.current?.requestFullscreen?.().catch(() => { });
  };
  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current.requestPictureInPicture();
    } catch { /* PiP unsupported */ }
  };
  const goLive = () => {
    const hls = hlsRef.current;
    userRewoundRef.current = false;
    if (hls?.liveSyncPosition) videoRef.current.currentTime = hls.liveSyncPosition;
    videoRef.current.play().catch(() => { });
  };
  const seekToPct = (pct) => {
    const { start, end } = timeline;
    if (end <= start) return;
    const target = start + pct * (end - start);
    userRewoundRef.current = end - target > 6; // deliberate rewind: don't auto catch up
    videoRef.current.currentTime = target;
  };
  // -1 = Auto (adaptive). A fixed rendition switches at the next segment.
  const selectLevel = (index) => {
    if (hlsRef.current) hlsRef.current.nextLevel = index;
    setManualLevel(index);
    setQualityOpen(false);
  };
  const showControls = () => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!videoRef.current?.paused) setControlsVisible(false); }, 3000);
  };

  // Keyboard shortcuts: Space/K play, M mute, F fullscreen, L go live, ←/→ seek 10s
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key.toLowerCase()) {
        case ' ': case 'k': e.preventDefault(); if (v.paused) v.play().catch(() => { }); else v.pause(); break;
        case 'm': v.muted = !v.muted; break;
        case 'f': if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else containerRef.current?.requestFullscreen?.().catch(() => { }); break;
        case 'l': userRewoundRef.current = false; if (hlsRef.current?.liveSyncPosition) v.currentTime = hlsRef.current.liveSyncPosition; break;
        case 'arrowleft': userRewoundRef.current = true; v.currentTime = Math.max(0, v.currentTime - 10); break;
        case 'arrowright': v.currentTime = v.currentTime + 10; break;
        default: return;
      }
      setControlsVisible(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Derived display values ---
  const { start, end, current, buffered } = timeline;
  const span = Math.max(end - start, 0.001);
  const playedPct = Math.min(100, Math.max(0, ((current - start) / span) * 100));
  const bufferedPct = Math.min(100, Math.max(0, ((buffered - start) / span) * 100));
  const behindLive = Math.max(0, end - current);
  const atLive = !live || behindLive < 8;
  const activeLevel = levels[currentLevel];
  const mbps = (bps) => `${(bps / 1e6).toFixed(1)} Mbps`;
  const levelLabel = (l) => `${l.height}p${l.fps && l.fps < 40 ? Math.round(l.fps) : ''} · ${mbps(l.bitrate)}`;
  const hideUi = !controlsVisible && playing;
  const resolution = stats?.height ? `${stats.height}p` : null;
  const ready = status.phase !== 'loading' && status.phase !== 'error';

  return (
    <div ref={containerRef}
      className={`relative w-full h-full bg-black select-none overflow-hidden ${hideUi ? 'cursor-none' : ''}`}
      onMouseMove={showControls} onMouseLeave={() => playing && setControlsVisible(false)}>
      <video ref={videoRef} autoPlay playsInline onClick={togglePlay} onDoubleClick={toggleFullscreen}
        className="w-full h-full bg-black object-contain" />
      <PlayerStatus status={status} />

      {/* Top bar: live state + quality */}
      {ready && (
        <div className={`absolute top-0 inset-x-0 flex items-start justify-between p-3 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${hideUi ? 'opacity-0' : 'opacity-100'}`}>
          {live ? (
            <button onClick={goLive} title="Jump to live (L)"
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold border tracking-wider ${atLive ? 'bg-[#ff1801] border-[#ff1801] text-white' : 'bg-black/70 border-white/20 text-gray-200 hover:border-[#ff1801]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${atLive ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />
              {atLive ? 'LIVE' : `-${formatDuration(behindLive)} · GO LIVE`}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            {catchingUp && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-black/70 border border-white/20 text-gray-200" title="Playing slightly faster to rejoin the live edge">
                CATCHING UP 1.08×
              </span>
            )}
            {resolution && (
              <span className={`text-[10px] font-black px-2 py-0.5 rounded tracking-wider ${stats.height >= 2160 ? 'bg-purple-600 text-white' : stats.height >= 1080 ? 'bg-white text-black' : 'bg-white/20 text-white'}`}>
                {stats.height >= 2160 ? '4K' : stats.height >= 1080 ? 'FHD' : 'HD'} · {resolution}{activeLevel ? ` · ${mbps(activeLevel.bitrate)}` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stats for nerds */}
      {showStats && stats && (
        <div className="absolute top-12 right-3 z-20 w-64 bg-black/85 backdrop-blur border border-white/10 rounded-lg p-3 text-[11px] font-mono space-y-1">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[#ff1801] font-bold tracking-wider">STREAM STATS</span>
            <button onClick={() => setShowStats(false)} className="text-gray-500 hover:text-white"><X className="w-3 h-3" /></button>
          </div>
          <StatRow label="Resolution" value={stats.width ? `${stats.width}×${stats.height}` : '—'} />
          {levels.length > 1 && (
            <StatRow label="Rendition" value={`${manualLevel === -1 ? 'Auto' : 'Fixed'} · ${currentLevel + 1}/${levels.length}`} />
          )}
          <StatRow label="Codecs" value={stats.codecs || '—'} />
          <StatRow label="Stream bitrate" value={stats.bitrate ? `${(stats.bitrate / 1e6).toFixed(1)} Mbps` : '—'} />
          <StatRow label="Connection" value={stats.bandwidth ? `${(stats.bandwidth / 1e6).toFixed(1)} Mbps` : '—'} />
          <StatRow label="Buffer ahead" value={`${stats.buffer.toFixed(1)} s`} />
          {live && <StatRow label="Behind live" value={formatDuration(behindLive)} />}
          <StatRow label="DVR window" value={formatDuration(end - start)} />
          <StatRow label="Dropped frames" value={`${stats.dropped} / ${stats.frames}`} />
        </div>
      )}

      {/* Big play button when paused */}
      {ready && !playing && (
        <button onClick={togglePlay} aria-label="Play"
          className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-[#ff1801]/90 hover:bg-[#ff1801] flex items-center justify-center shadow-2xl shadow-red-900/40 transition-transform hover:scale-105">
          <Play className="w-9 h-9 text-white fill-current ml-1" />
        </button>
      )}

      {/* Bottom controls */}
      {ready && (
        <div className={`absolute bottom-0 inset-x-0 px-3 pb-2 pt-12 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 ${hideUi ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          {/* DVR / seek bar */}
          <div className="relative h-4 flex items-center cursor-pointer group/seek"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
              setHover({ pct, time: start + pct * span });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seekToPct(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
            }}>
            <div className="relative w-full h-1 group-hover/seek:h-1.5 transition-all bg-white/20 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufferedPct}%` }} />
              <div className="absolute inset-y-0 left-0 bg-[#ff1801]" style={{ width: `${playedPct}%` }} />
            </div>
            <div className="absolute w-3 h-3 rounded-full bg-[#ff1801] shadow -translate-x-1/2 scale-0 group-hover/seek:scale-100 transition-transform" style={{ left: `${playedPct}%` }} />
            {hover && (
              <div className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/90 border border-white/10 text-[10px] font-mono text-white whitespace-nowrap" style={{ left: `${hover.pct * 100}%` }}>
                {live ? (end - hover.time < 1 ? 'LIVE' : `-${formatDuration(end - hover.time)}`) : formatDuration(hover.time)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 mt-1">
            <ControlButton onClick={togglePlay} title={playing ? 'Pause (K)' : 'Play (K)'}>
              {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </ControlButton>
            <div className="flex items-center group/vol">
              <ControlButton onClick={toggleMute} title={muted ? 'Unmute (M)' : 'Mute (M)'}>
                {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </ControlButton>
              <div className="w-0 group-hover/vol:w-20 group-focus-within/vol:w-20 overflow-hidden transition-all duration-200 flex items-center">
                <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Volume"
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  className="w-20 accent-[#ff1801] cursor-pointer" />
              </div>
            </div>
            <span className="ml-2 text-xs font-mono text-gray-300 whitespace-nowrap">
              {live ? (atLive ? 'Live' : `-${formatDuration(behindLive)} behind live`) : `${formatDuration(current - start)} / ${formatDuration(end - start)}`}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {live && !atLive && (
                <button onClick={goLive} className="hidden sm:inline-flex mr-1 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap bg-[#ff1801] text-white hover:bg-[#cc0000]">GO LIVE</button>
              )}
              {levels.length > 1 && (
                <div className="relative">
                  <button onClick={() => setQualityOpen(v => !v)} title="Quality"
                    className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold text-white/90 hover:text-white hover:bg-white/10 whitespace-nowrap">
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">{manualLevel === -1 ? 'Auto' : `${levels[manualLevel]?.height}p`}</span>
                  </button>
                  {qualityOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-56 bg-black/90 backdrop-blur border border-white/10 rounded-lg py-1 text-xs z-20">
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-bold">Quality</div>
                      <button onClick={() => selectLevel(-1)}
                        className={`w-full flex justify-between px-3 py-1.5 hover:bg-white/10 ${manualLevel === -1 ? 'text-[#ff1801] font-bold' : 'text-gray-200'}`}>
                        <span>Auto</span>
                        <span className="text-gray-500 font-mono">{activeLevel ? levelLabel(activeLevel) : ''}</span>
                      </button>
                      {levels.map(l => (
                        <button key={l.index} onClick={() => selectLevel(l.index)}
                          className={`w-full flex justify-between px-3 py-1.5 hover:bg-white/10 font-mono ${manualLevel === l.index ? 'text-[#ff1801] font-bold' : 'text-gray-200'}`}>
                          <span>{levelLabel(l)}</span>
                          {currentLevel === l.index && <span className="text-[#ff1801]">●</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <ControlButton onClick={() => setShowStats(v => !v)} title="Stream stats" active={showStats}><BarChart3 className="w-5 h-5" /></ControlButton>
              {document.pictureInPictureEnabled && (
                <ControlButton onClick={togglePip} title="Picture in picture"><PictureInPicture2 className="w-5 h-5" /></ControlButton>
              )}
              <ControlButton onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
                {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </ControlButton>
            </div>
          </div>
        </div>
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

const Hero = ({ race, weekend, feed, onWatch, telemetryPaused }) => {
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
          {/* The player shows telemetry next to the feed; don't run two live connections */}
          {telemetryPaused
            ? <div className="h-24 flex items-center justify-center text-xs text-gray-500">Live telemetry is open in the player</div>
            : <LiveTelemetry />}
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
// The server picks the profile (adaptive bitrate ladder by default)
const streamUrlForKey = (key) => `${apiBase()}/hls/${encodeURIComponent(key)}/index.m3u8`;

// A playable stream object for a live channel from /api/channels
const streamForChannel = (c) => ({
  key: c.key,
  title: c.title,
  source: c.english ? 'English commentary' : 'Live feed',
  quality: c.quality,
  url: streamUrlForKey(c.key),
  type: 'hls-live',
});

const STATUS_STYLES = {
  ONLINE: { badge: "bg-green-900 text-green-400", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
  DEGRADED: { badge: "bg-yellow-900 text-yellow-400", card: "bg-[#1a1a1a] border-yellow-800 hover:border-yellow-600" },
  OFFLINE: { badge: "bg-red-900 text-red-400", card: "bg-[#111] border-red-950 hover:border-red-800" },
  UNKNOWN: { badge: "bg-gray-800 text-gray-400", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
  CHECKING: { badge: "bg-blue-900 text-blue-300", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
  READY: { badge: "bg-green-900 text-green-400", card: "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801]" },
};

const StreamSidebar = ({ isOpen, onClose, race, isArchive, channels, onPlay }) => {
  const [health, setHealth] = useState({});
  const [isChecking, setIsChecking] = useState(false);
  const checkRun = useRef(0);

  const isPast = !!isArchive;

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

  const liveStreams = channels.map(streamForChannel);

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

// Full-screen viewer. While an F1 session is live, the feed sits on the left
// (70%) with live telemetry on the right (30%); otherwise the feed is centred.
// The video element stays mounted when the layout changes, so toggling the
// telemetry panel never restarts the stream. Fullscreen (F) shows video only.
const PlayerModal = ({ stream, channels, liveSession, onSwitch, onClose }) => {
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!stream) return;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      if (e.key.toLowerCase() === 't') setShowTelemetry(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stream, onClose]);

  if (!stream) return null;

  const isLiveStream = stream.type === 'hls-live' || stream.type === 'mpegts';
  const canSplit = isLiveStream && !!liveSession;
  const split = canSplit && showTelemetry;
  const switchable = isLiveStream && channels.length > 1;

  return (
    <div className="fixed inset-0 z-[70] bg-[#050505] flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 md:px-4 h-14 bg-[#101010] border-b border-[#333] shrink-0">
        <button onClick={onClose} title="Close (Esc)" aria-label="Close player"
          className="p-2 -ml-1 rounded-full text-gray-400 hover:text-white hover:bg-[#333] transition-colors">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {stream.type !== 'youtube' && <div className="live-indicator" />}
          <span className="text-[#ff1801] font-bold text-xs tracking-wider">
            {stream.type === 'youtube' ? 'HIGHLIGHTS' : isLiveStream ? 'LIVE' : 'REPLAY'}
          </span>
        </div>
        <div className="w-px h-5 bg-[#333] shrink-0" />

        {/* Feed title + switcher */}
        <div className="relative min-w-0">
          <button onClick={() => switchable && setMenuOpen(v => !v)} disabled={!switchable}
            className={`flex items-center gap-2 min-w-0 rounded px-1 py-1 ${switchable ? 'hover:bg-white/5' : 'cursor-default'}`}>
            <span className="text-white font-bold truncate">{stream.title}</span>
            {stream.quality && <span className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#333] text-gray-400 shrink-0">{stream.quality}</span>}
            {switchable && <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-2 z-20 w-80 max-w-[90vw] max-h-[60vh] overflow-y-auto bg-[#151515] border border-[#333] rounded-lg shadow-2xl py-1">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-bold">Switch feed</div>
                {channels.map(c => (
                  <button key={c.key}
                    onClick={() => { setMenuOpen(false); if (c.key !== stream.key) onSwitch(streamForChannel(c)); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-white/5 ${c.key === stream.key ? 'text-[#ff1801] font-bold' : 'text-gray-200'}`}>
                    <Tv className="w-4 h-4 shrink-0 text-gray-500" />
                    <span className="truncate flex-1">{c.title}</span>
                    <span className="text-[10px] font-mono text-gray-500 shrink-0">{c.quality}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          {canSplit && (
            <>
              <span className="hidden md:flex items-center gap-1.5 text-xs text-gray-400">
                <Activity className="w-3.5 h-3.5 text-[#ff1801]" />
                {liveSession.name} {liveSession.replay ? 'replay' : 'live'}
              </span>
              <button onClick={() => setShowTelemetry(v => !v)} title="Toggle live telemetry (T)"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${showTelemetry ? 'bg-[#ff1801]/10 border-[#ff1801]/50 text-[#ff1801]' : 'border-[#333] text-gray-300 hover:border-gray-500'}`}>
                {showTelemetry ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                <span className="hidden sm:inline">Telemetry</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body: 70:30 split during a live session, centred feed otherwise */}
      <div className={`flex-1 min-h-0 flex ${split ? 'flex-col lg:flex-row overflow-y-auto lg:overflow-hidden' : 'items-center justify-center md:p-6'}`}>
        <div className={split
          ? 'w-full lg:w-[70%] aspect-video lg:aspect-auto lg:h-full bg-black shrink-0'
          : 'w-full max-w-6xl max-h-full aspect-video bg-black shadow-2xl md:border border-[#222] md:rounded-lg overflow-hidden'}>
          <VideoPlayer key={stream.url} src={stream.url} type={stream.type} />
        </div>
        {split && (
          <aside className="w-full lg:w-[30%] h-[75vh] lg:h-full shrink-0 border-t lg:border-t-0 lg:border-l border-[#333] bg-[#0b0b0b] overflow-hidden">
            <LiveTelemetry compact />
          </aside>
        )}
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
  const [channels, setChannels] = useState([]);
  const now = useNow(5000);

  // Live channel list (metadata only - credentials stay on the server)
  useEffect(() => {
    fetch(`${apiBase()}/api/channels`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => Array.isArray(data) && setChannels(data))
      .catch(() => setChannels([]));
  }, []);

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

  const closePlayer = useCallback(() => setActiveStream(null), []);

  // Session shown next to the video in the player (a live session, or a
  // server-side replay used for testing)
  const liveSession = hero?.state.live
    ? { name: hero.state.live.name }
    : feed?.source === 'replay' && feed.session ? { name: feed.session.name, replay: true } : null;

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
          {hero && <Hero race={hero.race} weekend={hero.state} feed={feed} onWatch={openStreamMenu} telemetryPaused={!!activeStream} />}

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
          channels={channels}
          onPlay={playStream}
        />

        <PlayerModal
          stream={activeStream}
          channels={channels}
          liveSession={liveSession}
          onSwitch={setActiveStream}
          onClose={closePlayer}
        />
      </div>
    </>
  );
};

export default App;
