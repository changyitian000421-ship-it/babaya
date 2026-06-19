#!/usr/bin/env python3
"""Shengdong training management MVP server.

Serves the static frontend and a small JSON API backed by SQLite.
"""

from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).expanduser()
DATABASE = Path(os.environ.get("DATABASE_PATH", str(DATA_DIR / "shengdong.db"))).expanduser()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4173"))

STATUSES = {"在读", "待续费", "请假中", "待分班", "停课"}
COLORS = ["#e8664a", "#715b87", "#4f896f", "#c89436", "#507b9d"]

SEED_STUDENTS = [
    ("顾言溪", 8, "顾女士", "138****2168", "少儿主持基础班", 24, "在读", "#e8664a", ""),
    ("周亦辰", 10, "周先生", "186****5372", "朗诵表达进阶班", 16, "在读", "#715b87", ""),
    ("许星禾", 7, "许女士", "135****8906", "舞台表演启蒙班", 30, "在读", "#4f896f", ""),
    ("沈嘉树", 11, "沈先生", "159****4381", "演讲与口才一对一", 8, "待续费", "#c89436", ""),
    ("陆小满", 6, "陆女士", "137****1025", "少儿主持基础班", 20, "请假中", "#507b9d", ""),
]

SEED_COURSES = [
    ("少儿主持基础班", "主持", "6-9 岁", 24, 90, 4680, "#e8664a", "启用", "建立舞台自信，掌握主持礼仪与基础表达。"),
    ("朗诵表达进阶班", "朗诵", "8-12 岁", 24, 90, 5280, "#715b87", "启用", "提升语音、节奏、情感表达和作品理解能力。"),
    ("舞台表演启蒙班", "表演", "5-8 岁", 30, 60, 4980, "#4f896f", "启用", "通过角色、故事与肢体训练培养表现力。"),
    ("演讲与口才一对一", "演讲", "8-16 岁", 12, 60, 7200, "#c89436", "启用", "围绕个人目标进行演讲结构与表达训练。"),
]

SEED_TEACHERS = [
    ("陈语安", "陈老师", "主持、少儿口才", "13800001001", "#e8664a"),
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


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER NOT NULL CHECK (age BETWEEN 3 AND 18),
                parent TEXT NOT NULL,
                phone TEXT NOT NULL,
                course TEXT NOT NULL,
                hours REAL NOT NULL DEFAULT 0 CHECK (hours >= 0),
                status TEXT NOT NULL DEFAULT '待分班',
                color TEXT NOT NULL DEFAULT '#e8664a',
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
                color TEXT NOT NULL DEFAULT '#e8664a',
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
                color TEXT NOT NULL DEFAULT '#e8664a',
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
            """
        )
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
                        (name, course_id, teacher_id, room_id, weekday, start_time, duration, capacity, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (name, course_id, teacher_id, room_id, weekday, start_time, duration, capacity, status, now, now),
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


def integer_value(payload: dict, key: str, label: str, minimum: int = 0) -> int:
    value = number_value(payload, key, label, minimum)
    if not value.is_integer():
        raise ValueError(f"{label}必须是整数")
    return int(value)


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
    data = {
        "name": str(payload["name"]).strip(),
        "course_id": integer_value(payload, "course_id", "课程"),
        "teacher_id": integer_value(payload, "teacher_id", "教师"),
        "room_id": integer_value(payload, "room_id", "教室"),
        "weekday": integer_value(payload, "weekday", "上课星期"),
        "start_time": str(payload.get("start_time", "")).strip(),
        "duration": integer_value(payload, "duration", "课程时长", 15),
        "capacity": integer_value(payload, "capacity", "班级容量", 1),
        "status": str(payload.get("status", "招生中")).strip(),
    }
    if data["weekday"] > 6:
        raise ValueError("上课星期无效")
    if len(data["start_time"]) != 5 or data["start_time"][2] != ":":
        raise ValueError("上课时间格式无效")
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
    return item


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
    server_version = "ShengdongMVP/1.0"

    def log_message(self, format_string: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, data: dict | list, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
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

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"status": "ok", "database": DATABASE.name})
            return
        if parsed.path == "/api/students":
            self.get_students(parse_qs(parsed.query))
            return
        if parsed.path == "/api/catalog":
            self.get_catalog()
            return
        if parsed.path == "/api/dashboard":
            self.get_dashboard()
            return
        if parsed.path.startswith("/api/"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            return
        self.serve_static(parsed.path)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/students":
            self.create_student()
            return
        if path == "/api/courses":
            self.create_course()
            return
        if path == "/api/classes":
            self.create_class()
            return
        if path == "/api/teachers":
            self.create_teacher()
            return
        if path == "/api/rooms":
            self.create_room()
            return
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "classes"] and parts[3] == "students":
            self.enroll_student(parts[2])
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
            self.update_student(item_id)
            return
        if resource == "courses":
            self.update_course(item_id)
            return
        if resource == "classes":
            self.update_class(item_id)
            return
        if resource == "teachers":
            self.update_teacher(item_id)
            return
        if resource == "rooms":
            self.update_room(item_id)
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
            self.delete_student(item_id)
            return
        if parts[1] == "courses":
            self.delete_course(item_id)
            return
        if parts[1] == "classes":
            self.delete_class(item_id)
            return
        if parts[1] == "teachers":
            self.delete_teacher(item_id)
            return
        if parts[1] == "rooms":
            self.delete_room(item_id)
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")

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
                        (name, course_id, teacher_id, room_id, weekday, start_time, duration, capacity, status, created_at, updated_at)
                    VALUES (:name, :course_id, :teacher_id, :room_id, :weekday, :start_time, :duration, :capacity, :status, :created_at, :updated_at)
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
                        weekday=:weekday, start_time=:start_time, duration=:duration,
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
    print(f"声动教培系统已启动：http://{HOST}:{PORT}")
    print(f"数据库：{DATABASE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
