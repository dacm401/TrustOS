FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV production

# 安装 tsx 用于直接运行 TypeScript
RUN npm install -g tsx

# 复制 package 文件并安装依赖（包含 devDependencies）
#
# 注意：--ignore-scripts 会跳过 better-sqlite3 的 prebuild 下载，使其
# native binding 处于损坏状态（require() 时 SIGSEGV / exit 139，
# try/catch 无法捕获）。在 alpine 上补编译需要完整工具链且极慢。
# 因此事件索引已改为纯 JS 实现（src/services/trst1/jsonl-event-index.ts），
# 不依赖任何 native 模块。better-sqlite3 仅为可选依赖，缺失不影响运行。
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
