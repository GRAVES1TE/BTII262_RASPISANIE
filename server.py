import os
import sys
import json
import sqlite3
import hashlib
import secrets
from pathlib import Path
from aiohttp import web

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
DB_PATH = DATA_DIR / "database.sqlite"

# Ensure directories
DATA_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

# Load environment variables from local .env if present (ignored by git)
def load_dotenv():
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

load_dotenv()


def check_admin_password(request: web.Request, payload: dict = None) -> bool:
    """Verifies editor access using secret from environment (.env or cloud settings)."""
    admin_env = os.environ.get("ADMIN_PASSWORD", "").strip()
    if not admin_env:
        # If no password is set, modifications are locked for safety
        return False

    allowed = {p.strip().lower() for p in admin_env.split(",") if p.strip()}

    pwd = request.headers.get("X-Admin-Password", "")
    if not pwd and payload and isinstance(payload, dict):
        pwd = payload.get("adminPassword") or payload.get("admin_password") or payload.get("password") or ""
    if not pwd:
        pwd = request.query.get("admin_password", "")
    if not pwd:
        pwd = request.cookies.get("admin_password", "")

    if not pwd:
        return False

    return (pwd.strip().lower() in allowed)


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            full_name TEXT NOT NULL,
            subgroup INTEGER DEFAULT 1,
            theme TEXT DEFAULT 'light',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)

    # Tasks / Homework table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            subject TEXT NOT NULL,
            title TEXT NOT NULL,
            due_date TEXT,
            is_completed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)

    # Lesson notes table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            lesson_id TEXT NOT NULL,
            content TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, lesson_id),
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)

    conn.commit()
    conn.close()


