/**
 * Phase 5 — Local Archive Store (IArchiveStorage 实现)
 *
 * 本地文件系统存储后端，实现 IArchiveStorage 接口。
 * 用于：数据主权要求 / 离线场景 / 低延迟需求。
 *
 * 注意：旧 API create()/updateCommandStatus() 保留，但推荐使用 save()/update()。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import type {
  IArchiveStorage,
  ArchiveDocument,
  LocalArchiveConfig,
} from "./storage-backend.js";

// ── LocalArchiveStorage (IArchiveStorage 实现) ────────────────────────────────

/**
 * 实现 IArchiveStorage 接口的本地文件系统存储。
 *
 * 路径格式：{basePath}/{userId}/{sessionId}/{archiveId}.json
 * 文件名使用传入 doc.id，不自动生成。
 */
export class LocalArchiveStorage implements IArchiveStorage {
  private basePath: string;

  constructor(config: LocalArchiveConfig) {
    this.basePath = config.basePath;
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  private sessionDir(sessionId: string, userId: string): string {
    return join(this.basePath, userId, sessionId);
  }

  private filePath(sessionId: string, userId: string, archiveId: string): string {
    return join(this.sessionDir(sessionId, userId), `${archiveId}.json`);
  }

  // ── IArchiveStorage 实现 ──────────────────────────────────────────────────

  async save(doc: ArchiveDocument): Promise<string> {
    const dir = this.sessionDir(doc.session_id, doc.user_id);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const path = this.filePath(doc.session_id, doc.user_id, doc.id);
    writeFileSync(path, JSON.stringify(doc, null, 2), "utf-8");
    return doc.id;
  }

  async getById(id: string): Promise<ArchiveDocument | null> {
    return this.findByIdRecursive(this.basePath, id);
  }

  async getBySession(sessionId: string, userId: string): Promise<ArchiveDocument | null> {
    const dir = this.sessionDir(sessionId, userId);
    if (!existsSync(dir)) return null;

    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;
    try {
      return JSON.parse(readFileSync(join(dir, files[0].name), "utf-8")) as ArchiveDocument;
    } catch {
      return null;
    }
  }

  async update(id: string, updates: Partial<ArchiveDocument>): Promise<boolean> {
    const doc = await this.getById(id);
    if (!doc) return false;
    const updated: ArchiveDocument = {
      ...doc,
      ...updates,
      id: doc.id,
      created_at: doc.created_at,
      updated_at: new Date().toISOString(),
    };
    const path = this.filePath(doc.session_id, doc.user_id, id);
    writeFileSync(path, JSON.stringify(updated, null, 2), "utf-8");
    return true;
  }

  async updateCommandStatus(id: string, status: string, result?: unknown): Promise<boolean> {
    return this.update(id, {
      status,
      ...(result ? { slow_execution: result as Record<string, unknown> } : {}),
    });
  }

  async delete(id: string): Promise<boolean> {
    const doc = await this.getById(id);
    if (!doc) return false;
    const path = this.filePath(doc.session_id, doc.user_id, id);
    if (existsSync(path)) {
      unlinkSync(path);
      return true;
    }
    return false;
  }

  async listBySession(sessionId: string, userId: string): Promise<ArchiveDocument[]> {
    const dir = this.sessionDir(sessionId, userId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf-8")) as ArchiveDocument;
        } catch {
          return null;
        }
      })
      .filter((d): d is ArchiveDocument => d !== null)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async ping(): Promise<boolean> {
    return existsSync(this.basePath);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private findByIdRecursive(dir: string, id: string): ArchiveDocument | null {
    if (!existsSync(dir)) return null;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          const r = this.findByIdRecursive(full, id);
          if (r) return r;
        } else if (entry.isFile() && entry.name === `${id}.json`) {
          return JSON.parse(readFileSync(full, "utf-8")) as ArchiveDocument;
        }
      }
    } catch { /* ignore */ }
    return null;
  }
}

// ── Legacy LocalArchiveStore (向后兼容) ──────────────────────────────────────

/**
 * 遗留 API（Phase 5 早期版本），保留以兼容现有调用方。
 * 推荐迁移到 LocalArchiveStorage。
 */
export class LocalArchiveStore {
  private basePath: string;
  private maxFileSize: number;
  private compress: boolean;
  private impl: LocalArchiveStorage;

  constructor(config: LocalArchiveConfig) {
    this.basePath = config.basePath;
    this.maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024;
    this.compress = config.compress ?? false;
    this.impl = new LocalArchiveStorage(config);
  }

  async create(input: {
    task_id?: string;
    session_id: string;
    user_id: string;
    decision: unknown;
    user_input: string;
    task_brief?: string;
    goal?: string;
  }): Promise<{ id: string }> {
    const id = uuid();
    const now = new Date().toISOString();
    const doc: ArchiveDocument = {
      id,
      task_id: input.task_id,
      session_id: input.session_id,
      user_id: input.user_id,
      manager_decision: input.decision,
      command: (input.decision as { command?: unknown })?.command,
      user_input: input.user_input,
      task_brief: input.task_brief,
      goal: input.goal,
      state: "delegated",
      status: "pending",
      constraints: {},
      fast_observations: [],
      slow_execution: {},
      created_at: now,
      updated_at: now,
    };
    await this.impl.save(doc);
    return { id };
  }

  async getBySession(sessionId: string, userId: string) {
    return this.impl.getBySession(sessionId, userId);
  }

  async getById(id: string) {
    return this.impl.getById(id);
  }

  async update(
    id: string,
    updates: Partial<Omit<ArchiveDocument, "id" | "created_at">>
  ): Promise<boolean> {
    return this.impl.update(id, updates as Partial<ArchiveDocument>);
  }

  async updateCommandStatus(id: string, status: string, result?: unknown): Promise<boolean> {
    return this.impl.updateCommandStatus(id, status, result);
  }

  async delete(id: string): Promise<boolean> {
    return this.impl.delete(id);
  }

  async listBySession(sessionId: string, userId: string) {
    return this.impl.listBySession(sessionId, userId);
  }

  async getStats() {
    // legacy, skip for now
    return { totalArchives: 0, totalSize: 0, sessionsCount: 0 };
  }

  /** 转换为 IArchiveStorage 接口 */
  toIArchiveStorage(): IArchiveStorage {
    return this.impl;
  }
}

// ── Re-export config type ─────────────────────────────────────────────────────

export type { LocalArchiveConfig };
