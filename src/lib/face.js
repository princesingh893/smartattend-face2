import * as faceapi from '@vladmandic/face-api';

// ============================================================
// FACE CONFIG — Optimized for sub-2-second attendance
// ============================================================
export const FACE_CONFIG = {
  // ---- Detection (FAST) ----
  DETECTOR_INPUT_SIZE: 224,           // was 320/416 — faster inference
  DETECTOR_SCORE_THRESHOLD: 0.5,

  // ---- Quality (used during enrollment) ----
  MIN_FACE_SIZE_RATIO: 0.15,
  MAX_FACE_SIZE_RATIO: 0.85,
  MIN_DETECTION_SCORE: 0.55,
  EDGE_MARGIN_RATIO: 0.03,
  MIN_BRIGHTNESS: 40,
  MAX_BRIGHTNESS: 220,
  MIN_BLUR_VARIANCE: 30,

  // ---- Matching (strict) ----
  MATCH_THRESHOLD: 0.42,
  MIN_MATCH_MARGIN: 0.12,
  DUPLICATE_THRESHOLD: 0.45,

  // ---- Multi-frame confirmation (FAST sliding window) ----
  REQUIRED_FRAMES: 3,                 // was 5 — 3 frames enough
  MIN_CONSISTENCY: 0.66,
  FRAME_WINDOW_MS: 1000,              // was 3500 — tighter window

  // ---- Scan loop (FAST polling) ----
  SCAN_INTERVAL_MS: 150,              // was 250

  // ---- Liveness ----
  EAR_CLOSED_THRESHOLD: 0.22,
  EAR_OPEN_THRESHOLD: 0.28,
  REQUIRED_BLINKS: 0,
  LIVENESS_WINDOW_MS: 8000,

  // ---- Debug ----
  DEBUG_MATCHING: false,
};

// ============================================================
// MODEL LOADING (once per app lifetime)
// ============================================================
let modelsLoaded = false;
let loadingPromise = null;

export async function loadModels() {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const url = '/models';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(url),
      faceapi.nets.faceLandmark68Net.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url),
    ]);
    modelsLoaded = true;
    loadingPromise = null;
  })();

  return loadingPromise;
}

// ============================================================
// DESCRIPTOR PARSING
// Format: "v1,...,v128|v1,...,v128|..."
// ============================================================
export function parseStoredDescriptors(stored) {
  if (!stored || typeof stored !== 'string') return [];
  return stored
    .split('|')
    .map((part) => {
      const nums = part.split(',').map(Number);
      return nums.length === 128 && nums.every((n) => !isNaN(n)) ? nums : null;
    })
    .filter(Boolean);
}

