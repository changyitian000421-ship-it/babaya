const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4173" : "";
let currentUser = null;
let students = [];
let catalog = { courses: [], classes: [], teachers: [], rooms: [] };
let catalogView = "courses";
let dashboardStats = {
  totalStudents: 0,
  activeStudents: 0,
  renewalStudents: 0,
  remainingHours: 0,
};

const dashboardClasses = [
  { time: "14:00", duration: "90 分钟", name: "少儿主持基础班", room: "春日教室 · A203", teacher: "陈老师", teacherKey: "陈", current: 10, max: 12, color: "#e8664a" },
  { time: "16:00", duration: "90 分钟", name: "朗诵表达进阶班", room: "剧场教室 · B101", teacher: "苏老师", teacherKey: "苏", current: 8, max: 10, color: "#715b87" },
  { time: "18:30", duration: "60 分钟", name: "演讲与口才一对一", room: "星光教室 · A205", teacher: "方老师", teacherKey: "方", current: 1, max: 1, color: "#4f896f" },
];

const leads = [
  { name: "林可昕", age: 7, stage: "新线索", source: "大众点评", note: "希望改善胆小、不敢表达的问题", time: "10 分钟前", tag: "主持" },
  { name: "唐子墨", age: 9, stage: "新线索", source: "老带新", note: "对朗诵和舞台表演有兴趣", time: "1 小时前", tag: "朗诵" },
  { name: "韩雨桐", age: 6, stage: "已联系", source: "公众号", note: "妈妈周末方便带孩子来试听", time: "今天 10:20", tag: "启蒙" },
  { name: "宋安然", age: 10, stage: "已联系", source: "地推活动", note: "有学校主持经验，想系统提升", time: "昨天", tag: "主持" },
  { name: "程知远", age: 8, stage: "待试听", source: "小红书", note: "已约本周六 15:00 体验课", time: "周六 15:00", tag: "口才" },
  { name: "叶舒然", age: 11, stage: "待试听", source: "视频号", note: "准备校内演讲比赛", time: "周日 10:00", tag: "演讲" },
  { name: "温以宁", age: 7, stage: "待报名", source: "老带新", note: "试听反馈很好，待确认班级时间", time: "跟进 2 次", tag: "朗诵" },
];

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
  academic: ["dashboard", "students", "catalog", "schedule", "teaching"],
  teacher: ["dashboard", "schedule", "teaching", "students", "catalog"],
  sales: ["dashboard", "leads", "students"],
  finance: ["dashboard", "hours", "students"],
};

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

function showLogin(message = "") {
  document.querySelector("#appShell").hidden = true;
  document.querySelector("#loginScreen").hidden = false;
  if (message) showToast(message);
  setTimeout(() => document.querySelector('#loginForm input[name="username"]')?.focus(), 30);
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
            ${todoItem("确认程知远试听课", "与家长确认周六到店时间", "11:30", "#e8664a")}
            ${todoItem("沈嘉树续费回访", "剩余 8 课时，已触发预警", "今天", "#c89436")}
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
            ${funnelRow("新增线索", 42, 100, "#e8664a")}
            ${funnelRow("预约试听", 28, 67, "#d98265")}
            ${funnelRow("完成试听", 21, 50, "#b57972")}
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
        <div class="class-detail"><span>上课时间</span><strong>${weekdayName(item.weekday)} ${escapeHtml(item.start_time)} · ${item.duration} 分钟</strong></div>
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
    <article class="resource-card" style="--resource-color:#e8664a">
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
  if (status === "招生中") return "#e8664a";
  if (status === "已结课") return "#715b87";
  return "#8a827b";
}

function renderSchedule() {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>6 月 8 日 - 6 月 14 日</h2><p>本周共 21 节课，预计到课 146 人次</p></div>
      <div class="toolbar-actions"><button class="secondary-button">今天</button>${can("catalog:write") ? `<button class="primary-button">${icon("plus")} 新建课程</button>` : ""}</div>
    </div>
    <div class="week-strip">${days.map((d, i) => `<button class="day-button ${i === 5 ? "active" : ""}"><span>${d}</span><strong>${8 + i}</strong></button>`).join("")}</div>
    <div class="schedule-board">
      <div class="time-rail">${["14:00", "15:30", "17:00", "18:30"].map(t => `<div class="time-slot">${t}</div>`).join("")}</div>
      <div class="schedule-lane">
        ${dashboardClasses.map(c => `<article class="schedule-event" style="--event-color:${c.color}"><span class="color-pill"></span><div><strong>${c.name}</strong><small>${c.time} · ${c.duration} · ${c.room}</small></div><div class="schedule-meta"><b>${c.teacher}</b>${c.current}/${c.max} 人</div></article>`).join("")}
        <article class="schedule-event" style="--event-color:#507b9d"><span class="color-pill"></span><div><strong>舞台表演启蒙班</strong><small>19:40 · 60 分钟 · 剧场教室 B101</small></div><div class="schedule-meta"><b>顾老师</b>7/10 人</div></article>
      </div>
    </div>`;
}

function renderLeads() {
  const stages = ["新线索", "已联系", "待试听", "待报名"];
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>招生跟进看板</h2><p>拖动式流程将在正式版接入，当前可查看完整跟进状态</p></div>
      <div class="toolbar-actions"><button class="secondary-button">${icon("filter")} 筛选</button>${can("leads:write") ? `<button class="primary-button">${icon("plus")} 新增线索</button>` : ""}</div>
    </div>
    <div class="lead-board">${stages.map(stage => {
      const items = leads.filter(l => l.stage === stage);
      return `<section class="lead-column"><div class="lead-column-header"><strong>${stage}</strong><span class="lead-count">${items.length}</span></div>
        ${items.map(l => `<article class="lead-card"><div class="lead-card-top"><h3>${l.name} · ${l.age}岁</h3><span class="tag" style="--tag-color:#e8664a">${l.tag}</span></div><p>${l.note}</p><div class="lead-card-footer"><span>${l.source} · ${l.time}</span><button class="phone-button" data-call="${l.name}">${icon("phone")}</button></div></article>`).join("")}
      </section>`;
    }).join("")}</div>`;
}

