import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, MapPin, Play, Clock, Trophy, Tv, AlertCircle, X, RefreshCw, Server, ChevronRight, Signal, Battery, Info, History, Film, Timer, BarChart3, Youtube, Users } from 'lucide-react';
import mpegts from 'mpegts.js';

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

// --- Video Player Component ---
const VideoPlayer = ({ src, type }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Handle MPEG-TS streams with mpegts.js
  const mpegtsPlayerRef = useRef(null);

  useEffect(() => {
    if (type !== 'mpegts' || !videoRef.current) return;

    const video = videoRef.current;

    // Check if mpegts.js is supported
    if (!mpegts.isSupported()) {
      setError('MPEG-TS playback is not supported in this browser');
      setLoading(false);
      return;
    }

    console.log('Initializing mpegts.js player with source:', src);

    // Destroy previous player if exists
    if (mpegtsPlayerRef.current) {
      mpegtsPlayerRef.current.destroy();
      mpegtsPlayerRef.current = null;
    }

    // Create mpegts.js player with optimized live streaming config
    const player = mpegts.createPlayer({
      type: 'mpegts',
      url: src,
      isLive: true,
      enableStashBuffer: false,
      stashInitialSize: 128,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 3,
      liveBufferLatencyMinRemain: 0.3
    }, {
      enableWorker: false,
      enableStashBuffer: false,
      autoCleanupSourceBuffer: true
    });

    mpegtsPlayerRef.current = player;

    // Attach to video element
    player.attachMediaElement(video);

    // Event listeners
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log('MPEG-TS loading complete');
    });

    player.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
      console.log('MPEG-TS media info:', mediaInfo);
      setLoading(false);
    });

    player.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
      console.error('MPEG-TS error:', { errorType, errorDetail, errorInfo });
      console.error('Stream URL:', src);
      setError(`Stream error: ${errorType} (${errorDetail}). Check server logs for details.`);
      setLoading(false);
    });

    // Load and play
    player.load();
    player.play().catch(e => {
      console.log('Autoplay prevented:', e);
    });

    // Cleanup
    return () => {
      if (mpegtsPlayerRef.current) {
        mpegtsPlayerRef.current.destroy();
        mpegtsPlayerRef.current = null;
      }
    };
  }, [src, type]);

  if (type === 'mpegts') {
    return (
      <div className="relative w-full h-full bg-black">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
            <div className="text-center">
              <RefreshCw className="w-12 h-12 text-[#ff1801] animate-spin mx-auto mb-4" />
              <p className="text-white text-sm">Loading stream...</p>
              <p className="text-gray-400 text-xs mt-2">Connecting to stream server...</p>
            </div>
          </div>
        )}
        <video
          ref={videoRef}
          controls
          autoPlay
          className="w-full h-full bg-black object-contain"
          playsInline
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="text-center p-8">
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <p className="text-white text-lg mb-2">Stream Error</p>
              <p className="text-gray-400 text-sm">{error}</p>
              <p className="text-gray-500 text-xs mt-4">Check server logs for details</p>
            </div>
          </div>
        )}
      </div>
    );
  }

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

  // HLS Player Logic with improved error handling
  useEffect(() => {
    const video = videoRef.current;
    if (!video || type === 'youtube' || !src) return;

    setLoading(true);
    setError(null);

    const loadHls = async () => {
      try {
        // Check if browser has native HLS support (Safari, iOS)
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('Using native HLS support');
          video.src = src;
          video.addEventListener('loadeddata', () => setLoading(false));
          video.addEventListener('error', (e) => {
            console.error('Native HLS error:', e);
            setError('Failed to load stream. Please try another quality.');
            setLoading(false);
          });
        } else {
          // Load HLS.js for other browsers
          if (!window.Hls) {
            console.log('Loading HLS.js library...');
            const script = document.createElement('script');
            script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
            script.async = true;
            script.onload = () => {
              console.log('HLS.js loaded successfully');
              initHls(video);
            };
            script.onerror = () => {
              setError('Failed to load video player library');
              setLoading(false);
            };
            document.body.appendChild(script);
          } else {
            initHls(video);
          }
        }
      } catch (err) {
        console.error('HLS loading error:', err);
        setError('Error initializing video player');
        setLoading(false);
      }
    };

    const initHls = (videoEl) => {
      if (!window.Hls.isSupported()) {
        setError('HLS is not supported in this browser');
        setLoading(false);
        return;
      }

      console.log('Initializing HLS.js with source:', src);

      // Clean up previous HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new window.Hls({
        debug: true,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        xhrSetup: function (xhr) {
          // Add custom headers for Xstream token URLs
          // Note: User-Agent can't be set in browser XMLHttpRequest due to security restrictions
          // The browser will send its default User-Agent
          xhr.withCredentials = false;  // Set to false to avoid CORS preflight
        },
      });

      hlsRef.current = hls;

      hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        console.log('Video element attached to HLS');
      });

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        console.log('Manifest parsed, starting playback');
        setLoading(false);
        videoEl.play().catch(e => {
          console.log('Autoplay prevented:', e);
        });
      });

      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        console.error('HLS Error:', data);
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error, attempting to recover...');
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, attempting to recover...');
              hls.recoverMediaError();
              break;
            default:
              setError('Fatal error: Unable to play stream. Please try another channel.');
              setLoading(false);
              hls.destroy();
              break;
          }
        }
      });

      hls.loadSource(src);
      hls.attachMedia(videoEl);
    };

    loadHls();

    // Cleanup function
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, type]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center p-8">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-white text-lg mb-2">Stream Error</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <p className="text-gray-500 text-xs mt-4">Check console for details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <div className="text-center">
            <RefreshCw className="w-12 h-12 text-[#ff1801] animate-spin mx-auto mb-4" />
            <p className="text-white text-sm">Loading stream...</p>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        controls
        autoPlay
        className="w-full h-full bg-black object-contain"
        playsInline
        onCanPlay={() => setLoading(false)}
      />
    </div>
  );
};