def hash_password(password: str, salt: str = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
    return hashed, salt


def get_user_from_token(token: str):
    if not token:
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.username, u.full_name, u.subgroup, u.theme, u.created_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
    """, (token,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


async def get_current_user(request: web.Request):
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.cookies.get("session_token")
    return get_user_from_token(token)


# ---------------- API HANDLERS ----------------

async def api_register(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Неверный формат данных JSON"}, status=400)

    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()
    full_name = (data.get("full_name") or "").strip()
    subgroup = int(data.get("subgroup") or 1)
    theme = (data.get("theme") or "light").strip()

    if not username or len(username) < 3:
        return web.json_response({"error": "Имя пользователя должно содержать не менее 3 символов"}, status=400)
    if not password or len(password) < 4:
        return web.json_response({"error": "Пароль должен содержать не менее 4 символов"}, status=400)
    if not full_name:
        return web.json_response({"error": "Укажите ваше имя или выберите из списка студентов"}, status=400)
    if subgroup not in (1, 2, 3):
        subgroup = 1

    hashed, salt = hash_password(password)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, salt, full_name, subgroup, theme) VALUES (?, ?, ?, ?, ?, ?)",
            (username, hashed, salt, full_name, subgroup, theme)
        )
        user_id = cursor.lastrowid
        token = secrets.token_urlsafe(32)
        cursor.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return web.json_response({"error": "Пользователь с таким логином уже существует"}, status=409)
    finally:
        conn.close()

    resp = web.json_response({
        "success": True,
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "full_name": full_name,
            "subgroup": subgroup,
            "theme": theme
        }
    })
    resp.set_cookie("session_token", token, max_age=86400 * 30, httponly=False, samesite="Lax")
    return resp


async def api_login(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Неверный формат данных JSON"}, status=400)

    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return web.json_response({"error": "Заполните логин и пароль"}, status=400)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        return web.json_response({"error": "Неверный логин или пароль"}, status=401)

    hashed, _ = hash_password(password, row["salt"])
    if hashed != row["password_hash"]:
        conn.close()
        return web.json_response({"error": "Неверный логин или пароль"}, status=401)

    token = secrets.token_urlsafe(32)
    cursor.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, row["id"]))
    conn.commit()
    conn.close()

    user_data = {
        "id": row["id"],
        "username": row["username"],
        "full_name": row["full_name"],
        "subgroup": row["subgroup"],
        "theme": row["theme"]
    }

    resp = web.json_response({
        "success": True,
        "token": token,
        "user": user_data
    })
    resp.set_cookie("session_token", token, max_age=86400 * 30, httponly=False, samesite="Lax")
    return resp


async def api_logout(request: web.Request):
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.cookies.get("session_token")

    if token:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()

    resp = web.json_response({"success": True})
    resp.del_cookie("session_token")
    return resp


async def api_me(request: web.Request):
    user = await get_current_user(request)
    if not user:
        return web.json_response({"authenticated": False, "user": None})
    return web.json_response({"authenticated": True, "user": user})


async def api_update_settings(request: web.Request):
    user = await get_current_user(request)
    if not user:
        return web.json_response({"error": "Требуется авторизация"}, status=401)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Неверный JSON"}, status=400)

    subgroup = data.get("subgroup")
    theme = data.get("theme")
    full_name = data.get("full_name")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if subgroup is not None and int(subgroup) in (1, 2, 3):
        cursor.execute("UPDATE users SET subgroup = ? WHERE id = ?", (int(subgroup), user["id"]))
        user["subgroup"] = int(subgroup)

    if theme is not None and theme in ("light", "dark"):
        cursor.execute("UPDATE users SET theme = ? WHERE id = ?", (theme, user["id"]))
        user["theme"] = theme

    if full_name:
        cursor.execute("UPDATE users SET full_name = ? WHERE id = ?", (full_name.strip(), user["id"]))
        user["full_name"] = full_name.strip()

    conn.commit()
    conn.close()

    return web.json_response({"success": True, "user": user})


async def api_get_schedule(request: web.Request):
    schedule_file = DATA_DIR / "schedule.json"
    if not schedule_file.exists():
        return web.json_response({"error": "Расписание не найдено"}, status=404)

    with open(schedule_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Optional subgroup filter via query param
    subgroup_param = request.query.get("subgroup")
    if subgroup_param and subgroup_param.isdigit():
        sg = int(subgroup_param)
        filtered_days = []
        for day in data["days"]:
            day_copy = dict(day)
            day_copy["lessons"] = [
                l for l in day["lessons"]
                if l.get("subgroup", 0) == 0 or l.get("subgroup") == sg
            ]
            filtered_days.append(day_copy)
        data = dict(data)
        data["days"] = filtered_days

    return web.json_response(data)


async def api_save_lesson(request: web.Request):
    schedule_file = DATA_DIR / "schedule.json"
    if not schedule_file.exists():
        return web.json_response({"error": "Файл расписания не найден"}, status=404)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Неверный формат JSON"}, status=400)

    if not check_admin_password(request, data):
        return web.json_response({"error": "Требуется пароль старосты / редактора для изменения расписания"}, status=403)

    lesson_id = (data.get("id") or "").strip()
    day_of_week = int(data.get("dayOfWeek") or 1)
    pair = int(data.get("pair") or 1)
    time = (data.get("time") or "").strip()
    custom_time = (data.get("customTime") or "").strip() or None
    subject = (data.get("subject") or "").strip()
    lesson_type = (data.get("type") or "Лекционные занятия").strip()
    teacher = (data.get("teacher") or "").strip()
    room = (data.get("room") or "").strip()
    subgroup = int(data.get("subgroup") if data.get("subgroup") is not None else 0)
    weeks = data.get("weeks", "all")
    weeks_display = (data.get("weeksDisplay") or "").strip() or None

    if not subject:
        return web.json_response({"error": "Название предмета обязательно"}, status=400)

    if not lesson_id:
        lesson_id = f"custom-{secrets.token_hex(4)}"

    # If time wasn't specified, determine default bell time
    default_times = {
        1: "08:00 - 09:35",
        2: "09:45 - 11:20",
        3: "11:30 - 13:05",
        4: "13:30 - 15:05",
        5: "15:15 - 16:50",
        6: "17:00 - 18:35",
        7: "18:40 - 20:05"
    }
    if not time:
        time = default_times.get(pair, "08:00 - 09:35")

    week_type = (data.get("weekType") or "all").strip()
    address = (data.get("address") or "").strip()

    if not address and room:
        if "/1" in room:
            address = "Московский просп., 14 (Корпус 1)"
        elif "/2" in room:
            address = "Плехановская ул., 11 (Корпус 2)"
        elif "/5" in room:
            address = "Московский просп., 14 (Корпус 5)"
        else:
            address = "ул. 20-летия Октября, 84 (Главный корпус)"

    lesson_obj = {
        "id": lesson_id,
        "pair": pair,
        "time": time,
        "customTime": custom_time,
        "subject": subject,
        "type": lesson_type,
        "teacher": teacher,
        "room": room,
        "address": address,
        "subgroup": subgroup,
        "weekType": week_type,
        "weeks": weeks
    }
    if weeks_display:
        lesson_obj["weeksDisplay"] = weeks_display

    with open(schedule_file, "r", encoding="utf-8") as f:
        schedule_data = json.load(f)

    # First remove lesson if it existed anywhere
    for day in schedule_data["days"]:
        day["lessons"] = [l for l in day["lessons"] if l.get("id") != lesson_id]

    # Now find target day and insert lesson
    target_day = next((d for d in schedule_data["days"] if d["dayOfWeek"] == day_of_week), None)
    if not target_day:
        return web.json_response({"error": "День недели не найден"}, status=400)

    target_day["lessons"].append(lesson_obj)
    # Sort lessons by pair number
    target_day["lessons"].sort(key=lambda l: (l.get("pair", 0), l.get("subgroup", 0)))

    with open(schedule_file, "w", encoding="utf-8") as f:
        json.dump(schedule_data, f, ensure_ascii=False, indent=2)

    return web.json_response({"success": True, "lesson": lesson_obj})


async def api_delete_lesson(request: web.Request):
    if not check_admin_password(request):
        return web.json_response({"error": "Требуется пароль старосты / редактора для удаления пары"}, status=403)

    schedule_file = DATA_DIR / "schedule.json"
    if not schedule_file.exists():
        return web.json_response({"error": "Файл расписания не найден"}, status=404)

    lesson_id = request.match_info.get("id")
    if not lesson_id:
        return web.json_response({"error": "ID пары не указан"}, status=400)

    with open(schedule_file, "r", encoding="utf-8") as f:
        schedule_data = json.load(f)

    deleted = False
    for day in schedule_data["days"]:
        orig_len = len(day["lessons"])
        day["lessons"] = [l for l in day["lessons"] if l.get("id") != lesson_id]
        if len(day["lessons"]) < orig_len:
            deleted = True

    if not deleted:
        return web.json_response({"error": "Занятие с таким ID не найдено"}, status=404)

    with open(schedule_file, "w", encoding="utf-8") as f:
        json.dump(schedule_data, f, ensure_ascii=False, indent=2)

    return web.json_response({"success": True, "deleted_id": lesson_id})


async def api_reset_schedule(request: web.Request):
    if not check_admin_password(request):
        return web.json_response({"error": "Требуется пароль старосты / редактора для сброса расписания"}, status=403)

    default_file = DATA_DIR / "schedule_default.json"
    schedule_file = DATA_DIR / "schedule.json"
    if not default_file.exists():
        return web.json_response({"error": "Резервная копия расписания не найдена"}, status=404)

    with open(default_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    with open(schedule_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return web.json_response({"success": True})



async def api_get_students(request: web.Request):
    students_file = DATA_DIR / "students.json"
    if not students_file.exists():
        return web.json_response({"error": "Список не найден"}, status=404)

    with open(students_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    return web.json_response(data)


# Tasks / Homework API (Общие домашние задания группы)
async def api_get_tasks(request: web.Request):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, subject, title, due_date, is_completed, created_at
        FROM tasks
        ORDER BY is_completed ASC, due_date ASC, id DESC
    """)
    tasks = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return web.json_response({"tasks": tasks})