// ============================================================
// SINGLE-FACE FRAME ANALYSIS (enrollment)
// ============================================================
export async function analyzeFrame(videoOrImg) {
  const imgW = videoOrImg.videoWidth || videoOrImg.width;
  const imgH = videoOrImg.videoHeight || videoOrImg.height;

  if (!imgW || !imgH) return { status: 'no_face' };

  let detections = [];
  try {
    detections = await faceapi
      .detectAllFaces(
        videoOrImg,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: FACE_CONFIG.DETECTOR_INPUT_SIZE,
          scoreThreshold: FACE_CONFIG.DETECTOR_SCORE_THRESHOLD,
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();
  } catch {
    return { status: 'no_face' };
  }

  if (!detections || detections.length === 0) return { status: 'no_face' };
  if (detections.length > 1) {
    return { status: 'multiple_faces', count: detections.length };
  }

  const det = detections[0];
  const box = det.detection.box;
  const score = det.detection.score;

  if (score < FACE_CONFIG.MIN_DETECTION_SCORE) {
    return { status: 'low_confidence', score };
  }

  const minDim = Math.min(imgW, imgH);
  const faceSize = Math.min(box.width, box.height);
  const sizeRatio = faceSize / minDim;

  if (sizeRatio < FACE_CONFIG.MIN_FACE_SIZE_RATIO) {
    return { status: 'too_small', ratio: sizeRatio };
  }
  if (sizeRatio > FACE_CONFIG.MAX_FACE_SIZE_RATIO) {
    return { status: 'too_large', ratio: sizeRatio };
  }

  const edgeX = imgW * FACE_CONFIG.EDGE_MARGIN_RATIO;
  const edgeY = imgH * FACE_CONFIG.EDGE_MARGIN_RATIO;
  if (
    box.x < edgeX ||
    box.y < edgeY ||
    box.x + box.width > imgW - edgeX ||
    box.y + box.height > imgH - edgeY
  ) {
    return { status: 'not_centered' };
  }

  const brightness = getAverageBrightness(videoOrImg, box);
  if (brightness < FACE_CONFIG.MIN_BRIGHTNESS) {
    return { status: 'poor_quality', reason: 'too_dark', brightness };
  }
  if (brightness > FACE_CONFIG.MAX_BRIGHTNESS) {
    return { status: 'poor_quality', reason: 'too_bright', brightness };
  }

  const blurVar = getBlurVariance(videoOrImg, box);
  if (blurVar < FACE_CONFIG.MIN_BLUR_VARIANCE) {
    return { status: 'poor_quality', reason: 'blurry', blurVar };
  }

  return {
    status: 'ok',
    descriptor: Array.from(det.descriptor),
    box,
    score,
    landmarks: det.landmarks,
    width: imgW,
    height: imgH,
    brightness,
    blurVar,
    sizeRatio,
  };
}

// ============================================================
// MULTI-FACE ANALYSIS (attendance — FAST, no quality overhead)
// ============================================================
export async function analyzeAllFaces(videoOrImg) {
  const imgW = videoOrImg.videoWidth || videoOrImg.width;
  const imgH = videoOrImg.videoHeight || videoOrImg.height;
  if (!imgW || !imgH) return [];

  let detections = [];
  try {
    detections = await faceapi
      .detectAllFaces(
        videoOrImg,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: FACE_CONFIG.DETECTOR_INPUT_SIZE,
          scoreThreshold: FACE_CONFIG.DETECTOR_SCORE_THRESHOLD,
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();
  } catch {
    return [];
  }

  if (!detections || !detections.length) return [];

  const minDim = Math.min(imgW, imgH);
  const minFaceSize = minDim * FACE_CONFIG.MIN_FACE_SIZE_RATIO;

  return detections
    .filter((det) => {
      const box = det.detection.box;
      if (det.detection.score < FACE_CONFIG.MIN_DETECTION_SCORE) return false;
      if (Math.min(box.width, box.height) < minFaceSize) return false;
      if (box.x < 0 || box.y < 0) return false;
      return true;
    })
    .map((det) => ({
      descriptor: Array.from(det.descriptor),
      box: det.detection.box,
      score: det.detection.score,
      landmarks: det.landmarks,
      width: imgW,
      height: imgH,
    }));
}

// ============================================================
// HELPERS
// ============================================================
function getAverageBrightness(videoOrImg, box) {
  try {
    const canvas = document.createElement('canvas');
    const w = 80;
    const h = 60;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoOrImg, box.x, box.y, box.width, box.height, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sum / (data.length / 4);
  } catch {
    return 128;
  }
}

function getBlurVariance(videoOrImg, box) {
  try {
    const canvas = document.createElement('canvas');
    const w = 120;
    const h = 90;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoOrImg, box.x, box.y, box.width, box.height, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] =
        0.299 * data[i * 4] +
        0.587 * data[i * 4 + 1] +
        0.114 * data[i * 4 + 2];
    }

    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap =
          -4 * gray[i] +
          gray[i - 1] +
          gray[i + 1] +
          gray[i - w] +
          gray[i + w];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    const mean = sum / count;
    return sumSq / count - mean * mean;
  } catch {
    return 100;
  }
}

