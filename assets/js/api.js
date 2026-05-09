// ============================================================
// assets/js/api.js — Centralised API client
// All fetch calls go through here. Change API_BASE to point
// at your backend (e.g. https://your-backend.com/api).
// ============================================================

const API_BASE = "http://localhost:5000/api";

/**
 * Generic JSON POST helper.
 * @param {string} path    - e.g. "/simplify"
 * @param {object} body    - request payload
 * @param {number} timeout - ms (default 8000)
 */
async function apiPost(path, body, timeout = 8000) {
  const r = await fetch(API_BASE + path, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeout),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

/**
 * Generic JSON GET helper.
 * @param {string} path    - e.g. "/progress"
 * @param {object} params  - query-string params
 * @param {number} timeout - ms (default 6000)
 */
async function apiGet(path, params = {}, timeout = 6000) {
  const qs  = new URLSearchParams(params).toString();
  const url = API_BASE + path + (qs ? "?" + qs : "");
  const r   = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// ── Typed API wrappers ────────────────────────────────────────

const BrainiesAPI = {
  health:       ()                                => apiGet("/health"),
  simplify:     (text)                            => apiPost("/simplify",      { text }),
  translate:    (text, lang)                      => apiPost("/translate",     { text, lang }),
  describe:     (image_url, fallback)             => apiPost("/describe",      { image_url, fallback }),
  saveProgress: (student_id, lesson_id, payload)  => apiPost("/progress",      { student_id, lesson_id, ...payload }),
  getProgress:  (student_id)                      => apiGet("/progress",       { student_id }),
  saveProfile:  (student_id, profile, name)       => apiPost("/profile",       { student_id, profile, name }),
  teacherLogin: (pin)                             => apiPost("/teacher-login", { pin }, 5000),
  dashStats:    ()                                => apiGet("/dashboard/stats"),
};
