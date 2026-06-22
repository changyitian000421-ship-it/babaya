#!/usr/bin/env python3
"""Babaya training management MVP server.

Serves the static frontend and a small JSON API backed by SQLite.
"""

from __future__ import annotations

import json
import hashlib
import hmac
import mimetypes
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).expanduser()
DATABASE = Path(os.environ.get("DATABASE_PATH", str(DATA_DIR / "shengdong.db"))).expanduser()
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "").strip()
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
DATABASE_KIND = "turso" if TURSO_DATABASE_URL else "postgres" if DATABASE_URL else "sqlite"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4173"))

STATUSES = {"在读", "待续费", "请假中", "待分班", "停课"}
COLORS = ["#ff9f1c", "#ffd33d", "#f47a12", "#715b87", "#4f896f"]
SESSION_COOKIE = "sd_session"
SESSION_HOURS = 12

ROLE_LABELS = {
    "owner": "校长 / 管理员",
    "academic": "教务前台",
    "teacher": "授课教师",
    "sales": "招生顾问",
    "finance": "财务",
}

ROLE_PERMISSIONS = {
    "owner": {
        "dashboard:read", "students:read", "students:write", "catalog:read", "catalog:write",
        "roster:write", "leads:read", "leads:write", "hours:read", "hours:write", "teaching:read",
        "settings:read", "settings:write",
    },
    "academic": {
        "dashboard:read", "students:read", "students:write", "catalog:read", "catalog:write",
        "roster:write", "hours:read", "hours:write", "teaching:read",
    },
    "teacher": {"dashboard:read", "students:read", "catalog:read", "hours:read", "hours:write", "teaching:read"},
    "sales": {"dashboard:read", "students:read", "students:write", "leads:read", "leads:write"},
    "finance": {"dashboard:read", "students:read", "hours:read", "hours:write"},
}

SEED_USERS = [
    ("admin", "13800000001", "admin123", "林知夏", "owner"),
    ("jiaowu", "13800000002", "jiaowu123", "教务前台", "academic"),
    ("teacher", "13800000003", "teacher123", "陈老师", "teacher"),
    ("sales", "13800000004", "sales123", "招生顾问", "sales"),
    ("finance", "13800000005", "finance123", "财务老师", "finance"),
]

SEED_STUDENTS = [
    ("顾言溪", 8, "顾女士", "138****2168", "少儿主持基础班", 24, "在读", "#ff9f1c", ""),
    ("周亦辰", 10, "周先生", "186****5372", "朗诵表达进阶班", 16, "在读", "#715b87", ""),
    ("许星禾", 7, "许女士", "135****8906", "舞台表演启蒙班", 30, "在读", "#4f896f", ""),
    ("沈嘉树", 11, "沈先生", "159****4381", "演讲与口才一对一", 8, "待续费", "#c89436", ""),
    ("陆小满", 6, "陆女士", "137****1025", "少儿主持基础班", 20, "请假中", "#507b9d", ""),
]

SEED_COURSES = [
    ("少儿主持基础班", "主持", "6-9 岁", 24, 90, 4680, "#ff9f1c", "启用", "建立舞台自信，掌握主持礼仪与基础表达。"),
    ("朗诵表达进阶班", "朗诵", "8-12 岁", 24, 90, 5280, "#715b87", "启用", "提升语音、节奏、情感表达和作品理解能力。"),
    ("舞台表演启蒙班", "表演", "5-8 岁", 30, 60, 4980, "#4f896f", "启用", "通过角色、故事与肢体训练培养表现力。"),
    ("演讲与口才一对一", "演讲", "8-16 岁", 12, 60, 7200, "#f47a12", "启用", "围绕个人目标进行演讲结构与表达训练。"),
]

SEED_TEACHERS = [
    ("林知夏", "林校长", "主持、语言艺术综合课", "13800000001", "#f47a12"),
    ("陈语安", "陈老师", "主持、少儿口才", "13800001001", "#ff9f1c"),
    ("苏清禾", "苏老师", "朗诵、语音表达", "13800001002", "#715b87"),
    ("方明远", "方老师", "演讲、赛事辅导", "13800001003", "#4f896f"),
    ("顾南星", "顾老师", "戏剧、舞台表演", "13800001004", "#507b9d"),
]

SEED_ROOMS = [
    ("春日教室", "A203", 12),
    ("剧场教室", "B101", 16),
    ("星光教室", "A205", 6),
]

SEED_CLASSES = [
    ("主持基础 A 班", "少儿主持基础班", "陈老师", "A203", 5, "14:00", 90, 12, "进行中"),
    ("朗诵进阶 A 班", "朗诵表达进阶班", "苏老师", "B101", 5, "16:00", 90, 10, "进行中"),
    ("演讲一对一", "演讲与口才一对一", "方老师", "A205", 5, "18:30", 60, 1, "进行中"),
    ("表演启蒙 A 班", "舞台表演启蒙班", "顾老师", "B101", 5, "19:40", 60, 10, "招生中"),
]

LEAD_STAGES = ("新线索", "已联系", "待试听", "待报名", "已报名", "无效")
HOUR_ACTIONS = {
    "purchase": ("购买课时", 1),
    "consume": ("上课消课", -1),
    "return": ("请假返还", 1),
    "deduct": ("手动扣减", -1),
}

SEED_LEADS = [
    ("林可昕", 7, "139****1021", "大众点评", "新线索", "主持", "希望改善胆小、不敢表达的问题", ""),
    ("唐子墨", 9, "136****7782", "老带新", "新线索", "朗诵", "对朗诵和舞台表演有兴趣", ""),
    ("韩雨桐", 6, "188****2365", "公众号", "已联系", "启蒙", "妈妈周末方便带孩子来试听", ""),
    ("宋安然", 10, "137****6119", "地推活动", "已联系", "主持", "有学校主持经验，想系统提升", ""),
    ("程知远", 8, "150****0927", "小红书", "待试听", "口才", "已约本周六 15:00 体验课", "周六 15:00"),
    ("叶舒然", 11, "152****5180", "视频号", "待试听", "演讲", "准备校内演讲比赛", "周日 10:00"),
    ("温以宁", 7, "138****9204", "老带新", "待报名", "朗诵", "试听反馈很好，待确认班级时间", ""),
]


class DictRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PostgresCursor:
    def __init__(self, cursor, lastrowid: int | None = None):
        self.cursor = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self) -> int:
        return self.cursor.rowcount

    def fetchone(self):
        row = self.cursor.fetchone()
        return DictRow(row) if row is not None else None

    def fetchall(self) -> list[DictRow]:
        return [DictRow(row) for row in self.cursor.fetchall()]


class PostgresConnection:
    dialect = "postgres"

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback):
        return self.connection.__exit__(exc_type, exc, traceback)

    def execute(self, sql: str, params: tuple | dict = ()):
        translated = translate_postgres_sql(sql)
        returning_id = should_return_id(translated)
        if returning_id:
            translated = f"{translated.rstrip().rstrip(';')} RETURNING id"
        cursor = self.connection.cursor()
        try:
            cursor.execute(translated, params)
            lastrowid = None
            if returning_id:
                row = cursor.fetchone()
                lastrowid = row["id"] if row else None
            return PostgresCursor(cursor, lastrowid)
        except Exception as exc:
            if exc.__class__.__name__ in {"IntegrityError", "UniqueViolation", "ForeignKeyViolation"}:
                raise sqlite3.IntegrityError(str(exc)) from exc
            raise

    def executemany(self, sql: str, params: list[tuple] | list[dict]):
        translated = translate_postgres_sql(sql)
        cursor = self.connection.cursor()
        try:
            cursor.executemany(translated, params)
            return PostgresCursor(cursor)
        except Exception as exc:
            if exc.__class__.__name__ in {"IntegrityError", "UniqueViolation", "ForeignKeyViolation"}:
                raise sqlite3.IntegrityError(str(exc)) from exc
            raise

    def executescript(self, script: str) -> None:
        for statement in split_sql_script(script):
            self.execute(statement)


