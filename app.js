const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4173" : "";
let currentUser = null;
let students = [];
let catalog = { courses: [], classes: [], teachers: [], rooms: [] };
let users = [];
let leads = [];
let trials = [];
let hourTransactions = [];
let payments = [];
let parentStudents = [];
let parentSchedule = [];
let parentAttendance = [];
let parentPayments = [];
let catalogView = "courses";
let activeWeekStart = startOfWeek(new Date());
let activeScheduleDay = todayScheduleIndex();
let pendingScheduleFocusId = "";
let dashboardTodoEditing = false;
let dashboardStats = {
  scope: "all",
  scopeLabel: "全校数据",
  totalStudents: 0,
  activeStudents: 0,
  renewalStudents: 0,
  remainingHours: 0,
  activeClasses: 0,
  todayAttendancePresent: 0,
  todayAttendanceTotal: 0,
  recentClasses: [],
  teacherOverview: [],
  leadConversion: {
    total: 0,
    monthNew: 0,
    new: 0,
    contacted: 0,
    trialScheduled: 0,
    trialCompleted: 0,
    enrolled: 0,
  },
  customTodos: [],
};

const leadStages = ["新线索", "已联系", "待试听", "待报名", "已报名"];
const trialStatuses = ["待试听", "已试听", "已转正", "已取消"];
const trialResults = ["未填写", "适合报名", "需再跟进", "暂不适合", "未到场"];
const COLORS_FOR_TODO_PICKER = ["#ff9f1c", "#ffd33d", "#715b87", "#4f896f", "#f47a12"];

const pageMeta = {
  dashboard: ["总览", "下午好，林老师"],
  students: ["教务管理", "学员管理"],
  catalog: ["教务管理", "课程与班级"],
  schedule: ["教务管理", "班级课表"],
  attendance: ["教学管理", "上课点名"],
  leads: ["招生中心", "招生跟进"],
  trials: ["招生中心", "试听课管理"],
  payments: ["财务管理", "缴费续费"],
  hours: ["财务与课消", "课时管理"],
  teaching: ["教学管理", "教学中心"],
  account: ["个人中心", "账号设置"],
  settings: ["系统配置", "系统设置"],
};

const rolePages = {
  owner: ["dashboard", "students", "catalog", "schedule", "attendance", "leads", "trials", "payments", "hours", "teaching", "account", "settings"],
  academic: ["dashboard", "students", "catalog", "schedule", "attendance", "leads", "trials", "payments", "hours", "teaching", "account"],
  teacher: ["dashboard", "schedule", "attendance", "trials", "hours", "leads", "teaching", "students", "catalog", "account"],
  sales: ["dashboard", "leads", "trials", "students", "account"],
  finance: ["dashboard", "payments", "hours", "leads", "students", "account"],
};

const roleOptions = [
  ["owner", "校长 / 管理员"],
  ["academic", "教务前台"],
  ["teacher", "授课教师"],
  ["sales", "招生顾问"],
  ["finance", "财务"],
];

const pageContent = document.querySelector("#pageContent");
const parentContent = document.querySelector("#parentContent");
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

function currentTeacherIds() {
  if (currentUser?.role !== "teacher") return null;
  const userName = String(currentUser?.name || "").trim();
  const userPhone = String(currentUser?.phone || "").trim();
  return catalog.teachers
    .filter(teacher => [teacher.name, teacher.display_name, teacher.phone].some(value => String(value || "").trim() === userName)
      || String(teacher.phone || "").trim() === userPhone)
    .map(teacher => Number(teacher.id));
}

function visibleClassesForCurrentUser(classItems = catalog.classes) {
  const teacherIds = currentTeacherIds();
  if (teacherIds === null) return classItems;
  return classItems.filter(item => teacherIds.includes(Number(item.teacher_id)));
}

function currentTeacherProfiles() {
  const teacherIds = currentTeacherIds();
  if (!teacherIds) return [];
  return catalog.teachers.filter(teacher => teacherIds.includes(Number(teacher.id)));
}

function icon(id) {
  return `<svg><use href="#icon-${id}"></use></svg>`;
}

function avatarMarkup(user, className = "") {
  const image = user?.avatarImage || "";
  const text = user?.avatarText || (user?.name || "员")[0];
  const color = user?.avatarColor || "#ff9f1c";
  return `<span class="avatar avatar-manager ${className}" style="--profile-color:${escapeHtml(color)}">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(user?.name || "头像")}" />` : escapeHtml(text)}</span>`;
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

async function loadTrials() {
  trials = await api("/api/trials");
}

async function loadHourTransactions() {
  hourTransactions = await api("/api/hour-transactions");
}

async function loadPayments() {
  payments = await api("/api/payments");
}

async function loadParentPortalData() {
  const start = toDateInputValue(new Date());
  const end = toDateInputValue(addDays(new Date(), 45));
  [parentStudents, parentSchedule, parentAttendance, parentPayments] = await Promise.all([
    api("/api/parent/students"),
    api(`/api/parent/schedule?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    api("/api/parent/attendance"),
    api("/api/parent/payments"),
  ]);
}

function showLogin(message = "") {
  document.querySelector("#appShell").hidden = true;
  document.querySelector("#parentShell").hidden = true;
  document.querySelector("#loginScreen").hidden = false;
  if (message) showToast(message);
  setTimeout(() => document.querySelector('#loginForm input[name="phone"]')?.focus(), 30);
}

function showApp() {
  document.querySelector("#loginScreen").hidden = true;
  document.querySelector("#parentShell").hidden = true;
  document.querySelector("#appShell").hidden = false;
}

function showParentApp() {
  document.querySelector("#loginScreen").hidden = true;
  document.querySelector("#appShell").hidden = true;
  document.querySelector("#parentShell").hidden = false;
}

function applyRoleUi() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.hidden = !canOpenPage(item.dataset.page);
  });
  document.querySelector("#quickAdd").hidden = !can("students:write");
  document.querySelector(".global-search").hidden = !can("students:read");
  document.querySelector("#profileName").textContent = currentUser?.name || "未登录";
  document.querySelector("#profileRole").textContent = currentUser?.roleLabel || "";
  const avatar = document.querySelector("#profileAvatar");
  avatar.style.setProperty("--profile-color", currentUser?.avatarColor || "#ff9f1c");
  avatar.innerHTML = currentUser?.avatarImage
    ? `<img src="${escapeHtml(currentUser.avatarImage)}" alt="${escapeHtml(currentUser.name)}" />`
    : escapeHtml(currentUser?.avatarText || (currentUser?.name || "声")[0]);
}

async function loadSession() {
  const data = await api("/api/session");
  currentUser = data.user;
  if (currentUser.role === "parent") {
    showParentApp();
    await loadParentPortalData();
    renderParentPortal();
    return;
  }
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
    if (currentUser.role === "parent") {
      showParentApp();
      showToast(`欢迎回来，${currentUser.name}`);
      await loadParentPortalData();
      renderParentPortal();
      return;
    }
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
  const recentClasses = dashboardRecentClasses();
  const attendanceTotal = Number(dashboardStats.todayAttendanceTotal || 0);
  const attendancePresent = Number(dashboardStats.todayAttendancePresent || 0);
  const attendanceRate = attendanceTotal ? Math.round(attendancePresent / attendanceTotal * 100) : 0;
  const leadConversion = dashboardStats.leadConversion || {};
  const generatedTodos = dashboardTodos(recentClasses, attendancePresent, attendanceTotal);
  const todoItems = effectiveDashboardTodos(generatedTodos);
  const insight = dashboardInsight(recentClasses, attendanceRate);
  const recentTitle = dashboardStats.scope === "own" ? "我的近期课程" : "近期课程";
  const recentDescription = dashboardStats.scope === "own"
    ? "只显示当前账号对应授课教师的课程"
    : "按时间顺序查看全体教师近期课程";
  pageContent.innerHTML = `
    <p class="date-line">${formatToday()} · 当前范围：${escapeHtml(dashboardStats.scopeLabel || "全校数据")}</p>
    <div class="metric-grid">
      ${metricCard("users", "在读学员", dashboardStats.activeStudents, `全部 ${dashboardStats.totalStudents} 人`, "orange", "students")}
      ${metricCard("calendar", "今日到课", `${attendancePresent} / ${attendanceTotal}`, attendanceTotal ? `到课率 ${attendanceRate}%` : "今日暂无课程", "purple", "attendance")}
      ${metricCard("wallet", "剩余课时总量", formatHours(dashboardStats.remainingHours), "实时数据", "green", "hours")}
      ${metricCard("clock", "待续费学员", dashboardStats.renewalStudents, "需要跟进", "yellow", "students")}
    </div>
    <div class="dashboard-grid">
      <div class="stack">
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><h2>${recentTitle}</h2><p>${recentDescription}</p></div>
            <button class="text-button" data-go="schedule">查看完整课表 ${icon("arrow")}</button>
          </div>
          <div class="class-list">
            ${recentClasses.length ? recentClasses.map(classRow).join("") : `<div class="empty-state">${dashboardStats.scope === "own" ? "当前账号还没有匹配到自己的近期课程，请检查教师名单中的姓名或手机号。" : "近期还没有排课。"}</div>`}
          </div>
        </section>
        <section class="insight-card">
          <small>${escapeHtml(insight.label)}</small>
          <h3>${escapeHtml(insight.title)}</h3>
          <p>${escapeHtml(insight.description)}</p>
        </section>
      </div>
      <div class="stack">
        ${renderTeacherCourseOverview()}
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><h2>${dashboardStats.scope === "own" ? "我的待办" : "今日待办"}</h2><p>${dashboardTodoEditing ? "编辑后会保存到当前登录账号" : todoDescription()}</p></div>
            <button class="text-button edit-dashboard-todos">${dashboardTodoEditing ? "取消编辑" : `编辑待办 ${icon("edit")}`}</button>
          </div>
          ${dashboardTodoEditing ? dashboardTodoEditor(todoItems) : `<div class="todo-list">${todoItems.map(item => todoItem(item.title, item.description, item.time, item.color)).join("")}</div>`}
        </section>
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><h2>招生转化</h2><p>全校可见 · 本月新增线索 ${Number(leadConversion.monthNew || 0)} 条</p></div>
            <button class="text-button" data-go="leads">进入跟进 ${icon("arrow")}</button>
          </div>
          <div class="funnel">
            ${dashboardLeadFunnel()}
          </div>
        </section>
      </div>
    </div>`;
}

