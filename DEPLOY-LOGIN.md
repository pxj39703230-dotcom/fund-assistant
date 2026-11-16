# 登录功能部署说明

## 功能概述

已为基金助手添加完整的用户登录和数据隔离功能：

- ✅ JWT 认证系统
- ✅ 两个固定账号：`pxj` 和 `sgw`
- ✅ 密码：`pxj123` 和 `sgw123`
- ✅ 数据完全隔离，每个用户只能看到自己的持仓
- ✅ 登录页面和自动跳转
- ✅ Token 有效期 7 天

## 本地测试

已完成本地数据库初始化，可直接启动服务测试：

```bash
npm start
```

访问 http://localhost:3000/login.html 登录即可。

## Render 部署（重要！）

推送到 GitHub 后，Render 会自动部署。**部署成功后需要执行一次初始化脚本**：

### 步骤 1：等待部署完成

在 Render Dashboard 中查看部署日志，确认部署成功（显示 "Your service is live"）。

### 步骤 2：执行初始化脚本

在 Render Dashboard 中：

1. 点击你的服务（fund-assistant）
2. 点击顶部菜单的 **"Shell"** 标签
3. 在 Shell 中执行以下命令：

```bash
node backend/scripts/init-users.js
```

4. 看到以下输出即为成功：

```
✅ funds 表已添加 user_id 字段
✅ 账号 pxj 已初始化
✅ 账号 sgw 已初始化
✅ 用户初始化完成
```

### 步骤 3：访问登录页

打开 https://fund-assistant.onrender.com/login.html

使用以下账号登录：

**账号 1（你）**：
- 用户名：`pxj`
- 密码：`pxj123`

**账号 2（你朋友）**：
- 用户名：`sgw`
- 密码：`sgw123`

## 数据隔离说明

- 每个账号的持仓数据完全独立
- pxj 添加的基金，sgw 完全看不到
- sgw 添加的基金，pxj 完全看不到
- 已有数据会自动归属到第一个账号（user_id=1，即 pxj）

## 安全说明

1. **JWT Secret**：当前使用硬编码的 secret（`fund-assistant-secret-key-2026`），生产环境建议改为环境变量。
2. **密码加密**：使用 bcrypt 加密存储，安全性较高。
3. **HTTPS**：Render 默认提供 HTTPS，token 传输是安全的。
4. **Token 有效期**：7 天后自动过期，需要重新登录。

## 故障排查

### 登录后立即被退出

可能原因：Render 数据库未初始化。

解决方法：在 Render Shell 中执行 `node backend/scripts/init-users.js`

### 显示"未登录"

可能原因：Token 未正确保存或已过期。

解决方法：清除浏览器 localStorage，重新登录。

### 两个账号看到同样的数据

可能原因：数据库字段未正确添加。

解决方法：在 Render Shell 中重新执行初始化脚本。

## 版本历史

- v1.8：添加用户登录和数据隔离功能（2026-11-16）
- v1.7：添加同类位置分析功能
- v1.6：添加分页功能
- v1.5：部署到 Render + UptimeRobot 防休眠

## 技术栈

- 认证：JWT (jsonwebtoken)
- 密码加密：bcrypt (bcryptjs)
- 前端：原生 JavaScript + localStorage
- 后端：Express + better-sqlite3
- 部署：Render (Singapore)

---

**注意**：本地开发时，每次修改代码推送到 GitHub 后，Render 会自动部署（3-5 分钟）。无需手动操作，但**首次部署后必须执行一次初始化脚本**。
