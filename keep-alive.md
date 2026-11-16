# 防止 Render 服务休眠 - 定时唤醒方案

## 问题

Render 免费版服务在 15 分钟无访问后会自动休眠，下次访问需要等 50 秒左右唤醒。

## 解决方案

### ✅ 方案 1：使用 UptimeRobot（推荐，零配置）

**免费监控服务，自动定时访问你的网站**

1. **注册 UptimeRobot**
   - 访问：https://uptimerobot.com/
   - 点击 "Sign Up Free" 注册
   - 验证邮箱

2. **添加监控**
   - 登录后点击 "+ Add New Monitor"
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: 基金助手
   - **URL**: `https://你的应用名.onrender.com/health`
   - **Monitoring Interval**: 5 minutes（每 5 分钟访问一次）
   - 点击 "Create Monitor"

3. **完成！**
   - UptimeRobot 会每 5 分钟自动访问你的 `/health` 接口
   - 服务永远不会休眠
   - 还能在服务宕机时发邮件通知你

**优点**：
- ✅ 完全免费
- ✅ 无需写代码
- ✅ 还能监控服务是否正常
- ✅ 宕机时邮件通知

---

### 方案 2：使用 Cron-job.org

**另一个免费的定时任务服务**

1. **注册 Cron-job.org**
   - 访问：https://cron-job.org/en/
   - 注册账号

2. **创建定时任务**
   - 登录后点击 "Cronjobs" → "Create cronjob"
   - **Title**: Keep Fund Assistant Alive
   - **URL**: `https://你的应用名.onrender.com/health`
   - **Schedule**: 选择 "Every 5 minutes"
   - 点击 "Create cronjob"

**优点**：
- ✅ 完全免费
- ✅ 支持更灵活的定时规则
- ✅ 可以同时监控多个服务

---

### 方案 3：自己搭建定时脚本（需要一台一直开着的电脑）

如果你有一台一直开着的电脑（或树莓派），可以用这个脚本：

**Windows 版（PowerShell）：**

```powershell
# keep-alive.ps1
while ($true) {
    try {
        $response = Invoke-WebRequest -Uri "https://你的应用名.onrender.com/health" -Method Get
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 服务唤醒成功: $($response.StatusCode)"
    } catch {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 唤醒失败: $_"
    }
    Start-Sleep -Seconds 300  # 每 5 分钟运行一次
}
```

**运行方式**：
```powershell
powershell -ExecutionPolicy Bypass -File keep-alive.ps1
```

---

**Linux/Mac 版（Bash + Crontab）：**

```bash
# keep-alive.sh
#!/bin/bash
curl -s "https://你的应用名.onrender.com/health" > /dev/null
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pinged fund-assistant"
```

**添加到 Crontab**：
```bash
chmod +x keep-alive.sh
crontab -e
```

添加这行：
```
*/5 * * * * /path/to/keep-alive.sh >> /tmp/keep-alive.log 2>&1
```

---

## 推荐方案

**我强烈推荐方案 1（UptimeRobot）**，因为：

1. ✅ **完全免费**
2. ✅ **无需自己维护脚本**
3. ✅ **还能监控服务是否正常**
4. ✅ **宕机时邮件通知**
5. ✅ **5 分钟设置完成**

---

## 已实施的后端改动

在 `backend/app.js` 中添加了健康检查接口：

```javascript
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

**测试**：
```bash
curl https://你的应用名.onrender.com/health
```

**返回**：
```json
{
  "status": "ok",
  "uptime": 1234.56,
  "timestamp": "2026-11-16T06:30:00.000Z"
}
```

---

## 注意事项

1. **不要设置太频繁**：5 分钟一次已足够，太频繁会浪费 Render 的免费额度
2. **使用 /health 接口**：不要 ping 主页，因为主页需要 token 验证
3. **监控 uptime**：如果发现 uptime 很小，说明服务重启了，可能需要检查日志

---

## 效果

- ✅ 服务永不休眠
- ✅ 首次访问秒开
- ✅ 用户体验大幅提升
