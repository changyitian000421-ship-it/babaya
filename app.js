const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4173" : "";
let currentUser = null;
let students = [];
let catalog = { courses: [], classes: [], teachers: [], rooms: [] };
let users = [];
let leads = [];
let hourTransactions = [];
let catalogView = "courses";
let activeWeekStart = startOfWeek(new Date());
let activeScheduleDay = todayScheduleIndex();
let dashboardStats = {
  totalStudents: 0,
  activeStudents: 0,
  renewalStudents: 0,
  remainingHours: 0,
};

const dashboardClasses = [
  { time: "14:00", duration: "90 分钟", name: "少儿主持基础班", room: "春日教室 · A203", teacher: "陈老师", teacherKey: "陈", current: 10, max: 12, color: "#ff9f1c" },
  { time: "16:00", duration: "90 分钟", name: "朗诵表达进阶班", room: "剧场教室 · B101", teacher: "苏老师", teacherKey: "苏", current: 8, max: 10, color: "#715b87" },
  { time: "18:30", duration: "60 分钟", name: "演讲与口才一对一", room: "星光教室 · A205", teacher: "方老师", teacherKey: "方", current: 1, max: 1, color: "#4f896f" },
];

const leadStages = ["新线索", "已联系", "待试听", "待报名", "已报名"];

const pageMeta = {
  dashboard: ["总览", "下午好，林老师"],
  students: ["教务管理", "学员管理"],
  catalog: ["教务管理", "课程与班级"],
  schedule: ["教务管理", "班级课表"],
  leads: ["招生中心", "招生跟进"],
  hours: ["财务与课消", "课时管理"],
  teaching: ["教学管理", "教学中心"],
  settings: ["系统配置", "系统设置"],
};

const rolePages = {
  owner: ["dashboard", "students", "catalog", "schedule", "leads", "hours", "teaching", "settings"],
  academic: ["dashboard", "students", "catalog", "schedule", "hours", "teaching"],
  teacher: ["dashboard", "schedule", "hours", "teaching", "students", "catalog"],
  sales: ["dashboard", "leads", "students"],
  finance: ["dashboard", "hours", "students"],
};

const roleOptions = [
  ["owner", "校长 / 管理员"],
  ["academic", "教务前台"],
  ["teacher", "授课教师"],
  ["sales", "招生顾问"],
  ["finance", "财务"],
];

const pageContent = document.querySelector("#pageContent");
let activePage = "dashboard";

function permissions() {
  return new Set(currentUser?.permissions || []);
}

function can(permission) {
  return permissions().has(permission);
}

function allowedPages() {
  return rolePages[currentUser?.role] || ["dashboard"];
}

function canOpenPage(page) {
  return allowedPages().includes(page);
}

function icon(id) {
  return `<svg><use href="#icon-${id}"></use></svg>`;
}

function todayScheduleIndex() {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function startOfWeek(date) {
  const value = new Date(date);
  const offset = value.getDay() === 0 ? -6 : 1 - value.getDay();
  value.setDate(value.getDate() + offset);
  value.setHours(0, 0, 0, 0);
  return value;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/session" && path !== "/api/login") {
      showLogin();
    }
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return data;
}

async function loadStudents() {
  students = await api("/api/students");
}

async function loadDashboardStats() {
  dashboardStats = await api("/api/dashboard");
}

async function loadCatalog() {
  catalog = await api("/api/catalog");
  syncStudentCourseOptions();
}

async function loadUsers() {
  users = await api("/api/users");
}

async function loadLeads() {
  leads = await api("/api/leads");
}

async function loadHourTransactions() {
  hourTransactions = await api("/api/hour-transactions");
}

function showLogin(message = "") {
  document.querySelector("#appShell").hidden = true;
  document.querySelector("#loginScreen").hidden = false;
  if (message) showToast(message);
  setTimeout(() => document.querySelector('#loginForm input[name="phone"]')?.focus(), 30);
}

function showApp() {
  document.querySelector("#loginScreen").hidden = true;
  document.querySelector("#appShell").hidden = false;
}

function applyRoleUi() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.hidden = !canOpenPage(item.dataset.page);
  });
  document.querySelector("#quickAdd").hidden = !can("students:write");
  document.querySelector(".global-search").hidden = !can("students:read");
  document.querySelector("#profileName").textContent = currentUser?.name || "未登录";
  document.querySelector("#profileRole").textContent = currentUser?.roleLabel || "";
  document.querySelector("#profileAvatar").textContent = (currentUser?.name || "声")[0];
}

async function loadSession() {
  const data = await api("/api/session");
  currentUser = data.user;
  applyRoleUi();
  showApp();
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const button = document.querySelector("#loginButton");
  button.classList.add("button-loading");
  button.textContent = "登录中...";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
    currentUser = result.user;
    form.reset();
    applyRoleUi();
    showApp();
    showToast(`欢迎回来，${currentUser.name}`);
    await renderPage(allowedPages()[0] || "dashboard");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = "登录系统";
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    showToast(error.message);
  }
  currentUser = null;
  showLogin("已退出登录");
}

function renderDashboard() {
  pageContent.innerHTML = `
    <p class="date-line">${formatToday()} · 本周课程安排已更新</p>
    <div class="metric-grid">
      ${metricCard("users", "在读学员", dashboardStats.activeStudents, `全部 ${dashboardStats.totalStudents} 人`, "orange")}
      ${metricCard("calendar", "今日到课", "19 / 22", "到课率 86%", "purple")}
      ${metricCard("wallet", "剩余课时总量", formatHours(dashboardStats.remainingHours), "实时数据", "green")}
      ${metricCard("clock", "待续费学员", dashboardStats.renewalStudents, "需要跟进", "yellow")}
    </div>
    <div class="dashboard-grid">
      <div class="stack">
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><h2>近期课程</h2><p>按时间顺序查看本周教学安排</p></div>
            <button class="text-button" data-go="schedule">查看完整课表 ${icon("arrow")}</button>
          </div>
          <div class="class-list">
            ${dashboardClasses.map(classRow).join("")}
          </div>
        </section>
        <section class="insight-card">
          <small>教学观察 · WEEKLY INSIGHT</small>
          <h3>本周学员作品提交率提升了 18%，朗诵进阶班表现最积极。</h3>
          <p>建议在周末家长群展示优秀作品，帮助家长看见成长，也为下月续费做好铺垫。</p>
        </section>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><h2>今日待办</h2><p>6 项任务，2 项需要尽快处理</p></div>
            <button class="text-button">全部完成</button>
          </div>
          <div class="todo-list">
            ${todoItem("确认程知远试听课", "与家长确认周六到店时间", "11:30", "#ff9f1c")}
            ${todoItem("沈嘉树续费回访", "剩余 8 课时，已触发预警", "今天", "#ffd33d")}
            ${todoItem("发布朗诵班课堂点评", "8 位学员等待教师反馈", "课后", "#715b87")}
            ${todoItem("六月课时对账", "核对 6 月 1 日至 12 日记录", "明天", "#4f896f")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><h2>招生转化</h2><p>本月新增线索 42 条</p></div>
            <button class="text-button" data-go="leads">进入跟进 ${icon("arrow")}</button>
          </div>
          <div class="funnel">
            ${funnelRow("新增线索", 42, 100, "#ff9f1c")}
            ${funnelRow("预约试听", 28, 67, "#ffb22e")}
            ${funnelRow("完成试听", 21, 50, "#f47a12")}
            ${funnelRow("成功报名", 18, 43, "#715b87")}
          </div>
        </section>
      </div>
    </div>`;
}

function metricCard(iconName, label, value, trend, color) {
  return `<article class="metric-card ${color}">
    <div class="metric-top"><span class="metric-icon">${icon(iconName)}</span><span class="trend">${icon("trend")} ${trend}</span></div>
    <h3>${value}</h3><p>${label}</p>
  </article>`;
}

function classRow(item) {
  return `<div class="class-row" style="--row-color:${item.color}">
    <div class="class-time"><strong>${item.time}</strong><small>${item.duration}</small></div>
    <div class="class-color"></div>
    <div class="class-name"><strong>${item.name}</strong><small>${item.room}</small></div>
    <div class="teacher"><span class="avatar">${item.teacherKey}</span>${item.teacher}</div>
    <div class="capacity"><strong>${item.current} / ${item.max} 人</strong><div class="capacity-bar"><span style="width:${item.current / item.max * 100}%"></span></div></div>
    <button class="row-action checkin" data-class="${item.name}" title="开始点名">${icon("chevron")}</button>
  </div>`;
}

function todoItem(title, desc, time, color) {
  return `<div class="todo-item" style="--todo-color:${color}"><span class="todo-dot"></span><div><strong>${title}</strong><p>${desc}</p></div><span class="todo-time">${time}</span></div>`;
}