// ============================================================
// LIVENESS — Eye Aspect Ratio
// ============================================================
export function eyeAspectRatio(landmarks, side) {
  if (!landmarks) return null;
  const pts = landmarks.positions;
  const idx =
    side === 'left'
      ? [36, 37, 38, 39, 40, 41]
      : [42, 43, 44, 45, 46, 47];
  const p = idx.map((i) => pts[i]);
  const v1 = dist(p[1], p[5]);
  const v2 = dist(p[2], p[4]);
  const h = dist(p[0], p[3]);
  return (v1 + v2) / (2 * h);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ============================================================
// MATCHING
// ============================================================
export function matchStudent(descriptor, students) {
  if (!descriptor || !students?.length) return null;

  const candidates = [];

  for (const s of students) {
    const samples = parseStoredDescriptors(s.FaceDescriptor);
    if (!samples.length) continue;

    let bestDist = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < samples.length; i++) {
      const d = euclidean(descriptor, samples[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    candidates.push({ student: s, distance: bestDist, sampleIndex: bestIdx });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.distance - b.distance);

  if (FACE_CONFIG.DEBUG_MATCHING) {
    console.log('🔍 TOP 3 CANDIDATES:');
    console.table(
      candidates.slice(0, 3).map((c, i) => ({
        rank: i + 1,
        name: c.student.Name,
        id: c.student.StudentID,
        distance: c.distance.toFixed(4),
      }))
    );
  }

  const best = candidates[0];
  const second = candidates[1];

  if (best.distance > FACE_CONFIG.MATCH_THRESHOLD) return null;

  if (second) {
    const margin = second.distance - best.distance;
    if (margin < FACE_CONFIG.MIN_MATCH_MARGIN) return null;
  }

  const confidence = Math.max(0, Math.min(1, 1 - best.distance));
  return {
    student: best.student,
    distance: best.distance,
    margin: second ? second.distance - best.distance : Infinity,
    sampleIndex: best.sampleIndex,
    confidence,
  };
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ============================================================
// MULTI-FRAME CONSISTENCY
// ============================================================
export function checkConsistency(
  history,
  windowMs = FACE_CONFIG.FRAME_WINDOW_MS
) {
  const now = Date.now();
  const recent = history.filter((h) => now - h.ts < windowMs);
  if (recent.length < FACE_CONFIG.REQUIRED_FRAMES) {
    return {
      consistent: false,
      progress: recent.length / FACE_CONFIG.REQUIRED_FRAMES,
      studentId: null,
    };
  }

  const counts = {};
  for (const h of recent.slice(-FACE_CONFIG.REQUIRED_FRAMES)) {
    counts[h.studentId] = (counts[h.studentId] || 0) + 1;
  }

  let dominantId = null;
  let dominantCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantId = id;
    }
  }

  const consistency = dominantCount / FACE_CONFIG.REQUIRED_FRAMES;
  return {
    consistent: consistency >= FACE_CONFIG.MIN_CONSISTENCY,
    progress: consistency,
    studentId: dominantId,
    student: recent.find((h) => h.studentId === dominantId)?.student,
  };
}

// ============================================================
// ENROLLMENT HELPERS
// ============================================================
export async function captureEnrollmentSample(videoOrImg) {
  const result = await analyzeFrame(videoOrImg);
  if (result.status !== 'ok') return { ok: false, result };
  return { ok: true, descriptor: result.descriptor, result };
}

export function serializeDescriptors(descriptors) {
  if (!Array.isArray(descriptors) || !descriptors.length) return '';
  return descriptors
    .map((d) => d.map((n) => n.toFixed(6)).join(','))
    .join('|');
}

// ============================================================
// DUPLICATE FACE CHECK (enrollment)
// ============================================================
export function checkDuplicateFace(newDescriptor, existingStudents) {
  if (
    !newDescriptor ||
    !Array.isArray(newDescriptor) ||
    newDescriptor.length !== 128
  ) {
    return null;
  }
  if (!existingStudents?.length) return null;

  let bestMatch = null;
  let bestDistance = Infinity;

  for (const s of existingStudents) {
    const samples = parseStoredDescriptors(s.FaceDescriptor);
    if (!samples.length) continue;

    for (const sample of samples) {
      const d = euclidean(newDescriptor, sample);
      if (d < bestDistance) {
        bestDistance = d;
        bestMatch = s;
      }
    }
  }

  if (bestMatch && bestDistance < FACE_CONFIG.DUPLICATE_THRESHOLD) {
    return {
      student: bestMatch,
      distance: bestDistance,
    };
  }

  return null;
}