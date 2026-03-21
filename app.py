# ============================================================
# BRAINIES — Flask Backend
# Run: py App.py
# Install: pip install flask flask-cors requests python-dotenv
# ============================================================

import os, json
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

HF_TOKEN   = os.getenv("HUGGINGFACE_TOKEN", "")
DEEPAI_KEY = os.getenv("DEEPAI_KEY", "")
TEACHER_PIN = os.getenv("TEACHER_PIN", "1234")

# ── Serve HTML / JS / CSS files ──────────────────────────────
API_PREFIXES = [
    "simplify","translate","describe","save-progress",
    "get-progress","save-profile","get-profile",
    "dashboard/stats","teacher-login","health","api"
]

@app.route("/")
def root():
    return send_from_directory(".", "welcome.html")

@app.route("/<path:filename>")
def static_files(filename):
    if any(filename.startswith(p) for p in API_PREFIXES):
        return jsonify({"error": "Use correct HTTP method"}), 404
    try:
        return send_from_directory(".", filename)
    except:
        return jsonify({"error": f"{filename} not found"}), 404

# ── Health ────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "huggingface": bool(HF_TOKEN),
        "deepai": bool(DEEPAI_KEY)
    })

# ── Simplify text with AI ─────────────────────────────────────
@app.route("/simplify", methods=["POST"])
def simplify():
    data = request.get_json()
    if not data or "text" not in data:
        return jsonify({"error": "text required"}), 400
    text = data["text"].strip()
    if not text:
        return jsonify({"error": "empty text"}), 400

    # Try HuggingFace BART
    if HF_TOKEN:
        try:
            r = requests.post(
                "https://api-inference.huggingface.co/models/facebook/bart-large-cnn",
                headers={"Authorization": f"Bearer {HF_TOKEN}"},
                json={
                    "inputs": text,
                    "parameters": {
                        "max_length": 130,
                        "min_length": 25,
                        "do_sample": False
                    }
                },
                timeout=30
            )
            if r.status_code == 200:
                d = r.json()
                if isinstance(d, list) and d:
                    simplified = d[0].get("summary_text", "")
                    if simplified:
                        return jsonify({"result": simplified, "source": "ai"})
        except Exception as e:
            print(f"HuggingFace error: {e}")

    # Fallback: rule-based word replacement
    replacements = {
        "photosynthesis":  "how plants make food",
        "chlorophyll":     "the green pigment in plants",
        "chloroplasts":    "parts of plant cells that make food",
        "mitochondria":    "the energy-making part of a cell",
        "approximately":   "about",
        "subsequently":    "then",
        "furthermore":     "also",
        "nevertheless":    "but",
        "consequently":    "so",
        "demonstrates":    "shows",
        "utilizes":        "uses",
        "significant":     "important",
        "fundamental":     "basic",
        "organisms":       "living things",
        "evaporation":     "water turning into vapour",
        "transpiration":   "water loss from plant leaves",
    }
    result = text
    for hard, easy in replacements.items():
        result = result.replace(hard, easy)
        result = result.replace(hard.capitalize(), easy.capitalize())
    # Trim to first 4 sentences
    sentences = result.split(". ")
    if len(sentences) > 4:
        result = ". ".join(sentences[:4]) + "."
    return jsonify({"result": result, "source": "fallback"})

# ── Translate text ────────────────────────────────────────────
@app.route("/translate", methods=["POST"])
def translate():
    data = request.get_json()
    if not data or "text" not in data or "lang" not in data:
        return jsonify({"error": "text and lang required"}), 400
    text = data["text"].strip()[:500]
    lang = data["lang"].strip()
    supported = ["hi","mr","ta","te","bn","gu","kn","ml","pa","ur"]
    if lang not in supported:
        return jsonify({"error": f"Unsupported language. Use: {supported}"}), 400
    try:
        r = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": f"en|{lang}"},
            timeout=15
        )
        d = r.json()
        if d.get("responseStatus") == 200:
            return jsonify({"result": d["responseData"]["translatedText"]})
    except Exception as e:
        print(f"Translation error: {e}")
    return jsonify({"error": "Translation failed"}), 500

# ── Image description ─────────────────────────────────────────
@app.route("/describe", methods=["POST"])
def describe():
    data = request.get_json() or {}
    fallback = data.get("fallback", "An educational diagram for this lesson.")
    image_url = data.get("image_url", "")
    if DEEPAI_KEY and image_url.startswith("http"):
        try:
            r = requests.post(
                "https://api.deepai.org/api/image-captioning",
                data={"image": image_url},
                headers={"api-key": DEEPAI_KEY},
                timeout=20
            )
            if r.status_code == 200:
                desc = r.json().get("output", fallback)
                return jsonify({"description": desc, "source": "deepai"})
        except Exception as e:
            print(f"DeepAI error: {e}")
    return jsonify({"description": fallback, "source": "fallback"})

