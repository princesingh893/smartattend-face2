import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  loadModels,
  analyzeFrame,
  serializeDescriptors,
  checkDuplicateFace,
} from '../lib/face';
import { isAdminLoggedIn, logoutAdmin } from '../lib/auth';
import Header from '../components/Header';
import Loader from '../components/Loader';

// ============================================================
// ENROLLMENT ANGLES
// ============================================================
const ENROLLMENT_ANGLES = [
  { key: 'front', shortLabel: 'Front', label: 'Look straight at the camera', emoji: '👤' },
  { key: 'left', shortLabel: 'Left', label: 'Slowly turn your head LEFT', emoji: '👈' },
  { key: 'right', shortLabel: 'Right', label: 'Slowly turn your head RIGHT', emoji: '👉' },
  { key: 'up', shortLabel: 'Up', label: 'Slowly tilt your head UP', emoji: '👆' },
];

const STABILITY_FRAMES_REQUIRED = 5;
const SCAN_INTERVAL_MS = 350;
const API_TIMEOUT_MS = 15000;

// ============================================================
// 3D DIRECTION ARROW
// ============================================================
function DirectionArrow({ direction }) {
  const cfg =
    {
      front: { rotate: 'rotateY(0deg)', arrow: '⬆️', label: 'STRAIGHT', color: 'from-emerald-500 to-green-600' },
      left: { rotate: 'rotateY(55deg)', arrow: '↩️', label: 'TURN LEFT', color: 'from-indigo-500 to-purple-600' },
      right: { rotate: 'rotateY(-55deg)', arrow: '↪️', label: 'TURN RIGHT', color: 'from-orange-500 to-red-600' },
      up: { rotate: 'rotateX(40deg)', arrow: '⬆️', label: 'TILT UP', color: 'from-cyan-500 to-blue-600' },
    }[direction] || {
      rotate: 'rotateY(0deg)',
      arrow: '⬆️',
      label: 'STRAIGHT',
      color: 'from-emerald-500 to-green-600',
    };

  return (
    <div
      className="flex flex-col items-center justify-center py-3"
      style={{ perspective: '500px' }}
    >
      <div
        className="transition-transform duration-700 ease-out animate-bounce"
        style={{ transform: cfg.rotate }}
      >
        <div
          className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${cfg.color} flex items-center justify-center shadow-2xl`}
        >
          <span className="text-4xl">{cfg.arrow}</span>
        </div>
      </div>
      <p className="mt-2 text-xs font-extrabold tracking-widest text-slate-700">
        {cfg.label}
      </p>
    </div>
  );
}

// ============================================================
// HEAD POSE (coarse approximation)
// ============================================================
function computeHeadPose(landmarks) {
  if (!landmarks?.positions || landmarks.positions.length < 68) return null;
  const p = landmarks.positions;
  const nose = p[30];
  const leftEye = p[36];
  const rightEye = p[45];

  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeCenterY = (leftEye.y + rightEye.y) / 2;
  const faceWidth = Math.max(1, Math.abs(rightEye.x - leftEye.x));

  return {
    yaw: (nose.x - eyeCenterX) / faceWidth,
    pitch: (nose.y - eyeCenterY) / faceWidth,
  };
}

function validateAngle(direction, pose) {
  if (!pose) return false;
  switch (direction) {
    case 'front':
      return Math.abs(pose.yaw) < 0.18;
    case 'left':
      return pose.yaw > 0.10;
    case 'right':
      return pose.yaw < -0.10;
    case 'up':
      return pose.pitch < 0.44;
    default:
      return true;
  }
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message || 'Request timed out')), ms)
    ),
  ]);
}

const STATUS_REASONS = {
  no_face: 'No face detected — look at the camera',
  multiple_faces: 'Multiple faces — only one person',
  too_small: 'Move closer',
  too_large: 'Move farther away',
  not_centered: 'Face not centered',
  low_confidence: 'Improve lighting',
  poor_quality: 'Poor quality — hold still',
};

function bannerStyles(type) {
  switch (type) {
    case 'success':
      return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    case 'error':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'warning':
      return 'bg-amber-50 border-amber-200 text-amber-800';
    default:
      return 'bg-blue-50 border-blue-200 text-blue-700';
  }
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function Admin() {
  const nav = useNavigate();

  const [tab, setTab] = useState('add');
  const [students, setStudents] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState(null);
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({
    student_id: '',
    roll_no: '',
    name: '',
    course: 'BCA',
    semester: 1,
  });

  const [phase, setPhase] = useState('idle');
  const [directionIndex, setDirectionIndex] = useState(0);
  const [stabilityProgress, setStabilityProgress] = useState(0);
  const [capturedSamples, setCapturedSamples] = useState([]);
  const [liveMessage, setLiveMessage] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const loopRunningRef = useRef(false);
  const phaseRef = useRef('idle');
  const directionRef = useRef(0);
  const stabilityRef = useRef(0);
  const lastBoxRef = useRef(null);
  const lastFrameTsRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    directionRef.current = directionIndex;
  }, [directionIndex]);

  useEffect(() => {
    if (!isAdminLoggedIn()) nav('/admin-login', { replace: true });
  }, [nav]);

  const loadStudents = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const data = await withTimeout(
        api.getStudents(),
        API_TIMEOUT_MS,
        'Loading timed out'
      );
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      setListError(err.message || 'Failed to load students');
      setStudents([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    if (tab === 'add') loadModels().catch(() => {});
  }, [tab]);

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {}
      if (v.srcObject) {
        try {
          v.srcObject.getTracks().forEach((t) => t.stop());
        } catch {}
        v.srcObject = null;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      loopRunningRef.current = false;
      stopStream();
    };
  }, [stopStream]);

  const handleLogout = () => {
    loopRunningRef.current = false;
    stopStream();
    logoutAdmin();
    nav('/', { replace: true });
  };

  const startCamera = async () => {
    if (streamRef.current) return true;

    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveMessage({ type: 'error', text: 'Camera not supported' });
      setPhase('camera-error');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (err) {
      let text = 'Camera could not start.';
      if (err.name === 'NotAllowedError')
        text = 'Camera permission denied — allow it in browser';
      else if (err.name === 'NotFoundError') text = 'No camera found';
      else if (err.name === 'NotReadableError')
        text = 'Camera in use by another app';
      else text = 'Camera error: ' + err.message;

      setLiveMessage({ type: 'error', text });
      setPhase('camera-error');
      return false;
    }
  };

  const startEnrollment = async () => {
    setStatusMsg(null);
    setLiveMessage(null);
    setCapturedSamples([]);
    setDirectionIndex(0);
    setStabilityProgress(0);
    stabilityRef.current = 0;
    lastBoxRef.current = null;
    setPhase('starting');

    const ok = await startCamera();
    if (!ok) return;

    setPhase('capturing');
    setLiveMessage({ type: 'info', text: ENROLLMENT_ANGLES[0].label });

    if (!loopRunningRef.current) {
      loopRunningRef.current = true;
      enrollLoop();
    }
  };

  const enrollLoop = async () => {
    if (!loopRunningRef.current) return;

    const video = videoRef.current;
    const now = performance.now();

    if (now - lastFrameTsRef.current < SCAN_INTERVAL_MS) {
      requestAnimationFrame(enrollLoop);
      return;
    }
    lastFrameTsRef.current = now;

    if (video && video.readyState === 4 && phaseRef.current === 'capturing') {
      try {
        const analysis = await analyzeFrame(video);

        if (analysis.status !== 'ok') {
          stabilityRef.current = 0;
          lastBoxRef.current = null;
          setStabilityProgress(0);
          setLiveMessage({
            type: 'warning',
            text: STATUS_REASONS[analysis.status] || 'Hold still',
          });
        } else {
          const dir = ENROLLMENT_ANGLES[directionRef.current];
          const pose = computeHeadPose(analysis.landmarks);
          const poseOk = validateAngle(dir.key, pose);

          if (!poseOk) {
            stabilityRef.current = 0;
            lastBoxRef.current = analysis.box;
            setStabilityProgress(0);
            setLiveMessage({ type: 'warning', text: dir.label });
          } else {
            const box = analysis.box;
            const prev = lastBoxRef.current;
            const isStable =
              prev &&
              Math.abs(box.x - prev.x) < 30 &&
              Math.abs(box.y - prev.y) < 30;

            lastBoxRef.current = box;

            if (isStable) {
              stabilityRef.current += 1;
            } else {
              stabilityRef.current = Math.max(0, stabilityRef.current - 1);
            }

            const pct = Math.min(
              100,
              Math.round(
                (stabilityRef.current / STABILITY_FRAMES_REQUIRED) * 100
              )
            );
            setStabilityProgress(pct);
            setLiveMessage({
              type: 'success',
              text: `${dir.label} — hold still (${pct}%)`,
            });

            if (stabilityRef.current >= STABILITY_FRAMES_REQUIRED) {
              const capturedIdx = directionRef.current;

              setCapturedSamples((prevSamples) => [
                ...prevSamples,
                {
                  angle: ENROLLMENT_ANGLES[capturedIdx].key,
                  descriptor: analysis.descriptor,
                },
              ]);

              stabilityRef.current = 0;
              lastBoxRef.current = null;
              setStabilityProgress(0);

              if (capturedIdx + 1 >= ENROLLMENT_ANGLES.length) {
                loopRunningRef.current = false;
                setPhase('complete');
                stopStream();
                setLiveMessage({
                  type: 'success',
                  text: 'All 4 angles captured! Click "Save Student".',
                });
                return;
              } else {
                setDirectionIndex(capturedIdx + 1);
                setLiveMessage({
                  type: 'info',
                  text: `Captured ${ENROLLMENT_ANGLES[capturedIdx].shortLabel}. Next: ${
                    ENROLLMENT_ANGLES[capturedIdx + 1].label
                  }`,
                });
              }
            }
          }
        }
      } catch {}
    }

    requestAnimationFrame(enrollLoop);
  };

  const cancelEnrollment = () => {
    loopRunningRef.current = false;
    stopStream();
    setPhase('idle');
    setCapturedSamples([]);
    setDirectionIndex(0);
    setStabilityProgress(0);
    stabilityRef.current = 0;
    lastBoxRef.current = null;
    setLiveMessage(null);
  };

  // ============================================================
  // SUBMIT — WITH DUPLICATE FACE CHECK
  // ============================================================
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    const studentId = form.student_id.trim();
    const rollNo = form.roll_no.trim();
    const name = form.name.trim();

    // ---- Form validation ----
    if (!studentId)
      return setStatusMsg({ type: 'error', text: 'Student ID required' });
    if (!rollNo)
      return setStatusMsg({ type: 'error', text: 'Roll number required' });
    if (!name)
      return setStatusMsg({ type: 'error', text: 'Full name required' });
    if (!/^[A-Za-z0-9_-]+$/.test(studentId)) {
      return setStatusMsg({
        type: 'error',
        text: 'Student ID: only letters, numbers, - and _ allowed',
      });
    }

    // ---- Enrollment validation ----
    if (capturedSamples.length < ENROLLMENT_ANGLES.length) {
      return setStatusMsg({
        type: 'error',
        text: `Face registration incomplete — ${capturedSamples.length}/${ENROLLMENT_ANGLES.length} angles`,
      });
    }

    // ---- Duplicate Student ID check ----
    const existingId = students.find(
      (s) =>
        String(s.StudentID || '').trim().toLowerCase() ===
        studentId.toLowerCase()
    );
    if (existingId) {
      return setStatusMsg({
        type: 'error',
        text: `Student ID "${studentId}" already exists (${existingId.Name})`,
      });
    }

    // ============================================================
    // 🚨 DUPLICATE FACE CHECK
    // ============================================================
    setStatusMsg({ type: 'info', text: 'Checking for duplicate faces…' });
    await new Promise((r) => setTimeout(r, 50));

    const newDescriptor = capturedSamples[0]?.descriptor;

    if (!newDescriptor) {
      return setStatusMsg({
        type: 'error',
        text: 'Face descriptor missing — please re-enroll',
      });
    }

    const duplicate = checkDuplicateFace(newDescriptor, students);

    if (duplicate) {
      return setStatusMsg({
        type: 'error',
        text:
          `⚠️ This face is already registered as "${duplicate.student.Name}" ` +
          `(${duplicate.student.StudentID}). ` +
          `Cannot register the same face under two names. ` +
          `If this is a mistake, delete the old record from the Students sheet.`,
      });
    }

    // ============================================================
    // SAVE STUDENT
    // ============================================================
    setSaving(true);
    setStatusMsg({ type: 'info', text: 'Saving student…' });

    try {
      const descriptorString = serializeDescriptors(
        capturedSamples.map((s) => s.descriptor)
      );

      const payload = {
        student_id: studentId,
        roll_no: rollNo,
        name,
        course: form.course,
        semester: form.semester,
        photo_url: '',
        face_descriptor: descriptorString,
      };

      const res = await withTimeout(
        api.addStudent(payload),
        API_TIMEOUT_MS,
        'Save timed out'
      );

      if (!res || typeof res !== 'object') {
        throw new Error('Server returned invalid response');
      }
      if (res.error === 'Unauthorized') {
        throw new Error('API key rejected — check Apps Script SECRET_KEY');
      }
      if (!res.success) {
        throw new Error(res.message || 'Server rejected the student');
      }

      setStatusMsg({
        type: 'success',
        text: `Student "${name}" enrolled successfully!`,
      });
      setForm({
        student_id: '',
        roll_no: '',
        name: '',
        course: 'BCA',
        semester: 1,
      });
      setCapturedSamples([]);
      setDirectionIndex(0);
      setPhase('idle');
      setLiveMessage(null);
      await loadStudents();
    } catch (err) {
      const msg = err.message || 'Unknown error';
      if (
        msg.includes('invalid response') ||
        msg.includes('Failed to fetch') ||
        msg.includes('timed out')
      ) {
        setStatusMsg({
          type: 'error',
          text:
            'Server returned unexpected response. Check: (1) Apps Script deployed as Web app "Anyone", (2) URL ends with /exec, (3) internet is stable.',
        });
      } else {
        setStatusMsg({ type: 'error', text: msg });
      }
    } finally {
      setSaving(false);
    }
  };

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        String(s.StudentID || '').toLowerCase().includes(q) ||
        String(s.RollNo || '').toLowerCase().includes(q) ||
        String(s.Name || '').toLowerCase().includes(q)
    );
  }, [students, search]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50">
      <Header isAdmin onLogout={handleLogout} />

      <main className="max-w-6xl mx-auto px-3 sm:px-5 py-5 sm:py-8">
        <div className="mb-5 sm:mb-7">
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900">
            Admin Panel
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Enroll students with 4-angle face registration
          </p>
        </div>

        <div className="flex gap-2 mb-5 bg-white p-1 rounded-2xl shadow-md shadow-slate-200/60 w-fit">
          <TabBtn active={tab === 'add'} onClick={() => setTab('add')} icon="➕">
            Add Student
          </TabBtn>
          <TabBtn active={tab === 'list'} onClick={() => setTab('list')} icon="👥">
            Students
            {students.length > 0 && (
              <span className="ml-1 text-[10px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full">
                {students.length}
              </span>
            )}
          </TabBtn>
        </div>

        {statusMsg && (
          <div
            className={`mb-5 px-4 py-3 rounded-xl border text-sm font-semibold ${bannerStyles(
              statusMsg.type
            )}`}
          >
            {statusMsg.text}
          </div>
        )}

        {tab === 'add' && (
          <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
            {/* LEFT: FORM */}
            <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-white p-5 sm:p-6">
              <h2 className="font-heading text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                  📝
                </span>
                Student Details
              </h2>

              <form onSubmit={submit} className="space-y-3.5">
                <InputField
                  label="Student ID"
                  placeholder="STU001"
                  value={form.student_id}
                  onChange={(v) => setForm({ ...form, student_id: v })}
                  disabled={saving || phase === 'capturing'}
                />
                <InputField
                  label="Roll Number"
                  placeholder="BCA-001"
                  value={form.roll_no}
                  onChange={(v) => setForm({ ...form, roll_no: v })}
                  disabled={saving || phase === 'capturing'}
                />
                <InputField
                  label="Full Name"
                  placeholder="Prince Singh"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  disabled={saving || phase === 'capturing'}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">
                      Course
                    </label>
                    <select
                      value={form.course}
                      onChange={(e) =>
                        setForm({ ...form, course: e.target.value })
                      }
                      disabled={saving || phase === 'capturing'}
                      className="w-full px-3.5 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 text-slate-900 font-medium"
                    >
                      <option value="BCA">BCA</option>
                      <option value="BBA">BBA</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">
                      Semester
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      required
                      value={form.semester}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          semester: parseInt(e.target.value) || 1,
                        })
                      }
                      disabled={saving || phase === 'capturing'}
                      className="w-full px-3.5 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 text-slate-900 font-medium"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    capturedSamples.length < ENROLLMENT_ANGLES.length
                  }
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-indigo-500/30 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                >
                  {saving ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>💾 Save Student</>
                  )}
                </button>

                {capturedSamples.length < ENROLLMENT_ANGLES.length &&
                  !saving && (
                    <p className="text-xs text-center text-slate-400">
                      {capturedSamples.length}/{ENROLLMENT_ANGLES.length} face
                      angles captured
                    </p>
                  )}
              </form>
            </div>

            {/* RIGHT: ENROLLMENT */}
            <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-white p-5 sm:p-6">
              <h2 className="font-heading text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600">
                  📸
                </span>
                Face Enrollment
              </h2>

              {/* Angle tracker */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {ENROLLMENT_ANGLES.map((d, i) => {
                  const done = i < capturedSamples.length;
                  const active = i === directionIndex && phase === 'capturing';
                  return (
                    <div
                      key={d.key}
                      className={`rounded-xl p-2 text-center transition-all ${
                        done
                          ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                          : active
                          ? 'bg-indigo-100 border-2 border-indigo-400 text-indigo-700'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <div className="text-lg">{done ? '✓' : d.emoji}</div>
                      <div className="text-[10px] font-bold uppercase mt-0.5">
                        {d.shortLabel}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 3D Direction Arrow */}
              {phase === 'capturing' && (
                <div className="mb-3 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-2 border border-indigo-100">
                  <DirectionArrow
                    direction={ENROLLMENT_ANGLES[directionIndex].key}
                  />
                </div>
              )}

              {/* Camera view */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3]">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />

                {phase === 'capturing' && (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-40 h-56 border-4 border-emerald-400/70 rounded-3xl" />
                    </div>
                    <div className="absolute top-3 left-3 bg-emerald-500 px-3 py-1.5 rounded-full text-xs font-bold text-white flex items-center gap-2 shadow-lg">
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                      Step {directionIndex + 1}/{ENROLLMENT_ANGLES.length}
                    </div>
                    <div className="absolute bottom-3 left-3 right-3">
                      <div className="bg-black/60 backdrop-blur rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all duration-200"
                          style={{ width: `${stabilityProgress}%` }}
                        />
                      </div>
                    </div>
                  </>
                )}

                {phase === 'idle' && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-center px-6">
                    <div className="w-16 h-16 mb-3 bg-white/10 rounded-2xl flex items-center justify-center">
                      <span className="text-3xl">📷</span>
                    </div>
                    <p className="text-white font-semibold mb-1">Camera is off</p>
                    <p className="text-white/60 text-xs">
                      Click "Start Face Registration" below
                    </p>
                  </div>
                )}

                {phase === 'starting' && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center">
                    <Loader text="Starting camera…" variant="white" />
                  </div>
                )}

                {phase === 'complete' && (
                  <div className="absolute inset-0 bg-emerald-600/95 flex flex-col items-center justify-center text-center px-6">
                    <div className="w-16 h-16 mb-3 bg-white rounded-full flex items-center justify-center">
                      <span className="text-3xl text-emerald-600">✓</span>
                    </div>
                    <p className="text-white font-bold text-lg">
                      All 4 angles captured
                    </p>
                    <p className="text-white/80 text-xs mt-1">
                      Click "Save Student" to finish
                    </p>
                  </div>
                )}

                {phase === 'camera-error' && (
                  <div className="absolute inset-0 bg-red-900/90 flex flex-col items-center justify-center text-center px-6">
                    <span className="text-3xl mb-2">🚫</span>
                    <p className="text-white font-semibold mb-1">
                      Camera unavailable
                    </p>
                    <p className="text-white/70 text-xs">See message below</p>
                  </div>
                )}
              </div>

              {liveMessage && (
                <div
                  className={`mt-3 px-3 py-2.5 rounded-xl text-sm font-semibold ${
                    liveMessage.type === 'success'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                      : liveMessage.type === 'warning'
                      ? 'bg-amber-50 border border-amber-200 text-amber-800'
                      : liveMessage.type === 'error'
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-blue-50 border border-blue-200 text-blue-700'
                  }`}
                >
                  {liveMessage.text}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                {phase === 'idle' && (
                  <button
                    type="button"
                    onClick={startEnrollment}
                    disabled={saving}
                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/30 transition active:scale-95 disabled:opacity-50"
                  >
                    🎥 Start Face Registration
                  </button>
                )}
                {phase === 'capturing' && (
                  <button
                    type="button"
                    onClick={cancelEnrollment}
                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                  >
                    Cancel Enrollment
                  </button>
                )}
                {phase === 'complete' && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhase('idle');
                      setCapturedSamples([]);
                      setDirectionIndex(0);
                      setLiveMessage(null);
                    }}
                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                  >
                    Restart Enrollment
                  </button>
                )}
                {phase === 'camera-error' && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhase('idle');
                      setLiveMessage(null);
                    }}
                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                  >
                    Try Again
                  </button>
                )}
              </div>

              {phase === 'idle' && capturedSamples.length === 0 && (
                <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-800">
                  <p className="font-bold mb-1">📋 Instructions</p>
                  <ul className="space-y-0.5 list-disc list-inside opacity-90">
                    <li>Camera opens and captures 4 angles automatically</li>
                    <li>Order: Front → Left → Right → Up</li>
                    <li>Follow the on-screen 3D arrow</li>
                    <li>Hold still ~2 sec per angle</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'list' && (
          <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
              <h2 className="font-heading font-bold text-slate-900 mr-auto">
                All Students ({students.length})
              </h2>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ID, roll, or name"
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-64"
              />
              <button
                onClick={loadStudents}
                className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-indigo-100 flex items-center justify-center text-slate-600 hover:text-indigo-600 transition"
              >
                <svg
                  className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>

            {listError && (
              <div className="mx-5 mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
                {listError}
                <button
                  onClick={loadStudents}
                  className="ml-3 underline font-bold"
                >
                  Retry
                </button>
              </div>
            )}

            {loadingList ? (
              <div className="py-12">
                <Loader text="Loading students…" />
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-14">
                <div className="text-5xl mb-3 opacity-30">👥</div>
                <p className="text-slate-400 font-medium">
                  {search
                    ? 'No students match your search'
                    : 'No students added yet'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold">ID</th>
                      <th className="px-4 py-3 text-left font-bold">Roll</th>
                      <th className="px-4 py-3 text-left font-bold">Name</th>
                      <th className="px-4 py-3 text-left font-bold hidden sm:table-cell">
                        Course
                      </th>
                      <th className="px-4 py-3 text-left font-bold hidden sm:table-cell">
                        Sem
                      </th>
                      <th className="px-4 py-3 text-left font-bold">Face</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((s) => {
                      const sampleCount = s.FaceDescriptor
                        ? String(s.FaceDescriptor).split('|').length
                        : 0;
                      return (
                        <tr
                          key={s.StudentID}
                          className="hover:bg-indigo-50/40 transition"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">
                            {s.StudentID}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {s.RollNo}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {s.Name}
                          </td>
                          <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                            {s.Course}
                          </td>
                          <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                            {s.Semester}
                          </td>
                          <td className="px-4 py-3">
                            {sampleCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-xs bg-emerald-50 px-2 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                {sampleCount} angle
                                {sampleCount > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-500 font-bold text-xs bg-red-50 px-2 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                                None
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================
// SMALL COMPONENTS
// ============================================================
function TabBtn({ active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 sm:px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
        active
          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/30'
          : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
      }`}
    >
      <span>{icon}</span>
      <span className="flex items-center">{children}</span>
    </button>
  );
}

function InputField({ label, placeholder, value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3.5 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 text-slate-900 placeholder:text-slate-400 transition"
      />
    </div>
  );
}