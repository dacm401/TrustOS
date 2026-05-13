/**
 * Sprint 57: Artifact Source Resolver 测试
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { ArtifactRevisionSource } from "../../../src/services/artifacts/artifact-source-resolver.js";

// Mock TaskArchiveRepo — vi.mock 会 hoist 到模块顶部
const mockGetById = vi.fn();
vi.mock("../../../src/db/task-archive-repo.js", () => ({
  TaskArchiveRepo: {
    getById: (...args: any[]) => mockGetById(...args),
  },
}));

// 在 vi.mock 之后动态 import 被测模块（确保 mock 生效）
let resolveArtifactRevisionSource: Function;

beforeAll(async () => {
  const mod = await import("../../../src/services/artifacts/artifact-source-resolver.js");
  resolveArtifactRevisionSource = mod.resolveArtifactRevisionSource;
});

beforeEach(() => {
  mockGetById.mockReset();
});

describe("resolveArtifactRevisionSource", () => {
  it("从 archive 的 slow_execution.result 读取 artifact content", async () => {
    mockGetById.mockResolvedValue({
      id: "archive_1",
      slow_execution: {
        result: "export default function LoginPage() { return <div>Login</div>; }",
        confidence: 0.85,
      },
    });

    const source = await resolveArtifactRevisionSource({ artifactId: "archive_1" }) as ArtifactRevisionSource;

    expect(source.source).toBe("archive");
    expect(source.content).toContain("export default function LoginPage");
    expect(mockGetById).toHaveBeenCalledWith("archive_1");
  });

  it("archive 不存在时返回 unavailable", async () => {
    mockGetById.mockResolvedValue(null);

    const source = await resolveArtifactRevisionSource({ artifactId: "missing" }) as ArtifactRevisionSource;

    expect(source.source).toBe("unavailable");
    expect(source.content).toBe("");
  });

  it("slow_execution 存在但 result 为空时返回 unavailable", async () => {
    mockGetById.mockResolvedValue({
      id: "archive_1",
      slow_execution: { result: "" },
    });

    const source = await resolveArtifactRevisionSource({ artifactId: "archive_1" }) as ArtifactRevisionSource;

    expect(source.source).toBe("unavailable");
  });

  it("无 artifactId/taskId 时返回 unavailable", async () => {
    const source = await resolveArtifactRevisionSource({}) as ArtifactRevisionSource;
    expect(source.source).toBe("unavailable");
  });

  it("taskId fallback 到 archive 查询", async () => {
    mockGetById.mockResolvedValue({
      id: "archive_1",
      slow_execution: { result: "function App() {}" },
    });

    const source = await resolveArtifactRevisionSource({ taskId: "archive_1" }) as ArtifactRevisionSource;

    expect(source.source).toBe("archive");
    expect(source.content).toContain("function App()");
  });

  it("archive 读取失败返回 unavailable（不抛异常）", async () => {
    mockGetById.mockRejectedValue(new Error("DB connection lost"));

    const source = await resolveArtifactRevisionSource({ artifactId: "archive_1" }) as ArtifactRevisionSource;

    expect(source.source).toBe("unavailable");
    expect(source.content).toBe("");
  });
});
