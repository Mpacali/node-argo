# 使用官方 Node.js 20 版本的 Alpine Linux 镜像作为基础镜像
# Alpine 镜像非常小巧，适合生产环境
FROM node:20-alpine

# 设置工作目录
# 容器内所有后续命令都将在这个目录下执行
WORKDIR /app

# 将 package.json 和 package-lock.json (如果存在) 复制到工作目录
# 这样可以利用 Docker 缓存，如果依赖不变，就不需要重新安装
COPY package.json ./

# 安装 Node.js 依赖
# 使用 --omit=dev 来跳过开发依赖，进一步减小镜像大小
RUN npm install --omit=dev

# 复制应用程序的源代码到工作目录
# index.js 应该位于 Dockerfile 的同级目录
COPY index.js .

# 创建 /tmp 目录，因为脚本会将二进制文件下载到这里
# 确保该目录存在且可写
RUN mkdir -p /app/tmp && chmod 775 /app/tmp

# 暴露应用程序监听的端口
# 脚本默认监听 3000 端口，或者由 SERVER_PORT/PORT 环境变量指定
EXPOSE 3000

# 定义容器启动时执行的命令
# npm start 会运行 package.json 中定义的 "start" 脚本，即 "node index.js"
CMD [ "npm", "start" ]