class LibsqlCursor:
    def __init__(self, result):
        self.result = result
        self.lastrowid = getattr(result, "last_insert_rowid", None)
        self._rows = list(getattr(result, "rows", []) or [])
        self._columns = list(getattr(result, "columns", []) or [])

    @property
    def rowcount(self) -> int:
        return getattr(self.result, "rows_affected", -1)

    def row_to_dict(self, row):
        if row is None:
            return None
        if isinstance(row, dict):
            return DictRow(row)
        if hasattr(row, "keys"):
            return DictRow({key: row[key] for key in row.keys()})
        return DictRow(dict(zip(self._columns, row)))

    def fetchone(self):
        return self.row_to_dict(self._rows[0]) if self._rows else None

    def fetchall(self) -> list[DictRow]:
        return [self.row_to_dict(row) for row in self._rows]


class LibsqlConnection:
    dialect = "turso"

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        if hasattr(self.connection, "__enter__"):
            self.connection.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type:
            if hasattr(self.connection, "rollback"):
                self.connection.rollback()
        elif hasattr(self.connection, "commit"):
            self.connection.commit()
        if hasattr(self.connection, "__exit__"):
            return self.connection.__exit__(exc_type, exc, traceback)
        if hasattr(self.connection, "close"):
            self.connection.close()
        return None

    def execute(self, sql: str, params: tuple | dict = ()):
        try:
            result = self.connection.execute(sql, params)
            return LibsqlCursor(result)
        except Exception as exc:
            if exc.__class__.__name__ in {"IntegrityError", "LibsqlError"}:
                raise sqlite3.IntegrityError(str(exc)) from exc
            raise

    def executemany(self, sql: str, params: list[tuple] | list[dict]):
        try:
            result = None
            for item in params:
                result = self.connection.execute(sql, item)
            return LibsqlCursor(result)
        except Exception as exc:
            if exc.__class__.__name__ in {"IntegrityError", "LibsqlError"}:
                raise sqlite3.IntegrityError(str(exc)) from exc
            raise

    def executescript(self, script: str) -> None:
        for statement in split_sql_script(script):
            self.execute(statement)


def split_sql_script(script: str) -> list[str]:
    return [statement.strip() for statement in script.split(";") if statement.strip()]


def translate_postgres_sql(sql: str) -> str:
    translated = sql.strip()
    if re.match(r"INSERT\s+OR\s+IGNORE\s+INTO", translated, re.IGNORECASE):
        translated = re.sub(r"INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", translated, flags=re.IGNORECASE)
        translated = f"{translated.rstrip().rstrip(';')} ON CONFLICT DO NOTHING"
    translated = translated.replace("?", "%s")
    return re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"%(\1)s", translated)


def should_return_id(sql: str) -> bool:
    return bool(re.match(r"\s*INSERT\s+INTO\s+(students|courses|teachers|rooms|classes|users|leads|hour_transactions)\b", sql, re.IGNORECASE))


def postgres_schema(script: str) -> str:
    return (
        script
        .replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
        .replace("REAL NOT NULL", "DOUBLE PRECISION NOT NULL")
        .replace("REAL ", "DOUBLE PRECISION ")
    )


def turso_client_url() -> str:
    if TURSO_DATABASE_URL.startswith("libsql://"):
        return TURSO_DATABASE_URL.replace("libsql://", "https://", 1)
    if TURSO_DATABASE_URL.startswith("wss://"):
        return TURSO_DATABASE_URL.replace("wss://", "https://", 1)
    if TURSO_DATABASE_URL.startswith("ws://"):
        return TURSO_DATABASE_URL.replace("ws://", "http://", 1)
    return TURSO_DATABASE_URL


def connect():
    if DATABASE_KIND == "turso":
        if not TURSO_AUTH_TOKEN:
            raise RuntimeError("使用 Turso 需要设置 TURSO_AUTH_TOKEN")
        try:
            import libsql_client
        except ImportError as exc:
            raise RuntimeError("使用 Turso 需要安装 libsql-client，请运行 pip install -r requirements.txt") from exc
        connection = libsql_client.create_client_sync(
            turso_client_url(),
            auth_token=TURSO_AUTH_TOKEN,
        )
        return LibsqlConnection(connection)

    if DATABASE_KIND == "postgres":
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("使用 PostgreSQL 需要安装 psycopg，请运行 pip install -r requirements.txt") from exc
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        return PostgresConnection(psycopg.connect(url, row_factory=dict_row))

    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    iterations = 120_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations),
    ).hex()
    return hmac.compare_digest(digest, expected)


def user_to_dict(row: sqlite3.Row) -> dict:
    permissions = sorted(ROLE_PERMISSIONS.get(row["role"], set()))
    return {
        "id": row["id"],
        "username": row["username"],
        "phone": row["phone"],
        "name": row["name"],
        "role": row["role"],
        "roleLabel": ROLE_LABELS.get(row["role"], row["role"]),
        "permissions": permissions,
    }


def ensure_user_schema(db: sqlite3.Connection) -> None:
    columns = table_columns(db, "users")
    if "phone" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
    for username, phone, _password, _name, _role in SEED_USERS:
        db.execute(
            "UPDATE users SET phone = ? WHERE username = ? AND phone = ''",
            (phone, username),
        )
    db.execute("UPDATE users SET phone = username WHERE phone = ''")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)")


def table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    if DATABASE_KIND == "postgres":
        return {
            row["name"]
            for row in db.execute(
                """
                SELECT column_name AS name
                FROM information_schema.columns
                WHERE table_name = ?
                """,
                (table,),
            ).fetchall()
        }
    return {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}


def ensure_class_schedule_schema(db: sqlite3.Connection) -> None:
    columns = table_columns(db, "classes")
    if "start_date" not in columns:
        db.execute("ALTER TABLE classes ADD COLUMN start_date TEXT NOT NULL DEFAULT ''")
    if "end_date" not in columns:
        db.execute("ALTER TABLE classes ADD COLUMN end_date TEXT NOT NULL DEFAULT ''")
    current_year = datetime.now().year
    db.execute("UPDATE classes SET start_date = ? WHERE start_date = ''", (f"{current_year}-01-01",))
    db.execute("UPDATE classes SET end_date = ? WHERE end_date = ''", (f"{current_year}-12-31",))