async def api_create_task(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Неверный JSON"}, status=400)

    if not check_admin_password(request, data):
        return web.json_response({"error": "Требуется пароль старосты / редактора для добавления ДЗ"}, status=403)

    user = await get_current_user(request)
    user_id = user["id"] if user else 1

    subject = (data.get("subject") or "Общее").strip()
    title = (data.get("title") or "").strip()
    due_date = (data.get("due_date") or "").strip()

    if not title:
        return web.json_response({"error": "Введите текст задания"}, status=400)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO tasks (user_id, subject, title, due_date, is_completed) VALUES (?, ?, ?, ?, 0)",
        (user_id, subject, title, due_date)
    )
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return web.json_response({
        "success": True,
        "task": {
            "id": task_id,
            "subject": subject,
            "title": title,
            "due_date": due_date,
            "is_completed": 0
        }
    })


async def api_toggle_task(request: web.Request):
    task_id = request.match_info.get("id")
    try:
        data = await request.json()
        is_completed = 1 if data.get("is_completed") else 0
    except Exception:
        is_completed = None

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if is_completed is not None:
        cursor.execute("UPDATE tasks SET is_completed = ? WHERE id = ?", (is_completed, task_id))
    else:
        cursor.execute("UPDATE tasks SET is_completed = 1 - is_completed WHERE id = ?", (task_id,))

    conn.commit()
    conn.close()
    return web.json_response({"success": True})