function funnelRow(label, count, percent, color) {
  return `<div class="funnel-row"><span>${label}</span><div class="funnel-bar" style="--bar-color:${color}"><span style="width:${percent}%"></span></div><b>${count}</b></div>`;
}

function renderStudents(query = "") {
  const normalized = query.trim().toLowerCase();
  const result = students.filter(s => [s.name, s.parent, s.phone, s.course].some(v => String(v).toLowerCase().includes(normalized)));
  const canEditStudents = can("students:write");
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>全部学员 <span style="color:var(--muted);font-weight:400">${students.length}</span></h2><p>维护学员档案、课程与剩余课时</p></div>
      <div class="toolbar-actions">
        <input class="filter-input" id="studentSearch" placeholder="搜索姓名或课程" value="${escapeHtml(query)}" />
        <button class="secondary-button">${icon("filter")} 筛选</button>
      </div>
    </div>
    <div class="table-card">
      ${result.length ? `<table class="data-table">
        <thead><tr><th>学员</th><th>家长 / 联系方式</th><th>在读课程</th><th>剩余课时</th><th>状态</th><th></th></tr></thead>
        <tbody>${result.map(s => `<tr>
          <td><div class="student-cell" style="--student-color:${escapeHtml(s.color)}"><span class="avatar">${escapeHtml(s.name[0])}</span><div><strong>${escapeHtml(s.name)}</strong><small>${s.age} 岁 · 编号 ${escapeHtml(s.code)}</small></div></div></td>
          <td>${escapeHtml(s.parent)}<br><small style="color:var(--muted)">${escapeHtml(s.phone)}</small></td>
          <td><span class="tag" style="--tag-color:${escapeHtml(s.color)}">${escapeHtml(s.course)}</span></td>
          <td><strong>${formatHours(s.hours)}</strong> 课时</td>
          <td><span class="status-dot" style="--status-color:${statusColor(s.status)}">${escapeHtml(s.status)}</span></td>
          <td>${canEditStudents ? `<div class="table-actions">
            <button class="table-action edit-student" data-id="${s.id}" title="编辑学员" aria-label="编辑 ${escapeHtml(s.name)}">${icon("edit")}</button>
            <button class="table-action danger delete-student" data-id="${s.id}" title="删除学员" aria-label="删除 ${escapeHtml(s.name)}">${icon("trash")}</button>
          </div>` : `<span class="readonly-note">只读</span>`}</td>
        </tr>`).join("")}</tbody>
      </table>` : `<div class="empty-state">没有找到匹配的学员</div>`}
    </div>`;
  document.querySelector("#studentSearch")?.addEventListener("input", e => renderStudents(e.target.value));
}

function renderCatalog() {
  const activeClasses = catalog.classes.filter(item => ["招生中", "进行中"].includes(item.status));
  const enrolled = new Set(catalog.classes.flatMap(item => item.students.map(student => student.id))).size;
  const canManageCatalog = can("catalog:write");
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>课程与班级管理</h2><p>维护课程产品、开班信息和学员分班</p></div>
      ${canManageCatalog ? `<div class="toolbar-actions">
        <button class="secondary-button add-course">${icon("plus")} 新增课程</button>
        <button class="secondary-button add-teacher">${icon("plus")} 新增教师</button>
        <button class="secondary-button add-room">${icon("plus")} 新增教室</button>
        <button class="primary-button add-class">${icon("plus")} 新建班级</button>
      </div>` : `<span class="readonly-badge">当前角色仅可查看</span>`}
    </div>
    <div class="catalog-summary">
      ${catalogStat("课程产品", catalog.courses.length)}
      ${catalogStat("活跃班级", activeClasses.length)}
      ${catalogStat("已分班学员", enrolled)}
      ${catalogStat("师资 / 教室", `${catalog.teachers.length} / ${catalog.rooms.length}`)}
    </div>
    <div class="catalog-tabs">
      <button class="catalog-tab ${catalogView === "courses" ? "active" : ""}" data-catalog-view="courses">课程产品</button>
      <button class="catalog-tab ${catalogView === "classes" ? "active" : ""}" data-catalog-view="classes">班级管理</button>
      <button class="catalog-tab ${catalogView === "teachers" ? "active" : ""}" data-catalog-view="teachers">教师名单</button>
      <button class="catalog-tab ${catalogView === "rooms" ? "active" : ""}" data-catalog-view="rooms">教室管理</button>
    </div>
    ${renderCatalogView()}`;
}