// --- Driver Standings Component ---
const DriverStandings = () => {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://api.jolpi.ca/ergast/f1/current/driverStandings.json')
      .then(res => res.json())
      .then(data => {
        setStandings(data.MRData.StandingsTable.StandingsLists[0]?.DriverStandings.slice(0, 5) || []);
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
        <div className="text-xs text-gray-500 font-mono">LIVE DATA</div>
      </div>

      <div className="bg-[#151515] border border-[#333] rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[600px] md:min-w-0">
          <thead>
            <tr className="bg-[#1a1a1a] text-xs uppercase text-gray-400 border-b border-[#333]">
              <th className="p-4 font-bold">Pos</th>
              <th className="p-4 font-bold">Driver</th>
              <th className="p-4 font-bold">Constructor</th>
              <th className="p-4 font-bold text-right">Wins</th>
              <th className="p-4 font-bold text-right">Points</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {standings.map((driver) => (
              <tr key={driver.position} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="p-4 font-mono text-[#ff1801] font-bold">{driver.position}</td>
                <td className="p-4 font-bold text-white flex items-center gap-2">
                  <span className={`flag-icon flag-icon-${driver.Driver.nationality.toLowerCase()}`}></span>
                  {driver.Driver.givenName} {driver.Driver.familyName}
                </td>
                <td className="p-4 text-gray-400">{driver.Constructors[0].name}</td>
                <td className="p-4 text-right font-mono text-gray-500">{driver.wins}</td>
                <td className="p-4 text-right font-bold text-white font-mono text-lg">{driver.points}</td>
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
  const [time, setTime] = useState({ d: 0, h: 0, m: 0, s: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const diff = new Date(date) - now;
      if (diff < 0) return clearInterval(interval);

      setTime({
        d: Math.floor(diff / (1000 * 60 * 60 * 24)),
        h: Math.floor((diff / (1000 * 60 * 60)) % 24),
        m: Math.floor((diff / 1000 / 60) % 60),
        s: Math.floor((diff / 1000) % 60),
      });
    }, 1000);
    return () => clearInterval(interval);
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

const SessionList = ({ race }) => {
  if (!race) return null;

  const formatSession = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return "TBA";
    const d = new Date(`${dateStr}T${timeStr}`);
    return {
      day: d.toLocaleDateString(undefined, { weekday: 'short' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    };
  };

  const sessions = [
    { name: "Qualifying", ...formatSession(race.Qualifying?.date, race.Qualifying?.time), active: false },
    { name: "Race", ...formatSession(race.date, race.time), active: true },
  ].filter(s => s.day !== "TBA");

  return (
    <div className="mt-4 bg-black/40 rounded-lg p-3 border border-[#333]">
      <h4 className="text-xs font-bold uppercase text-gray-400 mb-2 flex items-center gap-2">
        <Timer className="w-3 h-3" /> Schedule
      </h4>
      <div className="space-y-1">
        {sessions.map((session, idx) => (
          <div key={idx} className={`session-row text-sm ${session.active ? 'text-white font-bold' : 'text-gray-400'}`}>
            <span>{session.name}</span>
            <div className="flex gap-2 font-mono text-xs items-center">
              <span className="text-[#ff1801]">{session.day}</span>
              <span>{session.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Hero = ({ race, onWatch }) => {
  if (!race) return null;
  return (
    <section className="relative rounded-2xl overflow-hidden border border-[#333] bg-[#101010] mb-8 md:mb-12 shadow-2xl grid grid-cols-1 lg:grid-cols-12 flex flex-col lg:flex-row">
      <div className="absolute inset-0 lg:col-span-12 bg-[url('https://media.formula1.com/image/upload/f_auto,c_limit,w_1440,q_auto/f_auto/q_auto/content/dam/fom-website/manual/Misc/2021-Master-Folder/F1%202021%20Generic/F1_Generic_01')] bg-cover bg-center opacity-20"></div>
      <div className="absolute inset-0 lg:col-span-12 bg-gradient-to-r from-black via-black/90 to-black/40"></div>

      {/* Left Content: Race Info (7 cols) */}
      <div className="relative z-10 p-6 md:p-10 lg:col-span-7 flex flex-col justify-center min-h-[300px]">
        <div className="flex items-center gap-2 text-[#ff1801] font-bold uppercase tracking-widest text-xs md:text-sm mb-3">
          <Trophy className="w-3 h-3 md:w-4 md:h-4" /> Next Grand Prix
        </div>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-white italic leading-none mb-4">
          {race.raceName.replace("Grand Prix", "")} <br />
          <span className="text-white text-stroke">GP</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3 md:gap-4 text-gray-400 text-base md:text-lg mb-6">
          <span className="flex items-center gap-2"><MapPin className="w-4 h-4 md:w-5 md:h-5" /> {race.Circuit.CircuitName}</span>
          <span className="flex items-center gap-2"><Calendar className="w-4 h-4 md:w-5 md:h-5" /> {new Date(race.date).toLocaleDateString()}</span>
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
          <CircuitMap circuitId={race.Circuit.circuitId} />

          <div className="mt-auto pt-4 md:pt-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest">Lights Out</h3>
              <span className="text-[#ff1801] text-xs font-mono">LOCAL TIME</span>
            </div>
            <RaceCountdown date={`${race.date}T${race.time}`} />
            <SessionList race={race} />
          </div>
        </div>
      </div>
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

const StreamSidebar = ({ isOpen, onClose, race, onPlay }) => {
  const [streamStatuses, setStreamStatuses] = useState({});
  const [isChecking, setIsChecking] = useState(false);

  // Calculate isPast before any conditional returns
  const isPast = race && new Date(`${race.date}T${race.time}`) < new Date();

  // useEffect must be called BEFORE any early returns (Rules of Hooks)
  useEffect(() => {
    if (!isOpen || isPast) return;
    // Health check triggered by button click
  }, [isOpen, isPast]);

  // Early return AFTER all hooks
  if (!isOpen) return null;

  // Parse stream credentials from URL for health check
  const parseStreamCredentials = (streamUrl) => {
    try {
      const url = new URL(streamUrl);
      const server = url.searchParams.get('server');
      const username = url.searchParams.get('username');
      const password = url.searchParams.get('password');
      const channelId = url.pathname.split('/').pop();
      return { server, username, password, channelId };
    } catch {
      return null;
    }
  };

  // Check stream health via backend API
  const checkStreamHealth = async (stream, credentials) => {
    try {
      const apiBase = import.meta.env.VITE_API_URL ||
        (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin);

      const params = new URLSearchParams({
        server: credentials.server,
        username: credentials.username,
        password: credentials.password,
        channelId: credentials.channelId
      });

      const response = await fetch(`${apiBase}/api/stream-health?${params}`, {
        signal: AbortSignal.timeout(12000)
      });
      const data = await response.json();
      return data.status || 'OFFLINE';
    } catch {
      return 'UNKNOWN';
    }
  };

  // Helper function to generate stream URL with custom provider
  // Using FFmpeg restream endpoint with mpegts.js
  const getStreamUrl = (channelId, server, username, password) => {
    // 1. Environment Variable (Best for Split Hosting: Render Backend + GH Pages Frontend)
    const envUrl = import.meta.env.VITE_API_URL;
    if (envUrl) {
      console.log(`[Stream] Using Configured API: ${envUrl}`);
      return `${envUrl}/restream/${channelId}?server=${encodeURIComponent(server)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    }

    // 2. Localhost Development (Use standard dev port 3001)
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
      const localUrl = 'http://localhost:3001';
      console.log(`[Stream] Using Local Dev API: ${localUrl}`);
      return `${localUrl}/restream/${channelId}?server=${encodeURIComponent(server)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    }

    // 3. Production / Self-Hosted (Ubuntu/Render Monolith)
    // Automatically uses the current domain and port (e.g. port 10000 or 3001)
    const originUrl = window.location.origin;
    console.log(`[Stream] Using Origin API: ${originUrl}`);
    return `${originUrl}/restream/${channelId}?server=${encodeURIComponent(server)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  };

  // Available F1 Channels from your Xstream provider
  // NOTE: Using mpegts type with mpegts.js library for playback
  // UK Sky Sports F1 channels with English commentary - tested and verified working
  // Multiple quality options and providers for maximum redundancy
  const liveStreams = [
    // Primary - Sky Sports F1 (Verified Working - Expires 2029!)
    {
      id: 135341,
      title: "DE: SKY SPORT F1 720P (Primary)",
      source: "vipwettbornwet.top",
      quality: "HD",
      bitrate: "Live",
      url: getStreamUrl(135341, "http://vipwettbornwet.top:8080", "VIP0199169358094917", "21693580949"),
      status: "ONLINE",
      type: "mpegts"
    },

    // Backup 1 - UK Sky Sports F1 FHD (Verified - Expires 2026-10-22)
    {
      id: 53704,
      title: "UK: Sky Sports F1 FHD (Backup 1)",
      source: "tv14s.xyz",
      quality: "FHD",
      bitrate: "Live",
      url: getStreamUrl(53704, "http://tv14s.xyz:8080", "6dfDWF", "654188"),
      status: "ONLINE",
      type: "mpegts"
    },

    // Backup 2 - UK Sky Sports F1 UHD (Verified - Expires 2026-08-22)
    {
      id: 303265,
      title: "UK: Sky Sports F1 UHD (Backup 2)",
      source: "4kgood.org",
      quality: "UHD",
      bitrate: "Live",
      url: getStreamUrl(303265, "http://4kgood.org:8080", "9680723188", "kyft6ks0g7gr7uw0xio6"),
      status: "ONLINE",
      type: "mpegts"
    },

    // Backup 3 - F1 Alternative (Verified - Expires 2026-09-05)
    {
      id: 775856,
      title: "F1 Alternative (Backup 3)",
      source: "birdkick.xyz",
      quality: "HD",
      bitrate: "Live",
      url: getStreamUrl(775856, "http://birdkick.xyz:83", "buddy182", "6LkRAfUHhC"),
      status: "ONLINE",
      type: "mpegts"
    }
  ];

  const archiveStreams = [
    { id: 101, title: "Full Race Replay", source: "Archive", quality: "1080p", bitrate: "Archive", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "READY", type: "hls" },
    { id: 102, title: "Race Highlights", source: "Archive", quality: "720p", bitrate: "VOD", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "READY", type: "hls" },
  ];

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
                    ? "Checking stream status..."
                    : "Live UK Sky Sports F1 stream with English commentary"}
              </p>
            </div>
            {!isPast && (
              <button
                onClick={async () => {
                  setIsChecking(true);
                  const newStatuses = {};
                  for (const stream of liveStreams) {
                    const creds = parseStreamCredentials(stream.url);
                    if (creds) {
                      newStatuses[stream.id] = await checkStreamHealth(stream, creds);
                    }
                  }
                  setStreamStatuses(newStatuses);
                  setIsChecking(false);
                }}
                disabled={isChecking}
                className="flex items-center gap-1 px-2 py-1 bg-blue-800/50 hover:bg-blue-700/50 rounded text-[10px] font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                {isChecking ? 'Checking...' : 'Check Status'}
              </button>
            )}
          </div>

          {streamsToShow.map(s => {
            // Use real-time status if available, otherwise use default
            const realStatus = streamStatuses[s.id] || s.status;
            const isOnline = realStatus === 'ONLINE' || realStatus === 'READY';
            const isDegraded = realStatus === 'DEGRADED';

            return (
              <button
                key={s.id}
                onClick={() => isOnline && onPlay(s)}
                disabled={!isOnline && !isDegraded}
                className={`w-full text-left p-4 rounded border transition-all group ${isOnline ? "bg-[#1a1a1a] border-[#333] hover:border-[#ff1801] cursor-pointer" :
                  isDegraded ? "bg-[#1a1a1a] border-yellow-800 hover:border-yellow-600 cursor-pointer" :
                    "bg-[#111] border-[#222] opacity-50 cursor-not-allowed"
                  }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    {isPast ? <Film className="w-4 h-4 text-gray-400" /> : <Tv className="w-4 h-4 text-gray-400" />}
                    <span className={`font-bold ${isOnline || isDegraded ? "text-white" : "text-gray-500"}`}>{s.title}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isOnline ? "bg-green-900 text-green-400" :
                    isDegraded ? "bg-yellow-900 text-yellow-400" :
                      "bg-red-900 text-red-400"
                    }`}>{realStatus}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
                  <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {s.source}</span>
                  <span className="flex items-center gap-1"><Signal className="w-3 h-3" /> {s.quality}</span>
                </div>
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
          <VideoPlayer src={stream.url} type={stream.type} />
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStream, setActiveStream] = useState(null);
  const [selectedRace, setSelectedRace] = useState(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);

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

        const mappedRaces = racesArray.map(r => ({
          round: String(r.round),
          raceName: `${r.name} Grand Prix`,
          date: r.sessions.gp.split('T')[0],
          time: r.sessions.gp.split('T')[1],
          season: "2026",
          Qualifying: {
            date: r.sessions.qualifying ? r.sessions.qualifying.split('T')[0] : null,
            time: r.sessions.qualifying ? r.sessions.qualifying.split('T')[1].replace('Z', '') : null
          },
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
  }, []);

  const nextRace = useMemo(() => {
    const now = new Date();
    return races.find(r => new Date(`${r.date}T${r.time}`) > now) || races[races.length - 1];
  }, [races]);

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
          <Hero race={nextRace} onWatch={openStreamMenu} />

          <DriverStandings />

          <div className="flex items-center justify-between mb-6 border-b border-[#333] pb-4">
            <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 md:w-6 md:h-6 text-[#ff1801]" /> Season Calendar
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {races.map((race) => (
              <RaceCard
                key={race.round}
                race={race}
                isPast={new Date(`${race.date}T${race.time}`) < new Date()}
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