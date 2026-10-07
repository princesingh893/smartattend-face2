import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus,
  Users,
  Check,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  LogOut,
  RefreshCw,
  Search,
  Save,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  loadModels,
  analyzeFrame,
  serializeDescriptors,
  checkDuplicateFace,
} from '../lib/face';
import { isAdminLoggedIn, logoutAdmin } from '../lib/auth';
import AppShell from '../components/AppShell';
import Loader from '../components/Loader';
import { Button, Card, Input, Select, Badge, EmptyState, toast } from '../components/ui';
import { SkeletonTable } from '../components/ui/Skeleton';

// ============================================================
// ENROLLMENT ANGLES
// ============================================================
const ENROLLMENT_ANGLES = [
  { key: 'front', shortLabel: 'Front', label: 'Look straight at the camera' },
  { key: 'left', shortLabel: 'Left', label: 'Slowly turn your head LEFT' },
  { key: 'right', shortLabel: 'Right', label: 'Slowly turn your head RIGHT' },
  { key: 'up', shortLabel: 'Up', label: 'Slowly tilt your head UP' },
];

const STABILITY_FRAMES_REQUIRED = 5;
const SCAN_INTERVAL_MS = 350;
const API_TIMEOUT_MS = 15000;

// ============================================================
// DIRECTION PROMPT (flat, professional)
// ============================================================
function DirectionPrompt({ direction }) {
  const cfg =
    {
      front: { Icon: ArrowUp, label: 'LOOK STRAIGHT' },
      left: { Icon: ArrowLeft, label: 'TURN LEFT' },
      right: { Icon: ArrowRight, label: 'TURN RIGHT' },
      up: { Icon: ArrowUp, label: 'TILT UP' },
    }[direction] || { Icon: ArrowUp, label: 'LOOK STRAIGHT' };

  return (
    <div className="flex items-center justify-center gap-3 py-3">
      <div className="w-11 h-11 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
        <cfg.Icon className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold tracking-wide text-slate-700">
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
      return 'bg-green-50 border-green-200 text-green-700';
    case 'error':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'warning':
      return 'bg-amber-50 border-amber-200 text-amber-800';
    default:
      return 'bg-sky-50 border-sky-200 text-sky-700';
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
        text = 'Camera permission denied — allow it in browser settings, then try again';
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
          `This face is already registered as "${duplicate.student.Name}" ` +
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
      toast.success('Student enrolled', name);
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
      toast.error('Could not save student', 'See message on page');
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
    <AppShell
      title="Admin Panel"
      subtitle="Enroll students with 4-angle face registration"
      maxW="max-w-6xl"
      actions={
        <Button variant="secondary" size="sm" icon={LogOut} onClick={handleLogout}>
          Logout
        </Button>
      }
    >
      {/* Tabs — segmented control */}
      <div
        className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-lg w-fit"
        role="tablist"
        aria-label="Admin sections"
      >
        <TabBtn
          active={tab === 'add'}
          onClick={() => setTab('add')}
          icon={UserPlus}
        >
          Add Student
        </TabBtn>
        <TabBtn
          active={tab === 'list'}
          onClick={() => setTab('list')}
          icon={Users}
          count={students.length}
        >
          Students
        </TabBtn>
      </div>

      {statusMsg && (
        <div
          className={`mb-5 px-4 py-3 rounded-lg border text-sm font-medium ${bannerStyles(
            statusMsg.type
          )}`}
          role="alert"
        >
          {statusMsg.text}
        </div>
      )}

      {tab === 'add' && (
        <div className="grid md:grid-cols-2 gap-4 sm:gap-5">
          {/* LEFT: FORM */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-4">
              Student Details
            </h2>

            <form onSubmit={submit} className="space-y-4">
              <Input
                label="Student ID"
                placeholder="STU001"
                value={form.student_id}
                onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                disabled={saving || phase === 'capturing'}
                required
              />
              <Input
                label="Roll Number"
                placeholder="BCA-001"
                value={form.roll_no}
                onChange={(e) => setForm({ ...form, roll_no: e.target.value })}
                disabled={saving || phase === 'capturing'}
                required
              />
              <Input
                label="Full Name"
                placeholder="Prince Singh"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving || phase === 'capturing'}
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Course"
                  value={form.course}
                  onChange={(e) => setForm({ ...form, course: e.target.value })}
                  disabled={saving || phase === 'capturing'}
                >
                  <option value="BCA">BCA</option>
                  <option value="BBA">BBA</option>
                </Select>
                <Input
                  label="Semester"
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
                />
              </div>

              <Button
                type="submit"
                size="lg"
                icon={Save}
                loading={saving}
                disabled={
                  saving || capturedSamples.length < ENROLLMENT_ANGLES.length
                }
                className="w-full"
              >
                {saving ? 'Saving…' : 'Save Student'}
              </Button>

              {capturedSamples.length < ENROLLMENT_ANGLES.length && !saving && (
                <p className="text-xs text-center text-slate-500">
                  {capturedSamples.length}/{ENROLLMENT_ANGLES.length} face angles
                  captured
                </p>
              )}
            </form>
          </Card>

          {/* RIGHT: ENROLLMENT */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-4">
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
                    className={`rounded-lg py-2 text-center transition-colors border ${
                      done
                        ? 'bg-green-600 border-green-600 text-white'
                        : active
                        ? 'bg-blue-50 border-blue-600 text-blue-700'
                        : 'bg-slate-50 border-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="flex justify-center">
                      {done ? (
                        <Check className="w-4 h-4" aria-hidden />
                      ) : (
                        <span className="text-xs font-bold">{i + 1}</span>
                      )}
                    </div>
                    <div className="text-[10px] font-semibold uppercase mt-1">
                      {d.shortLabel}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Direction prompt */}
            {phase === 'capturing' && (
              <div className="mb-3 bg-slate-50 rounded-lg border border-slate-200">
                <DirectionPrompt
                  direction={ENROLLMENT_ANGLES[directionIndex].key}
                />
              </div>
            )}

            {/* Camera view */}
            <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-[4/3] border border-slate-200">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />

              {phase === 'capturing' && (
                <>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-56 border-2 border-green-400/80 rounded-2xl" />
                  </div>
                  <div className="absolute top-3 left-3 bg-slate-900/85 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                    Step {directionIndex + 1}/{ENROLLMENT_ANGLES.length}
                  </div>
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="bg-slate-900/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all duration-200"
                        style={{ width: `${stabilityProgress}%` }}
                      />
                    </div>
                  </div>
                </>
              )}

              {phase === 'idle' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                  <div className="w-12 h-12 mb-3 bg-white/10 rounded-xl flex items-center justify-center">
                    <Camera className="w-6 h-6 text-slate-400" aria-hidden />
                  </div>
                  <p className="text-slate-300 text-sm font-medium">
                    Camera is off
                  </p>
                  <p className="text-slate-500 text-xs mt-1">
                    Click “Start Face Registration” below
                  </p>
                </div>
              )}

              {phase === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader text="Starting camera…" variant="white" />
                </div>
              )}

              {phase === 'complete' && (
                <div className="absolute inset-0 bg-green-600/95 flex flex-col items-center justify-center text-center px-6">
                  <div className="w-12 h-12 mb-3 bg-white rounded-full flex items-center justify-center">
                    <Check className="w-6 h-6 text-green-600" aria-hidden />
                  </div>
                  <p className="text-white font-semibold text-sm">
                    All 4 angles captured
                  </p>
                  <p className="text-white/80 text-xs mt-1">
                    Click “Save Student” to finish
                  </p>
                </div>
              )}

              {phase === 'camera-error' && (
                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center text-center px-6">
                  <div className="w-12 h-12 mb-3 bg-red-500/15 rounded-xl flex items-center justify-center">
                    <CameraOff className="w-6 h-6 text-red-400" aria-hidden />
                  </div>
                  <p className="text-white font-medium text-sm">
                    Camera unavailable
                  </p>
                  <p className="text-slate-400 text-xs mt-1">
                    See message below
                  </p>
                </div>
              )}
            </div>

            {liveMessage && (
              <div
                className={`mt-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  liveMessage.type === 'success'
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : liveMessage.type === 'warning'
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : liveMessage.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-700'
                    : 'bg-sky-50 border border-sky-200 text-sky-700'
                }`}
                role="status"
              >
                {liveMessage.text}
              </div>
            )}

            <div className="mt-3">
              {phase === 'idle' && (
                <Button
                  variant="success"
                  size="lg"
                  icon={Camera}
                  onClick={startEnrollment}
                  disabled={saving}
                  className="w-full"
                >
                  Start Face Registration
                </Button>
              )}
              {phase === 'capturing' && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={XCircle}
                  onClick={cancelEnrollment}
                  className="w-full"
                >
                  Cancel Enrollment
                </Button>
              )}
              {(phase === 'complete' || phase === 'camera-error') && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={RotateCcw}
                  onClick={() => {
                    setPhase('idle');
                    setCapturedSamples([]);
                    setDirectionIndex(0);
                    setLiveMessage(null);
                  }}
                  className="w-full"
                >
                  {phase === 'complete' ? 'Restart Enrollment' : 'Try Again'}
                </Button>
              )}
            </div>

            {phase === 'idle' && capturedSamples.length === 0 && (
              <div className="mt-4 bg-sky-50 border border-sky-200 rounded-lg p-3.5 text-xs text-sky-800">
                <p className="font-semibold mb-1.5">How it works</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Camera opens and captures 4 angles automatically</li>
                  <li>Order: Front → Left → Right → Up</li>
                  <li>Follow the on-screen direction prompt</li>
                  <li>Hold still ~2 seconds per angle</li>
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'list' && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-semibold text-slate-900 mr-auto">
              All Students
              <span className="ml-2 text-xs font-medium text-slate-500">
                {students.length}
              </span>
            </h2>
            <div className="relative w-full sm:w-64">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                aria-hidden
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ID, roll, or name"
                aria-label="Search students"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
            <button
              onClick={loadStudents}
              aria-label="Refresh students"
              className="w-10 h-10 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500"
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`}
              />
            </button>
          </div>

          {listError && (
            <div className="mx-5 mt-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {listError}
              <button onClick={loadStudents} className="ml-3 underline font-semibold">
                Retry
              </button>
            </div>
          )}

          {loadingList ? (
            <SkeletonTable rows={6} />
          ) : filteredStudents.length === 0 ? (
            <EmptyState
              icon={Users}
              title={search ? 'No students match your search' : 'No students added yet'}
              description={
                search
                  ? 'Try a different name, roll number, or ID.'
                  : 'Enroll your first student from the Add Student tab.'
              }
              actionLabel={search ? undefined : 'Add Student'}
              onAction={search ? undefined : () => setTab('add')}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        ID
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Roll
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Course
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Sem
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Face
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((s) => {
                      const sampleCount = s.FaceDescriptor
                        ? String(s.FaceDescriptor).split('|').length
                        : 0;
                      return (
                        <tr key={s.StudentID} className="hover:bg-slate-50">
                          <td className="px-5 py-3 font-mono text-xs text-slate-600">
                            {s.StudentID}
                          </td>
                          <td className="px-5 py-3 text-slate-700">{s.RollNo}</td>
                          <td className="px-5 py-3 font-medium text-slate-900">
                            {s.Name}
                          </td>
                          <td className="px-5 py-3 text-slate-600">{s.Course}</td>
                          <td className="px-5 py-3 text-slate-600">{s.Semester}</td>
                          <td className="px-5 py-3">
                            {sampleCount > 0 ? (
                              <Badge variant="success">
                                {sampleCount} angle{sampleCount > 1 ? 's' : ''}
                              </Badge>
                            ) : (
                              <Badge variant="danger">No face</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden p-3 space-y-2">
                {filteredStudents.map((s) => {
                  const sampleCount = s.FaceDescriptor
                    ? String(s.FaceDescriptor).split('|').length
                    : 0;
                  return (
                    <div
                      key={s.StudentID}
                      className="rounded-lg border border-slate-200 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {s.Name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Roll: {s.RollNo} · {s.Course} — Sem {s.Semester}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                            {s.StudentID}
                          </p>
                        </div>
                        {sampleCount > 0 ? (
                          <Badge variant="success">
                            {sampleCount} angle{sampleCount > 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <Badge variant="danger">No face</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}
    </AppShell>
  );
}

// ============================================================
// SMALL COMPONENTS
// ============================================================
function TabBtn({ active, onClick, icon: Icon, children, count }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-10 px-4 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      <Icon className="w-4 h-4" aria-hidden />
      {children}
      {typeof count === 'number' && count > 0 && (
        <span className="text-[10px] font-semibold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}