# ── Save student progress ─────────────────────────────────────
@app.route("/save-progress", methods=["POST"])
def save_progress():
    data = request.get_json() or {}
    if "student_id" not in data or "lesson_id" not in data:
        return jsonify({"error": "student_id and lesson_id required"}), 400
    fp = "student_data.json"
    db = {}
    if os.path.exists(fp):
        with open(fp) as f:
            db = json.load(f)
    sid = data["student_id"]
    if sid not in db:
        db[sid] = {"progress": {}, "total_points": 0, "profile": "", "name": ""}
    db[sid]["progress"][data["lesson_id"]] = {
        "score":     data.get("score", 0),
        "completed": data.get("completed", False),
        "points":    data.get("points_earned", 0),
        "timestamp": data.get("timestamp", "")
    }
    db[sid]["total_points"] = db[sid].get("total_points", 0) + data.get("points_earned", 0)
    with open(fp, "w") as f:
        json.dump(db, f, indent=2)
    return jsonify({"success": True})

# ── Get student progress ──────────────────────────────────────
@app.route("/get-progress", methods=["GET"])
def get_progress():
    sid = request.args.get("student_id")
    if not sid:
        return jsonify({"error": "student_id required"}), 400
    fp = "student_data.json"
    if os.path.exists(fp):
        with open(fp) as f:
            db = json.load(f)
        return jsonify(db.get(sid, {}))
    return jsonify({})

# ── Save accessibility profile ────────────────────────────────
@app.route("/save-profile", methods=["POST"])
def save_profile():
    data = request.get_json() or {}
    if "student_id" not in data or "profile" not in data:
        return jsonify({"error": "student_id and profile required"}), 400
    fp = "student_data.json"
    db = {}
    if os.path.exists(fp):
        with open(fp) as f:
            db = json.load(f)
    sid = data["student_id"]
    if sid not in db:
        db[sid] = {"progress": {}, "total_points": 0}
    db[sid]["profile"] = data["profile"]
    db[sid]["name"]    = data.get("name", "Student")
    with open(fp, "w") as f:
        json.dump(db, f, indent=2)
    print(f"  Profile saved: {data.get('name','?')} → {data['profile']}")
    return jsonify({"success": True})

# ── Dashboard stats ───────────────────────────────────────────
@app.route("/dashboard/stats", methods=["GET"])
def dashboard_stats():
    # Demo students
    students = [
        {"name":"Aarav Singh",  "profile":"dyslexic","progress":78,"lessons":15,"days_inactive":0},
        {"name":"Priya Sharma", "profile":"adhd",    "progress":65,"lessons":12,"days_inactive":0},
        {"name":"Rohit Patel",  "profile":"blind",   "progress":91,"lessons":18,"days_inactive":1},
        {"name":"Sneha Nair",   "profile":"motor",   "progress":22,"lessons":3, "days_inactive":5},
        {"name":"Karan Mehta",  "profile":"standard","progress":55,"lessons":10,"days_inactive":0},
        {"name":"Divya Menon",  "profile":"dyslexic","progress":38,"lessons":6, "days_inactive":3},
        {"name":"Arjun Rao",    "profile":"deaf",    "progress":72,"lessons":14,"days_inactive":0},
        {"name":"Meera Iyer",   "profile":"adhd",    "progress":80,"lessons":16,"days_inactive":0},
    ]
    # Merge in real students from file
    fp = "student_data.json"
    if os.path.exists(fp):
        with open(fp) as f:
            db = json.load(f)
        for sid, info in db.items():
            if info.get("name") and info.get("profile"):
                students.append({
                    "name":          info["name"],
                    "profile":       info["profile"],
                    "progress":      min(100, len(info.get("progress", {})) * 12),
                    "lessons":       len(info.get("progress", {})),
                    "days_inactive": 0
                })
    return jsonify({"students": students, "total": len(students)})

# ── Teacher login ─────────────────────────────────────────────
@app.route("/teacher-login", methods=["POST"])
def teacher_login():
    data = request.get_json() or {}
    if data.get("pin") == TEACHER_PIN:
        return jsonify({"success": True})
    return jsonify({"error": "Wrong PIN"}), 401

# ── Run ───────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 45)
    print("  BRAINIES BACKEND")
    print("=" * 45)
    print(f"  HuggingFace : {'✅ set' if HF_TOKEN else '❌ not set (fallback used)'}")
    print(f"  DeepAI      : {'✅ set' if DEEPAI_KEY else '❌ not set'}")
    print(f"  Teacher PIN : {TEACHER_PIN}")
    print("=" * 45)
    print("  Open: http://localhost:5000")
    print("=" * 45)
    port = int(os.environ.get("PORT", 5000))
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)