def ensure_seed_teachers(db: sqlite3.Connection) -> None:
    for name, display_name, specialty, phone, color in SEED_TEACHERS:
        if db.execute("SELECT id FROM teachers WHERE display_name = ?", (display_name,)).fetchone():
            continue
        db.execute(
            """
            INSERT INTO teachers (name, display_name, specialty, phone, color, active)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (name, display_name, specialty, phone, color),
        )


def ensure_hour_transaction_schema(db: sqlite3.Connection) -> None:
    columns = table_columns(db, "hour_transactions")
    if "teacher_id" not in columns:
        db.execute("ALTER TABLE hour_transactions ADD COLUMN teacher_id INTEGER")
    db.execute("CREATE INDEX IF NOT EXISTS idx_hour_transactions_teacher ON hour_transactions(teacher_id)")


def validate_user(payload: dict, existing: sqlite3.Row | None = None) -> dict:
    phone = str(payload.get("phone", "")).strip()
    name = str(payload.get("name", "")).strip()
    role = str(payload.get("role", "")).strip()
    password = str(payload.get("password", "")).strip()
    if not phone or len(phone) < 7:
        raise ValueError("请填写有效手机号")
    if not name:
        raise ValueError("请填写员工姓名")
    if role not in ROLE_LABELS:
        raise ValueError("请选择有效角色")
    if not existing and len(password) < 6:
        raise ValueError("初始密码至少 6 位")
    if existing and password and len(password) < 6:
        raise ValueError("新密码至少 6 位")
    return {"phone": phone, "name": name, "role": role, "password": password}


def initialize_database() -> None:
    if DATABASE_KIND == "sqlite":
        DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        schema_sql = """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER NOT NULL CHECK (age BETWEEN 3 AND 18),
                parent TEXT NOT NULL,
                phone TEXT NOT NULL,
                course TEXT NOT NULL,
                hours REAL NOT NULL DEFAULT 0 CHECK (hours >= 0),
                status TEXT NOT NULL DEFAULT '待分班',
                color TEXT NOT NULL DEFAULT '#ff9f1c',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
            CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone);
            CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                age_range TEXT NOT NULL,
                total_hours REAL NOT NULL CHECK (total_hours > 0),
                lesson_duration INTEGER NOT NULL CHECK (lesson_duration > 0),
                price REAL NOT NULL CHECK (price >= 0),
                color TEXT NOT NULL DEFAULT '#ff9f1c',
                status TEXT NOT NULL DEFAULT '启用',
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                display_name TEXT NOT NULL UNIQUE,
                specialty TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '#ff9f1c',
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                capacity INTEGER NOT NULL CHECK (capacity > 0),
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS classes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
                teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
                room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
                start_date TEXT NOT NULL DEFAULT '',
                end_date TEXT NOT NULL DEFAULT '',
                weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
                start_time TEXT NOT NULL,
                duration INTEGER NOT NULL CHECK (duration > 0),
                capacity INTEGER NOT NULL CHECK (capacity > 0),
                status TEXT NOT NULL DEFAULT '招生中',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS class_students (
                class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                joined_at TEXT NOT NULL,
                PRIMARY KEY (class_id, student_id)
            );

            CREATE INDEX IF NOT EXISTS idx_classes_course ON classes(course_id);
            CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                phone TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER NOT NULL CHECK (age BETWEEN 3 AND 18),
                phone TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                stage TEXT NOT NULL DEFAULT '新线索',
                tag TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                next_follow_at TEXT NOT NULL DEFAULT '',
                last_contact_at TEXT NOT NULL DEFAULT '',
                follow_count INTEGER NOT NULL DEFAULT 0 CHECK (follow_count >= 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
            CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

            CREATE TABLE IF NOT EXISTS hour_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                amount REAL NOT NULL CHECK (amount > 0),
                delta REAL NOT NULL,
                balance_after REAL NOT NULL CHECK (balance_after >= 0),
                note TEXT NOT NULL DEFAULT '',
                operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                occurred_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_hour_transactions_student ON hour_transactions(student_id);
            CREATE INDEX IF NOT EXISTS idx_hour_transactions_created ON hour_transactions(created_at);
            """
        db.executescript(postgres_schema(schema_sql) if DATABASE_KIND == "postgres" else schema_sql)
        ensure_user_schema(db)
        ensure_class_schedule_schema(db)
        ensure_hour_transaction_schema(db)
        now = datetime.now().isoformat(timespec="seconds")
        count = db.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        if count == 0:
            db.executemany(
                """
                INSERT INTO students
                    (name, age, parent, phone, course, hours, status, color, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*student, now, now) for student in SEED_STUDENTS],
            )

        if db.execute("SELECT COUNT(*) FROM courses").fetchone()[0] == 0:
            db.executemany(
                """
                INSERT INTO courses
                    (name, category, age_range, total_hours, lesson_duration, price, color, status, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*course, now, now) for course in SEED_COURSES],
            )
        if db.execute("SELECT COUNT(*) FROM teachers").fetchone()[0] == 0:
            db.executemany(
                "INSERT INTO teachers (name, display_name, specialty, phone, color) VALUES (?, ?, ?, ?, ?)",
                SEED_TEACHERS,
            )
        ensure_seed_teachers(db)
        if db.execute("SELECT COUNT(*) FROM rooms").fetchone()[0] == 0:
            db.executemany(
                "INSERT INTO rooms (name, code, capacity) VALUES (?, ?, ?)",
                SEED_ROOMS,
            )
        if db.execute("SELECT COUNT(*) FROM classes").fetchone()[0] == 0:
            for class_data in SEED_CLASSES:
                name, course_name, teacher_name, room_code, weekday, start_time, duration, capacity, status = class_data
                course_id = db.execute("SELECT id FROM courses WHERE name = ?", (course_name,)).fetchone()[0]
                teacher_id = db.execute("SELECT id FROM teachers WHERE display_name = ?", (teacher_name,)).fetchone()[0]
                room_id = db.execute("SELECT id FROM rooms WHERE code = ?", (room_code,)).fetchone()[0]
                db.execute(
                    """
                    INSERT INTO classes
                        (name, course_id, teacher_id, room_id, start_date, end_date, weekday, start_time, duration, capacity, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        name, course_id, teacher_id, room_id,
                        f"{datetime.now().year}-01-01", f"{datetime.now().year}-12-31",
                        weekday, start_time, duration, capacity, status, now, now,
                    ),
                )
        if db.execute("SELECT COUNT(*) FROM class_students").fetchone()[0] == 0:
            students = db.execute("SELECT id, course FROM students").fetchall()
            for student in students:
                class_row = db.execute(
                    """
                    SELECT c.id FROM classes c
                    JOIN courses p ON p.id = c.course_id
                    WHERE p.name = ? ORDER BY c.id LIMIT 1
                    """,
                    (student["course"],),
                ).fetchone()
                if class_row:
                    db.execute(
                        "INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)",
                        (class_row["id"], student["id"], now),
                    )
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            db.executemany(
                """
                INSERT INTO users (username, phone, password_hash, name, role, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                """,
                [
                    (username, phone, hash_password(password), name, role, now, now)
                    for username, phone, password, name, role in SEED_USERS
                ],
            )
        if db.execute("SELECT COUNT(*) FROM leads").fetchone()[0] == 0:
            db.executemany(
                """
                INSERT INTO leads
                    (name, age, phone, source, stage, tag, note, next_follow_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*lead, now, now) for lead in SEED_LEADS],
            )


def student_to_dict(row: sqlite3.Row) -> dict:
    student = dict(row)
    student["code"] = f"S{student['id'] + 1023:04d}"
    student["hours"] = float(student["hours"])
    if student["hours"].is_integer():
        student["hours"] = int(student["hours"])
    return student


def number_value(payload: dict, key: str, label: str, minimum: float = 0) -> float:
    try:
        value = float(payload.get(key, ""))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是数字") from exc
    if value < minimum:
        raise ValueError(f"{label}不能小于 {minimum:g}")
    return value


def format_number(value: float) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else f"{number:g}"


def integer_value(payload: dict, key: str, label: str, minimum: int = 0) -> int:
    value = number_value(payload, key, label, minimum)
    if not value.is_integer():
        raise ValueError(f"{label}必须是整数")
    return int(value)


def date_value(payload: dict, key: str, label: str) -> str:
    value = str(payload.get(key, "")).strip()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise ValueError(f"{label}格式无效，请选择日期") from exc


def time_minutes(value: str, label: str) -> int:
    if len(value) != 5 or value[2] != ":":
        raise ValueError(f"{label}格式无效")
    try:
        hour = int(value[:2])
        minute = int(value[3:])
    except ValueError as exc:
        raise ValueError(f"{label}格式无效") from exc
    if hour > 23 or minute > 59:
        raise ValueError(f"{label}格式无效")
    return hour * 60 + minute


def validate_course(payload: dict) -> dict:
    required = ("name", "category", "age_range")
    if any(not str(payload.get(key, "")).strip() for key in required):
        raise ValueError("请填写课程名称、类别和适龄范围")
    status = str(payload.get("status", "启用")).strip()
    if status not in {"启用", "停用"}:
        raise ValueError("课程状态无效")
    return {
        "name": str(payload["name"]).strip(),
        "category": str(payload["category"]).strip(),
        "age_range": str(payload["age_range"]).strip(),
        "total_hours": number_value(payload, "total_hours", "总课时", 0.5),
        "lesson_duration": integer_value(payload, "lesson_duration", "单节时长", 15),
        "price": number_value(payload, "price", "课程价格", 0),
        "color": str(payload.get("color", COLORS[0])).strip() or COLORS[0],
        "status": status,
        "description": str(payload.get("description", "")).strip(),
    }


def validate_teacher(payload: dict) -> dict:
    if not str(payload.get("name", "")).strip():
        raise ValueError("教师姓名不能为空")
    display_name = str(payload.get("display_name", "")).strip()
    return {
        "name": str(payload["name"]).strip(),
        "display_name": display_name or str(payload["name"]).strip(),
        "specialty": str(payload.get("specialty", "")).strip(),
        "phone": str(payload.get("phone", "")).strip(),
        "color": str(payload.get("color", COLORS[0])).strip() or COLORS[0],
    }


def validate_room(payload: dict) -> dict:
    if not str(payload.get("name", "")).strip():
        raise ValueError("教室名称不能为空")
    if not str(payload.get("code", "")).strip():
        raise ValueError("教室编号不能为空")
    return {
        "name": str(payload["name"]).strip(),
        "code": str(payload["code"]).strip(),
        "capacity": integer_value(payload, "capacity", "教室容量", 1),
    }


def validate_class(payload: dict, db: sqlite3.Connection) -> dict:
    if not str(payload.get("name", "")).strip():
        raise ValueError("班级名称不能为空")
    start_date = date_value(payload, "start_date", "开课日期")
    end_date = date_value(payload, "end_date", "结课日期")
    if end_date < start_date:
        raise ValueError("结课日期不能早于开课日期")
    start_time = str(payload.get("start_time", "")).strip()
    start_minutes = time_minutes(start_time, "开始时间")
    end_time = str(payload.get("end_time", "")).strip()
    if end_time:
        end_minutes = time_minutes(end_time, "结束时间")
        if end_minutes <= start_minutes:
            raise ValueError("结束时间必须晚于开始时间")
        duration = end_minutes - start_minutes
    else:
        duration = integer_value(payload, "duration", "课程时长", 15)
    data = {
        "name": str(payload["name"]).strip(),
        "course_id": integer_value(payload, "course_id", "课程"),
        "teacher_id": integer_value(payload, "teacher_id", "教师"),
        "room_id": integer_value(payload, "room_id", "教室"),
        "start_date": start_date,
        "end_date": end_date,
        "weekday": integer_value(payload, "weekday", "上课星期"),
        "start_time": start_time,
        "duration": duration,
        "capacity": integer_value(payload, "capacity", "班级容量", 1),
        "status": str(payload.get("status", "招生中")).strip(),
    }
    if data["weekday"] > 6:
        raise ValueError("上课星期无效")
    if data["status"] not in {"招生中", "进行中", "已结课", "暂停"}:
        raise ValueError("班级状态无效")
    for table, key, label in (
        ("courses", "course_id", "课程"),
        ("teachers", "teacher_id", "教师"),
        ("rooms", "room_id", "教室"),
    ):
        if not db.execute(f"SELECT id FROM {table} WHERE id = ?", (data[key],)).fetchone():
            raise ValueError(f"{label}不存在")
    room_capacity = db.execute("SELECT capacity FROM rooms WHERE id = ?", (data["room_id"],)).fetchone()[0]
    if data["capacity"] > room_capacity:
        raise ValueError(f"班级容量不能超过教室容量 {room_capacity} 人")
    return data


def course_to_dict(row: sqlite3.Row) -> dict:
    item = dict(row)
    for key in ("total_hours", "price"):
        item[key] = float(item[key])
        if item[key].is_integer():
            item[key] = int(item[key])
    return item


def teacher_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def room_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def class_to_dict(row: sqlite3.Row, students: list[dict] | None = None) -> dict:
    item = dict(row)
    item["students"] = students or []
    item["current"] = len(item["students"])
    item["end_time"] = minutes_to_time(time_minutes(item["start_time"], "开始时间") + int(item["duration"]))
    return item


def minutes_to_time(total_minutes: int) -> str:
    hour = (total_minutes // 60) % 24
    minute = total_minutes % 60
    return f"{hour:02d}:{minute:02d}"


def lead_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def validate_lead(payload: dict) -> dict:
    name = str(payload.get("name", "")).strip()
    age = integer_value(payload, "age", "年龄", 3)
    phone = str(payload.get("phone", "")).strip()
    stage = str(payload.get("stage", "新线索")).strip()
    if not name:
        raise ValueError("请填写线索姓名")
    if age > 18:
        raise ValueError("年龄需要在 3-18 岁之间")
    if not phone or len(phone) < 7:
        raise ValueError("请填写有效联系电话")
    if stage not in LEAD_STAGES:
        raise ValueError("线索阶段无效")
    return {
        "name": name,
        "age": age,
        "phone": phone,
        "source": str(payload.get("source", "")).strip(),
        "stage": stage,
        "tag": str(payload.get("tag", "")).strip(),
        "note": str(payload.get("note", "")).strip(),
        "next_follow_at": str(payload.get("next_follow_at", "")).strip(),
    }


def validate_hour_transaction(payload: dict) -> dict:
    action = str(payload.get("action", "")).strip()
    if action not in HOUR_ACTIONS:
        raise ValueError("课时变动类型无效")
    return {
        "student_id": integer_value(payload, "student_id", "学员", 1),
        "teacher_id": integer_value(payload, "teacher_id", "教师", 1),
        "action": action,
        "amount": number_value(payload, "amount", "课时数", 0.5),
        "note": str(payload.get("note", "")).strip(),
        "occurred_at": str(payload.get("occurred_at", "")).strip() or datetime.now().isoformat(timespec="seconds"),
    }


def hour_transaction_to_dict(row: sqlite3.Row) -> dict:
    item = dict(row)
    for key in ("amount", "delta", "balance_after"):
        item[key] = float(item[key])
        if item[key].is_integer():
            item[key] = int(item[key])
    item["action_label"] = HOUR_ACTIONS.get(item["action"], (item["action"], 0))[0]
    return item


def teacher_ids_for_user(db: sqlite3.Connection, user: sqlite3.Row | dict | None) -> list[int] | None:
    if not user or user["role"] in {"owner", "academic", "finance"}:
        return None
    if user["role"] != "teacher":
        return []
    rows = db.execute(
        """
        SELECT id FROM teachers
        WHERE active = 1 AND (display_name = ? OR name = ? OR phone = ?)
        """,
        (user["name"], user["name"], user["phone"]),
    ).fetchall()
    return [row["id"] for row in rows]


def student_belongs_to_teacher(db: sqlite3.Connection, teacher_id: int, student_id: int) -> bool:
    return bool(
        db.execute(
            """
            SELECT 1
            FROM class_students cs
            JOIN classes c ON c.id = cs.class_id
            WHERE c.teacher_id = ? AND cs.student_id = ?
            LIMIT 1
            """,
            (teacher_id, student_id),
        ).fetchone()
    )


def validate_student(payload: dict, partial: bool = False) -> dict:
    required = ("name", "age", "parent", "phone", "course")
    if not partial:
        missing = [key for key in required if payload.get(key) in (None, "")]
        if missing:
            raise ValueError(f"请填写完整：{', '.join(missing)}")

    result = {}
    for field in ("name", "parent", "phone", "course", "status", "color", "note"):
        if field in payload:
            result[field] = str(payload[field]).strip()

    if "age" in payload:
        try:
            result["age"] = int(payload["age"])
        except (TypeError, ValueError) as exc:
            raise ValueError("年龄必须是整数") from exc
        if not 3 <= result["age"] <= 18:
            raise ValueError("年龄应在 3 到 18 岁之间")

    if "hours" in payload:
        try:
            result["hours"] = float(payload["hours"])
        except (TypeError, ValueError) as exc:
            raise ValueError("课时必须是数字") from exc
        if result["hours"] < 0:
            raise ValueError("课时不能小于 0")

    if "course" in result and not result["course"]:
        raise ValueError("请选择有效课程")
    if "status" in result and result["status"] not in STATUSES:
        raise ValueError("请选择有效状态")

    if "name" in result and not result["name"]:
        raise ValueError("学员姓名不能为空")
    if "parent" in result and not result["parent"]:
        raise ValueError("家长姓名不能为空")
    if "phone" in result and len(result["phone"]) < 7:
        raise ValueError("联系电话格式不正确")

    if not partial:
        result.setdefault("hours", 0)
        result.setdefault("status", "待分班")
        result.setdefault("note", "")
    return result


class AppHandler(BaseHTTPRequestHandler):
    server_version = "BabayaMVP/1.0"

    def log_message(self, format_string: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(
        self,
        data: dict | list,
        status: HTTPStatus = HTTPStatus.OK,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Credentials", "true")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("请求长度无效") from exc
        if length <= 0 or length > 1_000_000:
            raise ValueError("请求内容为空或过大")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("请求内容不是有效 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("请求内容格式错误")
        return payload

    def session_cookie(self) -> str:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else ""

    def current_user(self) -> dict | None:
        token = self.session_cookie()
        if not token:
            return None
        now = datetime.now().isoformat(timespec="seconds")
        with connect() as db:
            db.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
            row = db.execute(
                """
                SELECT u.* FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ? AND s.expires_at > ? AND u.active = 1
                """,
                (token, now),
            ).fetchone()
        return user_to_dict(row) if row else None

    def require_permission(self, permission: str) -> dict | None:
        user = self.current_user()
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "请先登录")
            return None
        if permission not in set(user["permissions"]):
            self.send_error_json(HTTPStatus.FORBIDDEN, "当前角色没有此操作权限")
            return None
        return user

    def set_session_cookie(self, token: str, max_age: int) -> str:
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"

    def get_session(self) -> None:
        user = self.current_user()
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "请先登录")
            return
        self.send_json({"user": user})

    def login(self) -> None:
        try:
            payload = self.read_json()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        phone = str(payload.get("phone", "")).strip()
        password = str(payload.get("password", ""))
        with connect() as db:
            row = db.execute(
                "SELECT * FROM users WHERE phone = ? AND active = 1",
                (phone,),
            ).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "手机号或密码不正确")
                return
            token = secrets.token_urlsafe(32)
            now = datetime.now()
            expires_at = now + timedelta(hours=SESSION_HOURS)
            db.execute(
                "INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (
                    token,
                    row["id"],
                    now.isoformat(timespec="seconds"),
                    expires_at.isoformat(timespec="seconds"),
                ),
            )
        self.send_json(
            {"user": user_to_dict(row)},
            extra_headers={"Set-Cookie": self.set_session_cookie(token, SESSION_HOURS * 60 * 60)},
        )

    def logout(self) -> None:
        token = self.session_cookie()
        if token:
            with connect() as db:
                db.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
        self.send_json(
            {"loggedOut": True},
            extra_headers={"Set-Cookie": self.set_session_cookie("", 0)},
        )

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"status": "ok", "database": DATABASE_KIND})
            return
        if parsed.path == "/api/session":
            self.get_session()
            return
        if parsed.path == "/api/users":
            if not self.require_permission("settings:read"):
                return
            self.get_users()
            return
        if parsed.path == "/api/students":
            if not self.require_permission("students:read"):
                return
            self.get_students(parse_qs(parsed.query))
            return
        if parsed.path == "/api/catalog":
            if not self.require_permission("catalog:read"):
                return
            self.get_catalog()
            return
        if parsed.path == "/api/dashboard":
            if not self.require_permission("dashboard:read"):
                return
            self.get_dashboard()
            return
        if parsed.path == "/api/hour-transactions":
            if not self.require_permission("hours:read"):
                return
            self.get_hour_transactions()
            return
        if parsed.path == "/api/leads":
            if not self.require_permission("leads:read"):
                return
            self.get_leads(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            return
        self.serve_static(parsed.path)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/login":
            self.login()
            return
        if path == "/api/logout":
            self.logout()
            return
        if path == "/api/users":
            if not self.require_permission("settings:write"):
                return
            self.create_user()
            return
        if path == "/api/students":
            if not self.require_permission("students:write"):
                return
            self.create_student()
            return
        if path == "/api/courses":
            if not self.require_permission("catalog:write"):
                return
            self.create_course()
            return
        if path == "/api/classes":
            if not self.require_permission("catalog:write"):
                return
            self.create_class()
            return
        if path == "/api/teachers":
            if not self.require_permission("catalog:write"):
                return
            self.create_teacher()
            return
        if path == "/api/rooms":
            if not self.require_permission("catalog:write"):
                return
            self.create_room()
            return
        if path == "/api/leads":
            if not self.require_permission("leads:write"):
                return
            self.create_lead()
            return
        if path == "/api/hour-transactions":
            if not self.require_permission("hours:write"):
                return
            self.create_hour_transaction()
            return
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "classes"] and parts[3] == "students":
            if not self.require_permission("roster:write"):
                return
            self.enroll_student(parts[2])
            return
        if len(parts) == 4 and parts[:2] == ["api", "leads"] and parts[3] == "contact":
            if not self.require_permission("leads:write"):
                return
            self.contact_lead(parts[2])
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")

    def create_student(self) -> None:
        try:
            data = validate_student(self.read_json())
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        data.setdefault("color", COLORS[0])

        now = datetime.now().isoformat(timespec="seconds")
        with connect() as db:
            cursor = db.execute(
                """
                INSERT INTO students
                    (name, age, parent, phone, course, hours, status, color, note, created_at, updated_at)
                VALUES (:name, :age, :parent, :phone, :course, :hours, :status, :color, :note, :created_at, :updated_at)
                """,
                {**data, "created_at": now, "updated_at": now},
            )
            row = db.execute("SELECT * FROM students WHERE id = ?", (cursor.lastrowid,)).fetchone()
        self.send_json(student_to_dict(row), HTTPStatus.CREATED)

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        parts = path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api":
            self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            return
        resource = parts[1]
        try:
            item_id = int(parts[2])
        except ValueError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "编号无效")
            return
        if resource == "students":
            if not self.require_permission("students:write"):
                return
            self.update_student(item_id)
            return
        if resource == "courses":
            if not self.require_permission("catalog:write"):
                return
            self.update_course(item_id)
            return
        if resource == "classes":
            if not self.require_permission("catalog:write"):
                return
            self.update_class(item_id)
            return
        if resource == "teachers":
            if not self.require_permission("catalog:write"):
                return
            self.update_teacher(item_id)
            return
        if resource == "rooms":
            if not self.require_permission("catalog:write"):
                return
            self.update_room(item_id)
            return
        if resource == "users":
            if not self.require_permission("settings:write"):
                return
            self.update_user(item_id)
            return
        if resource == "leads":
            if not self.require_permission("leads:write"):
                return
            self.update_lead(item_id)
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")

    def update_student(self, student_id: int) -> None:
        try:
            data = validate_student(self.read_json())
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        assignments = ", ".join(f"{key} = :{key}" for key in data)
        data.update({"id": student_id, "updated_at": datetime.now().isoformat(timespec="seconds")})
        with connect() as db:
            exists = db.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
            if not exists:
                self.send_error_json(HTTPStatus.NOT_FOUND, "学员不存在")
                return
            db.execute(
                f"UPDATE students SET {assignments}, updated_at = :updated_at WHERE id = :id",
                data,
            )
            row = db.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
        self.send_json(student_to_dict(row))

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        parts = path.strip("/").split("/")
        if len(parts) == 5 and parts[:2] == ["api", "classes"] and parts[3] == "students":
            if not self.require_permission("roster:write"):
                return
            self.unenroll_student(parts[2], parts[4])
            return
        if len(parts) != 3 or parts[0] != "api":
            self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            return
        try:
            item_id = int(parts[2])
        except ValueError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "编号无效")
            return
        if parts[1] == "students":
            if not self.require_permission("students:write"):
                return
            self.delete_student(item_id)
            return
        if parts[1] == "courses":
            if not self.require_permission("catalog:write"):
                return
            self.delete_course(item_id)
            return
        if parts[1] == "classes":
            if not self.require_permission("catalog:write"):
                return
            self.delete_class(item_id)
            return
        if parts[1] == "teachers":
            if not self.require_permission("catalog:write"):
                return
            self.delete_teacher(item_id)
            return
        if parts[1] == "rooms":
            if not self.require_permission("catalog:write"):
                return
            self.delete_room(item_id)
            return
        if parts[1] == "users":
            if not self.require_permission("settings:write"):
                return
            self.delete_user(item_id)
            return
        if parts[1] == "leads":
            if not self.require_permission("leads:write"):
                return
            self.delete_lead(item_id)
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")

    def get_leads(self, query: dict) -> None:
        stage = query.get("stage", [""])[0].strip()
        sql = "SELECT * FROM leads"
        params: tuple = ()
        if stage:
            sql += " WHERE stage = ?"
            params = (stage,)
        sql += " ORDER BY updated_at DESC, id DESC"
        with connect() as db:
            rows = db.execute(sql, params).fetchall()
        self.send_json([lead_to_dict(row) for row in rows])

    def create_lead(self) -> None:
        try:
            data = validate_lead(self.read_json())
            now = datetime.now().isoformat(timespec="seconds")
            with connect() as db:
                cursor = db.execute(
                    """
                    INSERT INTO leads
                        (name, age, phone, source, stage, tag, note, next_follow_at, created_at, updated_at)
                    VALUES (:name, :age, :phone, :source, :stage, :tag, :note, :next_follow_at, :created_at, :updated_at)
                    """,
                    {**data, "created_at": now, "updated_at": now},
                )
                row = db.execute("SELECT * FROM leads WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_json(lead_to_dict(row), HTTPStatus.CREATED)

    def update_lead(self, lead_id: int) -> None:
        try:
            data = validate_lead(self.read_json())
            data.update({"id": lead_id, "updated_at": datetime.now().isoformat(timespec="seconds")})
            with connect() as db:
                if not db.execute("SELECT id FROM leads WHERE id = ?", (lead_id,)).fetchone():
                    self.send_error_json(HTTPStatus.NOT_FOUND, "线索不存在")
                    return
                db.execute(
                    """
                    UPDATE leads SET
                        name=:name, age=:age, phone=:phone, source=:source, stage=:stage,
                        tag=:tag, note=:note, next_follow_at=:next_follow_at, updated_at=:updated_at
                    WHERE id=:id
                    """,
                    data,
                )
                row = db.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_json(lead_to_dict(row))

    def contact_lead(self, raw_lead_id: str) -> None:
        try:
            lead_id = int(raw_lead_id)
        except ValueError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "编号无效")
            return
        now = datetime.now().isoformat(timespec="seconds")
        with connect() as db:
            row = db.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
            if not row:
                self.send_error_json(HTTPStatus.NOT_FOUND, "线索不存在")
                return
            next_stage = "已联系" if row["stage"] == "新线索" else row["stage"]
            db.execute(
                """
                UPDATE leads SET stage = ?, follow_count = follow_count + 1,
                    last_contact_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_stage, now, now, lead_id),
            )
            row = db.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        self.send_json(lead_to_dict(row))

    def delete_lead(self, lead_id: int) -> None:
        with connect() as db:
            cursor = db.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "线索不存在")
            return
        self.send_json({"deleted": True, "id": lead_id})

    def get_hour_transactions(self) -> None:
        with connect() as db:
            teacher_ids = teacher_ids_for_user(db, self.current_user())
            where_sql = ""
            params: tuple = ()
            if teacher_ids == []:
                self.send_json([])
                return
            if teacher_ids is not None:
                placeholders = ", ".join("?" for _ in teacher_ids)
                where_sql = f"WHERE h.teacher_id IN ({placeholders})"
                params = tuple(teacher_ids)
            rows = db.execute(
                f"""
                SELECT h.*, s.name AS student_name, s.course AS course_name,
                    t.display_name AS teacher_name, u.name AS operator_name
                FROM hour_transactions h
                JOIN students s ON s.id = h.student_id
                LEFT JOIN teachers t ON t.id = h.teacher_id
                LEFT JOIN users u ON u.id = h.operator_id
                {where_sql}
                ORDER BY h.occurred_at DESC, h.id DESC
                LIMIT 200
                """,
                params,
            ).fetchall()
        self.send_json([hour_transaction_to_dict(row) for row in rows])

    def create_hour_transaction(self) -> None:
        try:
            data = validate_hour_transaction(self.read_json())
            label, sign = HOUR_ACTIONS[data["action"]]
            delta = data["amount"] * sign
            now = datetime.now().isoformat(timespec="seconds")
            current_user = self.current_user()
            with connect() as db:
                allowed_teacher_ids = teacher_ids_for_user(db, current_user)
                if allowed_teacher_ids is not None and data["teacher_id"] not in allowed_teacher_ids:
                    raise ValueError("当前账号不能为该教师记录课时")
                teacher = db.execute("SELECT id FROM teachers WHERE id = ? AND active = 1", (data["teacher_id"],)).fetchone()
                if not teacher:
                    raise ValueError("教师不存在")
                student = db.execute("SELECT * FROM students WHERE id = ?", (data["student_id"],)).fetchone()
                if not student:
                    raise ValueError("学员不存在")
                if not student_belongs_to_teacher(db, data["teacher_id"], data["student_id"]):
                    raise ValueError("该学员不在该教师名下，不能记录课时变动")
                balance_after = float(student["hours"]) + delta
                if balance_after < 0:
                    raise ValueError(f"{student['name']} 当前仅剩 {format_number(student['hours'])} 课时，不能{label} {format_number(data['amount'])} 课时")
                db.execute(
                    "UPDATE students SET hours = ?, updated_at = ? WHERE id = ?",
                    (balance_after, now, data["student_id"]),
                )
                cursor = db.execute(
                    """
                    INSERT INTO hour_transactions
                        (student_id, teacher_id, action, amount, delta, balance_after, note, operator_id, occurred_at, created_at)
                    VALUES (:student_id, :teacher_id, :action, :amount, :delta, :balance_after, :note, :operator_id, :occurred_at, :created_at)
                    """,
                    {
                        **data,
                        "delta": delta,
                        "balance_after": balance_after,
                        "operator_id": current_user["id"] if current_user else None,
                        "created_at": now,
                    },
                )
                row = db.execute(
                    """
                    SELECT h.*, s.name AS student_name, s.course AS course_name,
                        t.display_name AS teacher_name, u.name AS operator_name
                    FROM hour_transactions h
                    JOIN students s ON s.id = h.student_id
                    LEFT JOIN teachers t ON t.id = h.teacher_id
                    LEFT JOIN users u ON u.id = h.operator_id
                    WHERE h.id = ?
                    """,
                    (cursor.lastrowid,),
                ).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_json(hour_transaction_to_dict(row), HTTPStatus.CREATED)

    def get_users(self) -> None:
        with connect() as db:
            rows = db.execute(
                "SELECT * FROM users WHERE active = 1 ORDER BY id"
            ).fetchall()
        self.send_json([user_to_dict(row) for row in rows])

    def create_user(self) -> None:
        try:
            data = validate_user(self.read_json())
            now = datetime.now().isoformat(timespec="seconds")
            with connect() as db:
                cursor = db.execute(
                    """
                    INSERT INTO users (username, phone, password_hash, name, role, active, created_at, updated_at)
                    VALUES (:username, :phone, :password_hash, :name, :role, 1, :created_at, :updated_at)
                    """,
                    {
                        "username": data["phone"],
                        "phone": data["phone"],
                        "password_hash": hash_password(data["password"]),
                        "name": data["name"],
                        "role": data["role"],
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                row = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "该手机号已存在账号")
            return
        self.send_json(user_to_dict(row), HTTPStatus.CREATED)

    def update_user(self, user_id: int) -> None:
        try:
            payload = self.read_json()
            with connect() as db:
                existing = db.execute("SELECT * FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone()
                if not existing:
                    self.send_error_json(HTTPStatus.NOT_FOUND, "员工账号不存在")
                    return
                data = validate_user(payload, existing)
                params = {
                    "id": user_id,
                    "username": data["phone"],
                    "phone": data["phone"],
                    "name": data["name"],
                    "role": data["role"],
                    "updated_at": datetime.now().isoformat(timespec="seconds"),
                }
                if data["password"]:
                    params["password_hash"] = hash_password(data["password"])
                    db.execute(
                        """
                        UPDATE users SET username=:username, phone=:phone, name=:name, role=:role,
                            password_hash=:password_hash, updated_at=:updated_at
                        WHERE id=:id
                        """,
                        params,
                    )
                else:
                    db.execute(
                        """
                        UPDATE users SET username=:username, phone=:phone, name=:name, role=:role,
                            updated_at=:updated_at
                        WHERE id=:id
                        """,
                        params,
                    )
                row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "该手机号已存在账号")
            return
        self.send_json(user_to_dict(row))

    def delete_user(self, user_id: int) -> None:
        current = self.current_user()
        if current and current["id"] == user_id:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "不能停用当前登录账号")
            return
        with connect() as db:
            cursor = db.execute(
                "UPDATE users SET active = 0, updated_at = ? WHERE id = ? AND active = 1",
                (datetime.now().isoformat(timespec="seconds"), user_id),
            )
            db.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "员工账号不存在")
            return
        self.send_json({"deleted": True, "id": user_id})

    def delete_student(self, student_id: int) -> None:
        with connect() as db:
            cursor = db.execute("DELETE FROM students WHERE id = ?", (student_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "学员不存在")
            return
        self.send_json({"deleted": True, "id": student_id})

    def create_course(self) -> None:
        try:
            data = validate_course(self.read_json())
            now = datetime.now().isoformat(timespec="seconds")
            with connect() as db:
                cursor = db.execute(
                    """
                    INSERT INTO courses
                        (name, category, age_range, total_hours, lesson_duration, price, color, status, description, created_at, updated_at)
                    VALUES (:name, :category, :age_range, :total_hours, :lesson_duration, :price, :color, :status, :description, :created_at, :updated_at)
                    """,
                    {**data, "created_at": now, "updated_at": now},
                )
                row = db.execute("SELECT * FROM courses WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "课程名称已存在")
            return
        self.send_json(course_to_dict(row), HTTPStatus.CREATED)

    def update_course(self, course_id: int) -> None:
        try:
            data = validate_course(self.read_json())
            data.update({"id": course_id, "updated_at": datetime.now().isoformat(timespec="seconds")})
            with connect() as db:
                old = db.execute("SELECT name FROM courses WHERE id = ?", (course_id,)).fetchone()
                if not old:
                    self.send_error_json(HTTPStatus.NOT_FOUND, "课程不存在")
                    return
                db.execute(
                    """
                    UPDATE courses SET
                        name=:name, category=:category, age_range=:age_range, total_hours=:total_hours,
                        lesson_duration=:lesson_duration, price=:price, color=:color, status=:status,
                        description=:description, updated_at=:updated_at
                    WHERE id=:id
                    """,
                    data,
                )
                if old["name"] != data["name"]:
                    db.execute("UPDATE students SET course = ? WHERE course = ?", (data["name"], old["name"]))
                row = db.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "课程名称已存在")
            return
        self.send_json(course_to_dict(row))

    def delete_course(self, course_id: int) -> None:
        with connect() as db:
            used = db.execute("SELECT COUNT(*) FROM classes WHERE course_id = ?", (course_id,)).fetchone()[0]
            if used:
                self.send_error_json(HTTPStatus.CONFLICT, "该课程已有班级，请先删除或调整班级")
                return
            cursor = db.execute("DELETE FROM courses WHERE id = ?", (course_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "课程不存在")
            return
        self.send_json({"deleted": True, "id": course_id})

    def create_teacher(self) -> None:
        try:
            data = validate_teacher(self.read_json())
            with connect() as db:
                cursor = db.execute(
                    """
                    INSERT INTO teachers (name, display_name, specialty, phone, color, active)
                    VALUES (:name, :display_name, :specialty, :phone, :color, 1)
                    """,
                    data,
                )
                row = db.execute("SELECT * FROM teachers WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "教师简称已存在")
            return
        self.send_json(teacher_to_dict(row), HTTPStatus.CREATED)

    def update_teacher(self, teacher_id: int) -> None:
        try:
            data = validate_teacher(self.read_json())
            data["id"] = teacher_id
            with connect() as db:
                if not db.execute("SELECT id FROM teachers WHERE id = ? AND active = 1", (teacher_id,)).fetchone():
                    self.send_error_json(HTTPStatus.NOT_FOUND, "教师不存在")
                    return
                db.execute(
                    """
                    UPDATE teachers SET
                        name=:name, display_name=:display_name, specialty=:specialty,
                        phone=:phone, color=:color
                    WHERE id=:id
                    """,
                    data,
                )
                row = db.execute("SELECT * FROM teachers WHERE id = ?", (teacher_id,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "教师简称已存在")
            return
        self.send_json(teacher_to_dict(row))

    def delete_teacher(self, teacher_id: int) -> None:
        with connect() as db:
            used = db.execute("SELECT COUNT(*) FROM classes WHERE teacher_id = ?", (teacher_id,)).fetchone()[0]
            if used:
                self.send_error_json(HTTPStatus.CONFLICT, "该教师已有班级，请先调整班级教师")
                return
            cursor = db.execute("UPDATE teachers SET active = 0 WHERE id = ? AND active = 1", (teacher_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "教师不存在")
            return
        self.send_json({"deleted": True, "id": teacher_id})

    def create_room(self) -> None:
        try:
            data = validate_room(self.read_json())
            with connect() as db:
                cursor = db.execute(
                    "INSERT INTO rooms (name, code, capacity, active) VALUES (:name, :code, :capacity, 1)",
                    data,
                )
                row = db.execute("SELECT * FROM rooms WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "教室编号已存在")
            return
        self.send_json(room_to_dict(row), HTTPStatus.CREATED)

    def update_room(self, room_id: int) -> None:
        try:
            data = validate_room(self.read_json())
            data["id"] = room_id
            with connect() as db:
                if not db.execute("SELECT id FROM rooms WHERE id = ? AND active = 1", (room_id,)).fetchone():
                    self.send_error_json(HTTPStatus.NOT_FOUND, "教室不存在")
                    return
                max_class_capacity = db.execute(
                    "SELECT COALESCE(MAX(capacity), 0) FROM classes WHERE room_id = ?",
                    (room_id,),
                ).fetchone()[0]
                if data["capacity"] < max_class_capacity:
                    raise ValueError(f"该教室已有班级容量为 {max_class_capacity} 人，教室容量不能低于它")
                db.execute(
                    "UPDATE rooms SET name=:name, code=:code, capacity=:capacity WHERE id=:id",
                    data,
                )
                row = db.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "教室编号已存在")
            return
        self.send_json(room_to_dict(row))

    def delete_room(self, room_id: int) -> None:
        with connect() as db:
            used = db.execute("SELECT COUNT(*) FROM classes WHERE room_id = ?", (room_id,)).fetchone()[0]
            if used:
                self.send_error_json(HTTPStatus.CONFLICT, "该教室已有班级，请先调整班级教室")
                return
            cursor = db.execute("UPDATE rooms SET active = 0 WHERE id = ? AND active = 1", (room_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "教室不存在")
            return
        self.send_json({"deleted": True, "id": room_id})

    def create_class(self) -> None:
        try:
            payload = self.read_json()
            with connect() as db:
                data = validate_class(payload, db)
                now = datetime.now().isoformat(timespec="seconds")
                cursor = db.execute(
                    """
                    INSERT INTO classes
                        (name, course_id, teacher_id, room_id, start_date, end_date, weekday, start_time, duration, capacity, status, created_at, updated_at)
                    VALUES (:name, :course_id, :teacher_id, :room_id, :start_date, :end_date, :weekday, :start_time, :duration, :capacity, :status, :created_at, :updated_at)
                    """,
                    {**data, "created_at": now, "updated_at": now},
                )
                class_id = cursor.lastrowid
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_json({"id": class_id, **data}, HTTPStatus.CREATED)

    def update_class(self, class_id: int) -> None:
        try:
            payload = self.read_json()
            with connect() as db:
                if not db.execute("SELECT id FROM classes WHERE id = ?", (class_id,)).fetchone():
                    self.send_error_json(HTTPStatus.NOT_FOUND, "班级不存在")
                    return
                data = validate_class(payload, db)
                current = db.execute(
                    "SELECT COUNT(*) FROM class_students WHERE class_id = ?", (class_id,)
                ).fetchone()[0]
                if data["capacity"] < current:
                    raise ValueError(f"班级已有 {current} 名学员，容量不能低于当前人数")
                data.update({"id": class_id, "updated_at": datetime.now().isoformat(timespec="seconds")})
                db.execute(
                    """
                    UPDATE classes SET
                        name=:name, course_id=:course_id, teacher_id=:teacher_id, room_id=:room_id,
                        start_date=:start_date, end_date=:end_date, weekday=:weekday, start_time=:start_time, duration=:duration,
                        capacity=:capacity, status=:status, updated_at=:updated_at
                    WHERE id=:id
                    """,
                    data,
                )
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_json({"id": class_id, **data})

    def delete_class(self, class_id: int) -> None:
        with connect() as db:
            cursor = db.execute("DELETE FROM classes WHERE id = ?", (class_id,))
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "班级不存在")
            return
        self.send_json({"deleted": True, "id": class_id})

    def enroll_student(self, raw_class_id: str) -> None:
        try:
            class_id = int(raw_class_id)
            student_id = integer_value(self.read_json(), "student_id", "学员", 1)
            with connect() as db:
                class_row = db.execute(
                    """
                    SELECT c.capacity, p.name AS course_name
                    FROM classes c JOIN courses p ON p.id = c.course_id WHERE c.id = ?
                    """,
                    (class_id,),
                ).fetchone()
                if not class_row:
                    raise ValueError("班级不存在")
                if not db.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone():
                    raise ValueError("学员不存在")
                current = db.execute(
                    "SELECT COUNT(*) FROM class_students WHERE class_id = ?", (class_id,)
                ).fetchone()[0]
                if current >= class_row["capacity"]:
                    raise ValueError("班级人数已满")
                existing_classes = db.execute(
                    "SELECT COUNT(*) FROM class_students WHERE student_id = ?", (student_id,)
                ).fetchone()[0]
                db.execute(
                    "INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)",
                    (class_id, student_id, datetime.now().isoformat(timespec="seconds")),
                )
                if existing_classes == 0:
                    db.execute(
                        "UPDATE students SET course = ?, status = '在读', updated_at = ? WHERE id = ?",
                        (class_row["course_name"], datetime.now().isoformat(timespec="seconds"), student_id),
                    )
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "该学员已在此班级")
            return
        self.send_json({"enrolled": True, "class_id": class_id, "student_id": student_id}, HTTPStatus.CREATED)

    def unenroll_student(self, raw_class_id: str, raw_student_id: str) -> None:
        try:
            class_id, student_id = int(raw_class_id), int(raw_student_id)
        except ValueError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "编号无效")
            return
        with connect() as db:
            cursor = db.execute(
                "DELETE FROM class_students WHERE class_id = ? AND student_id = ?",
                (class_id, student_id),
            )
            if cursor.rowcount:
                remaining = db.execute(
                    """
                    SELECT p.name FROM class_students cs
                    JOIN classes c ON c.id = cs.class_id
                    JOIN courses p ON p.id = c.course_id
                    WHERE cs.student_id = ? ORDER BY cs.joined_at LIMIT 1
                    """,
                    (student_id,),
                ).fetchone()
                if remaining:
                    db.execute(
                        "UPDATE students SET course = ?, updated_at = ? WHERE id = ?",
                        (remaining["name"], datetime.now().isoformat(timespec="seconds"), student_id),
                    )
        if cursor.rowcount == 0:
            self.send_error_json(HTTPStatus.NOT_FOUND, "分班记录不存在")
            return
        self.send_json({"removed": True, "class_id": class_id, "student_id": student_id})

    def get_students(self, query: dict) -> None:
        search = query.get("q", [""])[0].strip()
        sql = "SELECT * FROM students"
        params: tuple = ()
        if search:
            sql += " WHERE name LIKE ? OR parent LIKE ? OR phone LIKE ? OR course LIKE ?"
            keyword = f"%{search}%"
            params = (keyword, keyword, keyword, keyword)
        sql += " ORDER BY id DESC"
        with connect() as db:
            rows = db.execute(sql, params).fetchall()
        self.send_json([student_to_dict(row) for row in rows])

    def get_catalog(self) -> None:
        with connect() as db:
            course_rows = db.execute(
                """
                SELECT p.*,
                    COUNT(DISTINCT c.id) AS class_count,
                    COUNT(DISTINCT cs.student_id) AS student_count
                FROM courses p
                LEFT JOIN classes c ON c.course_id = p.id
                LEFT JOIN class_students cs ON cs.class_id = c.id
                GROUP BY p.id
                ORDER BY p.id
                """
            ).fetchall()
            teacher_rows = db.execute(
                """
                SELECT t.*, COUNT(c.id) AS class_count
                FROM teachers t
                LEFT JOIN classes c ON c.teacher_id = t.id
                WHERE t.active = 1
                GROUP BY t.id
                ORDER BY t.id
                """
            ).fetchall()
            room_rows = db.execute(
                """
                SELECT r.*, COUNT(c.id) AS class_count
                FROM rooms r
                LEFT JOIN classes c ON c.room_id = r.id
                WHERE r.active = 1
                GROUP BY r.id
                ORDER BY r.id
                """
            ).fetchall()
            class_rows = db.execute(
                """
                SELECT c.*, p.name AS course_name, p.color AS course_color,
                    t.display_name AS teacher_name, t.color AS teacher_color,
                    r.name AS room_name, r.code AS room_code, r.capacity AS room_capacity
                FROM classes c
                JOIN courses p ON p.id = c.course_id
                JOIN teachers t ON t.id = c.teacher_id
                JOIN rooms r ON r.id = c.room_id
                ORDER BY c.weekday, c.start_time, c.id
                """
            ).fetchall()
            classes = []
            for row in class_rows:
                members = [
                    student_to_dict(member)
                    for member in db.execute(
                        """
                        SELECT s.* FROM students s
                        JOIN class_students cs ON cs.student_id = s.id
                        WHERE cs.class_id = ? ORDER BY s.name
                        """,
                        (row["id"],),
                    ).fetchall()
                ]
                classes.append(class_to_dict(row, members))
        self.send_json(
            {
                "courses": [course_to_dict(row) for row in course_rows],
                "classes": classes,
                "teachers": [teacher_to_dict(row) for row in teacher_rows],
                "rooms": [room_to_dict(row) for row in room_rows],
            }
        )

    def get_dashboard(self) -> None:
        with connect() as db:
            total = db.execute("SELECT COUNT(*) FROM students").fetchone()[0]
            active = db.execute("SELECT COUNT(*) FROM students WHERE status = '在读'").fetchone()[0]
            renewals = db.execute("SELECT COUNT(*) FROM students WHERE status = '待续费'").fetchone()[0]
            hours = db.execute("SELECT COALESCE(SUM(hours), 0) FROM students").fetchone()[0]
            class_count = db.execute(
                "SELECT COUNT(*) FROM classes WHERE status IN ('招生中', '进行中')"
            ).fetchone()[0]
        self.send_json(
            {
                "totalStudents": total,
                "activeStudents": active,
                "renewalStudents": renewals,
                "remainingHours": hours,
                "activeClasses": class_count,
            }
        )

    def serve_static(self, request_path: str) -> None:
        relative = unquote(request_path).lstrip("/") or "index.html"
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if any(part in {".git", "data", "__pycache__"} for part in target.relative_to(ROOT).parts):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file() or target.name == DATABASE.name:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content = target.read_bytes()
        content_type, _ = mimetypes.guess_type(target.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)


def run() -> None:
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"芭芭鸭教培系统已启动：http://{HOST}:{PORT}")
    if DATABASE_KIND == "turso":
        database_label = f"Turso ({TURSO_DATABASE_URL})"
    elif DATABASE_KIND == "postgres":
        database_label = "PostgreSQL"
    else:
        database_label = str(DATABASE)
    print(f"数据库：{database_label}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
