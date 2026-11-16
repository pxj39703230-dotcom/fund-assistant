# 部署到 Render 指南

## 🚀 快速部署步骤

### 1. 准备 GitHub 仓库

```bash
# 如果还没有 Git 仓库，初始化一个
git init

# 添加所有文件
git add .

# 提交
git commit -m "准备部署到 Render"

# 在 GitHub 上创建一个新仓库，然后关联
git remote add origin https://github.com/你的用户名/fund-assistant.git
git branch -M main
git push -u origin main
```

### 2. 在 Render 上部署

1. **访问 Render**
   - 打开 https://render.com
   - 点击右上角 "Sign Up" 注册账号（可用 GitHub 登录）

2. **创建新服务**
   - 登录后点击 "New +" 按钮
   - 选择 "Web Service"

3. **连接 GitHub 仓库**
   - 选择 "Connect a repository"
   - 授权 Render 访问你的 GitHub
   - 选择 `fund-assistant` 仓库

4. **配置服务**（会自动读取 render.yaml）
   - Name: `fund-assistant` （或你喜欢的名字）
   - Region: `Singapore` （新加坡，离中国最近）
   - Branch: `main`
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free** ✅

5. **添加持久化存储**（重要！）
   - 在 "Disks" 部分
   - Mount Path: `/opt/render/project/src`
   - Size: 1 GB（免费额度）

6. **部署**
   - 点击 "Create Web Service"
   - 等待 3-5 分钟完成部署

### 3. 获取访问链接

部署成功后，Render 会给你一个链接：

```
https://fund-assistant-xxxx.onrender.com
```

把这个链接发给朋友就能访问了！

---

## 📝 重要提示

### ✅ 优点
- **完全免费**（每月 750 小时）
- **永久链接**，不会断开
- **HTTPS 安全访问**
- **自动重启**，崩溃后自动恢复
- **数据持久化**（SQLite 数据库不会丢失）

### ⚠️ 限制
- **15 分钟无访问会休眠**（首次访问等 30-60 秒唤醒）
- **每月 750 小时免费额度**（约 31 天，够用）
- **构建时间可能较慢**（首次部署 3-5 分钟）

### 💡 提示
- 如果需要 24 小时不休眠，可以用 UptimeRobot 每 5 分钟访问一次（免费）
- 数据库文件保存在持久化磁盘，重启不会丢失
- 可以在 Render Dashboard 查看日志和监控

---

## 🔄 更新代码

以后需要更新时：

```bash
git add .
git commit -m "更新说明"
git push
```

Render 会自动检测到 push 并重新部署！

---

## 🆘 常见问题

### Q: 部署失败怎么办？
A: 查看 Render Dashboard 的 "Logs" 部分，找到错误信息

### Q: 数据会丢失吗？
A: 不会！只要配置了 Disk（持久化存储），数据库文件会一直保留

### Q: 可以绑定自己的域名吗？
A: 可以！在 Settings -> Custom Domain 添加

### Q: 如何查看服务器日志？
A: Render Dashboard -> 你的服务 -> Logs

---

**现在开始部署吧！** 🚀