function catalogStat(label, value) {
  return `<div class="catalog-stat"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderCatalogView() {
  if (catalogView === "courses") return renderCourseGrid();
  if (catalogView === "classes") return renderClassGrid();
  if (catalogView === "teachers") return renderTeacherGrid();
  return renderRoomGrid();
}

function renderCourseGrid() {
  if (!catalog.courses.length) return `<div class="empty-state">还没有课程产品</div>`;
  const canManageCatalog = can("catalog:write");
  return `<div class="course-grid">${catalog.courses.map(course => `
    <article class="course-card" style="--course-color:${escapeHtml(course.color)}">
      <div class="course-card-head">
        <div><h3>${escapeHtml(course.name)}</h3><p>${escapeHtml(course.category)} · ${escapeHtml(course.age_range)}</p></div>
        <span class="tag" style="--tag-color:${course.status === "启用" ? "#4f896f" : "#8a827b"}">${escapeHtml(course.status)}</span>
      </div>
      <p class="course-description">${escapeHtml(course.description || "暂未填写课程简介")}</p>
      <div class="course-facts">
        <span>总课时<strong>${formatHours(course.total_hours)} 节</strong></span>
        <span>单节时长<strong>${course.lesson_duration} 分钟</strong></span>
        <span>标准价格<strong>¥ ${Number(course.price).toLocaleString("zh-CN")}</strong></span>
        <span>开班 / 学员<strong>${course.class_count} / ${course.student_count}</strong></span>
      </div>
      <div class="course-card-footer">
        <span>课程编号 C${String(course.id).padStart(3, "0")}</span>
        ${canManageCatalog ? `<div class="card-actions">
          <button class="table-action edit-course" data-id="${course.id}" aria-label="编辑 ${escapeHtml(course.name)}">${icon("edit")}</button>
          <button class="table-action danger delete-course" data-id="${course.id}" aria-label="删除 ${escapeHtml(course.name)}">${icon("trash")}</button>
        </div>` : `<span class="readonly-note">只读</span>`}
      </div>
    </article>`).join("")}</div>`;
}

function renderClassGrid() {
  if (!catalog.classes.length) return `<div class="empty-state">还没有班级</div>`;
  const canManageCatalog = can("catalog:write");
  const canManageRoster = can("roster:write");
  return `<div class="class-grid">${catalog.classes.map(item => {
    const percent = Math.min(100, item.current / item.capacity * 100);
    return `<article class="class-card" style="--class-color:${escapeHtml(item.course_color)}">
      <div class="class-card-head">
        <div class="class-card-title"><span class="class-accent"></span><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.course_name)}</p></div></div>
        <span class="tag" style="--tag-color:${classStatusColor(item.status)}">${escapeHtml(item.status)}</span>
      </div>
      <div class="class-details">
        <div class="class-detail"><span>上课时间</span><strong>${weekdayName(item.weekday)} ${escapeHtml(item.start_time)}-${escapeHtml(classEndTime(item))}</strong></div>
        <div class="class-detail"><span>周期范围</span><strong>${escapeHtml(item.start_date)} 至 ${escapeHtml(item.end_date)}</strong></div>
        <div class="class-detail"><span>授课教师</span><strong>${escapeHtml(item.teacher_name)}</strong></div>
        <div class="class-detail"><span>上课教室</span><strong>${escapeHtml(item.room_name)} · ${escapeHtml(item.room_code)}</strong></div>
        <div class="class-detail"><span>班级编号</span><strong>B${String(item.id).padStart(3, "0")}</strong></div>
      </div>
      <div class="class-capacity">
        <div class="class-capacity-info">
          <div><span>班级人数</span><strong class="${item.current >= item.capacity ? "capacity-warning" : ""}">${item.current} / ${item.capacity} 人</strong></div>
          <div class="capacity-bar"><span style="width:${percent}%;background:${escapeHtml(item.course_color)}"></span></div>
        </div>
        <button class="secondary-button manage-roster" data-id="${item.id}">${canManageRoster ? "花名册" : "查看名单"}</button>
        ${canManageCatalog ? `<div class="card-actions">
          <button class="table-action edit-class" data-id="${item.id}" aria-label="编辑 ${escapeHtml(item.name)}">${icon("edit")}</button>
          <button class="table-action danger delete-class" data-id="${item.id}" aria-label="删除 ${escapeHtml(item.name)}">${icon("trash")}</button>
        </div>` : `<span class="readonly-note">只读</span>`}
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderTeacherGrid() {
  if (!catalog.teachers.length) return `<div class="empty-state">还没有教师</div>`;
  const canManageCatalog = can("catalog:write");
  return `<div class="resource-grid">${catalog.teachers.map(teacher => `
    <article class="resource-card" style="--resource-color:${escapeHtml(teacher.color)}">
      <div class="resource-head">
        <span class="avatar" style="color:${escapeHtml(teacher.color)};background:color-mix(in srgb, ${escapeHtml(teacher.color)} 14%, white)">${escapeHtml(teacher.display_name[0] || "师")}</span>
        <div><h3>${escapeHtml(teacher.display_name)}</h3><p>${escapeHtml(teacher.name)}</p></div>
        ${canManageCatalog ? `<div class="card-actions">
          <button class="table-action edit-teacher" data-id="${teacher.id}" aria-label="编辑 ${escapeHtml(teacher.display_name)}">${icon("edit")}</button>
          <button class="table-action danger delete-teacher" data-id="${teacher.id}" aria-label="删除 ${escapeHtml(teacher.display_name)}">${icon("trash")}</button>
        </div>` : `<span class="readonly-note">只读</span>`}
      </div>
      <div class="resource-info">
        <span>擅长方向<strong>${escapeHtml(teacher.specialty || "未填写")}</strong></span>
        <span>联系电话<strong>${escapeHtml(teacher.phone || "未填写")}</strong></span>
        <span>关联班级<strong>${teacher.class_count || 0} 个</strong></span>
      </div>
    </article>`).join("")}</div>`;
}

function renderRoomGrid() {
  if (!catalog.rooms.length) return `<div class="empty-state">还没有教室</div>`;
  const canManageCatalog = can("catalog:write");
  return `<div class="resource-grid">${catalog.rooms.map(room => `
    <article class="resource-card" style="--resource-color:#ff9f1c">
      <div class="resource-head">
        <span class="room-mark">${escapeHtml(room.code)}</span>
        <div><h3>${escapeHtml(room.name)}</h3><p>教室编号 ${escapeHtml(room.code)}</p></div>
        ${canManageCatalog ? `<div class="card-actions">
          <button class="table-action edit-room" data-id="${room.id}" aria-label="编辑 ${escapeHtml(room.name)}">${icon("edit")}</button>
          <button class="table-action danger delete-room" data-id="${room.id}" aria-label="删除 ${escapeHtml(room.name)}">${icon("trash")}</button>
        </div>` : `<span class="readonly-note">只读</span>`}
      </div>
      <div class="resource-info">
        <span>教室容量<strong>${room.capacity} 人</strong></span>
        <span>关联班级<strong>${room.class_count || 0} 个</strong></span>
        <span>状态<strong>启用</strong></span>
      </div>
    </article>`).join("")}</div>`;
}

function weekdayName(value) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][Number(value)] || "";
}

function classStatusColor(status) {
  if (status === "进行中") return "#4f896f";
  if (status === "招生中") return "#ff9f1c";
  if (status === "已结课") return "#715b87";
  return "#8a827b";
}

function renderSchedule() {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const weekDates = currentWeekDates();
  const activeDate = weekDates[activeScheduleDay];
  const activeDateValue = toDateInputValue(activeDate);
  const activeClasses = catalog.classes
    .filter(item => classOccursOnDate(item, activeDate))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const weeklyOccurrences = weekDates.reduce(
    (sum, date) => sum + catalog.classes.filter(item => classOccursOnDate(item, date)).length,
    0,
  );
  const activeStudents = activeClasses.reduce((sum, item) => sum + Number(item.current || 0), 0);
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>${formatWeekRange(weekDates)}</h2><p>${formatFullDate(activeDate)}：${activeClasses.length} 节课，预计到课 ${activeStudents} 人；本周共 ${weeklyOccurrences} 节</p></div>
      <div class="toolbar-actions schedule-tools">
        <button class="secondary-button schedule-prev-week">上一周</button>
        <input class="schedule-date-picker" type="date" value="${activeDateValue}" aria-label="选择课表日期" />
        <button class="secondary-button schedule-next-week">下一周</button>
        <button class="secondary-button schedule-today">今天</button>
        ${can("catalog:write") ? `<button class="primary-button schedule-new-class">${icon("plus")} 新建班级</button>` : ""}
      </div>
    </div>
    <div class="week-strip">${days.map((day, index) => `<button class="day-button ${index === activeScheduleDay ? "active" : ""}" data-schedule-day="${index}"><span>${day}</span><strong>${weekDates[index].getDate()}</strong></button>`).join("")}</div>
    <div class="schedule-board">
      <div class="time-rail">${scheduleTimeSlots(activeClasses).map(t => `<div class="time-slot">${t}</div>`).join("")}</div>
      <div class="schedule-lane">
        ${activeClasses.length ? activeClasses.map(item => `<article class="schedule-event" style="--event-color:${escapeHtml(item.course_color)}">
          <span class="color-pill"></span>
          <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.start_time)}-${escapeHtml(classEndTime(item))} · ${escapeHtml(item.room_name)} ${escapeHtml(item.room_code)} · ${escapeHtml(item.course_name)} · ${escapeHtml(item.start_date)} 至 ${escapeHtml(item.end_date)}</small></div>
          <div class="schedule-meta"><b>${escapeHtml(item.teacher_name)}</b>${item.current}/${item.capacity} 人<br><button class="text-button manage-roster" data-id="${item.id}">花名册</button></div>
        </article>`).join("") : `<div class="empty-state">这一天还没有排课，可以切换日期回溯/查看未来，或新建周期班级。</div>`}
      </div>
    </div>`;
}

function currentWeekDates() {
  return Array.from({ length: 7 }, (_, index) => {
    return addDays(activeWeekStart, index);
  });
}

function formatWeekRange(dates) {
  const start = dates[0];
  const end = dates[6];
  return `${start.getMonth() + 1} 月 ${start.getDate()} 日 - ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
}

function scheduleTimeSlots(items) {
  const slots = [...new Set(items.map(item => item.start_time))];
  return slots.length ? slots : ["09:00", "14:00", "18:30"];
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromInput(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function weekdayIndexForDate(date) {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function formatFullDate(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function classOccursOnDate(item, date) {
  const value = toDateInputValue(date);
  return Number(item.weekday) === weekdayIndexForDate(date)
    && (!item.start_date || item.start_date <= value)
    && (!item.end_date || item.end_date >= value)
    && ["招生中", "进行中"].includes(item.status);
}

function classEndTime(item) {
  if (item.end_time) return item.end_time;
  const [hour, minute] = String(item.start_time).split(":").map(Number);
  const total = hour * 60 + minute + Number(item.duration || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function renderLeads() {
  const activeLeads = leads.filter(lead => lead.stage !== "无效");
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>招生跟进看板</h2><p>${activeLeads.length} 条有效线索，电话跟进和阶段推进会自动保存</p></div>
      <div class="toolbar-actions"><button class="secondary-button render-invalid-leads">${icon("filter")} 无效 ${leads.filter(lead => lead.stage === "无效").length}</button>${can("leads:write") ? `<button class="primary-button add-lead">${icon("plus")} 新增线索</button>` : ""}</div>
    </div>
    <div class="lead-board">${leadStages.map(stage => {
      const items = activeLeads.filter(lead => lead.stage === stage);
      return `<section class="lead-column"><div class="lead-column-header"><strong>${stage}</strong><span class="lead-count">${items.length}</span></div>
        ${items.length ? items.map(leadCard).join("") : `<div class="lead-empty">暂无线索</div>`}
      </section>`;
    }).join("")}</div>`;
}

function renderInvalidLeads() {
  const invalidLeads = leads.filter(lead => lead.stage === "无效");
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>无效线索</h2><p>这些记录会保留在系统里，方便之后复盘来源质量</p></div>
      <div class="toolbar-actions"><button class="secondary-button back-to-leads">${icon("arrow")} 返回看板</button></div>
    </div>
    <div class="table-card">
      <table class="data-table">
        <thead><tr><th>姓名</th><th>年龄</th><th>电话</th><th>来源</th><th>意向</th><th>备注</th><th></th></tr></thead>
        <tbody>${invalidLeads.length ? invalidLeads.map(lead => `<tr>
          <td><strong>${escapeHtml(lead.name)}</strong></td>
          <td>${lead.age} 岁</td>
          <td>${escapeHtml(lead.phone)}</td>
          <td>${escapeHtml(lead.source || "未填写")}</td>
          <td><span class="tag" style="--tag-color:#8a827b">${escapeHtml(lead.tag || "未确认")}</span></td>
          <td><small>${escapeHtml(lead.note || "无备注")}</small></td>
          <td>${can("leads:write") ? `<button class="table-action edit-lead" data-id="${lead.id}" aria-label="编辑 ${escapeHtml(lead.name)}">${icon("edit")}</button>` : ""}</td>
        </tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">还没有无效线索</div></td></tr>`}</tbody>
      </table>
    </div>`;
}

function leadCard(lead) {
  const nextStage = leadStages[leadStages.indexOf(lead.stage) + 1];
  return `<article class="lead-card">
    <div class="lead-card-top"><h3>${escapeHtml(lead.name)} · ${lead.age}岁</h3><span class="tag" style="--tag-color:#ff9f1c">${escapeHtml(lead.tag || "待确认")}</span></div>
    <p>${escapeHtml(lead.note || "暂未填写跟进备注")}</p>
    <div class="lead-meta">
      <span>来源：${escapeHtml(lead.source || "未填写")}</span>
      <span>电话：${escapeHtml(lead.phone)}</span>
      <span>跟进：${lead.follow_count || 0} 次</span>
      ${lead.next_follow_at ? `<span>下次：${escapeHtml(lead.next_follow_at)}</span>` : ""}
    </div>
    <div class="lead-card-footer">
      <span>${lead.last_contact_at ? `最近联系 ${formatShortTime(lead.last_contact_at)}` : "尚未电话联系"}</span>
      <div class="lead-actions">
        ${can("leads:write") ? `<button class="phone-button contact-lead" data-id="${lead.id}" title="记录电话跟进">${icon("phone")}</button>
        <button class="table-action edit-lead" data-id="${lead.id}" title="编辑线索">${icon("edit")}</button>
        ${nextStage ? `<button class="text-button advance-lead" data-id="${lead.id}" data-stage="${nextStage}">推进</button>` : ""}
        <button class="table-action danger invalid-lead" data-id="${lead.id}" title="标记无效">${icon("trash")}</button>` : `<span class="readonly-note">只读</span>`}
      </div>
    </div>
  </article>`;
}

function formatShortTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function openLeadModal(lead = null) {
  const form = document.querySelector("#leadForm");
  form.reset();
  form.elements.id.value = lead?.id || "";
  document.querySelector("#leadTitle").textContent = lead ? "编辑招生线索" : "新增招生线索";
  document.querySelector("#leadEyebrow").textContent = lead ? "更新跟进信息" : "记录意向家长";
  document.querySelector("#saveLead").textContent = lead ? "保存修改" : "保存线索";
  if (lead) {
    for (const field of ["name", "age", "phone", "source", "tag", "stage", "next_follow_at", "note"]) {
      form.elements[field].value = lead[field] ?? "";
    }
  } else {
    form.elements.stage.value = "新线索";
  }
  document.querySelector("#leadBackdrop").hidden = false;
  setTimeout(() => form.elements.name.focus(), 30);
}

function closeLeadModal() {
  document.querySelector("#leadBackdrop").hidden = true;
}

async function saveLead(event) {
  event.preventDefault();
  if (!can("leads:write")) {
    showToast("当前角色不能修改招生线索");
    return;
  }
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const leadId = data.id;
  delete data.id;
  data.age = Number(data.age);
  const button = document.querySelector("#saveLead");
  button.classList.add("button-loading");
  button.textContent = "保存中...";
  try {
    await api(leadId ? `/api/leads/${leadId}` : "/api/leads", {
      method: leadId ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    closeLeadModal();
    showToast(`线索 ${data.name} 已${leadId ? "更新" : "添加"}`);
    await renderPage("leads");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = leadId ? "保存修改" : "保存线索";
  }
}

async function contactLead(leadId) {
  const lead = leads.find(item => item.id === leadId);
  if (!lead) return;
  try {
    await api(`/api/leads/${leadId}/contact`, { method: "POST" });
    showToast(`已记录 ${lead.name} 的电话跟进`);
    await renderPage("leads");
  } catch (error) {
    showToast(error.message);
  }
}

async function updateLeadStage(leadId, stage) {
  const lead = leads.find(item => item.id === leadId);
  if (!lead) return;
  try {
    await api(`/api/leads/${leadId}`, {
      method: "PUT",
      body: JSON.stringify({ ...lead, stage }),
    });
    showToast(`线索 ${lead.name} 已更新为「${stage}」`);
    await renderPage("leads");
  } catch (error) {
    showToast(error.message);
  }
}

function renderHours() {
  const groups = visibleHourGroups();
  const canSeeOverall = canSeeOverallHours();
  const totalHours = students.reduce((sum, student) => sum + Number(student.hours || 0), 0);
  const renewalStudents = students.filter(student => Number(student.hours || 0) <= 4 && student.status !== "停课");
  const monthKey = toDateInputValue(new Date()).slice(0, 7);
  const consumedThisMonth = hourTransactions
    .filter(item => item.action === "consume" && String(item.occurred_at || item.created_at).startsWith(monthKey))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const canManageHours = can("hours:write");
  const optionsHtml = hourTeacherStudentOptions(groups, canSeeOverall);
  pageContent.innerHTML = `
    <div class="hours-summary">
      <div class="summary-card"><span>本月已消课</span><strong>${formatHours(consumedThisMonth)}</strong><span>来自课时流水</span></div>
      <div class="summary-card"><span>剩余课时总量</span><strong>${formatHours(totalHours)}</strong><span>覆盖 ${students.length} 名学员</span></div>
      <div class="summary-card"><span>低课时待跟进</span><strong>${renewalStudents.length} 人</strong><span class="${renewalStudents.length ? "negative" : "positive"}">4 课时及以下</span></div>
    </div>
    <div class="section-toolbar"><div><h2>${canSeeOverall ? "教师课时总览" : "我的课时学员"}</h2><p>${canSeeOverall ? "按教师查看名下学员与剩余课时，校长也作为授课教师单独统计" : "当前教师账号只显示自己名下的学员与流水"}</p></div></div>
    <div class="teacher-hours-grid">${groups.length ? groups.map(teacherHourCard).join("") : `<div class="empty-state">当前账号还没有关联教师，请让校长在教师名单中添加同名教师。</div>`}</div>
    ${canManageHours ? `<section class="panel hours-form-panel">
      <div class="panel-header"><div class="panel-title"><h2>新增课时变动</h2><p>购买、消课、返还和手动扣减都会生成可追溯流水</p></div></div>
      <form id="hoursForm" class="hours-form">
        ${canSeeOverall ? `<label><span>教师 / 学员</span><select name="teacher_student" required ${optionsHtml ? "" : "disabled"}>${optionsHtml || `<option>暂无可记录的教师学员</option>`}</select></label>` : `<label><span>学员</span><select name="teacher_student" required ${optionsHtml ? "" : "disabled"}>${optionsHtml || `<option>暂无可记录的学员</option>`}</select></label>`}
        <label><span>变动类型</span><select name="action"><option value="purchase">购买课时</option><option value="consume">上课消课</option><option value="return">请假返还</option><option value="deduct">手动扣减</option></select></label>
        <label><span>课时数</span><input name="amount" required type="number" min="0.5" step="0.5" value="1" /></label>
        <label><span>发生时间</span><input name="occurred_at" type="datetime-local" value="${defaultDateTimeLocal()}" /></label>
        <label class="full"><span>备注</span><input name="note" placeholder="例如：购买 24 课时 / 6月22日主持基础班消课" /></label>
        <div class="hours-form-actions"><button type="submit" class="primary-button" id="saveHours" ${optionsHtml ? "" : "disabled"}>保存课时流水</button></div>
      </form>
    </section>` : `<div class="roster-readonly">当前角色只能查看课时流水，不能新增课时变动。</div>`}
    <div class="section-toolbar"><div><h2>最近课时流水</h2><p>每笔课时变动均可追溯，最多显示最近 200 条</p></div></div>
    <div class="table-card"><table class="data-table"><thead><tr><th>时间</th><th>教师</th><th>学员</th><th>变动类型</th><th>课程</th><th>课时变动</th><th>操作人</th></tr></thead>
      <tbody>
        ${hourTransactions.length ? hourTransactions.map(item => {
          const delta = Number(item.delta || 0);
          return `<tr>
            <td>${formatShortTime(item.occurred_at || item.created_at)}</td>
            <td>${escapeHtml(item.teacher_name || "未指定教师")}</td>
            <td><strong>${escapeHtml(item.student_name)}</strong><br><small>余额 ${formatHours(item.balance_after)} 课时</small></td>
            <td>${escapeHtml(item.action_label)}</td>
            <td>${escapeHtml(item.course_name || "未分配课程")}</td>
            <td><strong class="${delta >= 0 ? "positive" : "negative"}">${delta >= 0 ? "+" : ""}${formatHours(delta)}</strong></td>
            <td>${escapeHtml(item.operator_name || "系统")}<br><small>${escapeHtml(item.note || "无备注")}</small></td>
          </tr>`;
        }).join("") : `<tr><td colspan="7"><div class="empty-state">还没有课时流水，先新增一笔购买或消课记录。</div></td></tr>`}
      </tbody></table></div>`;
}

function canSeeOverallHours() {
  return ["owner", "academic", "finance"].includes(currentUser?.role);
}

function visibleHourGroups() {
  const groups = teacherHoursGroups();
  if (canSeeOverallHours()) return groups;
  const normalizedName = String(currentUser?.name || "").trim();
  const normalizedPhone = String(currentUser?.phone || "").trim();
  return groups.filter(group => {
    const teacher = group.teacher;
    return [teacher.name, teacher.display_name, teacher.phone].some(value => String(value || "").trim() === normalizedName)
      || String(teacher.phone || "").trim() === normalizedPhone;
  });
}

function teacherHoursGroups() {
  const studentById = new Map(students.map(student => [student.id, student]));
  const orderedTeachers = [...catalog.teachers].sort((a, b) => {
    const aOwner = String(a.display_name || a.name || "").includes("校长") ? 0 : 1;
    const bOwner = String(b.display_name || b.name || "").includes("校长") ? 0 : 1;
    return aOwner - bOwner || a.id - b.id;
  });
  const groups = orderedTeachers.map(teacher => ({
    teacher,
    students: [],
    studentIds: new Set(),
  }));
  const groupByTeacherId = new Map(groups.map(group => [group.teacher.id, group]));
  for (const classItem of catalog.classes) {
    const group = groupByTeacherId.get(classItem.teacher_id);
    if (!group) continue;
    for (const rosterStudent of classItem.students || []) {
      const student = studentById.get(rosterStudent.id) || rosterStudent;
      if (group.studentIds.has(student.id)) continue;
      group.studentIds.add(student.id);
      group.students.push(student);
    }
  }
  return groups.map(group => {
    const transactions = hourTransactions.filter(item => Number(item.teacher_id) === Number(group.teacher.id));
    return {
      ...group,
      students: group.students.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      totalHours: group.students.reduce((sum, student) => sum + Number(student.hours || 0), 0),
      lowCount: group.students.filter(student => Number(student.hours || 0) <= 4 && student.status !== "停课").length,
      consumedHours: transactions.filter(item => item.action === "consume").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    };
  });
}

function teacherHourCard(group) {
  return `<article class="teacher-hours-card" style="--teacher-color:${escapeHtml(group.teacher.color || "#ff9f1c")}">
    <div class="teacher-hours-head">
      <span class="avatar">${escapeHtml((group.teacher.display_name || group.teacher.name || "师")[0])}</span>
      <div><h3>${escapeHtml(group.teacher.display_name)}</h3><p>${escapeHtml(group.teacher.specialty || "授课教师")}</p></div>
    </div>
    <div class="teacher-hours-stats">
      <span>学员<strong>${group.students.length} 人</strong></span>
      <span>剩余课时<strong>${formatHours(group.totalHours)}</strong></span>
      <span>低课时<strong class="${group.lowCount ? "negative" : "positive"}">${group.lowCount} 人</strong></span>
    </div>
    <div class="teacher-student-list">
      ${group.students.length ? group.students.map(student => `<div class="teacher-student-row">
        <strong>${escapeHtml(student.name)}</strong>
        <span>${escapeHtml(student.course)} · ${formatHours(student.hours)} 课时</span>
      </div>`).join("") : `<div class="lead-empty">暂无分配学员</div>`}
    </div>
  </article>`;
}

function hourTeacherStudentOptions(groups, includeTeacher) {
  const availableGroups = groups.filter(group => group.students.length);
  if (!includeTeacher) {
    return availableGroups
      .flatMap(group => group.students.map(student => `<option value="${group.teacher.id}:${student.id}">${escapeHtml(student.name)} · ${escapeHtml(student.course)} · 剩余 ${formatHours(student.hours)} 课时</option>`))
      .join("");
  }
  return availableGroups
    .map(group => `<optgroup label="${escapeHtml(group.teacher.display_name)}">${group.students.map(student => `<option value="${group.teacher.id}:${student.id}">${escapeHtml(group.teacher.display_name)} · ${escapeHtml(student.name)} · 剩余 ${formatHours(student.hours)} 课时</option>`).join("")}</optgroup>`)
    .join("");
}

function defaultDateTimeLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function renderPlaceholder(type) {
  const isTeaching = type === "teaching";
  pageContent.innerHTML = `<div class="placeholder-page"><div>${icon("book")}<h2>教学中心</h2><p>教案、作业、作品集与成长评价将在第二阶段开放</p></div></div>`;
}

function renderSettings() {
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>员工账号与角色</h2><p>员工统一使用手机号登录；只有校长可以添加账号和分配角色</p></div>
      <span class="readonly-badge">校长专属</span>
    </div>
    <div class="settings-layout">
      <section class="panel account-form-panel">
        <div class="panel-header">
          <div class="panel-title"><h2 id="userFormTitle">新增员工账号</h2><p>设置手机号、姓名、角色和初始密码</p></div>
        </div>
        <form id="userForm" class="account-form">
          <input type="hidden" name="id" />
          <label><span>登录手机号</span><input name="phone" required placeholder="例如：13800000006" /></label>
          <label><span>员工姓名</span><input name="name" required placeholder="例如：王老师" /></label>
          <label><span>角色</span><select name="role">${roleOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
          <label><span>密码</span><input name="password" type="password" placeholder="新增时至少 6 位；编辑时留空表示不修改" /></label>
          <div class="account-form-actions">
            <button type="button" class="secondary-button cancel-user-edit" hidden>取消编辑</button>
            <button type="submit" class="primary-button" id="saveUser">保存账号</button>
          </div>
        </form>
      </section>
      <section class="table-card account-table-card">
        <table class="data-table">
          <thead><tr><th>员工</th><th>手机号</th><th>角色</th><th>权限摘要</th><th></th></tr></thead>
          <tbody>${users.map(user => `<tr>
            <td><div class="student-cell" style="--student-color:#ff9f1c"><span class="avatar">${escapeHtml(user.name[0] || "员")}</span><div><strong>${escapeHtml(user.name)}</strong><small>ID ${user.id}</small></div></div></td>
            <td>${escapeHtml(user.phone)}</td>
            <td><span class="tag" style="--tag-color:#715b87">${escapeHtml(user.roleLabel)}</span></td>
            <td><small style="color:var(--muted)">${permissionSummary(user.role)}</small></td>
            <td><div class="table-actions">
              <button class="table-action edit-user" data-id="${user.id}" aria-label="编辑 ${escapeHtml(user.name)}">${icon("edit")}</button>
              <button class="table-action danger delete-user" data-id="${user.id}" aria-label="停用 ${escapeHtml(user.name)}" ${currentUser?.id === user.id ? "disabled" : ""}>${icon("trash")}</button>
            </div></td>
          </tr>`).join("")}</tbody>
        </table>
      </section>
    </div>`;
}

function permissionSummary(role) {
  return {
    owner: "全功能，含员工账号管理",
    academic: "学员、课程、班级、教师、教室",
    teacher: "课表、学员与教学中心查看",
    sales: "招生跟进与学员录入",
    finance: "课时与学员信息查看",
  }[role] || "基础权限";
}

async function renderPage(page, query = "") {
  if (!currentUser) {
    showLogin();
    return;
  }
  if (!canOpenPage(page)) {
    page = allowedPages()[0] || "dashboard";
  }
  activePage = page;
  const [eyebrow, title] = pageMeta[page];
  document.querySelector("#pageEyebrow").textContent = eyebrow;
  document.querySelector("#pageTitle").textContent = page === "dashboard" ? `下午好，${currentUser.name}` : title;
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === page));
  try {
    if (page === "dashboard") {
      await loadDashboardStats();
      renderDashboard();
    }
    if (page === "students") {
      await Promise.all([loadStudents(), loadCatalog()]);
      syncStudentCourseOptions();
      renderStudents(query);
    }
    if (page === "catalog") {
      await Promise.all([loadCatalog(), loadStudents()]);
      renderCatalog();
    }
    if (page === "settings") {
      await loadUsers();
      renderSettings();
    }
    if (page === "schedule") {
      await Promise.all([loadCatalog(), loadStudents()]);
      renderSchedule();
    }
    if (page === "leads") {
      await loadLeads();
      renderLeads();
    }
    if (page === "hours") {
      await Promise.all([loadStudents(), loadCatalog(), loadHourTransactions()]);
      renderHours();
    }
  } catch (error) {
    renderConnectionError(error.message);
  }
  if (page === "teaching") renderPlaceholder(page);
  document.querySelector(".sidebar").classList.remove("open");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function formatHours(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatToday() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year} 年 ${values.month} 月 ${values.day} 日，${values.weekday}`;
}

function statusColor(status) {
  if (status === "在读") return "#4f896f";
  if (status === "待续费") return "#ff9f1c";
  if (status === "停课") return "#8a827b";
  return "#c89436";
}

function renderConnectionError(message) {
  pageContent.innerHTML = `<div class="connection-error">${icon("settings")}<h2>暂时连接不到数据服务</h2><p>${escapeHtml(message)}<br>请运行 <code>python3 server.py</code>，然后访问 http://127.0.0.1:4173。</p><button class="primary-button" id="retryConnection">重新连接</button></div>`;
  document.querySelector("#retryConnection")?.addEventListener("click", () => renderPage(activePage));
}

