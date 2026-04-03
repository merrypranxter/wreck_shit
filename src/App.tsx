import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { 
  Upload, 
  Zap, 
  Download, 
  RefreshCw, 
  AlertTriangle, 
  Terminal, 
  Settings, 
  Play, 
  Pause,
  Volume2,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type Status = 'idle' | 'loading' | 'processing' | 'error' | 'success';
type Resolution = 'low' | 'medium' | 'high';

interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
  timestamp: Date;
}

// --- Utils ---
const RESOLUTION_MAP = {
  low: { width: 854, height: 480, bitrate: 1500000 },
  medium: { width: 1280, height: 720, bitrate: 4000000 },
  high: { width: 1920, height: 1080, bitrate: 8000000 },
};

const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const speak = (text: string) => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.2;
    utterance.pitch = 0.8;
    window.speechSynthesis.speak(utterance);
  }
};

// --- Components ---
export default function App() {
  const [videoFile, setVideoFile] = useState<File | Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [segmentSize, setSegmentSize] = useState(0.5);
  const [speed, setSpeed] = useState(1);
  const [resolution, setResolution] = useState<Resolution>('high');
  const [progress, setProgress] = useState(0);
  const [isFFmpegReady, setIsFFmpegReady] = useState(false);
  const [supportsFFmpeg, setSupportsFFmpeg] = useState(false);

  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [
      ...prev,
      { id: Math.random().toString(36).substr(2, 9), message, type, timestamp: new Date() }
    ]);
  }, []);

  // --- Initialization ---
  useEffect(() => {
    const checkSupport = async () => {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const hasWASM = typeof WebAssembly === 'object';
      const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
      
      const canUseFFmpeg = !isMobile && hasWASM && hasSharedArrayBuffer;
      setSupportsFFmpeg(canUseFFmpeg);
      
      if (canUseFFmpeg) {
        addLog('DESKTOP DETECTED. INITIALIZING FFMPEG.JS...', 'info');
        try {
          const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
          await ffmpegRef.current.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          });
          setIsFFmpegReady(true);
          addLog('FFMPEG.JS CORE LOADED. READY FOR CHAOS.', 'success');
        } catch (err) {
          addLog('FFMPEG LOAD FAILED. FALLING BACK TO CANVAS.', 'warn');
          setSupportsFFmpeg(false);
        }
      } else {
        addLog('MOBILE/RESTRICTED BROWSER DETECTED. USING CANVAS ENGINE.', 'info');
      }
    };

    checkSupport();
    speak('GLITCH SCRAMBLER INITIALIZED. UPLOAD VIDEO TO BEGIN.');
  }, [addLog]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- Handlers ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      addLog(`VIDEO LOADED: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`, 'success');
      speak('VIDEO LOADED. READY TO SCRAMBLE.');
    }
  };

  const scrambleWithFFmpeg = async () => {
    if (!videoFile || !isFFmpegReady) return;
    
    setStatus('processing');
    setProgress(0);
    addLog('STARTING FFMPEG SCRAMBLE...', 'info');
    speak('COMMENCING FFMPEG SCRAMBLE.');

    const ffmpeg = ffmpegRef.current;
    const inputName = 'input.mp4';
    const outputName = 'output.mp4';

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
      
      // Get duration
      addLog('ANALYZING VIDEO DURATION...', 'info');
      const video = document.createElement('video');
      video.src = URL.createObjectURL(videoFile);
      await new Promise(r => video.onloadedmetadata = r);
      const duration = video.duration;
      URL.revokeObjectURL(video.src);

      const numSegments = Math.floor(duration / segmentSize);
      addLog(`CHOPPING INTO ${numSegments} SEGMENTS...`, 'info');

      const segmentIndices = Array.from({ length: numSegments }, (_, i) => i);
      const shuffledIndices = shuffleArray(segmentIndices);

      // Create concat file
      let concatContent = '';
      for (const i of shuffledIndices) {
        const start = (i * segmentSize).toFixed(3);
        const name = `seg_${i}.mp4`;
        addLog(`SLICING SEGMENT ${i} AT ${start}s...`, 'info');
        await ffmpeg.exec([
          '-ss', start,
          '-t', segmentSize.toString(),
          '-i', inputName,
          '-c', 'copy',
          '-avoid_negative_ts', '1',
          name
        ]);
        concatContent += `file '${name}'\n`;
        setProgress(Math.round(((i + 1) / numSegments) * 50));
      }

      await ffmpeg.writeFile('concat.txt', concatContent);

      addLog('REASSEMBLING SEGMENTS...', 'info');
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        'concatenated.mp4'
      ]);
      setProgress(75);

      addLog(`APPLYING SPEED (${speed}x) AND RESOLUTION (${resolution})...`, 'info');
      
      const filters: string[] = [];
      if (resolution !== 'high') {
        const res = RESOLUTION_MAP[resolution];
        filters.push(`scale=${res.width}:${res.height}`);
      }
      if (speed !== 1) {
        filters.push(`setpts=${(1/speed).toFixed(4)}*PTS`);
      }

      const outputArgs = [
        '-i', 'concatenated.mp4',
      ];

      if (filters.length > 0) {
        outputArgs.push('-filter:v', filters.join(','));
        if (speed !== 1) {
          outputArgs.push('-filter:a', `atempo=${speed.toFixed(4)}`);
        }
        // Re-encode with high quality if filters are applied
        outputArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', '-b:a', '128k');
      } else {
        outputArgs.push('-c', 'copy');
      }

      outputArgs.push(outputName);
      await ffmpeg.exec(outputArgs);
      setProgress(95);

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      
      setVideoFile(blob);
      setVideoUrl(url);
      setStatus('success');
      addLog('SCRAMBLE COMPLETE. REALITY DISTORTED.', 'success');
      speak('SCRAMBLE COMPLETE. DOWNLOAD YOUR CHAOS.');
      setProgress(100);

      // Cleanup
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
      await ffmpeg.deleteFile('concatenated.mp4');
      await ffmpeg.deleteFile('concat.txt');
      for (let i = 0; i < numSegments; i++) {
        await ffmpeg.deleteFile(`seg_${i}.mp4`);
      }
    } catch (err) {
      console.error(err);
      addLog(`ERROR: ${err instanceof Error ? err.message : 'UNKNOWN ERROR'}`, 'error');
      setStatus('error');
      speak('ERROR DETECTED. CHAOS INTERRUPTED.');
    }
  };

  const scrambleWithCanvas = async () => {
    if (!videoFile) return;
    
    setStatus('processing');
    setProgress(0);
    addLog('STARTING CANVAS SCRAMBLE (MOBILE ENGINE)...', 'info');
    speak('COMMENCING CANVAS SCRAMBLE.');

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;
    
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });

      const duration = video.duration;
      const numSegments = Math.floor(duration / segmentSize);
      const canvas = canvasRef.current!;
      
      // Set canvas size based on resolution
      const res = RESOLUTION_MAP[resolution];
      const scale = Math.min(res.width / video.videoWidth, res.height / video.videoHeight, 1);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      
      const ctx = canvas.getContext('2d')!;

      addLog(`EXTRACTING ${numSegments} SEGMENTS AT ${canvas.width}x${canvas.height}...`, 'info');

      const segmentIndices = Array.from({ length: numSegments }, (_, i) => i);
      const shuffledIndices = shuffleArray(segmentIndices);

      // MediaRecorder setup
      const stream = canvas.captureStream(30);
      
      const supportedTypes = [
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      
      let mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
      addLog(`USING RECORDER MIME_TYPE: ${mimeType || 'DEFAULT'}`, 'info');
      
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: res.bitrate
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      
      const recordPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });

      recorder.start();

      video.playbackRate = speed;
      
      for (let i = 0; i < shuffledIndices.length; i++) {
        const segmentIdx = shuffledIndices[i];
        const startTime = segmentIdx * segmentSize;
        
        addLog(`RECORDING SEGMENT ${segmentIdx} AT ${startTime.toFixed(2)}s...`, 'info');
        
        // Seek
        video.currentTime = startTime;
        await new Promise(r => video.onseeked = r);
        
        // Play and record for segmentSize / speed duration
        video.play();
        const startTimestamp = performance.now();
        const targetDuration = (segmentSize * 1000) / speed;
        
        while (performance.now() - startTimestamp < targetDuration) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          await new Promise(r => requestAnimationFrame(r));
        }
        video.pause();
        
        setProgress(Math.round(((i + 1) / numSegments) * 100));
      }

      recorder.stop();
      const finalBlob = await recordPromise;
      const url = URL.createObjectURL(finalBlob);

      setVideoFile(finalBlob);
      setVideoUrl(url);
      setStatus('success');
      addLog('CANVAS SCRAMBLE COMPLETE. MOBILE CHAOS ACHIEVED.', 'success');
      speak('SCRAMBLE COMPLETE. DOWNLOAD YOUR CHAOS.');
      setProgress(100);

    } catch (err) {
      console.error(err);
      addLog(`CANVAS ERROR: ${err instanceof Error ? err.message : 'UNKNOWN ERROR'}`, 'error');
      setStatus('error');
      speak('ERROR DETECTED. MOBILE CHAOS FAILED.');
    } finally {
      URL.revokeObjectURL(video.src);
    }
  };

  const handleScramble = () => {
    if (supportsFFmpeg) {
      scrambleWithFFmpeg();
    } else {
      scrambleWithCanvas();
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `glitch_scramble_${new Date().toISOString().split('T')[0]}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    speak('DOWNLOADING CHAOS.');
  };

  const reset = () => {
    setVideoFile(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setStatus('idle');
    setLogs([]);
    setProgress(0);
    speak('SYSTEM RESET. READY FOR NEW INPUT.');
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      addLog(`VIDEO DROPPED: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`, 'success');
      speak('VIDEO RECEIVED. READY TO SCRAMBLE.');
    }
  };

  return (
    <div 
      className={cn(
        "min-h-screen bg-black relative overflow-hidden selection:bg-neon-pink selection:text-white transition-colors duration-300",
        isDragging && "bg-neon-cyan/10"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Background Effects */}
      <div className="scanline" />
      <div className="crt-overlay" />
      
      {/* Glitch Sweep */}
      <motion.div 
        className="fixed top-0 left-0 w-1 h-full bg-neon-green/30 z-50 pointer-events-none"
        animate={{ left: ['-5%', '105%'] }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      <main className="relative z-30 max-w-6xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Header */}
        <header className="lg:col-span-12 border-4 border-neon-green p-6 bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <h1 className="text-4xl md:text-6xl font-bold neon-green tracking-tighter italic">
                GLITCH SCRAMBLER <span className="text-xl align-top">v1.0</span>
              </h1>
              <p className="font-mono text-neon-cyan mt-2">
                [ ITERATION IS KEY // GLITCH UNTIL IT BREAKS ]
              </p>
            </div>
            <div className="flex gap-4">
              <div className={cn(
                "px-4 py-2 border-2 font-mono text-sm flex items-center gap-2",
                supportsFFmpeg ? "border-neon-green text-neon-green" : "border-neon-yellow text-neon-yellow"
              )}>
                <Zap size={16} />
                {supportsFFmpeg ? "FFMPEG ENGINE" : "CANVAS ENGINE"}
              </div>
            </div>
          </div>
        </header>

        {/* Left Column: Controls */}
        <section className="lg:col-span-4 space-y-6">
          <div className="border-4 border-neon-pink p-6 bg-black/80 space-y-6">
            <h2 className="text-2xl font-bold neon-pink flex items-center gap-2">
              <Settings size={24} /> CONFIG_KNOBS
            </h2>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block font-mono text-neon-cyan text-sm">
                  RESOLUTION: {resolution.toUpperCase()}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['low', 'medium', 'high'] as const).map((res) => (
                    <button
                      key={res}
                      onClick={() => setResolution(res)}
                      className={cn(
                        "py-1 text-[10px] font-bold border-2 transition-all",
                        resolution === res 
                          ? "bg-neon-cyan text-black border-neon-cyan" 
                          : "border-gray-700 text-gray-500 hover:border-neon-cyan/50"
                      )}
                    >
                      {res === 'low' ? '480P' : res === 'medium' ? '720P' : 'HIGH'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-mono text-neon-cyan text-sm">
                  SEGMENT_SIZE: {segmentSize}s
                </label>
                <input 
                  type="range" 
                  min="0.1" 
                  max="5" 
                  step="0.1" 
                  value={segmentSize}
                  onChange={(e) => setSegmentSize(parseFloat(e.target.value))}
                  className="w-full accent-neon-pink cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-mono text-gray-500">
                  <span>CHAOS</span>
                  <span>ORDER</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-mono text-neon-cyan text-sm">
                  SPEED_MODIFIER: {speed}x
                </label>
                <input 
                  type="range" 
                  min="0.5" 
                  max="2" 
                  step="0.1" 
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="w-full accent-neon-pink cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-mono text-gray-500">
                  <span>BALANCED</span>
                  <span>FAST</span>
                </div>
              </div>
            </div>

            <div className="pt-4 space-y-3">
              {!videoFile ? (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-neon-cyan hover:bg-neon-cyan/10 transition-colors cursor-pointer group">
                  <Upload className="neon-cyan group-hover:scale-110 transition-transform" size={32} />
                  <span className="mt-2 font-mono text-xs neon-cyan">UPLOAD_VIDEO_SOURCE</span>
                  <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
                </label>
              ) : (
                <>
                  <button 
                    onClick={handleScramble}
                    disabled={status === 'processing'}
                    className={cn(
                      "w-full py-4 font-bold text-xl flex items-center justify-center gap-2 transition-all active:scale-95",
                      status === 'processing' 
                        ? "bg-gray-800 text-gray-500 cursor-not-allowed" 
                        : "bg-neon-green text-black hover:bg-white hover:shadow-[0_0_20px_#39ff14]"
                    )}
                  >
                    {status === 'processing' ? <RefreshCw className="animate-spin" /> : <Zap />}
                    {status === 'success' ? 'SCRAMBLE AGAIN' : 'SCRAMBLE'}
                  </button>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={handleDownload}
                      disabled={!videoUrl || status === 'processing'}
                      className="py-3 border-2 border-neon-cyan text-neon-cyan font-bold flex items-center justify-center gap-2 hover:bg-neon-cyan hover:text-black transition-all disabled:opacity-50"
                    >
                      <Download size={18} /> SAVE
                    </button>
                    <button 
                      onClick={reset}
                      disabled={status === 'processing'}
                      className="py-3 border-2 border-neon-yellow text-neon-yellow font-bold flex items-center justify-center gap-2 hover:bg-neon-yellow hover:text-black transition-all disabled:opacity-50"
                    >
                      <Trash2 size={18} /> RESET
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Status Log */}
          <div className="border-4 border-neon-cyan p-4 bg-black/80 h-64 flex flex-col">
            <h3 className="text-lg font-bold neon-cyan flex items-center gap-2 mb-2">
              <Terminal size={18} /> STATUS_LOG
            </h3>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar">
              {logs.length === 0 && <p className="text-gray-600 italic">WAITING FOR INPUT...</p>}
              {logs.map(log => (
                <div key={log.id} className={cn(
                  "border-l-2 pl-2 py-0.5",
                  log.type === 'info' && "border-neon-cyan text-neon-cyan",
                  log.type === 'warn' && "border-neon-yellow text-neon-yellow",
                  log.type === 'error' && "border-neon-pink text-neon-pink",
                  log.type === 'success' && "border-neon-green text-neon-green"
                )}>
                  <span className="opacity-50">[{log.timestamp.toLocaleTimeString([], { hour12: false })}]</span> {log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </section>

        {/* Right Column: Preview */}
        <section className="lg:col-span-8">
          <div className="border-4 border-neon-yellow p-2 bg-black relative aspect-video flex items-center justify-center overflow-hidden">
            {videoUrl ? (
              <video 
                ref={videoRef}
                src={videoUrl} 
                controls 
                className="max-w-full max-h-full z-10"
                autoPlay
                loop
              />
            ) : (
              <div className="text-center space-y-4 opacity-50">
                <Play size={64} className="mx-auto text-neon-yellow animate-pulse" />
                <p className="font-mono text-neon-yellow">NO_VIDEO_SIGNAL</p>
              </div>
            )}
            
            {/* Processing Overlay */}
            <AnimatePresence>
              {status === 'processing' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 bg-black/90 flex flex-col items-center justify-center p-8 text-center"
                >
                  <div className="relative w-32 h-32 mb-8">
                    <motion.div 
                      className="absolute inset-0 border-4 border-neon-green"
                      animate={{ rotate: 360, scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    <motion.div 
                      className="absolute inset-4 border-4 border-neon-pink"
                      animate={{ rotate: -360, scale: [1, 0.8, 1] }}
                      transition={{ duration: 3, repeat: Infinity }}
                    />
                    <Zap className="absolute inset-0 m-auto neon-yellow animate-pulse" size={48} />
                  </div>
                  
                  <h3 className="text-3xl font-bold neon-green mb-2 italic tracking-tighter">SCRAMBLING_REALITY</h3>
                  <div className="w-full max-w-md h-4 border-2 border-neon-cyan p-0.5">
                    <motion.div 
                      className="h-full bg-neon-cyan"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-neon-cyan text-sm">{progress}% COMPLETE</p>
                  
                  <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-xs">
                    {[1, 2, 3].map(i => (
                      <motion.div 
                        key={i}
                        className="h-1 bg-neon-pink"
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 0.5, delay: i * 0.2, repeat: Infinity }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Hidden Canvas for Processing */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Footer Info */}
          <div className="mt-6 p-4 border-2 border-gray-800 bg-black/50 font-mono text-[10px] text-gray-500 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-neon-pink font-bold mb-1">// SYSTEM_INFO</p>
              <p>ENGINE: {supportsFFmpeg ? 'FFMPEG_WASM' : 'CANVAS_RECORDER'}</p>
              <p>BROWSER: {navigator.userAgent.split(' ').pop()}</p>
            </div>
            <div>
              <p className="text-neon-green font-bold mb-1">// VIDEO_METRICS</p>
              <p>SIZE: {videoFile ? (videoFile.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}</p>
              <p>TYPE: {videoFile?.type || 'N/A'}</p>
            </div>
            <div>
              <p className="text-neon-cyan font-bold mb-1">// CHAOS_PARAMS</p>
              <p>SEGMENTS: {videoFile ? Math.floor(10 / segmentSize) : 0}</p>
              <p>SPEED: {speed}x</p>
            </div>
            <div className="flex items-end justify-end">
              <p className="neon-yellow animate-pulse">SYSTEM_OPERATIONAL</p>
            </div>
          </div>
        </section>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #000;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #00ffff;
        }
        input[type=range] {
          -webkit-appearance: none;
          background: #1a1a1a;
          height: 4px;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 16px;
          width: 16px;
          background: #ff00ff;
          cursor: pointer;
          box-shadow: 0 0 10px #ff00ff;
        }
      `}</style>
    </div>
  );
}
