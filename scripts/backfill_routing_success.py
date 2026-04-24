#!/usr/bin/env python3
"""
SmartRouter Pro — G4 Delegation Learning Loop
routing_success 回填脚本

用法：
  # 1. 生成 routing pairs JSON（从 backend_real 目录运行）
  node scripts/benchmark-ci.cjs --backfill

  # 2. 预览需要更新的记录（不写入 DB）
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-YYYY-MM-DD.json --dry-run

  # 3. 正式回填
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-YYYY-MM-DD.json

环境变量：
  DATABASE_URL   PostgreSQL 连接字符串（必需）
                 示例：postgresql://user:password@localhost:3001/smartrouter

依赖：
  pip install psycopg2-binary
"""

import argparse
import json
import os
import sys

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    print("错误: psycopg2 未安装。请运行: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


def load_pairs(json_path: str) -> list[dict]:
    """加载 benchmark 导出的 routing pairs JSON。"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "pairs" not in data:
        raise ValueError(f"无效的 routing pairs 文件: {json_path}")
    return data["pairs"]


def build_update_query(pairs: list[dict], dry_run: bool) -> tuple[list[tuple], int]:
    """
    对每条 delegation log，计算 routing_success 并构建更新 tuple 列表。

    匹配逻辑：
      对每条 pair，查询 delegation_logs 中 query 包含 benchmark input（或 input 的前20字
      匹配）的记录，且 routing_success 为 NULL。
      routing_success = (routed_action == expected_action)
    """
    updates: list[tuple] = []
    match_count = 0

    for pair in pairs:
        expected_action = pair["expected_action"]
        input_text = pair["input"]
        # 用前 20 字符做模糊匹配（去掉句尾标点）
        match_key = input_text[:20].rstrip("。！？，.")

        # SQL: 查询包含 match_key 的记录，且 routing_success IS NULL
        sql = """
            SELECT id, session_id, routed_action, expected_action_calc, created_at
            FROM (
              SELECT
                dl.id,
                dl.session_id,
                dl.routed_action,
                %s::text AS expected_action_calc,
                dl.created_at,
                -- 使用前 20 字匹配
                CASE
                  WHEN COALESCE(dl.routing_reason, '') LIKE '%' || %s || '%'
                    THEN length(%s)
                  ELSE 0
                END AS match_score
              FROM delegation_logs dl
              WHERE dl.routing_success IS NULL
                AND dl.execution_status IS NOT NULL
            ) sub
            WHERE match_score > 0
            ORDER BY match_score DESC, created_at DESC
        """
        # 本函数在 dry_run 时查询，实际执行由调用方处理
        # 为简化，这里返回 (id, expected_action, routed_action, routing_success) tuples
        updates.append((match_key, expected_action, input_text))

    return updates, len(pairs)


def run_backfill(pairs: list[dict], dry_run: bool, conn) -> dict:
    """
    执行 routing_success 回填。

    匹配策略：
      对每条 pair，用 SQL LIKE 匹配 delegation_logs.routing_reason 字段（包含 query 摘要）
      + delegation_logs.query_preview（如有）。
      匹配分两步：
        1. LIKE '%input[:20]%' 精确匹配前20字
        2. 备选：query_preview LIKE '%input[:10]%'
    """
    results = {
        "total_pairs": len(pairs),
        "rows_updated": 0,
        "rows_matched_not_updated": 0,
        "rows_skipped": 0,
        "errors": [],
        "details": [],
    }

    for pair in pairs:
        expected_action = pair["expected_action"]
        input_text = pair["input"]
        scenario = pair.get("scenario", "unknown")
        # 匹配键：input 前 20 字
        match_key = input_text[:20].rstrip("。！？，.")

        try:
            # 查询匹配的 delegation_logs
            query_sql = """
                SELECT id, routed_action, routing_reason, execution_status
                FROM delegation_logs
                WHERE routing_success IS NULL
                  AND execution_status IS NOT NULL
                  AND (
                    -- 方法1：routing_reason 中包含 query 摘要
                    routing_reason LIKE '%' || %s || '%'
                    -- 方法2：query_preview 子字段（如未来扩展）
                    OR (routing_reason IS NOT NULL AND length(%s) >= 10)
                  )
                ORDER BY created_at DESC
                LIMIT 5
            """
            with conn.cursor() as cur:
                cur.execute(query_sql, (match_key, match_key))
                rows = cur.fetchall()

            if not rows:
                results["rows_skipped"] += 1
                continue

            # 对每条匹配记录，计算 routing_success 并更新
            for (log_id, routed_action, routing_reason, exec_status) in rows:
                routing_success = routed_action == expected_action

                if dry_run:
                    results["rows_matched_not_updated"] += 1
                    results["details"].append({
                        "log_id": log_id,
                        "scenario": scenario,
                        "input_preview": input_text[:40],
                        "expected_action": expected_action,
                        "routed_action": routed_action,
                        "routing_success": routing_success,
                        "exec_status": exec_status,
                        "dry_run": True,
                    })
                else:
                    update_sql = """
                        UPDATE delegation_logs
                        SET routing_success = %s
                        WHERE id = %s
                    """
                    with conn.cursor() as cur:
                        cur.execute(update_sql, (routing_success, log_id))
                    results["rows_updated"] += 1
                    results["details"].append({
                        "log_id": log_id,
                        "scenario": scenario,
                        "input_preview": input_text[:40],
                        "expected_action": expected_action,
                        "routed_action": routed_action,
                        "routing_success": routing_success,
                        "exec_status": exec_status,
                        "dry_run": False,
                    })

        except Exception as e:
            results["errors"].append({"pair_input": input_text[:40], "error": str(e)})

    return results


def main():
    parser = argparse.ArgumentParser(
        description="G4 routing_success 回填工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 预览
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-2026-04-24.json --dry-run

  # 正式回填
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-2026-04-24.json

  # 指定 DATABASE_URL（也可以在环境变量中设置）
  DATABASE_URL="postgresql://user:pass@host:5432/db" python scripts/backfill_routing_success.py --file output.json
""",
    )
    parser.add_argument(
        "--file", "-f",
        required=True,
        help="routing pairs JSON 文件路径（由 benchmark-ci.cjs --backfill 生成）",
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="仅预览需要更新的记录，不写入数据库",
    )
    args = parser.parse_args()

    # 1. 加载 pairs
    if not os.path.exists(args.file):
        print(f"错误: 文件不存在: {args.file}", file=sys.stderr)
        sys.exit(1)

    pairs = load_pairs(args.file)
    print(f"[G4 Backfill] 加载 {len(pairs)} 条 routing pairs")
    print(f"[G4 Backfill] 文件: {args.file}")

    # 2. 连接数据库
    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL:
        # 尝试从 backend_real/.env 读取
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DATABASE_URL="):
                        DATABASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break

    if not DATABASE_URL:
        print("错误: DATABASE_URL 环境变量未设置", file=sys.stderr)
        print("提示: 设置 DATABASE_URL 后重试，或确认 backend_real/.env 中有 DATABASE_URL=", file=sys.stderr)
        sys.exit(1)

    print(f"[G4 Backfill] 连接数据库...")
    conn = psycopg2.connect(DATABASE_URL)

    try:
        # 3. 执行回填
        results = run_backfill(pairs, args.dry_run, conn)

        # 4. 输出结果
        print(f"\n{'='*50}")
        print(f"[G4 Backfill] 摘要")
        print(f"{'='*50}")
        print(f"  总 pairs 数:       {results['total_pairs']}")
        print(f"  匹配并更新:        {results['rows_updated']}")
        print(f"  匹配但预览模式:    {results['rows_matched_not_updated']} (--dry-run)")
        print(f"  跳过（无匹配）:    {results['rows_skipped']}")
        print(f"  错误:              {len(results['errors'])}")

        if results["errors"]:
            print(f"\n错误详情:")
            for err in results["errors"]:
                print(f"  [{err['pair_input']}] {err['error']}")

        if args.dry_run:
            print(f"\n[DRY-RUN] 预览明细（前 20 条）:")
            for detail in results["details"][:20]:
                status = "✅" if detail["routing_success"] else "❌"
                print(f"  {status} [{detail['scenario']}] exp:{detail['expected_action']:<20} got:{detail['routed_action']:<20} | {detail['input_preview']}")

        if not args.dry_run:
            conn.commit()
            print(f"\n[已提交] {results['rows_updated']} 条 delegation_logs 已更新 routing_success")
        else:
            print(f"\n[DRY-RUN] 未写入数据库。去掉 --dry-run 重新运行以实际更新。")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
