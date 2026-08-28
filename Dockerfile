FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV production

# 安装 tsx 用于直接运行 TypeScript
RUN npm install -g tsx

# 复制 package 文件并安装依赖（包含 devDependencies）
COPY package*.json ./
RUN npm install --ignore-scripts

# 复制源码
COPY src ./src
# Gateway 启动脚本（docker compose 的 gateway 服务以
# `tsx scripts/trst1/start-gateway.ts` 为入口，需要此目录）
COPY scripts ./scripts
COPY tsconfig.json ./

EXPOSE 3001
CMD ["tsx", "src/index.ts"]
