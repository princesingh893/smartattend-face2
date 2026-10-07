import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api';
import {
  loadModels,
  analyzeAllFaces,
  matchStudent,
  FACE_CONFIG,
} from '../lib/face';
import Header from '../components/Header';

// ============================================================
// CONSTANTS
// ============================================================
const SYNC_DEBOUNCE_MS = 2500; // wait for camera silence
const MAX_BATCH_SIZE = 50;     // safety cap per sync

export default function Scan() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const scanningRef = useRef(false);
  const loopRunningRef = useRef(false);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const studentsRef = useRef([]);
  const confirmationRef = useRef(new Map());
  const markedRef = useRef(new Set());     // in-session marked IDs
  const overlaysRef = useRef([]);          // keep latest overlay for state merge

  // 🔥 BATCH QUEUE (component-scoped)
  const batchQueueRef = useRef([]);        // pending records awaiting sync
  const syncTimerRef = useRef(null);       // debounce timer
  const syncInFlightRef = useRef(false);   // prevent overlapping syncs

  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState({
    type: 'info',
    msg: 'Loading AI models...',
    sub: '',
  });
  const [present, setPresent] = useState([]);
  const [overlays, setOverlays] = useState([]);
  const [stats, setStats] = useState({ detected: 0, confirmed: 0, pending: 0 });

  const updateStatus = useCallback((type, msg, sub = '') => {
    if (!mountedRef.current) return;
    setStatus({ type, msg, sub });
  }, []);

  const clearScanTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ============================================================
  // SYNC BATCH → single network call
  // ============================================================
  const flushBatch = useCallback(async () => {
    if (syncInFlightRef.current) return;
    if (!batchQueueRef.current.length) return;

    const records = batchQueueRef.current.splice(0, MAX_BATCH_SIZE);
    if (!records.length) return;

    syncInFlightRef.current = true;
    updateStatus(
      'info',
      `Syncing ${records.length} record${records.length > 1 ? 's' : ''}...`,
      ''
    );

    try {
      const res = await api.markAttendanceBatch(records);

      if (!mountedRef.current) return;

      if (res?.success) {
        const okCount = res.inserted ?? records.length;

        // Mark overlays as "synced"
        setPresent((prev) => {
          const synced = records.map((r) => ({
            StudentID: r.studentId,
            Name: r.name,
            RollNo: r.rollNo,
            time: r.timestamp,
            pending: false,
          }));
          // filter out any duplicate entries
          const existingIds = new Set(synced.map((s) => s.StudentID));
          const filtered = prev.filter((p) => !existingIds.has(p.StudentID));
          return [...synced, ...filtered].slice(0, 50);
        });

        updateStatus(
          'success',
          `✅ ${okCount} attendance synced`,
          records.map((r) => r.name).join(', ')
        );
      } else {
        // Server rejected — allow re-scan
        records.forEach((r) => markedRef.current.delete(r.studentId));
        updateStatus(
          'error',
          'Sync failed',
          res?.message || 'Server rejected the batch'
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // allow re-scan since it failed
      records.forEach((r) => markedRef.current.delete(r.studentId));
      console.error('Batch sync error:', err);
      updateStatus('error', 'Network error', err.message || 'Sync failed');
    } finally {
      syncInFlightRef.current = false;
    }
  }, [updateStatus]);

  // ============================================================
  // SCHEDULE DEBOUNCED SYNC
  // ============================================================
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      flushBatch();
    }, SYNC_DEBOUNCE_MS);

    // update pending count in stats
    setStats((s) => ({ ...s, pending: batchQueueRef.current.length }));
  }, [flushBatch]);

  // ============================================================
  // OPTIMISTIC MARK — no network call here
  // ============================================================
  const enqueueStudent = useCallback((student) => {
    if (markedRef.current.has(student.StudentID)) return;
    markedRef.current.add(student.StudentID);

    const record = {
      studentId: student.StudentID,
      name: student.Name,
      rollNo: student.RollNo || '',
      timestamp: new Date().toISOString(),
    };

    // push to batch queue
    batchQueueRef.current.push(record);

    // 🔥 Optimistic UI — instant "Recently Marked" with pending flag
    setPresent((prev) => [
      {
        StudentID: student.StudentID,
        Name: student.Name,
        RollNo: student.RollNo,
        time: new Date().toLocaleTimeString(),
        pending: true,
      },
      ...prev.filter((p) => p.StudentID !== student.StudentID),
    ].slice(0, 50));

    // schedule debounced sync
    scheduleSync();
  }, [scheduleSync]);

  // ============================================================
  // SCAN LOOP — multi-face
  // ============================================================
  const scanLoop = async () => {
    if (!mountedRef.current || !scanningRef.current) return;
    if (loopRunningRef.current) return;
    loopRunningRef.current = true;

    try {
      const video = videoRef.current;
      if (!video || video.readyState < 4) {
        scheduleNextScan();
        return;
      }

      const faces = await analyzeAllFaces(video);
      if (!mountedRef.current || !scanningRef.current) return;

      if (faces.length === 0) {
        setOverlays([]);
        setStats((s) => ({ ...s, detected: 0, confirmed: 0 }));
        confirmationRef.current.clear();
        updateStatus('info', 'No faces detected', 'Look at the camera');
        return;
      }

      const now = Date.now();
      const overlaysData = [];
      const matched = [];

      for (const face of faces) {
        const match = matchStudent(face.descriptor, studentsRef.current);
        const b = face.box;

        overlaysData.push({
          xPct: (b.x / face.width) * 100,
          yPct: (b.y / face.height) * 100,
          wPct: (b.width / face.width) * 100,
          hPct: (b.height / face.height) * 100,
          name: match?.student?.Name || null,
          rollNo: match?.student?.RollNo || null,
          matched: !!match,
          alreadyMarked: match ? markedRef.current.has(match.student.StudentID) : false,
        });

        if (match) matched.push({ student: match.student, face });
      }

      overlaysRef.current = overlaysData;
      setOverlays(overlaysData);

      // ---- Update per-student history ----
      const currentIds = new Set();

      for (const { student } of matched) {
        const id = student.StudentID;
        currentIds.add(id);
        if (markedRef.current.has(id)) continue;

        let history = confirmationRef.current.get(id) || [];
        history.push(now);
        history = history.filter((ts) => now - ts < FACE_CONFIG.FRAME_WINDOW_MS);
        confirmationRef.current.set(id, history);
      }

      for (const id of Array.from(confirmationRef.current.keys())) {
        if (!currentIds.has(id)) confirmationRef.current.delete(id);
      }

      // ---- Find confirmed ----
      const confirmed = [];
      for (const { student } of matched) {
        if (markedRef.current.has(student.StudentID)) continue;
        const history = confirmationRef.current.get(student.StudentID) || [];
        if (history.length >= FACE_CONFIG.REQUIRED_FRAMES) {
          confirmed.push(student);
        }
      }

      setStats({
        detected: matched.length,
        confirmed: confirmed.length,
        pending: batchQueueRef.current.length,
      });

      // ---- Status ----
      const unregisteredCount = faces.length - matched.length;

      if (matched.length === 0) {
        updateStatus(
          'error',
          `${faces.length} face${faces.length > 1 ? 's' : ''} detected — none registered`,
          'Contact admin'
        );
      } else if (unregisteredCount > 0) {
        updateStatus(
          'info',
          `${matched.length} matched, ${unregisteredCount} unknown`,
          'Unknown faces ignored'
        );
      } else {
        const pendingCount = matched.filter(
          (m) => !markedRef.current.has(m.student.StudentID)
        ).length;
        if (pendingCount > 0) {
          updateStatus(
            'info',
            `${matched.length} student${matched.length > 1 ? 's' : ''} in frame`,
            'Confirming… hold still'
          );
        }
      }

      // ---- Enqueue confirmed (LOCAL, no network) ----
      for (const student of confirmed) {
        enqueueStudent(student);
      }
    } catch (error) {
      console.error('Scan loop error:', error);
    } finally {
      loopRunningRef.current = false;
      if (mountedRef.current && scanningRef.current) {
        scheduleNextScan();
      }
    }
  };

  const scheduleNextScan = useCallback(() => {
    if (!scanningRef.current || !mountedRef.current) return;
    clearScanTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (scanningRef.current) scanLoop();
    }, FACE_CONFIG.SCAN_INTERVAL_MS);
  }, [clearScanTimer]);

  // ============================================================
  // STOP CAMERA — force flush pending
  // ============================================================
  const stopCamera = useCallback(async () => {
    scanningRef.current = false;
    loopRunningRef.current = false;
    clearScanTimer();

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }

    // 🔥 Force flush any leftovers
    if (batchQueueRef.current.length) {
      flushBatch();
    }

    const video = videoRef.current;
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      video.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      streamRef.current = null;
    }
    if (mountedRef.current) setScanning(false);
  }, [clearScanTimer, flushBatch]);

  // ============================================================
  // START CAMERA
  // ============================================================
  const startCamera = useCallback(async () => {
    if (!mountedRef.current || scanningRef.current) return;

    try {
      clearScanTimer();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
        streamRef.current = null;
      }

      confirmationRef.current.clear();
      markedRef.current.clear();
      batchQueueRef.current = [];
      setOverlays([]);
      setStats({ detected: 0, confirmed: 0, pending: 0 });

      updateStatus('info', 'Starting camera...', 'Please allow camera access');

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not supported');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview not available');

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      if (!mountedRef.current) {
        stopCamera();
        return;
      }

      scanningRef.current = true;
      setScanning(true);
      updateStatus('info', 'Scanning...', 'Multiple students can be visible');
      scanLoop();
    } catch (error) {
      scanningRef.current = false;
      clearScanTimer();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      let message = 'Unable to access camera';
      if (error?.name === 'NotAllowedError') message = 'Camera permission denied';
      else if (error?.name === 'NotFoundError') message = 'No camera found';
      else if (error?.name === 'NotReadableError') message = 'Camera in use';
      else if (error?.message) message = error.message;

      updateStatus('error', 'Camera error', message);
      setScanning(false);
    }
  }, [clearScanTimer, stopCamera, updateStatus]);

  const toggleScan = useCallback(() => {
    if (scanningRef.current) {
      stopCamera();
      updateStatus('info', 'Scan stopped', 'Tap "Start Scan" to resume');
    } else {
      startCamera();
    }
  }, [startCamera, stopCamera, updateStatus]);

  // ============================================================
  // INIT
  // ============================================================
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        updateStatus('info', 'Loading AI models...', 'First load: 5–15s');
        await loadModels();
        if (cancelled || !mountedRef.current) return;

        updateStatus('info', 'Loading students...', 'Fetching faces');
        const result = await api.getStudents();
        if (cancelled || !mountedRef.current) return;

        const list = Array.isArray(result) ? result : [];
        studentsRef.current = list;
        setReady(true);
        updateStatus('success', 'Ready to scan', 'Tap "Start Scan"');
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        updateStatus('error', 'Init error', error?.message || 'Failed');
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      scanningRef.current = false;
      loopRunningRef.current = false;
      clearScanTimer();

      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      // Force flush on unmount
      if (batchQueueRef.current.length) {
        flushBatch();
      }

      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
        videoRef.current.srcObject = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
        streamRef.current = null;
      }
    };
  }, [clearScanTimer, flushBatch, updateStatus]);

  const statusBg = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900">
      <Header />
      <main className="max-w-4xl mx-auto px-3 sm:px-5 py-4 sm:py-6">
        <div className="text-center mb-4">
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center gap-2">
            <span className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-lg shadow-lg">
              📸
            </span>
            Multi-Face Scan
          </h1>
          <p className="text-white/60 text-sm mt-1">
            Multiple students at once — batched sync under 2s
          </p>
        </div>

        {!ready ? (
          <div className="bg-white/10 backdrop-blur rounded-3xl p-10 sm:p-16 text-center border border-white/10">
            <div className="w-20 h-20 mx-auto border-4 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin mb-5" />
            <p className="text-white font-semibold text-lg">{status.msg}</p>
            {status.sub && (
              <p className="text-white/60 text-sm mt-1">{status.sub}</p>
            )}
          </div>
        ) : (
          <>
            <div className="relative bg-black rounded-3xl overflow-hidden aspect-[4/3] shadow-2xl border border-white/10">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />

              {scanning &&
                overlays.map((ov, i) => (
                  <div
                    key={i}
                    className="absolute transition-all duration-100 pointer-events-none"
                    style={{
                      left: `${ov.xPct}%`,
                      top: `${ov.yPct}%`,
                      width: `${ov.wPct}%`,
                      height: `${ov.hPct}%`,
                    }}
                  >
                    <div
                      className={`absolute inset-0 rounded-2xl border-4 ${
                        ov.matched
                          ? ov.alreadyMarked
                            ? 'border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.7)]'
                            : 'border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.7)]'
                          : 'border-red-400 shadow-[0_0_24px_rgba(239,68,68,0.7)]'
                      }`}
                    />

                    <div
                      className={`absolute left-1/2 -translate-x-1/2 -top-4 px-3 py-1.5 rounded-full font-bold text-xs shadow-xl whitespace-nowrap ${
                        ov.matched
                          ? ov.alreadyMarked
                            ? 'bg-blue-500 text-white'
                            : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white'
                          : 'bg-gradient-to-r from-red-500 to-rose-600 text-white'
                      }`}
                    >
                      {ov.matched
                        ? ov.alreadyMarked
                          ? `✓ ${ov.name}`
                          : `✅ ${ov.name}`
                        : '❌ Not Registered'}
                    </div>

                    {ov.matched && ov.rollNo && (
                      <div className="absolute left-1/2 -translate-x-1/2 -bottom-7 px-2.5 py-0.5 rounded-md bg-black/80 backdrop-blur text-white text-[10px] font-mono">
                        {ov.rollNo}
                      </div>
                    )}
                  </div>
                ))}

              {!scanning && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto mb-3 bg-white/10 backdrop-blur rounded-2xl flex items-center justify-center">
                      <span className="text-4xl">📷</span>
                    </div>
                    <p className="text-white/70 font-semibold">Camera is off</p>
                  </div>
                </div>
              )}

              {scanning && (
                <div className="absolute top-3 left-3 bg-emerald-500 px-3 py-1.5 rounded-full text-xs font-bold text-white flex items-center gap-2 shadow-lg">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  LIVE • {stats.detected} detected
                </div>
              )}

              {scanning && stats.pending > 0 && (
                <div className="absolute top-3 right-3 bg-amber-500 px-3 py-1.5 rounded-full text-xs font-bold text-white shadow-lg">
                  {stats.pending} pending sync…
                </div>
              )}
            </div>

            <button
              onClick={toggleScan}
              className={`mt-4 w-full py-4 rounded-2xl font-bold text-lg shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-3 ${
                scanning
                  ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-red-500/30'
                  : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-emerald-500/30'
              }`}
            >
              {scanning ? <>⏹️ Stop Scan</> : <>▶️ Start Scan</>}
            </button>

            <div
              className={`mt-4 rounded-2xl border p-5 text-center ${
                statusBg[status.type] || statusBg.info
              }`}
            >
              <div className="text-lg sm:text-xl font-bold">{status.msg}</div>
              {status.sub && (
                <div className="text-sm opacity-80 mt-1">{status.sub}</div>
              )}
            </div>

            {present.length > 0 && (
              <div className="mt-5 bg-white/5 backdrop-blur rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider">
                    Recently Marked
                  </h3>
                  <span className="text-xs text-emerald-300">
                    {present.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {present.map((p, i) => (
                    <div
                      key={`${p.StudentID}-${i}`}
                      className={`flex items-center justify-between rounded-xl p-3 ${
                        p.pending
                          ? 'bg-amber-500/15 border border-amber-500/30'
                          : 'bg-emerald-500/15 border border-emerald-500/30'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white text-sm truncate">
                          {p.Name}
                        </div>
                        {p.RollNo && (
                          <div className="text-xs text-white/50 mt-0.5">
                            {p.RollNo}
                          </div>
                        )}
                      </div>
                      <span
                        className={`text-xs whitespace-nowrap ml-3 ${
                          p.pending ? 'text-amber-300' : 'text-emerald-300'
                        }`}
                      >
                        {p.pending ? '⏳ syncing' : p.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}