import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ScanFace,
  Camera,
  CameraOff,
  Square,
  Play,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  loadModels,
  analyzeAllFaces,
  matchStudent,
  FACE_CONFIG,
} from '../lib/face';
import AppShell from '../components/AppShell';
import Badge from '../components/ui/Badge';

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
          `${okCount} attendance synced`,
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
          facingMode: { ideal: 'environment' },
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

  // ============================================================
  // UI HELPERS
  // ============================================================
  const totalStudents = studentsRef.current.length;
  const lastMarked = present[0] || null;
  const cameraError =
    !scanning && status.type === 'error' && /camera/i.test(status.msg + status.sub);

  const statusUi = {
    success: {
      icon: CheckCircle2,
      pill: 'bg-green-600 text-white',
    },
    error: { icon: XCircle, pill: 'bg-red-600 text-white' },
    warning: { icon: AlertTriangle, pill: 'bg-amber-500 text-white' },
    info: { icon: Info, pill: 'bg-slate-900/85 text-white' },
  };
  const StatusIcon = (statusUi[status.type] || statusUi.info).icon;

  return (
    <AppShell title="Attendance" subtitle="Face recognition scanning" flush>
      <div className="flex-1 flex flex-col w-full lg:max-w-4xl lg:mx-auto lg:px-8 lg:py-6">
        {!ready ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-10 text-center w-full max-w-sm">
              {status.type === 'error' ? (
                <>
                  <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-red-600" aria-hidden />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{status.msg}</p>
                  {status.sub && (
                    <p className="text-xs text-slate-500 mt-1">{status.sub}</p>
                  )}
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 mx-auto border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4" />
                  <p className="text-sm font-semibold text-slate-900">{status.msg}</p>
                  {status.sub && (
                    <p className="text-xs text-slate-500 mt-1">{status.sub}</p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* ============ CAMERA (fills available mobile viewport) ============ */}
            <div className="relative flex-1 min-h-[280px] lg:min-h-0 lg:flex-none lg:aspect-[4/3] bg-slate-950 lg:rounded-xl lg:border lg:border-slate-200 overflow-hidden">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />

              {/* Face overlays — labels clamped inside the frame */}
              {scanning &&
                overlays.map((ov, i) => {
                  const labelAbove = ov.yPct > 14;
                  return (
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
                        className={`absolute inset-0 rounded-lg border-2 ${
                          ov.matched
                            ? ov.alreadyMarked
                              ? 'border-sky-400'
                              : 'border-green-400'
                            : 'border-red-400'
                        }`}
                      />
                      <div
                        className={`absolute left-0 px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap max-w-full overflow-hidden text-ellipsis ${
                          labelAbove ? '-top-7' : 'top-1 left-1'
                        } ${
                          ov.matched
                            ? ov.alreadyMarked
                              ? 'bg-sky-600 text-white'
                              : 'bg-green-600 text-white'
                            : 'bg-red-600 text-white'
                        }`}
                      >
                        {ov.matched
                          ? ov.alreadyMarked
                            ? `${ov.name} · already marked`
                            : ov.name
                          : 'Not registered'}
                      </div>
                      {ov.matched && ov.rollNo && (
                        <div className="absolute left-0 -bottom-6 px-1.5 py-0.5 rounded bg-slate-900/80 text-white text-[10px] font-mono whitespace-nowrap">
                          {ov.rollNo}
                        </div>
                      )}
                    </div>
                  );
                })}

              {/* Camera-off placeholder */}
              {!scanning && (
                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center text-center px-6">
                  {cameraError ? (
                    <>
                      <div className="w-14 h-14 mb-4 bg-red-500/15 rounded-xl flex items-center justify-center">
                        <CameraOff className="w-7 h-7 text-red-400" aria-hidden />
                      </div>
                      <p className="text-white font-semibold text-sm">
                        {status.sub || status.msg}
                      </p>
                      <p className="text-slate-400 text-xs mt-1.5 max-w-xs">
                        Allow camera access in your browser settings, make sure no
                        other app is using the camera, then try again.
                      </p>
                      <button
                        onClick={startCamera}
                        className="mt-4 h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                      >
                        Retry Camera
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 mb-4 bg-white/10 rounded-xl flex items-center justify-center">
                        <Camera className="w-7 h-7 text-slate-400" aria-hidden />
                      </div>
                      <p className="text-slate-300 font-medium text-sm">
                        Camera is off
                      </p>
                      <p className="text-slate-500 text-xs mt-1">
                        Tap “Start Scan” below to begin attendance
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Live status pill (top center, always visible) */}
              {scanning && (
                <div className="absolute top-3 inset-x-3 flex justify-center pointer-events-none">
                  <div
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold shadow-lg max-w-full ${
                      (statusUi[status.type] || statusUi.info).pill
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    <StatusIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{status.msg}</span>
                  </div>
                </div>
              )}

              {/* Live counter badge */}
              {scanning && (
                <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-none">
                  <span className="inline-flex items-center gap-1.5 bg-slate-900/80 text-white px-2.5 py-1.5 rounded-md text-[11px] font-semibold">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                    LIVE · {stats.detected} in frame
                  </span>
                  {stats.pending > 0 && (
                    <span className="inline-flex items-center gap-1.5 bg-amber-500 text-white px-2.5 py-1.5 rounded-md text-[11px] font-semibold">
                      <Clock className="w-3 h-3" aria-hidden />
                      {stats.pending} syncing
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ============ CONTROLS (always visible, thumb reach) ============ */}
            <div className="shrink-0 bg-white border-t border-slate-200 lg:border lg:rounded-xl lg:shadow-card lg:mt-4 px-4 pt-3 pb-4 pb-safe lg:p-5">
              {/* Progress */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500">
                  Present this session
                </span>
                <span className="text-xs font-semibold text-slate-900 tabular-nums">
                  {present.length}
                  {totalStudents > 0 ? ` / ${totalStudents}` : ''}
                </span>
              </div>
              {totalStudents > 0 && (
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-green-600 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (present.length / totalStudents) * 100)}%`,
                    }}
                  />
                </div>
              )}

              {/* Last marked feedback */}
              {lastMarked && (
                <div
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 mb-3 ${
                    lastMarked.pending
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-green-50 border-green-200'
                  }`}
                  role="status"
                >
                  {lastMarked.pending ? (
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {lastMarked.Name}
                    </p>
                    {lastMarked.RollNo && (
                      <p className="text-xs text-slate-500">{lastMarked.RollNo}</p>
                    )}
                  </div>
                  {lastMarked.pending ? (
                    <Badge variant="warning">Syncing</Badge>
                  ) : (
                    <Badge variant="success">Present</Badge>
                  )}
                </div>
              )}

              {/* Start / Stop — 48px touch target */}
              <button
                onClick={toggleScan}
                className={`w-full h-12 rounded-lg font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors shadow-sm ${
                  scanning
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {scanning ? (
                  <>
                    <Square className="w-4 h-4" aria-hidden /> Stop Attendance
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" aria-hidden /> Start Scan
                  </>
                )}
              </button>

              {status.sub && scanning && (
                <p className="text-center text-xs text-slate-500 mt-2 truncate">
                  {status.sub}
                </p>
              )}
            </div>

            {/* ============ RECENT SCANS (desktop list; mobile summary) ============ */}
            {present.length > 0 && (
              <div className="hidden lg:block bg-white rounded-xl border border-slate-200 shadow-card mt-4">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
                    <ScanFace className="w-4 h-4 text-slate-400" aria-hidden />
                    Recently Marked
                  </h3>
                  <span className="text-xs font-medium text-slate-500">
                    {present.length} student{present.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="p-4 grid grid-cols-2 gap-2">
                  {present.map((p, i) => (
                    <div
                      key={`${p.StudentID}-${i}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {p.Name}
                        </div>
                        {p.RollNo && (
                          <div className="text-xs text-slate-500">{p.RollNo}</div>
                        )}
                      </div>
                      {p.pending ? (
                        <Badge variant="warning">Syncing</Badge>
                      ) : (
                        <Badge variant="success">Present</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
