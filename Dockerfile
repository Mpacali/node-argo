# 使用官方 Node.js 长期支持 (LTS) 版本的 Alpine Linux 镜像作为基础镜像
# Alpine 镜像小巧，适合构建轻量级容器
FROM node:lts-alpine

# 设置工作目录
WORKDIR /app

# 将 package.json 和 package-lock.json (如果存在) 复制到工作目录
# 这样可以利用 Docker 缓存层，在依赖不变时加快构建速度
COPY package*.json ./

# 安装项目依赖
# --no-cache: 不缓存包索引，减少镜像大小
# --virtual .build-deps: 安装构建依赖（例如 tar），并在安装完成后移除
# 如果没有 tar 或其他工具，npm install 可能失败
RUN apk add --no-cache --virtual .build-deps curl tar && \
    npm install --production && \
    apk del .build-deps

# 将所有本地代码复制到容器的工作目录
# .dockerignore 文件将用于排除不必要的文件
COPY . .

# 暴露应用程序监听的端口
# 确保这个端口与您脚本中的 PORT 变量一致，或者与容器运行时映射的端口一致
EXPOSE 3000

# 授予 sing-box 和 cloudflared 可执行权限 (在构建阶段)
# 这一步是为了确保容器启动时，这些二进制文件已经具备执行权限
# 如果您的脚本是在运行时下载并 chmod，这一步不是必须的，但可以在构建时预设
# 注意：这里假定 'web' 和 'bot' 是解压/下载后的文件名
RUN chmod +x /app/tmp/web || true && \
    chmod +x /app/tmp/bot || true

# 定义容器启动时运行的命令
# npm start 会执行 package.json 中定义的 "start" 脚本
CMD ["npm", "start"]