// ============================================
// Google Apps Script API Client
// Batch via GET (reliable, no CORS preflight)
// ============================================

const API_URL = "https://script.google.com/macros/s/AKfycbzbr-29a0Ciedt9v3fHRqe60GZ1YYnD7LnsD4OhYN9Tiv1n4ACDnpdnj7E4INfqPJGd/exec";
const API_KEY = "smartattend2026";

// Max URL length safe limit (Google ~8000)
const MAX_URL_LENGTH = 7000;

async function call(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("_t", Date.now().toString());
  url.searchParams.set("_r", Math.random().toString(36).substring(2, 8));

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response:", text.substring(0, 300));
    throw new Error("API returned HTML. Check Apps Script deployment.");
  }
}

// ============================================
// BATCH MARK via GET (chunked if needed)
// ============================================
async function callBatchGet(records) {
  if (!records.length) return { success: true, inserted: 0 };

  // Chunk records to fit URL length
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const r of records) {
    const recordStr = JSON.stringify({
      s: r.studentId,
      n: r.name,
      r: r.rollNo,
      t: r.timestamp,
    });

    if (currentLength + recordStr.length + 1 > MAX_URL_LENGTH - 500) {
      if (currentChunk.length) chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push({
      s: r.studentId,
      n: r.name,
      r: r.rollNo,
      t: r.timestamp,
    });
    currentLength += recordStr.length + 1;
  }
  if (currentChunk.length) chunks.push(currentChunk);

  // Send each chunk sequentially
  const results = [];
  for (const chunk of chunks) {
    const encoded = encodeURIComponent(JSON.stringify(chunk));
    try {
      const res = await call("markBatchGet", { payload: encoded });
      results.push(res);
    } catch (err) {
      console.error("Batch chunk error:", err);
      results.push({ success: false, error: err.message });
    }
  }

  // Merge
  const totalInserted = results.reduce((sum, r) => sum + (r?.inserted || 0), 0);
  const totalDuplicates = results.reduce((sum, r) => sum + (r?.duplicates || 0), 0);
  const failed = results.filter((r) => !r?.success);

  return {
    success: failed.length === 0,
    inserted: totalInserted,
    duplicates: totalDuplicates,
    errors: failed.map((f) => f?.error).filter(Boolean),
  };
}

export const api = {
  adminLogin: (email, password) => call("adminLogin", { email, password }),
  getStudents: () => call("getStudents"),
  addStudent: (data) => call("addStudent", data),
  updateDescriptor: (id, desc) =>
    call("updateDescriptor", { student_id: id, face_descriptor: desc }),

  markAttendance: (student_id, name, descriptor) =>
    call("markAttendance", {
      student_id,
      name,
      descriptor: Array.isArray(descriptor)
        ? descriptor.join(",")
        : descriptor || "",
    }),

  // ✅ Batch via GET — reliable
  markAttendanceBatch: (records) => callBatchGet(records),

  getTodayAttendance: () => call("getTodayAttendance"),
  getSummary: () => call("getSummary"),
  getAttendanceByDate: (date, course) =>
    call("getAttendanceByDate", { date: date || "", course: course || "" }),
};