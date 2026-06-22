# 芭芭鸭语言艺术培训中心教培系统 MVP

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/changyitian000421-ship-it/babaya)

芭芭鸭语言艺术培训中心管理端第一版，覆盖：

- 经营工作台
- SQLite 本地持久化数据库
- 学员档案、搜索、新增、编辑和删除
- 课程产品新增、编辑、状态和价格管理
- 教师名单新增、编辑和删除
- 教室名称、编号和容量新增、编辑和删除
- 班级创建、教师教室配置、班额校验
- 班级花名册与学员分班
- 班级课表
- 招生跟进看板
- 课时流水
- 桌面端与移动端适配

## 本地运行

### 推荐方式

在 macOS 中双击 `start.command`，系统会自动启动服务并打开浏览器。

### 命令行方式

项目不需要安装第三方依赖，运行：

```bash
python3 server.py
```

然后访问 `http://127.0.0.1:4173`。

请通过这个地址使用系统，不要直接打开 `index.html`。终端窗口关闭后，服务会停止；已保存的数据不会丢失。

## 默认登录账号

员工统一使用手机号登录。第一版内置以下试用账号：

- 校长 / 管理员：`13800000001` / `admin123`
- 教务前台：`13800000002` / `jiaowu123`
- 授课教师：`13800000003` / `teacher123`
- 招生顾问：`13800000004` / `sales123`
- 财务：`13800000005` / `finance123`

只有校长 / 管理员可以进入系统设置，为员工新增账号并分配角色。

## 文件

- `index.html`：页面结构与图标
- `styles.css`：视觉系统与响应式布局
- `app.js`：页面交互与 API 调用
- `server.py`：静态页面服务、数据接口与业务校验
- `data/shengdong.db`：自动创建的 SQLite 数据库
- `start.command`：macOS 快速启动脚本
- `render.yaml`：Render 部署蓝图

## 部署到 GitHub 和 Render

### 1. 推送到 GitHub

在 GitHub 新建一个空仓库，然后把仓库地址设为本项目的远程地址：

```bash
git remote add origin git@github.com:你的用户名/你的仓库名.git
git push -u origin main
```

如果使用 HTTPS 地址，也可以把第二行前的远程地址改成 GitHub 页面提供的 HTTPS 仓库地址。

### 2. 在 Render 部署

Render 可以直接读取本项目的 `render.yaml`：

1. 登录 Render，选择 `New +` -> `Blueprint`。
2. 连接刚推送到 GitHub 的仓库。
3. Render 会识别 `render.yaml`，创建名为 `shengdong-training-system` 的 Web Service。
4. 部署完成后访问 Render 提供的公开网址。

也可以手动创建 Web Service：

- Runtime：`Python`
- Build Command：`pip install -r requirements.txt && python -m py_compile server.py`
- Start Command：`python server.py`
- Environment Variables：
  - `HOST=0.0.0.0`
  - `DATA_DIR=/tmp/shengdong-data`

当前 Render 免费部署适合演示和试用，SQLite 数据会保存在 Render 的临时文件系统中，服务重启或重新部署后可能丢失。正式运营建议改用 Render Disk 或 PostgreSQL。

## 接入 PostgreSQL

系统现在支持三种数据库模式：

- 未配置 `DATABASE_URL`：默认使用本地 SQLite，适合开发和本机试用
- 已配置 `DATABASE_URL`：自动使用 PostgreSQL，适合 Render 正式部署
- 已配置 `TURSO_DATABASE_URL`：自动使用 Turso / libSQL，适合免费云端试用

在 Render 中接入 PostgreSQL：

1. 在 Render Dashboard 新建 PostgreSQL 数据库。
2. 复制数据库的 `Internal Database URL` 或 `External Database URL`。
3. 打开本项目的 Web Service，进入 `Environment`。
4. 新增环境变量：

```text
DATABASE_URL=postgresql://...
```

5. 重新部署 Web Service。

部署启动时，系统会自动创建表结构和默认试用账号。正式使用前，请用校长账号登录后，在系统设置里创建真实员工账号，并停用或修改默认密码。

本地如果也想连接 PostgreSQL，可以临时运行：

```bash
export DATABASE_URL="postgresql://用户名:密码@localhost:5432/shengdong"
python3 server.py
```

## 接入 Turso

Turso 是云端 SQLite / libSQL，迁移成本比 PostgreSQL 更低。Render 上推荐用 Turso 免费方案试运行：

1. 注册 Turso 并创建数据库。
2. 复制数据库地址，通常形如：

```text
libsql://你的数据库.turso.io
```

3. 创建数据库访问 token。
4. 打开 Render Web Service，进入 `Environment`，添加：

```text
TURSO_DATABASE_URL=libsql://你的数据库.turso.io
TURSO_AUTH_TOKEN=你的 token
```

5. 重新部署 Web Service。

系统会优先使用 Turso；如果没有 Turso 环境变量，再使用 PostgreSQL；都没有时使用本地 SQLite。你可以直接填写 Turso 提供的 `libsql://` 地址，服务会自动使用 HTTP 连接。启动后访问 `/api/health`，返回的 `database` 字段会显示当前数据库类型。

## 当前数据接口

- `GET /api/health`：服务健康检查
- `GET /api/dashboard`：工作台实时统计
- `GET /api/students`：获取或搜索学员
- `POST /api/students`：新增学员
- `PUT /api/students/:id`：修改学员
- `DELETE /api/students/:id`：删除学员
- `GET /api/catalog`：课程、班级、教师、教室与花名册
- `POST/PUT/DELETE /api/courses`：课程产品管理
- `POST/PUT/DELETE /api/classes`：班级管理
- `POST/PUT/DELETE /api/teachers`：教师名单管理
- `POST/PUT/DELETE /api/rooms`：教室资料管理
- `POST/DELETE /api/classes/:id/students`：学员分班管理

当前数据库适合单校区试用。后续部署到云端时，可以保持前端接口不变，将 SQLite 迁移到 MySQL 或 PostgreSQL。
