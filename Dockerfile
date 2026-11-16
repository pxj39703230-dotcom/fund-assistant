# 基金助手 Docker 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用代码
COPY backend ./backend
COPY frontend ./frontend
COPY fund.db ./fund.db

# 设置时区
ENV TZ=Asia/Shanghai

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["node", "backend/app.js"]