function syncStudentCourseOptions() {
  const select = document.querySelector('#studentForm select[name="course"]');
  if (!select || !catalog.courses.length) return;
  const current = select.value;
  select.innerHTML = catalog.courses
    .filter(course => course.status === "启用")
    .map(course => `<option value="${escapeHtml(course.name)}">${escapeHtml(course.name)}</option>`)
    .join("");
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function openModal(student = null) {
  const modal = document.querySelector(".modal");
  const form = document.querySelector("#studentForm");
  form.reset();
  modal.dataset.mode = student ? "edit" : "create";
  document.querySelector("#modalTitle").textContent = student ? "编辑学员" : "新增学员";
  document.querySelector(".modal-header small").textContent = student ? "更新学员档案" : "建立学员档案";
  document.querySelector("#saveStudent").textContent = student ? "保存修改" : "保存学员";
  form.elements.id.value = student?.id || "";
  if (student) {
    for (const field of ["name", "age", "parent", "phone", "course", "hours", "status", "note"]) {
      form.elements[field].value = student[field] ?? "";
    }
  } else {
    form.elements.hours.value = 0;
    form.elements.status.value = "待分班";
  }
  document.querySelector("#modalBackdrop").hidden = false;
  setTimeout(() => document.querySelector('input[name="name"]').focus(), 30);
}

function closeModal() {
  document.querySelector("#modalBackdrop").hidden = true;
}

function openCourseModal(course = null) {
  const form = document.querySelector("#managementForm");
  form.reset();
  form.elements.type.value = "course";
  form.elements.id.value = course?.id || "";
  document.querySelector("#managementTitle").textContent = course ? "编辑课程" : "新增课程";
  document.querySelector("#managementEyebrow").textContent = "课程产品";
  document.querySelector("#saveManagement").textContent = course ? "保存修改" : "创建课程";
  document.querySelector("#managementFields").innerHTML = `
    <label><span>课程名称</span><input name="name" required placeholder="例如：少儿主持基础班" value="${escapeHtml(course?.name || "")}" /></label>
    <label><span>课程类别</span><input name="category" required placeholder="主持、朗诵、表演等" value="${escapeHtml(course?.category || "")}" /></label>
    <label><span>适龄范围</span><input name="age_range" required placeholder="例如：6-9 岁" value="${escapeHtml(course?.age_range || "")}" /></label>
    <label><span>总课时</span><input name="total_hours" required type="number" min="0.5" step="0.5" value="${course?.total_hours ?? 24}" /></label>
    <label><span>单节时长（分钟）</span><input name="lesson_duration" required type="number" min="15" step="5" value="${course?.lesson_duration ?? 90}" /></label>
    <label><span>标准价格（元）</span><input name="price" required type="number" min="0" step="1" value="${course?.price ?? 0}" /></label>
    <label><span>课程状态</span><select name="status"><option ${course?.status !== "停用" ? "selected" : ""}>启用</option><option ${course?.status === "停用" ? "selected" : ""}>停用</option></select></label>
    <label class="color-field"><span>课程颜色</span><input name="color" type="color" value="${escapeHtml(course?.color || "#ff9f1c")}" /></label>
    <label class="full"><span>课程简介</span><textarea name="description" rows="3" placeholder="课程目标与特色">${escapeHtml(course?.description || "")}</textarea></label>`;
  document.querySelector("#managementBackdrop").hidden = false;
  setTimeout(() => form.elements.name.focus(), 30);
}

function openClassModal(item = null) {
  const form = document.querySelector("#managementForm");
  form.reset();
  const selectedDate = currentWeekDates()[activeScheduleDay] || new Date();
  const defaultStartDate = toDateInputValue(selectedDate);
  const defaultEndDate = toDateInputValue(addDays(selectedDate, 90));
  form.elements.type.value = "class";
  form.elements.id.value = item?.id || "";
  document.querySelector("#managementTitle").textContent = item ? "编辑班级" : "新建班级";
  document.querySelector("#managementEyebrow").textContent = "开班管理";
  document.querySelector("#saveManagement").textContent = item ? "保存修改" : "创建班级";
  document.querySelector("#managementFields").innerHTML = `
    <label class="full"><span>班级名称</span><input name="name" required placeholder="例如：主持基础 A 班" value="${escapeHtml(item?.name || "")}" /></label>
    <label><span>课程产品</span><select name="course_id">${catalog.courses.filter(course => course.status === "启用" || course.id === item?.course_id).map(course => `<option value="${course.id}" ${course.id === item?.course_id ? "selected" : ""}>${escapeHtml(course.name)}</option>`).join("")}</select></label>
    <label><span>授课教师</span><select name="teacher_id">${catalog.teachers.map(teacher => `<option value="${teacher.id}" ${teacher.id === item?.teacher_id ? "selected" : ""}>${escapeHtml(teacher.display_name)} · ${escapeHtml(teacher.specialty)}</option>`).join("")}</select></label>
    <label><span>上课教室</span><select name="room_id">${catalog.rooms.map(room => `<option value="${room.id}" ${room.id === item?.room_id ? "selected" : ""}>${escapeHtml(room.name)} ${escapeHtml(room.code)}（${room.capacity}人）</option>`).join("")}</select></label>
    <label><span>开课日期</span><input name="start_date" required type="date" value="${escapeHtml(item?.start_date || defaultStartDate)}" /></label>
    <label><span>结课日期</span><input name="end_date" required type="date" value="${escapeHtml(item?.end_date || defaultEndDate)}" /></label>
    <label><span>每周上课日</span><select name="weekday">${["周一","周二","周三","周四","周五","周六","周日"].map((day, index) => `<option value="${index}" ${index === (item?.weekday ?? activeScheduleDay) ? "selected" : ""}>${day}</option>`).join("")}</select></label>
    <label><span>开始时间</span><input name="start_time" required type="time" value="${escapeHtml(item?.start_time || "14:00")}" /></label>
    <label><span>结束时间</span><input name="end_time" required type="time" value="${escapeHtml(item ? classEndTime(item) : "15:30")}" /></label>
    <label><span>班级容量</span><input name="capacity" required type="number" min="1" value="${item?.capacity ?? 10}" /></label>
    <label><span>班级状态</span><select name="status">${["招生中","进行中","已结课","暂停"].map(status => `<option ${status === (item?.status || "招生中") ? "selected" : ""}>${status}</option>`).join("")}</select></label>`;
  document.querySelector("#managementBackdrop").hidden = false;
  setTimeout(() => form.elements.name.focus(), 30);
}

function openTeacherModal(teacher = null) {
  const form = document.querySelector("#managementForm");
  form.reset();
  form.elements.type.value = "teacher";
  form.elements.id.value = teacher?.id || "";
  document.querySelector("#managementTitle").textContent = teacher ? "编辑教师" : "新增教师";
  document.querySelector("#managementEyebrow").textContent = "教师名单";
  document.querySelector("#saveManagement").textContent = teacher ? "保存修改" : "创建教师";
  document.querySelector("#managementFields").innerHTML = `
    <label><span>教师姓名</span><input name="name" required placeholder="例如：王晓然" value="${escapeHtml(teacher?.name || "")}" /></label>
    <label><span>显示简称</span><input name="display_name" placeholder="例如：王老师" value="${escapeHtml(teacher?.display_name || "")}" /></label>
    <label><span>联系电话</span><input name="phone" type="tel" placeholder="教师电话" value="${escapeHtml(teacher?.phone || "")}" /></label>
    <label class="color-field"><span>教师颜色</span><input name="color" type="color" value="${escapeHtml(teacher?.color || "#ff9f1c")}" /></label>
    <label class="full"><span>擅长方向</span><textarea name="specialty" rows="3" placeholder="例如：主持、朗诵、赛事辅导">${escapeHtml(teacher?.specialty || "")}</textarea></label>`;
  document.querySelector("#managementBackdrop").hidden = false;
  setTimeout(() => form.elements.name.focus(), 30);
}

function openRoomModal(room = null) {
  const form = document.querySelector("#managementForm");
  form.reset();
  form.elements.type.value = "room";
  form.elements.id.value = room?.id || "";
  document.querySelector("#managementTitle").textContent = room ? "编辑教室" : "新增教室";
  document.querySelector("#managementEyebrow").textContent = "教室管理";
  document.querySelector("#saveManagement").textContent = room ? "保存修改" : "创建教室";
  document.querySelector("#managementFields").innerHTML = `
    <label><span>教室名称</span><input name="name" required placeholder="例如：春日教室" value="${escapeHtml(room?.name || "")}" /></label>
    <label><span>教室编号</span><input name="code" required placeholder="例如：A203" value="${escapeHtml(room?.code || "")}" /></label>
    <label><span>教室容量</span><input name="capacity" required type="number" min="1" value="${room?.capacity ?? 10}" /></label>
    <label><span>状态</span><input value="启用" disabled /></label>`;
  document.querySelector("#managementBackdrop").hidden = false;
  setTimeout(() => form.elements.name.focus(), 30);
}

function closeManagement() {
  document.querySelector("#managementBackdrop").hidden = true;
}

function openRoster(classId) {
  const item = catalog.classes.find(entry => entry.id === classId);
  if (!item) return;
  const canManageRoster = can("roster:write");
  const assignedIds = new Set(item.students.map(student => student.id));
  const available = students.filter(student => !assignedIds.has(student.id));
  document.querySelector("#rosterTitle").textContent = `${item.name} · ${item.current}/${item.capacity} 人`;
  document.querySelector("#rosterContent").innerHTML = `
    ${canManageRoster ? `<div class="roster-add">
      <select id="rosterStudentSelect" ${item.current >= item.capacity || !available.length ? "disabled" : ""}>
        ${available.length ? available.map(student => `<option value="${student.id}">${escapeHtml(student.name)} · ${student.age}岁 · ${escapeHtml(student.course)}</option>`).join("") : `<option>暂无可添加学员</option>`}
      </select>
      <button class="primary-button enroll-student" data-id="${item.id}" ${item.current >= item.capacity || !available.length ? "disabled" : ""}>加入班级</button>
    </div>` : `<div class="roster-readonly">当前角色只能查看班级花名册，不能调整分班。</div>`}
    <div class="roster-list">
      ${item.students.length ? item.students.map(student => `<div class="roster-person" style="--person-color:${escapeHtml(student.color)}">
        <span class="avatar">${escapeHtml(student.name[0])}</span>
        <div><strong>${escapeHtml(student.name)}</strong><small>${student.age} 岁 · ${escapeHtml(student.parent)} · ${formatHours(student.hours)} 课时</small></div>
        ${canManageRoster ? `<button class="table-action danger unenroll-student" data-class-id="${item.id}" data-student-id="${student.id}" aria-label="移出 ${escapeHtml(student.name)}">${icon("close")}</button>` : ""}
      </div>`).join("") : `<div class="roster-empty">班级中还没有学员</div>`}
    </div>`;
  document.querySelector("#rosterBackdrop").hidden = false;
}

function closeRoster() {
  document.querySelector("#rosterBackdrop").hidden = true;
}

document.addEventListener("click", async event => {
  const nav = event.target.closest(".nav-item");
  if (nav && canOpenPage(nav.dataset.page)) renderPage(nav.dataset.page);

  const go = event.target.closest("[data-go]");
  if (go) renderPage(go.dataset.go);

  const checkin = event.target.closest(".checkin");
  if (checkin) showToast(`已进入「${checkin.dataset.class}」点名页面`);

  const call = event.target.closest("[data-call]");
  if (call) showToast(`已记录对 ${call.dataset.call} 的电话跟进`);

  const scheduleDay = event.target.closest("[data-schedule-day]");
  if (scheduleDay) {
    activeScheduleDay = Number(scheduleDay.dataset.scheduleDay);
    renderSchedule();
  }

  if (event.target.closest(".schedule-prev-week")) {
    activeWeekStart = addDays(activeWeekStart, -7);
    renderSchedule();
  }

  if (event.target.closest(".schedule-next-week")) {
    activeWeekStart = addDays(activeWeekStart, 7);
    renderSchedule();
  }

  if (event.target.closest(".schedule-today")) {
    activeWeekStart = startOfWeek(new Date());
    activeScheduleDay = todayScheduleIndex();
    renderSchedule();
  }

  if (event.target.closest(".schedule-new-class") && can("catalog:write")) {
    catalogView = "classes";
    await renderPage("catalog");
    openClassModal();
  }

  const edit = event.target.closest(".edit-student");
  if (edit) {
    const student = students.find(item => item.id === Number(edit.dataset.id));
    if (student) openModal(student);
  }

  const remove = event.target.closest(".delete-student");
  if (remove) deleteStudent(Number(remove.dataset.id));

  const catalogTab = event.target.closest("[data-catalog-view]");
  if (catalogTab) {
    catalogView = catalogTab.dataset.catalogView;
    renderCatalog();
  }

  if (event.target.closest(".add-course") && can("catalog:write")) openCourseModal();
  if (event.target.closest(".add-class") && can("catalog:write")) openClassModal();
  if (event.target.closest(".add-teacher") && can("catalog:write")) openTeacherModal();
  if (event.target.closest(".add-room") && can("catalog:write")) openRoomModal();

  const editCourse = event.target.closest(".edit-course");
  if (editCourse) openCourseModal(catalog.courses.find(item => item.id === Number(editCourse.dataset.id)));

  const removeCourse = event.target.closest(".delete-course");
  if (removeCourse) deleteCourse(Number(removeCourse.dataset.id));

  const editTeacher = event.target.closest(".edit-teacher");
  if (editTeacher) openTeacherModal(catalog.teachers.find(item => item.id === Number(editTeacher.dataset.id)));

  const removeTeacher = event.target.closest(".delete-teacher");
  if (removeTeacher) deleteTeacher(Number(removeTeacher.dataset.id));

  const editRoom = event.target.closest(".edit-room");
  if (editRoom) openRoomModal(catalog.rooms.find(item => item.id === Number(editRoom.dataset.id)));

  const removeRoom = event.target.closest(".delete-room");
  if (removeRoom) deleteRoom(Number(removeRoom.dataset.id));

  const editClass = event.target.closest(".edit-class");
  if (editClass) openClassModal(catalog.classes.find(item => item.id === Number(editClass.dataset.id)));

  const removeClass = event.target.closest(".delete-class");
  if (removeClass) deleteClass(Number(removeClass.dataset.id));

  const roster = event.target.closest(".manage-roster");
  if (roster) openRoster(Number(roster.dataset.id));

  if (event.target.closest(".add-lead") && can("leads:write")) openLeadModal();

  const editLead = event.target.closest(".edit-lead");
  if (editLead) {
    const lead = leads.find(item => item.id === Number(editLead.dataset.id));
    if (lead) openLeadModal(lead);
  }

  const contactButton = event.target.closest(".contact-lead");
  if (contactButton) contactLead(Number(contactButton.dataset.id));

  const advanceLead = event.target.closest(".advance-lead");
  if (advanceLead) updateLeadStage(Number(advanceLead.dataset.id), advanceLead.dataset.stage);

  const invalidLead = event.target.closest(".invalid-lead");
  if (invalidLead) {
    const lead = leads.find(item => item.id === Number(invalidLead.dataset.id));
    if (lead && window.confirm(`确定将「${lead.name}」标记为无效线索吗？`)) {
      updateLeadStage(lead.id, "无效");
    }
  }

  if (event.target.closest(".render-invalid-leads")) renderInvalidLeads();
  if (event.target.closest(".back-to-leads")) renderLeads();

  const enroll = event.target.closest(".enroll-student");
  if (enroll) enrollStudent(Number(enroll.dataset.id));

  const unenroll = event.target.closest(".unenroll-student");
  if (unenroll) unenrollStudent(Number(unenroll.dataset.classId), Number(unenroll.dataset.studentId));

  const editUser = event.target.closest(".edit-user");
  if (editUser) fillUserForm(Number(editUser.dataset.id));

  const deleteUserButton = event.target.closest(".delete-user");
  if (deleteUserButton) deleteUser(Number(deleteUserButton.dataset.id));

  if (event.target.closest(".cancel-user-edit")) resetUserForm();
});

document.querySelector("#quickAdd").addEventListener("click", async () => {
  if (!can("students:write")) {
    showToast("当前角色不能新增学员");
    return;
  }
  try {
    if (!catalog.courses.length) await loadCatalog();
  } catch (error) {
    showToast(error.message);
  }
  openModal();
});
document.querySelector("#closeModal").addEventListener("click", closeModal);
document.querySelector("#cancelModal").addEventListener("click", closeModal);
document.querySelector("#modalBackdrop").addEventListener("click", event => {
  if (event.target.id === "modalBackdrop") closeModal();
});
document.querySelector("#mobileMenu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
document.querySelector("#closeManagement").addEventListener("click", closeManagement);
document.querySelector("#cancelManagement").addEventListener("click", closeManagement);
document.querySelector("#managementBackdrop").addEventListener("click", event => {
  if (event.target.id === "managementBackdrop") closeManagement();
});
document.querySelector("#closeRoster").addEventListener("click", closeRoster);
document.querySelector("#rosterBackdrop").addEventListener("click", event => {
  if (event.target.id === "rosterBackdrop") closeRoster();
});
document.querySelector("#closeLead").addEventListener("click", closeLeadModal);
document.querySelector("#cancelLead").addEventListener("click", closeLeadModal);
document.querySelector("#leadBackdrop").addEventListener("click", event => {
  if (event.target.id === "leadBackdrop") closeLeadModal();
});
document.querySelector("#loginForm").addEventListener("submit", handleLogin);
document.querySelector("#logoutButton").addEventListener("click", logout);

document.querySelector("#studentForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!can("students:write")) {
    showToast("当前角色不能修改学员");
    return;
  }
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const studentId = data.id;
  delete data.id;
  data.age = Number(data.age);
  data.hours = studentId ? Number(data.hours) : 0;
  data.status = studentId ? data.status : "待分班";
  const button = document.querySelector("#saveStudent");
  button.classList.add("button-loading");
  button.textContent = "保存中...";
  try {
    await api(studentId ? `/api/students/${studentId}` : "/api/students", {
      method: studentId ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    closeModal();
    showToast(`学员 ${data.name} 已${studentId ? "更新" : "添加"}`);
    await renderPage("students");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = studentId ? "保存修改" : "保存学员";
  }
});

document.querySelector("#managementForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!can("catalog:write")) {
    showToast("当前角色不能修改课程与班级");
    return;
  }
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const type = data.type;
  const itemId = data.id;
  delete data.type;
  delete data.id;
  const resourceMap = {
    course: "courses",
    class: "classes",
    teacher: "teachers",
    room: "rooms",
  };
  const resource = resourceMap[type];
  const button = document.querySelector("#saveManagement");
  button.classList.add("button-loading");
  button.textContent = "保存中...";
  try {
    await api(itemId ? `/api/${resource}/${itemId}` : `/api/${resource}`, {
      method: itemId ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    closeManagement();
    showToast(`${typeLabel(type)}已${itemId ? "更新" : "创建"}`);
    await renderPage("catalog");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = itemId ? "保存修改" : `创建${typeLabel(type)}`;
  }
});

document.querySelector("#leadForm").addEventListener("submit", saveLead);

document.addEventListener("submit", async event => {
  if (event.target.id === "hoursForm") {
    event.preventDefault();
    if (!can("hours:write")) {
      showToast("当前角色不能新增课时流水");
      return;
    }
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    if (data.teacher_student) {
      const [teacherId, studentId] = String(data.teacher_student).split(":").map(Number);
      data.teacher_id = teacherId;
      data.student_id = studentId;
    } else {
      data.teacher_id = Number(data.teacher_id);
      data.student_id = Number(data.student_id);
    }
    delete data.teacher_student;
    data.amount = Number(data.amount);
    const button = document.querySelector("#saveHours");
    button.classList.add("button-loading");
    button.textContent = "保存中...";
    try {
      await api("/api/hour-transactions", {
        method: "POST",
        body: JSON.stringify(data),
      });
      showToast("课时流水已保存");
      await Promise.all([loadStudents(), loadCatalog(), loadHourTransactions()]);
      renderHours();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "保存课时流水";
    }
    return;
  }
  if (event.target.id !== "userForm") return;
  event.preventDefault();
  if (!can("settings:write")) {
    showToast("只有校长可以管理员工账号");
    return;
  }
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const userId = data.id;
  delete data.id;
  const button = document.querySelector("#saveUser");
  button.classList.add("button-loading");
  button.textContent = "保存中...";
  try {
    await api(userId ? `/api/users/${userId}` : "/api/users", {
      method: userId ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    showToast(userId ? "员工账号已更新" : "员工账号已创建");
    await loadUsers();
    renderSettings();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = "保存账号";
  }
});

document.querySelector("#globalSearch").addEventListener("input", event => {
  if (event.target.value.trim()) renderPage("students", event.target.value);
});

document.addEventListener("change", event => {
  if (!event.target.matches(".schedule-date-picker")) return;
  const pickedDate = dateFromInput(event.target.value);
  activeWeekStart = startOfWeek(pickedDate);
  activeScheduleDay = weekdayIndexForDate(pickedDate);
  renderSchedule();
});

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#globalSearch").focus();
  }
  if (event.key === "Escape") {
    closeModal();
    closeManagement();
    closeRoster();
    closeLeadModal();
  }
});

async function deleteStudent(studentId) {
  const student = students.find(item => item.id === studentId);
  if (!student || !window.confirm(`确定删除学员「${student.name}」吗？此操作无法撤销。`)) return;
  try {
    await api(`/api/students/${studentId}`, { method: "DELETE" });
    showToast(`学员 ${student.name} 已删除`);
    await renderPage("students");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteCourse(courseId) {
  const course = catalog.courses.find(item => item.id === courseId);
  if (!course || !window.confirm(`确定删除课程「${course.name}」吗？`)) return;
  try {
    await api(`/api/courses/${courseId}`, { method: "DELETE" });
    showToast(`课程 ${course.name} 已删除`);
    await renderPage("catalog");
  } catch (error) {
    showToast(error.message);
  }
}

function typeLabel(type) {
  return { course: "课程", class: "班级", teacher: "教师", room: "教室" }[type] || "资料";
}

async function deleteTeacher(teacherId) {
  const teacher = catalog.teachers.find(item => item.id === teacherId);
  if (!teacher || !window.confirm(`确定删除教师「${teacher.display_name}」吗？`)) return;
  try {
    await api(`/api/teachers/${teacherId}`, { method: "DELETE" });
    showToast(`教师 ${teacher.display_name} 已删除`);
    await renderPage("catalog");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteRoom(roomId) {
  const room = catalog.rooms.find(item => item.id === roomId);
  if (!room || !window.confirm(`确定删除教室「${room.name}」吗？`)) return;
  try {
    await api(`/api/rooms/${roomId}`, { method: "DELETE" });
    showToast(`教室 ${room.name} 已删除`);
    await renderPage("catalog");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteClass(classId) {
  const item = catalog.classes.find(entry => entry.id === classId);
  if (!item || !window.confirm(`确定删除班级「${item.name}」吗？班级花名册也会清空。`)) return;
  try {
    await api(`/api/classes/${classId}`, { method: "DELETE" });
    showToast(`班级 ${item.name} 已删除`);
    await renderPage("catalog");
  } catch (error) {
    showToast(error.message);
  }
}

function fillUserForm(userId) {
  const user = users.find(item => item.id === userId);
  const form = document.querySelector("#userForm");
  if (!user || !form) return;
  form.elements.id.value = user.id;
  form.elements.phone.value = user.phone;
  form.elements.name.value = user.name;
  form.elements.role.value = user.role;
  form.elements.password.value = "";
  document.querySelector("#userFormTitle").textContent = "编辑员工账号";
  document.querySelector(".cancel-user-edit").hidden = false;
  document.querySelector("#saveUser").textContent = "保存修改";
}

function resetUserForm() {
  const form = document.querySelector("#userForm");
  if (!form) return;
  form.reset();
  form.elements.id.value = "";
  document.querySelector("#userFormTitle").textContent = "新增员工账号";
  document.querySelector(".cancel-user-edit").hidden = true;
  document.querySelector("#saveUser").textContent = "保存账号";
}

async function deleteUser(userId) {
  const user = users.find(item => item.id === userId);
  if (!user || user.id === currentUser?.id) return;
  if (!window.confirm(`确定停用员工账号「${user.name}」吗？该手机号将不能再登录。`)) return;
  try {
    await api(`/api/users/${userId}`, { method: "DELETE" });
    showToast(`员工 ${user.name} 已停用`);
    await loadUsers();
    renderSettings();
  } catch (error) {
    showToast(error.message);
  }
}

async function enrollStudent(classId) {
  const select = document.querySelector("#rosterStudentSelect");
  const studentId = Number(select?.value);
  if (!studentId) return;
  try {
    await api(`/api/classes/${classId}/students`, {
      method: "POST",
      body: JSON.stringify({ student_id: studentId }),
    });
    await Promise.all([loadCatalog(), loadStudents()]);
    openRoster(classId);
    showToast("学员已加入班级");
  } catch (error) {
    showToast(error.message);
  }
}

async function unenrollStudent(classId, studentId) {
  try {
    await api(`/api/classes/${classId}/students/${studentId}`, { method: "DELETE" });
    await loadCatalog();
    openRoster(classId);
    showToast("学员已移出班级");
  } catch (error) {
    showToast(error.message);
  }
}

async function boot() {
  try {
    await loadSession();
    await renderPage(allowedPages()[0] || "dashboard");
  } catch (error) {
    currentUser = null;
    showLogin();
  }
}

boot();