async def api_delete_task(request: web.Request):
    if not check_admin_password(request):
        return web.json_response({"error": "Требуется пароль старосты / редактора для удаления задания"}, status=403)

    task_id = request.match_info.get("id")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return web.json_response({"success": True})


# Admin editor mode password verification
async def api_admin_verify(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        data = {}

    if check_admin_password(request, data):
        return web.json_response({"success": True, "message": "Пароль верный! Режим редактора активирован."})
    return web.json_response({"success": False, "error": "Неверный пароль редактора расписания и ДЗ"}, status=403)


# Notes API
async def api_get_notes(request: web.Request):
    user = await get_current_user(request)
    if not user:
        return web.json_response({"notes": {}})

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT lesson_id, content FROM notes WHERE user_id = ?", (user["id"],))
    rows = cursor.fetchall()
    conn.close()
    notes_dict = {r["lesson_id"]: r["content"] for r in rows}
    return web.json_response({"notes": notes_dict})


async def api_save_note(request: web.Request):
    user = await get_current_user(request)
    if not user:
        return web.json_response({"error": "Требуется авторизация"}, status=401)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Неверный JSON"}, status=400)

    lesson_id = data.get("lesson_id")
    content = data.get("content", "").strip()

    if not lesson_id:
        return web.json_response({"error": "lesson_id обязателен"}, status=400)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    if not content:
        cursor.execute("DELETE FROM notes WHERE user_id = ? AND lesson_id = ?", (user["id"], lesson_id))
    else:
        cursor.execute("""
            INSERT INTO notes (user_id, lesson_id, content) VALUES (?, ?, ?)
            ON CONFLICT(user_id, lesson_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
        """, (user["id"], lesson_id, content))
    conn.commit()
    conn.close()

    return web.json_response({"success": True, "lesson_id": lesson_id, "content": content})


# Static files index
async def index_handler(request: web.Request):
    return web.FileResponse(STATIC_DIR / "index.html")


def create_app():
    init_db()
    app = web.Application()

    # API routes
    app.router.add_post("/api/register", api_register)
    app.router.add_post("/api/login", api_login)
    app.router.add_post("/api/logout", api_logout)
    app.router.add_get("/api/me", api_me)
    app.router.add_post("/api/user/settings", api_update_settings)

    app.router.add_get("/api/schedule", api_get_schedule)
    app.router.add_post("/api/schedule/lesson", api_save_lesson)
    app.router.add_delete("/api/schedule/lesson/{id}", api_delete_lesson)
    app.router.add_post("/api/schedule/reset", api_reset_schedule)
    app.router.add_get("/api/students", api_get_students)

    app.router.add_get("/api/tasks", api_get_tasks)
    app.router.add_post("/api/tasks", api_create_task)
    app.router.add_patch("/api/tasks/{id}", api_toggle_task)
    app.router.add_delete("/api/tasks/{id}", api_delete_task)

    app.router.add_post("/api/admin/verify", api_admin_verify)

    app.router.add_get("/api/notes", api_get_notes)
    app.router.add_post("/api/notes", api_save_note)

    # Static assets
    app.router.add_get("/", index_handler)
    app.router.add_static("/static", STATIC_DIR)

    return app


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8080))
    print(f"🚀 Сервер расписания запущен:")
    print(f"  • На этом компьютере: http://localhost:{port}")
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        print(f"  • Для устройств в вашей сети (Wi-Fi): http://{local_ip}:{port}")
    except Exception:
        pass
    print("-------------------------------------------------------")
    web.run_app(create_app(), host=host, port=port)