function renderHours() {
  pageContent.innerHTML = `
    <div class="hours-summary">
      <div class="summary-card"><span>本月已消课</span><strong>428.5</strong><span class="positive">较上月 +7.2%</span></div>
      <div class="summary-card"><span>剩余课时总量</span><strong>3,682</strong><span>覆盖 186 名在读学员</span></div>
      <div class="summary-card"><span>30 天内待续费</span><strong>12 人</strong><span class="negative">预计课时缺口 96 节</span></div>
    </div>
    <div class="section-toolbar"><div><h2>最近课时流水</h2><p>每笔课时变动均可追溯</p></div><button class="secondary-button">导出流水</button></div>
    <div class="table-card"><table class="data-table"><thead><tr><th>时间</th><th>学员</th><th>变动类型</th><th>课程</th><th>课时变动</th><th>操作人</th></tr></thead>
      <tbody>
        ${[
          ["今天 16:02", "周亦辰", "上课消课", "朗诵表达进阶班", "-1.5", "苏老师"],
          ["今天 15:35", "顾言溪", "上课消课", "少儿主持基础班", "-1.5", "陈老师"],
          ["今天 11:20", "沈嘉树", "购买课时", "演讲与口才一对一", "+12", "林知夏"],
          ["昨天 19:42", "许星禾", "请假返还", "舞台表演启蒙班", "+1", "系统"],
          ["昨天 18:31", "陆小满", "上课消课", "少儿主持基础班", "-1.5", "陈老师"],
        ].map(r => `<tr>${r.map((cell, i) => `<td>${i === 4 ? `<strong class="${cell.startsWith("+") ? "positive" : "negative"}">${cell}</strong>` : cell}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>`;
}

function renderPlaceholder(type) {
  const isTeaching = type === "teaching";
  if (!isTeaching) {
    pageContent.innerHTML = `<div class="settings-grid">
      ${[
        ["校长 / 管理员", "admin", "全功能管理，含系统设置"],
        ["教务前台", "jiaowu", "学员、课程、班级、教师、教室管理"],
        ["授课教师", "teacher", "查看课表、学员、课程与教学中心"],
        ["招生顾问", "sales", "招生跟进与学员录入"],
        ["财务", "finance", "课时和学员信息查看"],
      ].map(([role, account, desc]) => `<article class="settings-card"><strong>${role}</strong><span>账号：${account}</span><p>${desc}</p></article>`).join("")}
    </div>`;
    return;
  }
  pageContent.innerHTML = `<div class="placeholder-page"><div>${icon("book")}<h2>教学中心</h2><p>教案、作业、作品集与成长评价将在第二阶段开放</p></div></div>`;
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
  } catch (error) {
    renderConnectionError(error.message);
  }
  if (page === "schedule") renderSchedule();
  if (page === "leads") renderLeads();
  if (page === "hours") renderHours();
  if (["teaching", "settings"].includes(page)) renderPlaceholder(page);
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
  if (status === "待续费") return "#e8664a";
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
    <label class="color-field"><span>课程颜色</span><input name="color" type="color" value="${escapeHtml(course?.color || "#e8664a")}" /></label>
    <label class="full"><span>课程简介</span><textarea name="description" rows="3" placeholder="课程目标与特色">${escapeHtml(course?.description || "")}</textarea></label>`;
  document.querySelector("#managementBackdrop").hidden = false;
  setTimeout(() => form.elements.name.focus(), 30);
}

function openClassModal(item = null) {
  const form = document.querySelector("#managementForm");
  form.reset();
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
    <label><span>每周上课日</span><select name="weekday">${["周一","周二","周三","周四","周五","周六","周日"].map((day, index) => `<option value="${index}" ${index === (item?.weekday ?? 5) ? "selected" : ""}>${day}</option>`).join("")}</select></label>
    <label><span>开始时间</span><input name="start_time" required type="time" value="${escapeHtml(item?.start_time || "14:00")}" /></label>
    <label><span>单节时长（分钟）</span><input name="duration" required type="number" min="15" step="5" value="${item?.duration ?? 90}" /></label>
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
    <label class="color-field"><span>教师颜色</span><input name="color" type="color" value="${escapeHtml(teacher?.color || "#e8664a")}" /></label>
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

document.addEventListener("click", event => {
  const nav = event.target.closest(".nav-item");
  if (nav && canOpenPage(nav.dataset.page)) renderPage(nav.dataset.page);

  const go = event.target.closest("[data-go]");
  if (go) renderPage(go.dataset.go);

  const checkin = event.target.closest(".checkin");
  if (checkin) showToast(`已进入「${checkin.dataset.class}」点名页面`);

  const call = event.target.closest("[data-call]");
  if (call) showToast(`已记录对 ${call.dataset.call} 的电话跟进`);

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

  const enroll = event.target.closest(".enroll-student");
  if (enroll) enrollStudent(Number(enroll.dataset.id));

  const unenroll = event.target.closest(".unenroll-student");
  if (unenroll) unenrollStudent(Number(unenroll.dataset.classId), Number(unenroll.dataset.studentId));
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

document.querySelector("#globalSearch").addEventListener("input", event => {
  if (event.target.value.trim()) renderPage("students", event.target.value);
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
