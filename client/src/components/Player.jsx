import React, { memo, useState, useEffect, useRef } from 'react';
import { Play, Pause, AlertCircle, X, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2, ChevronDown, PanelRightOpen, PanelRightClose, Activity, Settings, BarChart3, Tv } from 'lucide-react';
import mpegts from 'mpegts.js';
import Hls from 'hls.js';
import LiveTelemetry from './LiveTelemetry';
import StartLights from './StartLights';
import { AnimatePresence, motion } from 'motion/react';
import { streamForChannel } from '../lib/streams';
import ChannelLogo from './ChannelLogo';
import { DESKTOP, LANDSCAPE_PHONE, useMedia } from '../lib/useMedia';

const PlayerStatus = ({ status }) => {
  if (!status || status.phase === 'playing') return null;
  if (status.phase === 'loading') {
    // The start lights cycle while the stream warms up
    return (
      <div className="absolute inset-0 z-10 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgb(31_31_41),rgb(0_0_0)_70%)]">
        <div className="text-center px-6">
          <StartLights loop className="justify-center" />
          <p className="mt-6 font-bold">Starting the stream</p>
          <p className="text-steel text-sm mt-1">{status.detail || 'Connecting to the stream server…'}</p>
        </div>
      </div>
    );
  }
  if (status.phase === 'error') {
    return (
      <div className="absolute inset-0 z-10 grid place-items-center bg-black">
        <div className="text-center p-8 max-w-md">
          <AlertCircle className="w-10 h-10 text-caution mx-auto mb-4" />
          <p className="text-lg font-bold mb-1">This stream can't play</p>
          <p className="text-steel text-sm">{status.detail}</p>
          <p className="text-steel text-sm mt-3">Close the player and pick another feed.</p>
        </div>
      </div>
    );
  }
  // Buffering / reconnecting: keep the video on screen, show a small chip
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 rounded-full border border-graphite bg-black/85 px-3.5 py-1.5 text-xs whitespace-nowrap">
      <StartLights loop size="sm" />
      <span className="font-semibold">{status.phase === 'reconnecting' ? `Reconnecting${status.attempt > 1 ? `, attempt ${status.attempt}` : ''}` : 'Buffering'}</span>
      {status.detail && <span className="text-steel hidden md:inline">{status.detail}</span>}
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

const ControlButton = ({ onClick, title, children, active, className = '' }) => (
  <button onClick={onClick} title={title} aria-label={title} aria-pressed={active}
    className={`${className} grid place-items-center w-10 h-10 shrink-0 rounded-full transition-[color,background-color,transform] duration-200 active:scale-90 ${active ? 'text-white bg-white/15' : 'text-chalk/85 hover:text-chalk hover:bg-white/10'}`}>
    {children}
  </button>
);

const StatRow = ({ label, value }) => (
  <div className="flex justify-between gap-6"><span className="text-steel">{label}</span><span className="tnum text-chalk">{value}</span></div>
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
  const lastDropAtRef = useRef(0);                     // last time frame drops were detected
  const [dropRate, setDropRate] = useState(0);         // dropped / decoded in the last window
  const [smoothCap, setSmoothCap] = useState(-1);      // rendition cap imposed for smoothness (-1 = none)
  const [smoothNotice, setSmoothNotice] = useState(null);

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
        // Sit 5 segments (~10 s) behind live: a bigger cushion absorbs
        // short bandwidth dips without stalling.
        liveSyncDurationCount: 5,
        liveDurationInfinity: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 90,
        backBufferLength: 600,
        // Adaptive bitrate: pick the rendition from measured bandwidth with
        // headroom, so a viewer whose connection drops below the top bitrate
        // switches to a lighter 1080p rendition instead of stalling.
        startLevel: -1,
        abrEwmaDefaultEstimate: 4_000_000,
        abrEwmaFastLive: 2,          // react to bandwidth drops within ~2 segments (default 3)
        abrEwmaSlowLive: 6,          // shorter memory of past good bandwidth (default 9)
        abrBandWidthFactor: 0.75,    // keep 25% headroom when choosing/keeping a rendition
        abrBandWidthUpFactor: 0.55,  // be cautious stepping up
        abrMaxWithRealBitrate: true,
        capLevelToPlayerSize: false, // keep 1080p even in the 70% split view
        testBandwidth: true,
        manifestLoadPolicy: HLS_LOAD_POLICY(30000, 30000, 12),
        playlistLoadPolicy: HLS_LOAD_POLICY(15000, 20000, 12),
        fragLoadPolicy: HLS_LOAD_POLICY(15000, 60000, 8),
      });
      hlsRef.current = hls;
      if (import.meta.env.DEV) window.__hls = hls; // debugging aid in `vite dev` only

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
        // Catching up costs ~8% more decoding; hold off while the device is
        // dropping frames so catch-up never causes stutter itself.
        const recentDrops = Date.now() - lastDropAtRef.current < 20000;
        if (!userRewoundRef.current && behind > 60) {
          v.currentTime = end; // long outage: rejoin live
          v.playbackRate = 1;
        } else if (!userRewoundRef.current && !recentDrops && behind > 6 && ahead > 4) {
          if (v.playbackRate !== 1.08) v.playbackRate = 1.08;
        } else if (v.playbackRate !== 1 && (behind < 1.5 || ahead < 2 || userRewoundRef.current || recentDrops)) {
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

  // --- Smoothness controller (dropped-frames rule) ---
  // Bandwidth-based ABR can't see when the *device* can't keep up: the video
  // downloads fine but the decoder/renderer drops frames. Like dash.js's
  // DroppedFramesRule, sample dropped/decoded frames and cap auto quality below
  // any rendition that stutters. Unlike hls.js's built-in capLevelOnFPSDrop
  // (one-way, never recovers), the cap is lifted again after a stable period,
  // with exponential backoff if the higher rendition stutters again.
  useEffect(() => {
    const SAMPLE_MS = 2000;
    const MIN_FRAMES = 90;        // ~2-4 s of video before judging
    const DROP_RATIO = 0.08;      // >8% dropped -> step down one rendition
    const SEVERE_RATIO = 0.2;     // >20% dropped -> go straight to the lightest
    const STABLE_RATIO = 0.03;    // average <3% over the stable period counts as smooth
    const s = {
      lastDropped: 0, lastDecoded: 0, winDropped: 0, winDecoded: 0,
      level: -2, ignoreUntil: Date.now() + 5000,
      cap: -1, stableSince: 0, stDropped: 0, stDecoded: 0, backoffMs: 45000, probing: null,
    };
    const applyCap = (hls, cap) => {
      s.cap = cap;
      hls.autoLevelCapping = cap;
      setSmoothCap(cap);
    };
    const onSeek = () => { s.ignoreUntil = Date.now() + 3000; s.winDropped = s.winDecoded = 0; };
    const video = videoRef.current;
    video?.addEventListener('seeking', onSeek);

    const id = setInterval(() => {
      const v = videoRef.current, hls = hlsRef.current;
      if (!v || !hls || !v.getVideoPlaybackQuality) return;
      const q = v.getVideoPlaybackQuality();
      const dropped = q.droppedVideoFrames - s.lastDropped;
      const decoded = q.totalVideoFrames - s.lastDecoded;
      s.lastDropped = q.droppedVideoFrames;
      s.lastDecoded = q.totalVideoFrames;
      const now = Date.now();

      // A rendition switch itself can drop a few frames: don't count it
      if (hls.currentLevel !== s.level) { s.level = hls.currentLevel; s.ignoreUntil = now + 3000; }
      // Hidden tabs drop frames by design; paused video decodes nothing
      if (v.paused || document.hidden || now < s.ignoreUntil || decoded <= 0 || dropped < 0) {
        s.winDropped = s.winDecoded = 0;
        return;
      }
      s.winDropped += dropped;
      s.winDecoded += decoded;
      if (s.winDecoded < MIN_FRAMES) return;
      const ratio = s.winDropped / s.winDecoded;
      const [winDropped, winDecoded] = [s.winDropped, s.winDecoded];
      s.winDropped = s.winDecoded = 0;
      setDropRate(ratio);

      if (!hls.autoLevelEnabled) return; // viewer picked a fixed rendition
      const level = hls.currentLevel;

      if (ratio > DROP_RATIO) {
        lastDropAtRef.current = now;
        if (v.playbackRate !== 1) v.playbackRate = 1;
        s.stableSince = 0;
        // A probe up that stutters again: wait longer before the next probe
        if (s.probing !== null && level >= s.probing) s.backoffMs = Math.min(s.backoffMs * 2, 8 * 60000);
        s.probing = null;
        if (level > 0) {
          // Prefer the best rendition with a lower frame rate than the one
          // that stutters (keeps bits per frame high); otherwise step down one.
          const fpsOf = (l) => hls.levels[l]?.frameRate || 50;
          let lowerFps = -1;
          for (let l = level - 1; l >= 0; l--) {
            if (fpsOf(l) < fpsOf(level)) { lowerFps = l; break; }
          }
          const target = lowerFps !== -1 ? lowerFps : ratio > SEVERE_RATIO ? 0 : level - 1;
          applyCap(hls, target);
          hls.nextLoadLevel = target; // next segment already at the lighter rendition
          setSmoothNotice(`Frame drops detected (${Math.round(ratio * 100)}%) - lowered quality for smooth playback`);
        }
        return;
      }

      // While capped, judge smoothness on the average over the whole stable
      // period (single noisy samples don't reset it); then probe one higher.
      if (s.cap !== -1) {
        if (!s.stableSince) { s.stableSince = now; s.stDropped = 0; s.stDecoded = 0; }
        s.stDropped += winDropped;
        s.stDecoded += winDecoded;
        if (now - s.stableSince >= s.backoffMs) {
          const smooth = s.stDropped / Math.max(1, s.stDecoded) < STABLE_RATIO;
          s.stableSince = 0;
          if (smooth) {
            const next = s.cap + 1;
            s.probing = next;
            applyCap(hls, next >= hls.levels.length - 1 ? -1 : next);
          }
        }
      }
      // A probe that has held for a full window is accepted
      if (s.probing !== null && level >= s.probing && ratio < STABLE_RATIO) s.probing = null;
    }, SAMPLE_MS);

    return () => {
      clearInterval(id);
      video?.removeEventListener('seeking', onSeek);
    };
  }, [src]);

  // Hide the "lowered quality" notice after a few seconds
  useEffect(() => {
    if (!smoothNotice) return;
    const id = setTimeout(() => setSmoothNotice(null), 6000);
    return () => clearTimeout(id);
  }, [smoothNotice]);

  // --- Actions ---
  const togglePlay = () => { const v = videoRef.current; if (v.paused) v.play().catch(() => { }); else v.pause(); };
  const toggleMute = () => { const v = videoRef.current; v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.5; };
  const changeVolume = (value) => { const v = videoRef.current; v.volume = value; v.muted = value === 0; };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => { }); return; }
    const el = containerRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch(() => { });
    } else {
      videoRef.current?.webkitEnterFullscreen?.(); // iOS Safari
    }
  };
  // On touch screens a tap shows or hides the controls (like YouTube); play
  // and pause are on the button. With a mouse, a click toggles playback.
  const lastPointer = useRef('mouse');
  const onVideoTap = () => {
    if (lastPointer.current !== 'touch') { togglePlay(); return; }
    if (controlsVisible && playing) { setControlsVisible(false); clearTimeout(hideTimer.current); } else showControls();
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
  const levelLabel = (l) => `${l.height}p${l.fps && l.fps < 40 ? Math.round(l.fps) : ''}, ${mbps(l.bitrate)}`;
  const hideUi = !controlsVisible && playing;
  const resolution = stats?.height ? `${stats.height}p` : null;
  const ready = status.phase !== 'loading' && status.phase !== 'error';

  return (
    <div ref={containerRef}
      className={`relative w-full h-full bg-black select-none overflow-hidden ${hideUi ? 'cursor-none' : ''}`}
      onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
      onMouseMove={() => lastPointer.current !== 'touch' && showControls()} onMouseLeave={() => playing && lastPointer.current !== 'touch' && setControlsVisible(false)}>
      <video ref={videoRef} autoPlay playsInline onClick={onVideoTap} onDoubleClick={toggleFullscreen}
        className="w-full h-full bg-black object-contain" />
      <PlayerStatus status={status} />

      {smoothNotice && status.phase === 'playing' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 w-max max-w-[90%] px-3.5 py-1.5 rounded-[14px] bg-black/85 border border-graphite text-xs text-center text-chalk/90">
          {smoothNotice}
        </div>
      )}

      {/* Top bar: live state + quality */}
      {ready && (
        <div className={`absolute top-0 inset-x-0 flex items-start justify-between p-4 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${hideUi ? 'opacity-0' : 'opacity-100'}`}>
          {live ? (
            <button onClick={goLive} title="Jump to live (L)"
              className={`slant flex items-center gap-2 px-4 py-1.5 text-xs font-bold transition-colors ${atLive ? 'bg-f1 text-white' : 'bg-black/70 text-chalk hover:bg-f1/80'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${atLive ? 'bg-white animate-pulse' : 'bg-muted'}`} />
              {atLive ? 'Live' : <span className="tnum">{formatDuration(behindLive)} behind, go live</span>}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            {catchingUp && (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-chip bg-black/70 border border-graphite text-chalk/90 tnum" title="Playing slightly faster to rejoin the live edge">
                Catching up at 1.08×
              </span>
            )}
            {resolution && (
              <span className={`tnum text-[11px] font-bold px-2.5 py-1 rounded-chip ${stats.height >= 2160 ? 'bg-f1 text-white' : stats.height >= 1080 ? 'bg-chalk text-night' : 'bg-white/20 text-chalk'}`}>
                {stats.height >= 2160 ? '4K' : stats.height >= 1080 ? 'FHD' : 'HD'} {resolution}{activeLevel ? `, ${mbps(activeLevel.bitrate)}` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stats for nerds */}
      {showStats && stats && (
        <div className="absolute top-14 right-4 z-20 w-72 rounded-card bg-carbon/95 border border-graphite p-4 text-xs space-y-1.5 shadow-2xl animate-[menu-in_.25s_cubic-bezier(.22,1,.36,1)]">
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold text-sm">Stream stats</span>
            <button onClick={() => setShowStats(false)} aria-label="Close stream stats" className="p-1 -m-1 rounded-full text-steel hover:text-chalk"><X className="w-3.5 h-3.5" /></button>
          </div>
          <StatRow label="Resolution" value={stats.width ? `${stats.width}×${stats.height}` : '—'} />
          {levels.length > 1 && (
            <StatRow label="Rendition" value={`${manualLevel === -1 ? 'Auto' : 'Fixed'}, ${currentLevel + 1} of ${levels.length}`} />
          )}
          <StatRow label="Codecs" value={stats.codecs || '—'} />
          <StatRow label="Stream bitrate" value={stats.bitrate ? `${(stats.bitrate / 1e6).toFixed(1)} Mbps` : '—'} />
          <StatRow label="Connection" value={stats.bandwidth ? `${(stats.bandwidth / 1e6).toFixed(1)} Mbps` : '—'} />
          <StatRow label="Buffer ahead" value={`${stats.buffer.toFixed(1)} s`} />
          {live && <StatRow label="Behind live" value={formatDuration(behindLive)} />}
          <StatRow label="DVR window" value={formatDuration(end - start)} />
          <StatRow label="Dropped frames" value={`${stats.dropped} / ${stats.frames}`} />
          <StatRow label="Drop rate (recent)" value={`${(dropRate * 100).toFixed(1)}%`} />
          {levels.length > 1 && (
            <StatRow label="Smoothness cap" value={smoothCap === -1 ? 'None' : `≤ ${levelLabel(levels[smoothCap])}`} />
          )}
        </div>
      )}

      {/* Big play button when paused */}
      {ready && !playing && (
        <button onClick={togglePlay} aria-label="Play"
          className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-black/50 border border-white/30 grid place-items-center shadow-2xl transition-[transform,background-color] duration-300 ease-pit hover:scale-105 hover:bg-f1 animate-[menu-in_.3s_cubic-bezier(.22,1,.36,1)]">
          <Play className="w-8 h-8 text-chalk fill-current ml-1" />
        </button>
      )}

      {/* Bottom controls */}
      {ready && (
        <div className={`absolute bottom-0 inset-x-0 px-2 sm:px-4 pb-1 sm:pb-3 pt-10 sm:pt-16 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-[opacity,transform] duration-300 ease-pit ${hideUi ? 'opacity-0 translate-y-2 pointer-events-none' : 'opacity-100'}`}>
          {/* DVR / seek bar */}
          <div className="relative h-5 flex items-center cursor-pointer group/seek" role="slider" aria-label="Seek"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(playedPct)}
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
            <div className="relative w-full h-1 group-hover/seek:h-1.5 transition-[height] duration-200 bg-white/15 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-white/30 transition-[width] duration-500" style={{ width: `${bufferedPct}%` }} />
              <div className={`absolute inset-y-0 left-0 ${live && atLive ? 'bg-f1' : 'bg-chalk'}`} style={{ width: `${playedPct}%` }} />
              {hover && <div className="absolute inset-y-0 left-0 bg-white/20" style={{ width: `${hover.pct * 100}%` }} />}
            </div>
            <div className="absolute w-3.5 h-3.5 rounded-full bg-chalk ring-4 ring-f1/0 group-hover/seek:ring-f1/40 -translate-x-1/2 scale-0 group-hover/seek:scale-100 transition-[transform,box-shadow] duration-200" style={{ left: `${playedPct}%` }} />
            {hover && (
              <div className="absolute -top-8 -translate-x-1/2 px-2 py-1 rounded-chip bg-carbon/95 border border-graphite text-[11px] font-semibold tnum whitespace-nowrap" style={{ left: `${hover.pct * 100}%` }}>
                {live ? (end - hover.time < 1 ? 'Live' : `-${formatDuration(end - hover.time)}`) : formatDuration(hover.time)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 mt-1.5">
            <ControlButton onClick={togglePlay} title={playing ? 'Pause (K)' : 'Play (K)'}>
              {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </ControlButton>
            <div className="flex items-center group/vol">
              <ControlButton onClick={toggleMute} title={muted ? 'Unmute (M)' : 'Mute (M)'}>
                {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </ControlButton>
              <div className="w-0 group-hover/vol:w-24 group-focus-within/vol:w-24 overflow-hidden transition-[width] duration-300 ease-pit flex items-center">
                <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Volume"
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  className="w-20 ml-1 accent-[rgb(225_6_0)] cursor-pointer" />
              </div>
            </div>
            <span className="ml-1 sm:ml-2 text-xs sm:text-sm text-chalk/80 tnum whitespace-nowrap truncate">
              {live ? (atLive ? 'Live' : `${formatDuration(behindLive)} behind live`) : `${formatDuration(current - start)} / ${formatDuration(end - start)}`}
            </span>
            <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
              {live && !atLive && (
                <button onClick={goLive} className="slant hidden sm:inline-flex mr-1 px-4 py-1.5 text-xs font-bold whitespace-nowrap bg-f1 text-white hover:bg-[rgb(255_30_20)]">Go live</button>
              )}
              {levels.length > 1 && (
                <div className="relative">
                  <button onClick={() => setQualityOpen(v => !v)} title="Quality" aria-expanded={qualityOpen}
                    className="flex items-center gap-1.5 h-10 px-3 rounded-full text-sm font-semibold text-chalk/85 hover:text-chalk hover:bg-white/10 whitespace-nowrap">
                    <Settings className={`w-4 h-4 transition-transform duration-300 ${qualityOpen ? 'rotate-90' : ''}`} />
                    <span className="hidden sm:inline">{manualLevel === -1 ? 'Auto' : `${levels[manualLevel]?.height}p`}</span>
                  </button>
                  {qualityOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 rounded-card bg-carbon/95 border border-graphite p-1.5 text-sm z-20 shadow-2xl origin-bottom-right animate-[menu-in_.2s_cubic-bezier(.22,1,.36,1)]">
                      <div className="px-3 pt-1.5 pb-2 text-xs text-steel font-semibold">Quality</div>
                      <button onClick={() => selectLevel(-1)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] hover:bg-white/10 ${manualLevel === -1 ? 'text-f1 font-bold' : ''}`}>
                        <span>Auto</span>
                        <span className="text-xs text-steel tnum font-normal">{activeLevel ? levelLabel(activeLevel) : ''}</span>
                      </button>
                      {levels.map(l => (
                        <button key={l.index} onClick={() => selectLevel(l.index)}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] hover:bg-white/10 tnum ${manualLevel === l.index ? 'text-f1 font-bold' : ''}`}>
                          <span>{levelLabel(l)}</span>
                          {currentLevel === l.index && <span className="w-1.5 h-1.5 rounded-full bg-f1" title="Playing now" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <ControlButton className="hidden sm:grid" onClick={() => setShowStats(v => !v)} title="Stream stats" active={showStats}><BarChart3 className="w-5 h-5" /></ControlButton>
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


export const VideoPlayer = ({ src, type }) => {
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
       
      ></iframe>
    );
  }

  return <HlsPlayer src={src} live={type === 'hls-live'} />;
};

// Full-screen viewer. While an F1 session is live, the feed sits on the left
// (70%) with live telemetry on the right (30%); otherwise the feed is centred.
// The video element stays mounted when the layout changes, so toggling the
// telemetry panel never restarts the stream. Fullscreen (F) shows video only.
// Animations here are opacity/transform only and nothing is blurred over the
// video, so the compositor never has to repaint the frame for the UI.
export const PlayerModal = memo(({ stream, channels, liveSession, onSwitch, onClose }) => {
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      if (e.key.toLowerCase() === 't') setShowTelemetry(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLiveStream = stream.type === 'hls-live' || stream.type === 'mpegts';
  const canSplit = isLiveStream && !!liveSession;
  const split = canSplit && showTelemetry;
  const switchable = isLiveStream && channels.length > 1;
  const kind = stream.type === 'youtube' ? 'Highlights' : isLiveStream ? 'Live' : 'Replay';
  const desktop = useMedia(DESKTOP);
  const landscapePhone = useMedia(LANDSCAPE_PHONE);
  const sideBySide = desktop || landscapePhone;

  return (
    <motion.div className="fixed inset-0 z-[70] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label={`${kind}: ${stream.title}`}
      initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      {/* Header */}
      <div className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-3 md:px-5 ${landscapePhone ? 'h-11' : 'h-14 md:h-16'} border-b border-graphite/70 bg-carbon shrink-0`}>
        <button onClick={onClose} title="Close (Esc)" aria-label="Close player"
          className="p-2 -ml-1 rounded-full text-steel hover:text-chalk hover:bg-raised transition-colors">
          <X className="w-5 h-5" />
        </button>
        <span className={`slant shrink-0 hidden sm:flex items-center gap-2 px-4 py-1 text-xs font-bold ${isLiveStream ? 'bg-f1 text-white' : 'bg-raised text-chalk'}`}>
          {isLiveStream && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
          {kind}
        </span>

        {/* Feed title + switcher */}
        <div className="relative flex-1 min-w-0">
          <button onClick={() => switchable && setMenuOpen(v => !v)} disabled={!switchable} aria-expanded={switchable ? menuOpen : undefined}
            className={`flex items-center gap-2 min-w-0 max-w-full rounded-[10px] px-2 py-1.5 transition-colors ${switchable ? 'hover:bg-raised' : 'cursor-default'}`}>
            {stream.type !== 'youtube' && <ChannelLogo stream={stream} archive={!isLiveStream} size="sm" className="hidden sm:grid" />}
            <span className="font-bold truncate">{stream.title}</span>
            {stream.quality && <span className="hidden sm:inline text-[11px] tnum px-1.5 py-0.5 rounded-chip border border-graphite text-steel shrink-0">{stream.quality}</span>}
            {switchable && <ChevronDown className={`w-4 h-4 text-steel shrink-0 transition-transform duration-300 ${menuOpen ? 'rotate-180' : ''}`} />}
          </button>
          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-x-2 top-[3.75rem] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 z-20 sm:w-96 max-h-[70vh] sm:max-h-[60vh] overflow-y-auto overscroll-contain rounded-card bg-carbon border border-graphite shadow-2xl p-1.5 origin-top sm:origin-top-left">
                  <div className="px-3 pt-1.5 pb-2 text-xs text-steel font-semibold">Switch feed</div>
                  {channels.map(c => (
                    <button key={c.key}
                      onClick={() => { setMenuOpen(false); if (c.key !== stream.key) onSwitch(streamForChannel(c)); }}
                      aria-current={c.key === stream.key ? 'true' : undefined}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-[10px] text-left text-sm transition-colors hover:bg-raised ${c.key === stream.key ? 'bg-raised font-bold' : ''}`}>
                      <ChannelLogo stream={c} size="sm" />
                      <span className="truncate flex-1">{c.title}</span>
                      <span className="text-[11px] tnum text-steel shrink-0">{c.quality}</span>
                      {c.key === stream.key && <span className="w-1.5 h-1.5 rounded-full bg-f1 shrink-0" title="Playing now" />}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canSplit && (
            <>
              <span className="hidden md:flex items-center gap-1.5 text-sm text-steel">
                <Activity className="w-4 h-4 text-f1" />
                {liveSession.name} {liveSession.replay ? 'replay' : 'live'}
              </span>
              <button onClick={() => setShowTelemetry(v => !v)} title="Toggle live telemetry (T)" aria-pressed={showTelemetry}
                className={`btn-line !py-1.5 ${showTelemetry ? '!border-f1/60 !bg-f1/10' : ''}`}>
                {showTelemetry ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                <span className="hidden sm:inline">Telemetry</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body: 70:30 split during a live session, centred feed otherwise */}
      <div className={`flex-1 min-h-0 flex ${split ? (sideBySide ? 'flex-row' : 'flex-col') : 'items-center justify-center md:p-8'}`}>
        <div className={split
          ? (sideBySide ? `${desktop ? 'w-[70%]' : 'w-[60%]'} h-full bg-black shrink-0` : 'w-full aspect-video bg-black shrink-0')
          : 'w-full max-w-6xl max-h-full aspect-video bg-black md:rounded-stage overflow-hidden md:border border-graphite/60'}>
          <VideoPlayer key={stream.url} src={stream.url} type={stream.type} />
        </div>
        <AnimatePresence>
          {split && (
            <motion.aside key="telemetry" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={`${sideBySide ? `${desktop ? 'w-[30%]' : 'w-[40%]'} h-full border-l` : 'w-full flex-1 min-h-0 border-t'} border-graphite/70 bg-carbon overflow-hidden`}>
              <LiveTelemetry compact tabbed={!desktop} />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});
