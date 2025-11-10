from flask import Flask, render_template, request, jsonify
from pathlib import Path
import json
from datetime import datetime

app = Flask(__name__)
DATA_FILE = Path(__file__).parent / "sessions.json"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/session", methods=["POST"])
def api_session():
    payload = request.json or {}
    payload.setdefault("ts", datetime.utcnow().isoformat())
    if DATA_FILE.exists():
        sessions = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    else:
        sessions = []
    sessions.append(payload)
    DATA_FILE.write_text(json.dumps(sessions, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True})

if __name__ == "__main__":
    app.run(debug=True, port=5000)