function renderParentPortal() {
  const totalHours = parentStudents.reduce((sum, student) => sum + Number(student.hours || 0), 0);
  const todayText = toDateInputValue(new Date());
  const upcoming = parentSchedule
    .filter(item => item.lesson_date >= todayText)
    .slice(0, 8);
  const recentAttendance = parentAttendance.slice(0, 8);
  const recentPayments = parentPayments.slice(0, 8);
  parentContent.innerHTML = `
    <section class="parent-welcome">
      <div>
        <span>欢迎回来</span>
        <h1>${escapeHtml(currentUser?.name || "家长")}，孩子的学习动态在这里</h1>
        <p>查看课表、剩余课时、上课点名和缴费记录。之后小程序也会沿用这套数据。</p>
      </div>
      <img src="./assets/babaya-duck-mark.png" alt="" aria-hidden="true" />
    </section>
    <section class="parent-metrics">
      <div><span>绑定学员</span><strong>${parentStudents.length}</strong><small>仅显示自己孩子</small></div>
      <div><span>剩余课时</span><strong>${formatHours(totalHours)}</strong><small>所有绑定孩子合计</small></div>
      <div><span>未来课程</span><strong>${parentSchedule.length}</strong><small>未来 45 天</small></div>
    </section>
    <section class="parent-section">
      <div class="section-toolbar"><div><h2>我的孩子</h2><p>学员档案和剩余课时</p></div></div>
      <div class="parent-student-grid">
        ${parentStudents.length ? parentStudents.map(student => `<article class="parent-student-card" style="--student-color:${escapeHtml(student.color || "#ff9f1c")}">
          <span class="avatar">${escapeHtml(student.name[0])}</span>
          <div><h3>${escapeHtml(student.name)}</h3><p>${student.age} 岁 · ${escapeHtml(student.course)}</p></div>
          <strong>${formatHours(student.hours)} 课时</strong>
        </article>`).join("") : `<div class="empty-state">暂未绑定孩子，请联系机构前台绑定家长手机号。</div>`}
      </div>
    </section>
    <section class="parent-grid">
      <div class="panel">
        <div class="panel-header"><div class="panel-title"><h2>近期课表</h2><p>按日期显示未来课程</p></div></div>
        <div class="parent-list">
          ${upcoming.length ? upcoming.map(item => `<div class="parent-list-row">
            <div><strong>${escapeHtml(item.class_name)}</strong><small>${escapeHtml(item.student_name)} · ${escapeHtml(item.teacher_name)} · ${escapeHtml(item.room_name)} ${escapeHtml(item.room_code)}</small></div>
            <span>${formatParentDate(item.lesson_date)}<br>${escapeHtml(item.start_time)}-${escapeHtml(item.end_time)}</span>
          </div>`).join("") : `<div class="lead-empty">未来 45 天暂无课程</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title"><h2>上课记录</h2><p>点名结果和课时扣减</p></div></div>
        <div class="parent-list">
          ${recentAttendance.length ? recentAttendance.map(item => `<div class="parent-list-row">
            <div><strong>${escapeHtml(item.class_name)}</strong><small>${escapeHtml(item.student_name)} · ${escapeHtml(item.teacher_name || "老师")}</small></div>
            <span>${formatParentDate(item.lesson_date)}<br>${escapeHtml(item.status_label)} ${formatHours(Math.abs(Number(item.hours_delta || 0)))}课时</span>
          </div>`).join("") : `<div class="lead-empty">暂无点名记录</div>`}
        </div>
      </div>
    </section>
    <section class="panel parent-section">
      <div class="panel-header"><div class="panel-title"><h2>缴费记录</h2><p>展示最近缴费与续费</p></div></div>
      <div class="parent-list">
        ${recentPayments.length ? recentPayments.map(item => `<div class="parent-list-row">
          <div><strong>${escapeHtml(item.payment_type)} · ${formatMoney(item.amount_paid)}</strong><small>${escapeHtml(item.student_name)} · ${escapeHtml(item.payment_method)} · ${escapeHtml(item.note || "无备注")}</small></div>
          <span>${formatParentDate(item.paid_at)}<br>+${formatHours(item.hours_added)} 课时</span>
        </div>`).join("") : `<div class="lead-empty">暂无缴费记录</div>`}
      </div>
    </section>`;
}

function formatParentDate(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function metricCard(iconName, label, value, trend, color, targetPage = "") {
  const actionAttrs = targetPage ? ` data-go="${targetPage}" role="button" tabindex="0" aria-label="查看${escapeHtml(label)}"` : "";
  return `<article class="metric-card ${color}"${actionAttrs}>
    <div class="metric-top"><span class="metric-icon">${icon(iconName)}</span><span class="trend">${icon("trend")} ${trend}</span></div>
    <h3>${value}</h3><p>${label}</p>
  </article>`;
}

function dashboardTodos(recentClasses, attendancePresent, attendanceTotal) {
  const isOwnScope = dashboardStats.scope === "own";
  const todos = [];
  const nextClass = recentClasses[0];
  if (nextClass) {
    const title = `${isOwnScope ? "准备我的课程" : "确认近期课程"}：${nextClass.name || nextClass.course_name || "未命名班级"}`;
    const dateLabel = nextClass.nextDate ? dashboardDateLabel(nextClass.nextDate) : "近期";
    const roomLabel = nextClass.room_name ? `${nextClass.room_name}${nextClass.room_code ? ` ${nextClass.room_code}` : ""}` : "教室待确认";
    todos.push({
      title,
      description: `${dateLabel} ${nextClass.start_time || ""} · ${nextClass.teacher_name || currentUser?.name || "老师"} · ${roomLabel}`,
      time: nextClass.start_time || "近期",
      color: nextClass.course_color || "#ff9f1c",
    });
  }
  if (attendanceTotal > attendancePresent) {
    todos.push({
      title: isOwnScope ? "完成我的今日点名" : "核对今日点名进度",
      description: `还有 ${attendanceTotal - attendancePresent} 人需要确认到课状态，点名后会自动消课。`,
      time: "课后",
      color: "#715b87",
    });
  }
  if (Number(dashboardStats.renewalStudents || 0) > 0) {
    todos.push({
      title: `跟进 ${dashboardStats.renewalStudents} 名待续费学员`,
      description: isOwnScope ? "仅统计当前账号授课范围内的学员。" : "来自当前可见范围，建议优先联系课时较低的家庭。",
      time: "今天",
      color: "#ffd33d",
    });
  }
  if (Number(dashboardStats.activeStudents || 0) > 0) {
    todos.push({
      title: isOwnScope ? "更新我的课堂反馈" : "检查教师课后反馈",
      description: `当前范围内有 ${dashboardStats.activeStudents} 名在读学员，保持课后反馈能提升续费稳定性。`,
      time: "本周",
      color: "#4f896f",
    });
  }
  if (!todos.length) {
    todos.push({
      title: isOwnScope ? "完善我的授课信息" : "完善全校运营数据",
      description: isOwnScope ? "当前账号暂无匹配课程或学员，可检查教师手机号与班级老师是否一致。" : "暂无紧急事项，可以继续维护课程、班级和招生线索。",
      time: "待处理",
      color: "#ff9f1c",
    });
  }
  return todos.slice(0, 4);
}

function effectiveDashboardTodos(generatedTodos) {
  const customTodos = dashboardStats.customTodos || [];
  return customTodos.length ? customTodos.map(item => ({
    title: item.title || "",
    description: item.description || "",
    time: item.time || item.time_label || "待处理",
    color: item.color || "#ff9f1c",
  })) : generatedTodos;
}

function todoDescription() {
  if ((dashboardStats.customTodos || []).length) return "当前显示你手动维护的个人待办";
  return dashboardStats.scope === "own" ? "围绕当前账号授课范围生成提醒" : "全校运营事项与跟进提醒";
}

function dashboardTodoEditor(todos) {
  const rows = (todos.length ? todos : [{ title: "", description: "", time: "待处理", color: "#ff9f1c" }])
    .map(dashboardTodoEditorRow)
    .join("");
  return `<form id="dashboardTodoForm" class="todo-editor-form">
    <div class="todo-editor-list">${rows}</div>
    <div class="todo-editor-actions">
      <button type="button" class="secondary-button add-dashboard-todo">${icon("plus")} 添加待办</button>
      <button type="button" class="secondary-button reset-dashboard-todos">恢复智能待办</button>
      <button type="submit" class="primary-button" id="saveDashboardTodos">保存待办</button>
    </div>
  </form>`;
}

function dashboardTodoEditorRow(todo = {}) {
  return `<div class="todo-editor-row">
    <input name="title" required maxlength="60" placeholder="待办标题" value="${escapeHtml(todo.title || "")}" />
    <input name="description" maxlength="160" placeholder="说明，例如：课后给家长反馈" value="${escapeHtml(todo.description || "")}" />
    <input name="time" maxlength="20" placeholder="时间" value="${escapeHtml(todo.time || todo.time_label || "待处理")}" />
    <input name="color" type="color" value="${escapeHtml(todo.color || "#ff9f1c")}" />
    <button type="button" class="table-action danger remove-dashboard-todo" title="删除待办" aria-label="删除待办">${icon("trash")}</button>
  </div>`;
}

function collectDashboardTodoForm(form) {
  return [...form.querySelectorAll(".todo-editor-row")].map(row => ({
    title: row.querySelector('input[name="title"]')?.value.trim() || "",
    description: row.querySelector('input[name="description"]')?.value.trim() || "",
    time: row.querySelector('input[name="time"]')?.value.trim() || "待处理",
    color: row.querySelector('input[name="color"]')?.value || "#ff9f1c",
  })).filter(item => item.title);
}

function dashboardInsight(recentClasses, attendanceRate) {
  const isOwnScope = dashboardStats.scope === "own";
  if (isOwnScope && !recentClasses.length) {
    return {
      label: "教学观察 · MY SCOPE",
      title: "当前账号还没有匹配到自己的近期课程。",
      description: "请确认教师名单里的手机号、账号手机号和班级任课教师是否对应，匹配后这里会自动显示个人教学提醒。",
    };
  }
  if (Number(dashboardStats.renewalStudents || 0) > 0) {
    return {
      label: isOwnScope ? "我的教学观察 · MY INSIGHT" : "教学观察 · WEEKLY INSIGHT",
      title: `${isOwnScope ? "我的" : "当前范围内"}待续费学员有 ${dashboardStats.renewalStudents} 名。`,
      description: "建议结合课堂表现、剩余课时和家长反馈安排回访，让续费沟通更自然。",
    };
  }
  if (Number(dashboardStats.todayAttendanceTotal || 0) > 0) {
    return {
      label: isOwnScope ? "我的教学观察 · ATTENDANCE" : "教学观察 · ATTENDANCE",
      title: `今日到课率 ${attendanceRate}%，点名数据已按当前账号范围统计。`,
      description: "如果有请假或缺席，建议课后补充备注，方便前台和家长端同步查看。",
    };
  }
  return {
    label: isOwnScope ? "我的教学观察 · MY INSIGHT" : "教学观察 · WEEKLY INSIGHT",
    title: `${isOwnScope ? "我的" : "当前范围内"}在读学员 ${dashboardStats.activeStudents || 0} 名，剩余课时 ${formatHours(dashboardStats.remainingHours)}。`,
    description: "可以从近期课程进入课表，检查排课、点名和课时记录是否完整。",
  };
}

function dashboardLeadFunnel() {
  const data = dashboardStats.leadConversion || {};
  const rows = [
    ["新增线索", Number(data.new || 0), "#ff9f1c"],
    ["已联系", Number(data.contacted || 0), "#ffb22e"],
    ["预约试听", Number(data.trialScheduled || 0), "#f47a12"],
    ["完成试听", Number(data.trialCompleted || 0), "#d7651d"],
    ["成功报名", Number(data.enrolled || 0), "#715b87"],
  ];
  const max = Math.max(...rows.map(row => row[1]), 1);
  return rows.map(([label, count, color]) => {
    const percent = count > 0 ? Math.max(8, Math.round(count / max * 100)) : 0;
    return funnelRow(label, count, percent, color);
  }).join("");
}

function dashboardDateLabel(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff > 1 && diff < 7) return `${diff} 天后`;
  return `${target.getMonth() + 1}/${target.getDate()}`;
}

function dashboardRecentClasses() {
  return (dashboardStats.recentClasses || [])
    .map(item => ({ ...item, nextDate: findNextClassDate(item) }))
    .filter(item => item.nextDate)
    .sort((a, b) => {
      const dateDiff = a.nextDate - b.nextDate;
      return dateDiff || String(a.start_time).localeCompare(String(b.start_time)) || Number(a.id) - Number(b.id);
    })
    .slice(0, 4);
}

function renderTeacherCourseOverview() {
  const overview = dashboardStats.teacherOverview || [];
  if (!["owner", "academic"].includes(currentUser?.role) || !overview.length) return "";
  return `<section class="panel teacher-overview-panel">
    <div class="panel-header">
      <div class="panel-title"><h2>教师课程总览</h2><p>${currentUser?.role === "owner" ? "校长可在这里看全体教师排课" : "教务可查看所有教师课程分布"}</p></div>
      <button class="text-button" data-go="catalog">管理班级 ${icon("arrow")}</button>
    </div>
    <div class="teacher-overview-list">
      ${overview.map(item => `<div class="teacher-overview-row" style="--teacher-color:${escapeHtml(item.color || "#ff9f1c")}">
        <span class="avatar">${escapeHtml((item.display_name || "师")[0])}</span>
        <div><strong>${escapeHtml(item.display_name)}</strong><small>${escapeHtml(item.specialty || "授课教师")}</small></div>
        <b>${Number(item.class_count || 0)} 班</b>
        <em>${Number(item.student_count || 0)} 学员</em>
      </div>`).join("")}
    </div>
  </section>`;
}

function classRow(item) {
  const courseName = item.course_name || item.name;
  const title = item.name || courseName;
  const startTime = item.start_time || item.time;
  const dateLabel = item.nextDate ? `${item.nextDate.getMonth() + 1}/${item.nextDate.getDate()}` : "";
  const durationLabel = item.duration ? `${item.duration} 分钟` : "";
  const roomLabel = item.room_name ? `${item.room_name} · ${item.room_code || ""}` : item.room;
  const teacherName = item.teacher_name || item.teacher || "";
  const teacherKey = (teacherName || "师")[0];
  const current = Number(item.current || 0);
  const capacity = Number(item.capacity || item.max || 1);
  const color = item.course_color || item.color || "#ff9f1c";
  return `<div class="class-row" style="--row-color:${escapeHtml(color)}" data-dashboard-class-id="${item.id || ""}" data-dashboard-course="${escapeHtml(courseName)}" data-dashboard-time="${escapeHtml(startTime)}" role="button" tabindex="0" aria-label="查看${escapeHtml(title)}的课表位置">
    <div class="class-time"><strong>${escapeHtml(startTime)}</strong><small>${escapeHtml(dateLabel || durationLabel)}</small></div>
    <div class="class-color"></div>
    <div class="class-name"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(roomLabel || courseName)} · ${escapeHtml(courseName)}</small></div>
    <div class="teacher"><span class="avatar">${escapeHtml(teacherKey)}</span>${escapeHtml(teacherName)}</div>
    <div class="capacity"><strong>${current} / ${capacity} 人</strong><div class="capacity-bar"><span style="width:${Math.min(100, current / capacity * 100)}%"></span></div></div>
    <button class="row-action dashboard-course-jump" data-dashboard-class-id="${item.id || ""}" data-dashboard-course="${escapeHtml(courseName)}" data-dashboard-time="${escapeHtml(startTime)}" title="查看课表位置" aria-label="查看${escapeHtml(title)}在课表中的位置">${icon("chevron")}</button>
  </div>`;
}

function findNextClassDate(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = 0; offset <= 370; offset += 1) {
    const candidate = addDays(today, offset);
    if (classOccursOnDate(item, candidate)) return candidate;
  }
  return null;
}

function findDashboardClass(courseName, startTime, classId = "") {
  if (classId) {
    const byId = catalog.classes.find(item => String(item.id) === String(classId));
    if (byId) return byId;
  }
  const normalizedName = String(courseName || "").trim();
  return catalog.classes.find(item => {
    const sameTime = !startTime || item.start_time === startTime;
    return sameTime && (item.course_name === normalizedName || item.name === normalizedName);
  }) || catalog.classes.find(item => item.course_name === normalizedName || item.name === normalizedName);
}

async function jumpToScheduleCourse(courseName, startTime, classId = "") {
  await loadCatalog();
  const item = findDashboardClass(courseName, startTime, classId);
  if (!item) {
    await renderPage("schedule");
    showToast(`没有找到「${courseName}」对应的班级`);
    return;
  }
  const nextDate = findNextClassDate(item);
  if (nextDate) {
    activeWeekStart = startOfWeek(nextDate);
    activeScheduleDay = weekdayIndexForDate(nextDate);
  }
  pendingScheduleFocusId = String(item.id);
  await renderPage("schedule");
}

function todoItem(title, desc, time, color) {
  return `<div class="todo-item" style="--todo-color:${escapeHtml(color)}"><span class="todo-dot"></span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(desc)}</p></div><span class="todo-time">${escapeHtml(time)}</span></div>`;
}

function funnelRow(label, count, percent, color) {
  return `<div class="funnel-row"><span>${escapeHtml(label)}</span><div class="funnel-bar" style="--bar-color:${escapeHtml(color)}"><span style="width:${Math.max(0, Math.min(100, Number(percent) || 0))}%"></span></div><b>${Number(count || 0)}</b></div>`;
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
            <button class="table-action bind-parent" data-id="${s.id}" title="绑定家长账号" aria-label="绑定 ${escapeHtml(s.name)} 的家长账号">${icon("users")}</button>
            <button class="table-action edit-student" data-id="${s.id}" title="编辑学员" aria-label="编辑 ${escapeHtml(s.name)}">${icon("edit")}</button>
            <button class="table-action danger delete-student" data-id="${s.id}" title="删除学员" aria-label="删除 ${escapeHtml(s.name)}">${icon("trash")}</button>
          </div>` : `<span class="readonly-note">只读</span>`}</td>
        </tr>`).join("")}</tbody>
      </table>` : `<div class="empty-state">没有找到匹配的学员</div>`}
    </div>`;
  document.querySelector("#studentSearch")?.addEventListener("input", e => renderStudents(e.target.value));
}

function renderCatalog() {
  const visibleClasses = visibleClassesForCurrentUser();
  const activeClasses = visibleClasses.filter(item => ["招生中", "进行中"].includes(item.status));
  const enrolled = new Set(visibleClasses.flatMap(item => item.students.map(student => student.id))).size;
  const canManageCatalog = can("catalog:write");
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>课程与班级管理</h2><p>${currentUser?.role === "teacher" ? "教师账号仅显示自己负责的班级" : "维护课程产品、开班信息和学员分班"}</p></div>
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
  const visibleClasses = visibleClassesForCurrentUser();
  if (!visibleClasses.length) return `<div class="empty-state">${currentUser?.role === "teacher" ? "当前教师账号还没有匹配到负责班级，请让校长检查教师名单中的姓名或手机号。" : "还没有班级"}</div>`;
  const canManageCatalog = can("catalog:write");
  const canManageRoster = can("roster:write");
  return `<div class="class-grid">${visibleClasses.map(item => {
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
  const scheduleClasses = visibleClassesForCurrentUser();
  const activeClasses = scheduleClasses
    .filter(item => classOccursOnDate(item, activeDate))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const weeklyOccurrences = weekDates.reduce(
    (sum, date) => sum + scheduleClasses.filter(item => classOccursOnDate(item, date)).length,
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
        ${activeClasses.length ? activeClasses.map(item => `<article class="schedule-event ${String(item.id) === pendingScheduleFocusId ? "schedule-event-focus" : ""}" data-class-id="${item.id}" style="--event-color:${escapeHtml(item.course_color)}">
          <span class="color-pill"></span>
          <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.start_time)}-${escapeHtml(classEndTime(item))} · ${escapeHtml(item.room_name)} ${escapeHtml(item.room_code)} · ${escapeHtml(item.course_name)} · ${escapeHtml(item.start_date)} 至 ${escapeHtml(item.end_date)}</small></div>
          <div class="schedule-meta"><b>${escapeHtml(item.teacher_name)}</b>${item.current}/${item.capacity} 人<br>
            ${can("hours:write") ? `<button class="text-button open-attendance" data-id="${item.id}">点名</button>` : ""}
            <button class="text-button manage-roster" data-id="${item.id}">花名册</button>
          </div>
        </article>`).join("") : `<div class="empty-state">这一天还没有排课，可以切换日期回溯/查看未来，或新建周期班级。</div>`}
      </div>
    </div>`;
  focusPendingScheduleEvent();
}

function focusPendingScheduleEvent() {
  if (!pendingScheduleFocusId) return;
  const targetId = pendingScheduleFocusId;
  window.setTimeout(() => {
    const eventCard = document.querySelector(`.schedule-event[data-class-id="${targetId}"]`);
    if (eventCard) {
      eventCard.scrollIntoView({ behavior: "smooth", block: "center" });
      eventCard.classList.add("schedule-event-focus");
      window.setTimeout(() => eventCard.classList.remove("schedule-event-focus"), 2200);
    }
    pendingScheduleFocusId = "";
  }, 120);
}

function renderAttendancePage() {
  const activeDate = currentWeekDates()[activeScheduleDay];
  const activeDateValue = toDateInputValue(activeDate);
  const classes = catalog.classes
    .filter(item => classOccursOnDate(item, activeDate))
    .filter(item => canManageClassAttendance(item))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const totalStudents = classes.reduce((sum, item) => sum + Number(item.current || 0), 0);
  pageContent.innerHTML = `
    <div class="section-toolbar">
      <div><h2>${formatFullDate(activeDate)} 点名</h2><p>${classes.length} 节课，${totalStudents} 名学员待点名；保存后自动生成课时流水</p></div>
      <div class="toolbar-actions schedule-tools">
        <button class="secondary-button attendance-prev-day">前一天</button>
        <input class="schedule-date-picker attendance-date-picker" type="date" value="${activeDateValue}" aria-label="选择点名日期" />
        <button class="secondary-button attendance-next-day">后一天</button>
        <button class="secondary-button attendance-today">今天</button>
      </div>
    </div>
    <div class="attendance-page-grid">
      ${classes.length ? classes.map(item => `<article class="attendance-class-card" style="--class-color:${escapeHtml(item.course_color)}">
        <div class="class-card-head">
          <div class="class-card-title"><span class="class-accent"></span><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.course_name)} · ${escapeHtml(item.start_time)}-${escapeHtml(classEndTime(item))}</p></div></div>
          <span class="tag" style="--tag-color:${classStatusColor(item.status)}">${escapeHtml(item.status)}</span>
        </div>
        <div class="class-details">
          <div class="class-detail"><span>授课教师</span><strong>${escapeHtml(item.teacher_name)}</strong></div>
          <div class="class-detail"><span>上课教室</span><strong>${escapeHtml(item.room_name)} · ${escapeHtml(item.room_code)}</strong></div>
          <div class="class-detail"><span>点名人数</span><strong>${item.current} / ${item.capacity} 人</strong></div>
          <div class="class-detail"><span>自动消课</span><strong>${formatHours(Number(item.duration || 0) / 60)} 课时/人</strong></div>
        </div>
        <div class="attendance-card-students">
          ${item.students.length ? item.students.slice(0, 6).map(student => `<span>${escapeHtml(student.name)}</span>`).join("") : `<span>暂无学员</span>`}
          ${item.students.length > 6 ? `<span>+${item.students.length - 6}</span>` : ""}
        </div>
        <button class="primary-button open-attendance" data-id="${item.id}" ${item.students.length ? "" : "disabled"}>${icon("check")} 开始点名</button>
      </article>`).join("") : `<div class="placeholder-page"><div>${icon("calendar")}<h2>这一天没有可点名课程</h2><p>可以切换日期，或先到「班级课表」确认课程安排。</p></div></div>`}
    </div>`;
}

function canManageClassAttendance(item) {
  if (!can("hours:write")) return false;
  if (["owner", "academic", "finance"].includes(currentUser?.role)) return true;
  const userName = String(currentUser?.name || "").trim();
  return item.teacher_name === userName;
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
        ${lead.stage === "待试听" ? `<button class="text-button schedule-trial" data-id="${lead.id}">预约试听</button>` : ""}
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

function renderTrials() {
  const upcoming = trials.filter(item => item.status === "待试听");
  const completed = trials.filter(item => item.status === "已试听");
  const converted = trials.filter(item => item.status === "已转正");
  pageContent.innerHTML = `
    <div class="hours-summary trial-summary">
      <div class="summary-card"><span>待试听</span><strong>${upcoming.length}</strong><span>需要准时提醒老师和家长</span></div>
      <div class="summary-card"><span>已试听待转化</span><strong>${completed.length}</strong><span>记录结果后继续报名跟进</span></div>
      <div class="summary-card"><span>已转正式</span><strong>${converted.length}</strong><span class="positive">已进入学员档案</span></div>
    </div>
    <div class="section-toolbar">
      <div><h2>试听课管理</h2><p>从待试听线索预约，试听后记录结果，并可一键转为正式学员</p></div>
      <div class="toolbar-actions">${can("leads:write") ? `<button class="primary-button add-trial">${icon("plus")} 新增试听</button>` : ""}</div>
    </div>
    <div class="trial-grid">
      ${trials.length ? trials.map(trialCard).join("") : `<div class="empty-state">还没有试听课。可以从“招生跟进”的待试听线索直接预约。</div>`}
    </div>`;
}

function trialCard(trial) {
  const canEdit = can("leads:write");
  const canConvert = can("students:write") && trial.status !== "已转正" && trial.status !== "已取消";
  return `<article class="trial-card" style="--trial-color:${escapeHtml(trial.teacher_color || "#ff9f1c")}">
    <div class="trial-card-head">
      <div>
        <span class="trial-date">${formatShortTime(trial.scheduled_at)}</span>
        <h3>${escapeHtml(trial.child_name)} · ${trial.age}岁</h3>
        <p>${escapeHtml(trial.course_interest || "待确认方向")} · ${trial.duration_minutes} 分钟</p>
      </div>
      <span class="tag" style="--tag-color:${trialStatusColor(trial.status)}">${escapeHtml(trial.status)}</span>
    </div>
    <div class="trial-details">
      <span>老师<strong>${escapeHtml(trial.teacher_name || "未分配")}</strong></span>
      <span>教室<strong>${escapeHtml(trial.room_name || "")} ${escapeHtml(trial.room_code || "")}</strong></span>
      <span>电话<strong>${escapeHtml(trial.phone)}</strong></span>
      <span>结果<strong>${escapeHtml(trial.result || "未填写")}</strong></span>
    </div>
    <p class="trial-note">${escapeHtml(trial.note || "暂无试听备注")}</p>
    <div class="trial-actions">
      ${canEdit ? `<button class="secondary-button edit-trial" data-id="${trial.id}">${icon("edit")} 编辑结果</button>` : ""}
      ${canConvert ? `<button class="primary-button convert-trial" data-id="${trial.id}">${icon("check")} 转正式学员</button>` : ""}
    </div>
  </article>`;
}

function trialStatusColor(status) {
  if (status === "已转正") return "#4f896f";
  if (status === "已试听") return "#715b87";
  if (status === "已取消") return "#8a827b";
  return "#ff9f1c";
}

function defaultTrialDateTime() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function normalizeDateTimeLocal(value) {
  return value ? String(value).replace(" ", "T").slice(0, 16) : defaultTrialDateTime();
}

function openTrialModal(trial = null, lead = null) {
  const form = document.querySelector("#trialForm");
  form.reset();
  form.elements.id.value = trial?.id || "";
  form.elements.lead_id.value = trial?.lead_id || lead?.id || "";
  document.querySelector("#trialTitle").textContent = trial ? "编辑试听课" : "预约试听课";
  document.querySelector("#trialEyebrow").textContent = lead ? `来自线索：${lead.name}` : "试听课管理";
  document.querySelector("#saveTrial").textContent = trial ? "保存修改" : "保存试听课";
  form.elements.teacher_id.innerHTML = catalog.teachers.map(teacher => `<option value="${teacher.id}">${escapeHtml(teacher.display_name)} · ${escapeHtml(teacher.specialty || "授课教师")}</option>`).join("");
  form.elements.room_id.innerHTML = catalog.rooms.map(room => `<option value="${room.id}">${escapeHtml(room.name)} ${escapeHtml(room.code)}（${room.capacity}人）</option>`).join("");
  form.elements.status.innerHTML = trialStatuses.map(status => `<option>${status}</option>`).join("");
  form.elements.result.innerHTML = trialResults.map(result => `<option>${result}</option>`).join("");
  form.elements.child_name.value = trial?.child_name || lead?.name || "";
  form.elements.age.value = trial?.age || lead?.age || "";
  form.elements.phone.value = trial?.phone || lead?.phone || "";
  form.elements.course_interest.value = trial?.course_interest || lead?.tag || "";
  form.elements.scheduled_at.value = normalizeDateTimeLocal(trial?.scheduled_at);
  form.elements.duration_minutes.value = trial?.duration_minutes || 60;
  form.elements.teacher_id.value = trial?.teacher_id || catalog.teachers[0]?.id || "";
  form.elements.room_id.value = trial?.room_id || catalog.rooms[0]?.id || "";
  form.elements.status.value = trial?.status || "待试听";
  form.elements.result.value = trial?.result || "未填写";
  form.elements.note.value = trial?.note || lead?.note || "";
  document.querySelector("#trialBackdrop").hidden = false;
  setTimeout(() => form.elements.child_name.focus(), 30);
}

function closeTrialModal() {
  document.querySelector("#trialBackdrop").hidden = true;
}

async function saveTrial(event) {
  event.preventDefault();
  if (!can("leads:write")) {
    showToast("当前角色不能修改试听课");
    return;
  }
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const trialId = data.id;
  delete data.id;
  data.age = Number(data.age);
  data.teacher_id = Number(data.teacher_id);
  data.room_id = Number(data.room_id);
  data.duration_minutes = Number(data.duration_minutes);
  const button = document.querySelector("#saveTrial");
  button.classList.add("button-loading");
  button.textContent = "保存中...";
  try {
    await api(trialId ? `/api/trials/${trialId}` : "/api/trials", {
      method: trialId ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    closeTrialModal();
    showToast(`试听课已${trialId ? "更新" : "预约"}`);
    await Promise.all([loadTrials(), loadLeads(), loadCatalog()]);
    if (activePage === "leads") renderLeads();
    else renderTrials();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = trialId ? "保存修改" : "保存试听课";
  }
}

async function convertTrial(trialId) {
  const trial = trials.find(item => item.id === trialId);
  if (!trial || !window.confirm(`确定将「${trial.child_name}」转为正式学员吗？`)) return;
  try {
    await api(`/api/trials/${trialId}/convert`, { method: "POST" });
    showToast(`${trial.child_name} 已转为正式学员`);
    await Promise.all([loadTrials(), loadLeads(), loadStudents(), loadCatalog()]);
    renderTrials();
  } catch (error) {
    showToast(error.message);
  }
}

function renderPayments() {
  const monthKey = toDateInputValue(new Date()).slice(0, 7);
  const paidThisMonth = payments
    .filter(item => String(item.paid_at || item.created_at).startsWith(monthKey) && item.payment_type !== "退费记录")
    .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
  const addedHoursThisMonth = payments
    .filter(item => String(item.paid_at || item.created_at).startsWith(monthKey))
    .reduce((sum, item) => sum + Number(item.hours_added || 0), 0);
  const renewalCount = payments.filter(item => item.payment_type === "续费").length;
  const canManagePayments = can("payments:write");
  const studentOptions = students
    .map(student => `<option value="${student.id}">${escapeHtml(student.name)} · ${escapeHtml(student.course)} · 剩余 ${formatHours(student.hours)} 课时</option>`)
    .join("");
  pageContent.innerHTML = `
    <div class="hours-summary">
      <div class="summary-card"><span>本月收款</span><strong>${formatMoney(paidThisMonth)}</strong><span>不含退费记录</span></div>
      <div class="summary-card"><span>本月新增课时</span><strong>${formatHours(addedHoursThisMonth)}</strong><span>保存后自动进入学员余额</span></div>
      <div class="summary-card"><span>续费记录</span><strong>${renewalCount}</strong><span>累计续费笔数</span></div>
    </div>
    <div class="section-toolbar"><div><h2>缴费与续费记录</h2><p>记录新报名、续费、补缴和退费；续费会自动增加课时并写入课时流水</p></div></div>
    ${canManagePayments ? `<section class="panel hours-form-panel">
      <div class="panel-header"><div class="panel-title"><h2>新增缴费 / 续费</h2><p>录入金额与新增课时，系统会自动更新学员剩余课时</p></div></div>
      <form id="paymentForm" class="hours-form payment-form">
        <label><span>学员</span><select name="student_id" required ${studentOptions ? "" : "disabled"}>${studentOptions || `<option>暂无学员</option>`}</select></label>
        <label><span>类型</span><select name="payment_type"><option>续费</option><option>新报名</option><option>补缴</option><option>退费记录</option></select></label>
        <label><span>缴费金额</span><input name="amount_paid" required type="number" min="0" step="1" placeholder="例如：4680" /></label>
        <label><span>新增课时</span><input name="hours_added" required type="number" min="0" step="0.5" placeholder="例如：24" /></label>
        <label><span>付款方式</span><select name="payment_method"><option>微信</option><option>支付宝</option><option>现金</option><option>银行卡</option><option>其他</option></select></label>
        <label><span>缴费时间</span><input name="paid_at" type="datetime-local" value="${defaultDateTimeLocal()}" /></label>
        <label class="full"><span>备注</span><input name="note" placeholder="例如：暑期班续费 24 课时 / 老带新优惠后金额" /></label>
        <div class="hours-form-actions"><button type="submit" class="primary-button" id="savePayment" ${studentOptions ? "" : "disabled"}>保存缴费记录</button></div>
      </form>
    </section>` : `<div class="roster-readonly">当前角色只能查看缴费记录，不能新增收款。</div>`}
    <div class="table-card"><table class="data-table"><thead><tr><th>缴费时间</th><th>学员</th><th>类型</th><th>金额</th><th>新增课时</th><th>方式</th><th>操作人 / 备注</th></tr></thead>
      <tbody>${payments.length ? payments.map(item => `<tr>
        <td>${formatShortTime(item.paid_at || item.created_at)}</td>
        <td><strong>${escapeHtml(item.student_name)}</strong><br><small>${escapeHtml(item.course_name || "未分配课程")} · 余额 ${formatHours(item.balance_after)} 课时</small></td>
        <td><span class="tag" style="--tag-color:${item.payment_type === "退费记录" ? "#8a827b" : "#ff9f1c"}">${escapeHtml(item.payment_type)}</span></td>
        <td><strong>${formatMoney(item.amount_paid)}</strong></td>
        <td><strong class="${Number(item.hours_added || 0) ? "positive" : ""}">+${formatHours(item.hours_added)}</strong></td>
        <td>${escapeHtml(item.payment_method)}</td>
        <td>${escapeHtml(item.operator_name || "系统")}<br><small>${escapeHtml(item.note || "无备注")}</small></td>
      </tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">还没有缴费记录，先新增一笔续费。</div></td></tr>`}</tbody>
    </table></div>`;
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
          <div class="account-default-password"><strong>初始密码：000000</strong><span>新员工首次登录后可在个人设置中修改密码。</span></div>
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
            <td><div class="student-cell" style="--student-color:${escapeHtml(user.avatarColor || "#ff9f1c")}">${avatarMarkup(user)}<div><strong>${escapeHtml(user.name)}</strong><small>ID ${user.id}</small></div></div></td>
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

function renderAccount() {
  const teacherProfiles = currentUser?.role === "teacher" ? currentTeacherProfiles() : [];
  const teacherProfile = teacherProfiles[0];
  pageContent.innerHTML = `
    <div class="account-settings-grid">
      <section class="panel account-profile-card">
        <div class="panel-header">
          <div class="panel-title"><h2>个人资料</h2><p>修改自己的登录手机号、显示名称和头像样式</p></div>
        </div>
        <form id="profileForm" class="account-form">
          <div class="profile-preview">
            ${avatarMarkup(currentUser, "large-avatar")}
            <div><strong>${escapeHtml(currentUser.name)}</strong><small>${escapeHtml(currentUser.roleLabel)} · ${escapeHtml(currentUser.phone)}</small></div>
          </div>
          <input type="hidden" name="avatar_image" value="${escapeHtml(currentUser.avatarImage || "")}" />
          <label class="full"><span>上传头像图片</span><input name="avatar_file" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          <div class="avatar-upload-actions">
            <button type="button" class="secondary-button remove-avatar-image" ${currentUser.avatarImage ? "" : "disabled"}>移除图片头像</button>
            <small>支持 JPG、PNG、WebP；会自动压缩后保存。</small>
          </div>
          <label><span>显示姓名</span><input name="name" required value="${escapeHtml(currentUser.name)}" /></label>
          <label><span>登录手机号</span><input name="phone" required value="${escapeHtml(currentUser.phone)}" /></label>
          <label><span>文字头像兜底</span><input name="avatar_text" maxlength="2" value="${escapeHtml(currentUser.avatarText || currentUser.name[0] || "员")}" placeholder="1-2 个字" /></label>
          <label class="color-field"><span>头像颜色</span><input name="avatar_color" type="color" value="${escapeHtml(currentUser.avatarColor || "#ff9f1c")}" /></label>
          <div class="account-form-actions"><button type="submit" class="primary-button" id="saveProfile">保存个人资料</button></div>
        </form>
      </section>
      ${currentUser?.role === "teacher" ? `<section class="panel account-profile-card">
        <div class="panel-header">
          <div class="panel-title"><h2>我的教师简介</h2><p>${teacherProfile ? "会同步到教师名单、课时与课程展示中" : "未匹配到教师档案"}</p></div>
        </div>
        ${teacherProfile ? `<form id="teacherProfileForm" class="account-form">
          <div class="profile-preview">
            <span class="avatar avatar-manager large-avatar" style="--profile-color:${escapeHtml(teacherProfile.color || "#ff9f1c")}">${escapeHtml((teacherProfile.display_name || teacherProfile.name || "师")[0])}</span>
            <div><strong>${escapeHtml(teacherProfile.display_name || teacherProfile.name)}</strong><small>${escapeHtml(teacherProfile.phone || currentUser.phone)} · 教师档案</small></div>
          </div>
          <label class="full"><span>教师简介 / 擅长方向</span><textarea name="specialty" rows="5" maxlength="300" placeholder="例如：少儿主持、朗诵表达、赛事辅导；也可以写教学风格和获奖经历。">${escapeHtml(teacherProfile.specialty || "")}</textarea></label>
          <div class="account-form-actions"><button type="submit" class="primary-button" id="saveTeacherProfile">保存教师简介</button></div>
        </form>` : `<div class="account-tips">
          <div><strong>没有找到对应教师</strong><span>请让校长在“课程与班级 - 教师名单”里把教师姓名或手机号改成和当前账号一致。</span></div>
        </div>`}
      </section>` : ""}
      <section class="panel account-profile-card">
        <div class="panel-header">
          <div class="panel-title"><h2>修改密码</h2><p>建议首次登录后立即把初始密码 000000 改成自己的密码</p></div>
        </div>
        <form id="passwordForm" class="account-form">
          <label><span>当前密码</span><input name="current_password" type="password" autocomplete="current-password" required /></label>
          <label><span>新密码</span><input name="new_password" type="password" autocomplete="new-password" minlength="6" required placeholder="至少 6 位" /></label>
          <label><span>确认新密码</span><input name="confirm_password" type="password" autocomplete="new-password" minlength="6" required /></label>
          <div class="account-form-actions"><button type="submit" class="primary-button" id="savePassword">更新密码</button></div>
        </form>
      </section>
      <section class="panel account-tips-card">
        <div class="panel-header">
          <div class="panel-title"><h2>实用提醒</h2><p>这些小功能能减少日常使用时的麻烦</p></div>
        </div>
        <div class="account-tips">
          <div><strong>手机号就是登录账号</strong><span>如果更换手机号，下次登录请使用新手机号。</span></div>
          <div><strong>头像会同步到左下角</strong><span>可以用姓名首字、岗位简称或昵称，方便多人共用设备时识别。</span></div>
          <div><strong>忘记密码</strong><span>请让校长在“系统设置”里编辑员工账号并重置密码，或先临时创建新账号。</span></div>
        </div>
      </section>
    </div>`;
}

function permissionSummary(role) {
  return {
    owner: "全功能，含员工账号与财务管理",
    academic: "学员、课程、班级、缴费与教务",
    teacher: "课表、学员与教学中心查看",
    sales: "招生跟进与学员录入",
    finance: "缴费续费、课时与学员信息",
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
    if (page === "account") {
      if (currentUser?.role === "teacher") await loadCatalog();
      renderAccount();
    }
    if (page === "schedule") {
      await Promise.all([loadCatalog(), loadStudents()]);
      renderSchedule();
    }
    if (page === "attendance") {
      await Promise.all([loadCatalog(), loadStudents()]);
      renderAttendancePage();
    }
    if (page === "leads") {
      await loadLeads();
      renderLeads();
    }
    if (page === "trials") {
      await Promise.all([loadTrials(), loadLeads(), loadCatalog()]);
      renderTrials();
    }
    if (page === "payments") {
      await Promise.all([loadStudents(), loadPayments()]);
      renderPayments();
    }
    if (page === "hours") {
      await Promise.all([loadStudents(), loadCatalog(), loadHourTransactions()]);
      renderHours();
    }
  } catch (error) {
    renderConnectionError(error.message);
  }
  if (page === "teaching") renderPlaceholder(page);
  animatePageContent();
  document.querySelector(".sidebar").classList.remove("open");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function formatHours(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });
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

function animatePageContent() {
  pageContent.classList.remove("page-enter");
  void pageContent.offsetWidth;
  pageContent.classList.add("page-enter");
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

function openParentBindModal(student) {
  const form = document.querySelector("#parentBindForm");
  const codeBox = document.querySelector("#parentBindCodeBox");
  form.reset();
  form.elements.student_id.value = student.id;
  form.elements.name.value = student.parent || "";
  form.elements.phone.value = student.phone || "";
  form.elements.relation.value = "家长";
  document.querySelector("#parentBindCode").textContent = "--------";
  document.querySelector("#parentBindCodeTip").textContent = "请让家长在小程序微信登录后输入此绑定码完成孩子绑定。";
  if (codeBox) codeBox.hidden = true;
  document.querySelector("#parentBindTitle").textContent = `绑定 ${student.name} 的家长账号`;
  document.querySelector("#parentBindEyebrow").textContent = "家长端登录";
  document.querySelector("#parentBindBackdrop").hidden = false;
  setTimeout(() => form.elements.phone.focus(), 30);
}

function closeParentBindModal() {
  document.querySelector("#parentBindBackdrop").hidden = true;
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

async function openAttendance(classId) {
  const item = catalog.classes.find(entry => entry.id === classId);
  if (!item) return;
  const lessonDate = toDateInputValue(currentWeekDates()[activeScheduleDay]);
  const lessonHours = Number(item.duration || 0) / 60;
  let existing = { records: [] };
  try {
    existing = await api(`/api/classes/${classId}/attendance?date=${encodeURIComponent(lessonDate)}`);
  } catch (error) {
    showToast(error.message);
    return;
  }
  const existingMap = new Map(existing.records.map(record => [Number(record.student_id), record]));
  const form = document.querySelector("#attendanceForm");
  form.elements.class_id.value = classId;
  form.elements.lesson_date.value = lessonDate;
  document.querySelector("#attendanceTitle").textContent = `${item.name} · ${lessonDate}`;
  document.querySelector("#attendanceEyebrow").textContent = `每位到课学员自动消课 ${formatHours(lessonHours)} 课时`;
  document.querySelector("#attendanceContent").innerHTML = `
    <div class="attendance-list">
      ${item.students.length ? item.students.map(student => {
        const record = existingMap.get(student.id);
        const status = record?.status || "present";
        return `<div class="attendance-row" data-student-id="${student.id}">
          <div class="attendance-person">
            <span class="avatar" style="--student-color:${escapeHtml(student.color)}">${escapeHtml(student.name[0])}</span>
            <div><strong>${escapeHtml(student.name)}</strong><small>剩余 ${formatHours(student.hours)} 课时 · ${escapeHtml(student.course)}</small></div>
          </div>
          <div class="attendance-statuses">
            ${[["present", "到课"], ["leave", "请假"], ["absent", "缺勤"]].map(([value, label]) => `<label><input type="radio" name="status_${student.id}" value="${value}" ${status === value ? "checked" : ""} />${label}</label>`).join("")}
          </div>
          <input name="note_${student.id}" placeholder="备注，可选" value="${escapeHtml(record?.note || "")}" />
        </div>`;
      }).join("") : `<div class="roster-empty">这个班级还没有学员，请先加入花名册。</div>`}
    </div>`;
  document.querySelector("#saveAttendance").disabled = !item.students.length;
  document.querySelector("#attendanceBackdrop").hidden = false;
}

function closeAttendance() {
  document.querySelector("#attendanceBackdrop").hidden = true;
}

document.addEventListener("click", async event => {
  const nav = event.target.closest(".nav-item");
  if (nav && canOpenPage(nav.dataset.page)) renderPage(nav.dataset.page);

  const profile = event.target.closest(".profile");
  if (profile && !event.target.closest("#logoutButton") && canOpenPage("account")) renderPage("account");

  const removeAvatar = event.target.closest(".remove-avatar-image");
  if (removeAvatar) {
    const form = document.querySelector("#profileForm");
    if (form) {
      form.elements.avatar_image.value = "";
      form.elements.avatar_file.value = "";
      const preview = document.querySelector(".profile-preview .avatar");
      preview.textContent = form.elements.avatar_text.value || currentUser.name[0] || "员";
      removeAvatar.disabled = true;
      showToast("图片头像已移除，保存后生效");
    }
  }

  const dashboardCourse = event.target.closest(".dashboard-course-jump, .class-row[data-dashboard-course]");
  if (dashboardCourse) {
    await jumpToScheduleCourse(dashboardCourse.dataset.dashboardCourse, dashboardCourse.dataset.dashboardTime, dashboardCourse.dataset.dashboardClassId);
    return;
  }

  const go = event.target.closest("[data-go]");
  if (go && !event.target.closest(".checkin")) renderPage(go.dataset.go);

  const checkin = event.target.closest(".checkin");
  if (checkin) showToast(`请到「班级课表」选择日期后为「${checkin.dataset.class}」点名`);

  const call = event.target.closest("[data-call]");
  if (call) showToast(`已记录对 ${call.dataset.call} 的电话跟进`);

  const scheduleDay = event.target.closest("[data-schedule-day]");
  if (scheduleDay) {
    activeScheduleDay = Number(scheduleDay.dataset.scheduleDay);
    renderSchedule();
  }

  if (event.target.closest(".attendance-prev-day")) {
    const current = currentWeekDates()[activeScheduleDay];
    const next = addDays(current, -1);
    activeWeekStart = startOfWeek(next);
    activeScheduleDay = weekdayIndexForDate(next);
    renderAttendancePage();
  }

  if (event.target.closest(".attendance-next-day")) {
    const current = currentWeekDates()[activeScheduleDay];
    const next = addDays(current, 1);
    activeWeekStart = startOfWeek(next);
    activeScheduleDay = weekdayIndexForDate(next);
    renderAttendancePage();
  }

  if (event.target.closest(".attendance-today")) {
    activeWeekStart = startOfWeek(new Date());
    activeScheduleDay = todayScheduleIndex();
    renderAttendancePage();
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

  const bindParent = event.target.closest(".bind-parent");
  if (bindParent) {
    const student = students.find(item => item.id === Number(bindParent.dataset.id));
    if (student) openParentBindModal(student);
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

  const attendance = event.target.closest(".open-attendance");
  if (attendance) openAttendance(Number(attendance.dataset.id));

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

  const scheduleTrial = event.target.closest(".schedule-trial");
  if (scheduleTrial) {
    const lead = leads.find(item => item.id === Number(scheduleTrial.dataset.id));
    if (lead) {
      if (!catalog.teachers.length || !catalog.rooms.length) await loadCatalog();
      openTrialModal(null, lead);
    }
  }

  if (event.target.closest(".add-trial") && can("leads:write")) {
    if (!catalog.teachers.length || !catalog.rooms.length) await loadCatalog();
    openTrialModal();
  }

  const editTrial = event.target.closest(".edit-trial");
  if (editTrial) {
    const trial = trials.find(item => item.id === Number(editTrial.dataset.id));
    if (trial) openTrialModal(trial);
  }

  const convertTrialButton = event.target.closest(".convert-trial");
  if (convertTrialButton) convertTrial(Number(convertTrialButton.dataset.id));

  const enroll = event.target.closest(".enroll-student");
  if (enroll) enrollStudent(Number(enroll.dataset.id));

  const unenroll = event.target.closest(".unenroll-student");
  if (unenroll) unenrollStudent(Number(unenroll.dataset.classId), Number(unenroll.dataset.studentId));

  const editUser = event.target.closest(".edit-user");
  if (editUser) fillUserForm(Number(editUser.dataset.id));

  const deleteUserButton = event.target.closest(".delete-user");
  if (deleteUserButton) deleteUser(Number(deleteUserButton.dataset.id));

  if (event.target.closest(".cancel-user-edit")) resetUserForm();

  if (event.target.closest(".edit-dashboard-todos")) {
    dashboardTodoEditing = !dashboardTodoEditing;
    renderDashboard();
  }

  if (event.target.closest(".add-dashboard-todo")) {
    const list = document.querySelector(".todo-editor-list");
    list?.insertAdjacentHTML("beforeend", dashboardTodoEditorRow({
      title: "",
      description: "",
      time: "待处理",
      color: COLORS_FOR_TODO_PICKER[list?.querySelectorAll(".todo-editor-row").length % COLORS_FOR_TODO_PICKER.length] || "#ff9f1c",
    }));
  }

  const removeTodo = event.target.closest(".remove-dashboard-todo");
  if (removeTodo) {
    const rows = document.querySelectorAll(".todo-editor-row");
    if (rows.length <= 1) {
      showToast("至少保留一条待办，或使用“恢复智能待办”");
      return;
    }
    removeTodo.closest(".todo-editor-row")?.remove();
  }

  if (event.target.closest(".reset-dashboard-todos")) {
    try {
      await api("/api/me/todos", {
        method: "PUT",
        body: JSON.stringify({ todos: [] }),
      });
      dashboardTodoEditing = false;
      showToast("已恢复智能待办");
      await loadDashboardStats();
      renderDashboard();
    } catch (error) {
      showToast(error.message);
    }
  }
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
document.querySelector("#closeParentBind").addEventListener("click", closeParentBindModal);
document.querySelector("#cancelParentBind").addEventListener("click", closeParentBindModal);
document.querySelector("#parentBindBackdrop").addEventListener("click", event => {
  if (event.target.id === "parentBindBackdrop") closeParentBindModal();
});
document.querySelector("#closeRoster").addEventListener("click", closeRoster);
document.querySelector("#rosterBackdrop").addEventListener("click", event => {
  if (event.target.id === "rosterBackdrop") closeRoster();
});
document.querySelector("#closeAttendance").addEventListener("click", closeAttendance);
document.querySelector("#cancelAttendance").addEventListener("click", closeAttendance);
document.querySelector("#attendanceBackdrop").addEventListener("click", event => {
  if (event.target.id === "attendanceBackdrop") closeAttendance();
});
document.querySelector("#closeLead").addEventListener("click", closeLeadModal);
document.querySelector("#cancelLead").addEventListener("click", closeLeadModal);
document.querySelector("#leadBackdrop").addEventListener("click", event => {
  if (event.target.id === "leadBackdrop") closeLeadModal();
});
document.querySelector("#closeTrial").addEventListener("click", closeTrialModal);
document.querySelector("#cancelTrial").addEventListener("click", closeTrialModal);
document.querySelector("#trialBackdrop").addEventListener("click", event => {
  if (event.target.id === "trialBackdrop") closeTrialModal();
});
document.querySelector("#loginForm").addEventListener("submit", handleLogin);
document.querySelector("#logoutButton").addEventListener("click", logout);
document.querySelector("#parentLogout").addEventListener("click", logout);

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

document.querySelector("#parentBindForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!can("students:write")) {
    showToast("当前角色不能绑定家长账号");
    return;
  }
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  data.student_id = Number(data.student_id);
  const button = document.querySelector("#saveParentBind");
  button.classList.add("button-loading");
  button.textContent = "绑定中...";
  try {
    const result = await api("/api/parent/bind", {
      method: "POST",
      body: JSON.stringify(data),
    });
    closeParentBindModal();
    showToast(`家长账号已绑定：${result.parent.phone} / 初始密码 000000`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = "保存绑定";
  }
});

document.querySelector("#generateParentBindCode").addEventListener("click", async event => {
  if (!can("students:write")) {
    showToast("当前角色不能生成家长绑定码");
    return;
  }
  const button = event.currentTarget;
  const form = document.querySelector("#parentBindForm");
  const studentId = Number(form.elements.student_id.value);
  const relation = form.elements.relation.value || "家长";
  if (!studentId) {
    showToast("请先选择学员");
    return;
  }
  button.classList.add("button-loading");
  button.textContent = "生成中...";
  try {
    const result = await api("/api/parent/binding-code", {
      method: "POST",
      body: JSON.stringify({ student_id: studentId, relation }),
    });
    document.querySelector("#parentBindCode").textContent = result.code;
    document.querySelector("#parentBindCodeTip").textContent = `${result.student.name} 的微信绑定码，有效期至 ${formatParentDate(result.expiresAt)}。`;
    document.querySelector("#parentBindCodeBox").hidden = false;
    showToast(`微信绑定码已生成：${result.code}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("button-loading");
    button.textContent = "生成微信绑定码";
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
document.querySelector("#trialForm").addEventListener("submit", saveTrial);

document.addEventListener("submit", async event => {
  if (event.target.id === "attendanceForm") {
    event.preventDefault();
    const form = event.target;
    const classId = Number(form.elements.class_id.value);
    const item = catalog.classes.find(entry => entry.id === classId);
    if (!item) return;
    const records = item.students.map(student => ({
      student_id: student.id,
      status: form.querySelector(`input[name="status_${student.id}"]:checked`)?.value || "present",
      note: form.elements[`note_${student.id}`]?.value || "",
    }));
    const button = document.querySelector("#saveAttendance");
    button.classList.add("button-loading");
    button.textContent = "保存中...";
    try {
      await api(`/api/classes/${classId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ lesson_date: form.elements.lesson_date.value, records }),
      });
      closeAttendance();
      showToast("点名已保存，课时已自动处理");
      await Promise.all([loadCatalog(), loadStudents(), loadHourTransactions()]);
      if (activePage === "attendance") renderAttendancePage();
      else renderSchedule();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "保存点名并自动消课";
    }
    return;
  }
  if (event.target.id === "profileForm") {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const button = document.querySelector("#saveProfile");
    button.classList.add("button-loading");
    button.textContent = "保存中...";
    try {
      const result = await api("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      currentUser = result.user;
      applyRoleUi();
      showToast("个人资料已更新");
      renderAccount();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "保存个人资料";
    }
    return;
  }
  if (event.target.id === "teacherProfileForm") {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const button = document.querySelector("#saveTeacherProfile");
    button.classList.add("button-loading");
    button.textContent = "保存中...";
    try {
      await api("/api/me/teacher-profile", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      await loadCatalog();
      showToast("教师简介已更新");
      renderAccount();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "保存教师简介";
    }
    return;
  }
  if (event.target.id === "dashboardTodoForm") {
    event.preventDefault();
    const form = event.target;
    const todos = collectDashboardTodoForm(form);
    if (!todos.length) {
      showToast("请至少填写一条待办标题，或点击恢复智能待办");
      return;
    }
    const button = document.querySelector("#saveDashboardTodos");
    button.classList.add("button-loading");
    button.textContent = "保存中...";
    try {
      const result = await api("/api/me/todos", {
        method: "PUT",
        body: JSON.stringify({ todos }),
      });
      dashboardStats.customTodos = result.todos || todos;
      dashboardTodoEditing = false;
      showToast("我的待办已保存");
      renderDashboard();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "保存待办";
    }
    return;
  }
  if (event.target.id === "passwordForm") {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const button = document.querySelector("#savePassword");
    button.classList.add("button-loading");
    button.textContent = "更新中...";
    try {
      await api("/api/me/password", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      form.reset();
      showToast("密码已更新，请牢记新密码");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "更新密码";
    }
    return;
  }
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
  if (event.target.id === "paymentForm") {
    event.preventDefault();
    if (!can("payments:write")) {
      showToast("当前角色不能新增缴费记录");
      return;
    }
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    data.student_id = Number(data.student_id);
    data.amount_paid = Number(data.amount_paid);
    data.hours_added = Number(data.hours_added);
    const button = document.querySelector("#savePayment");
    button.classList.add("button-loading");
    button.textContent = "保存中...";
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify(data),
      });
      showToast("缴费记录已保存，课时已自动增加");
      await Promise.all([loadStudents(), loadPayments(), loadHourTransactions()]);
      renderPayments();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.classList.remove("button-loading");
      button.textContent = "保存缴费记录";
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
  if (event.target.matches(".attendance-date-picker")) {
    const pickedDate = dateFromInput(event.target.value);
    activeWeekStart = startOfWeek(pickedDate);
    activeScheduleDay = weekdayIndexForDate(pickedDate);
    renderAttendancePage();
    return;
  }
  if (event.target.matches('input[name="avatar_file"]')) {
    handleAvatarFile(event.target);
    return;
  }
  if (!event.target.matches(".schedule-date-picker")) return;
  const pickedDate = dateFromInput(event.target.value);
  activeWeekStart = startOfWeek(pickedDate);
  activeScheduleDay = weekdayIndexForDate(pickedDate);
  renderSchedule();
});

async function handleAvatarFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    showToast("头像仅支持 JPG、PNG 或 WebP");
    input.value = "";
    return;
  }
  try {
    const dataUrl = await compressAvatarImage(file);
    document.querySelector('#profileForm input[name="avatar_image"]').value = dataUrl;
    const preview = document.querySelector(".profile-preview .avatar");
    preview.innerHTML = `<img src="${dataUrl}" alt="头像预览" />`;
    document.querySelector(".remove-avatar-image").disabled = false;
    showToast("头像已预览，保存后生效");
  } catch (error) {
    showToast(error.message);
    input.value = "";
  }
}

function compressAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片格式无法识别"));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        const minSide = Math.min(image.width, image.height);
        const sx = (image.width - minSide) / 2;
        const sy = (image.height - minSide) / 2;
        context.drawImage(image, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#globalSearch").focus();
  }
  const dashboardCourseAction = event.target.closest?.(".class-row[data-dashboard-course]");
  if (dashboardCourseAction && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    jumpToScheduleCourse(dashboardCourseAction.dataset.dashboardCourse, dashboardCourseAction.dataset.dashboardTime, dashboardCourseAction.dataset.dashboardClassId);
    return;
  }
  const jumpAction = event.target.closest?.(".metric-card[data-go]");
  if (jumpAction && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    renderPage(jumpAction.dataset.go);
  }
  if (event.key === "Escape") {
    closeModal();
    closeManagement();
    closeParentBindModal();
    closeRoster();
    closeAttendance();
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
