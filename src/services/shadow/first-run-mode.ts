/**
 * TRST-6.2: Shadow Mode 首跑 / opt-in 状态机
 *
 * 兑现 TRST-0.3 冻结基线："Shadow Mode as default first-run experience"。
 * 首次运行默认 shadow（观察、不实际外发执行、生成审计 trail）；`real`（实际执行）
 * 需显式 opt-in，且一旦 opt-in 会被持久化，避免每次首跑都强制观察。
 *
 * 设计边界（护栏）：
 *   - 不碰信任内核 / 网关 / enforcement（TRST-4F 仍冻结）。
 *   - 仅做"模式解析 + 持久化 + 真实降级保证"，由调用方（受控执行 seam）执行降级。
 *   - opt-in 标记存于 `.trustos/first-run.json`（本地优先，不跨机器）。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../config.js";

const TRUSTOS_DIR = join(process.cwd(), ".trustos");
const MARKER_PATH = join(TRUSTOS_DIR, "first-run.json");

export type ProductExecutionMode = "shadow" | "real";

export interface FirstRunState {
  /** 是否从未记录过 opt-in 标记（真正的"首次运行"） */
  firstRun: boolean;
  /** 系统当前生效模式（shadow | real） */
  mode: ProductExecutionMode;
  /** 是否 opt-in 了 real */
  optedIntoReal: boolean;
  /** 模式来源说明（诊断用） */
  reason: string;
}

let cached: FirstRunState | null = null;

function readMarker(): { optedIntoReal: boolean } {
  try {
    if (existsSync(MARKER_PATH)) {
      const raw = JSON.parse(readFileSync(MARKER_PATH, "utf8"));
      return { optedIntoReal: raw?.optedIntoReal === true };
    }
  } catch {
    /* 标记损坏 → 当作未 opt-in */
  }
  return { optedIntoReal: false };
}

function writeMarker(optedIntoReal: boolean): void {
  try {
    mkdirSync(TRUSTOS_DIR, { recursive: true });
    writeFileSync(
      MARKER_PATH,
      JSON.stringify({ optedIntoReal, updatedAt: new Date().toISOString() }, null, 2),
    );
  } catch {
    /* 写入失败不阻断启动（opt-in 仅本地便利） */
  }
}

/**
 * 解析系统当前生效模式 + 首跑状态。幂等（带缓存）。
 *
 * 优先级：
 *   1. env `TRUSTOS_DEFAULT_EXECUTION_MODE=real` → real（配置即 opt-in）。
 *   2. 持久化标记 optedIntoReal=true → real。
 *   3. 其余（含首次运行）→ shadow（默认安全）。
 */
export function getFirstRunState(): FirstRunState {
  if (cached) return cached;

  const envMode = config.defaultExecutionMode; // "shadow" | "real"
  const marker = readMarker();
  const firstRun = !existsSync(MARKER_PATH);

  let mode: ProductExecutionMode;
  let reason: string;

  if (envMode === "real") {
    mode = "real";
    reason = "env TRUSTOS_DEFAULT_EXECUTION_MODE=real";
    if (!marker.optedIntoReal) writeMarker(true);
  } else if (marker.optedIntoReal) {
    mode = "real";
    reason = "user opted into real (persisted)";
  } else {
    mode = "shadow";
    reason = firstRun ? "first-run default (shadow safety)" : "default (shadow)";
  }

  cached = { firstRun, mode, optedIntoReal: mode === "real", reason };
  return cached;
}

/**
 * 解析一次执行请求的生效模式。
 *
 * 规则：
 *   - 请求 `real` 且系统处于 shadow 默认 → **降级为 shadow（held=true）**，不实际执行。
 *   - 请求 `real` 且已 opt-in real → 放行 real。
 *   - 请求其他模式（dry_run / deterministic_local / manual_placeholder）或非 real → 透传。
 *
 * 调用方据此把 shadow 映射到其内部"观察态"执行（如 deterministic_local），
 * 从而保证"首次默认观察、real 需 opt-in"的硬保证。
 */
const SAFE_OBSERVE_MODES = ["dry_run", "deterministic_local", "manual_placeholder"];

export function resolveExecutionMode(requested?: string): {
  effective: ProductExecutionMode;
  held: boolean;
  reason: string;
} {
  const state = getFirstRunState();

  if (requested === "real") {
    if (state.mode === "real") {
      return { effective: "real", held: false, reason: state.reason };
    }
    return {
      effective: "shadow",
      held: true,
      reason: "real held — system in shadow by default; explicit opt-in required for real execution",
    };
  }

  // 非 real 的安全观察模式透传（dry_run / deterministic_local / manual_placeholder）。
  if (requested && SAFE_OBSERVE_MODES.includes(requested)) {
    return { effective: state.mode, held: false, reason: state.reason };
  }

  // 未指定 → 跟随系统模式。
  return { effective: state.mode, held: false, reason: state.reason };
}

/**
 * 显式 opt-in / opt-out real。供 UI / 运维触发。持久化到本地标记。
 */
export function setOptInReal(optIn: boolean): FirstRunState {
  writeMarker(optIn);
  cached = null; // 清缓存，下次读取重新解析
  return getFirstRunState();
}
