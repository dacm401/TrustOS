#!/usr/bin/env python3
"""
SmartRouter Pro — G4 Delegation Learning Loop
routing_success 回填脚本

用法：
  # 1. 生成 routing pairs JSON
  node scripts/benchmark-ci.cjs --backfill

  # 2a. 表为空时（推荐首次使用）：用 benchmark 数据做种子插入
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-YYYY-MM-DD.json --seed-from-benchmark

  # 2b. 已有真实数据时：更新现有记录的 routing_success
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-YYYY-MM-DD.json --dry-run
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-YYYY-MM-DD.json

环境变量：
  DATABASE_URL   PostgreSQL 连接字符串（必需）
                 示例：postgresql://user:password@localhost:3001/smartrouter
依赖：pip install psycopg2-binary
"""

import argparse
import json
import os
import sys
import uuid

try:
    import psycopg2
    from psycopg2.extras import execute_batch, Json
except ImportError:
    print("error: psycopg2 not installed. Run: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


def load_pairs(json_path: str) -> list[dict]:
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "pairs" not in data:
        raise ValueError(f"invalid routing pairs file: {json_path}")
    return data["pairs"]


def get_table_columns(conn) -> set:
    """动态获取 delegation_logs 表的所有列名。"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'delegation_logs'
        """)
        return {row[0] for row in cur.fetchall()}


def seed_from_benchmark(pairs: list[dict], dry_run: bool, conn) -> dict:
    """
    种子插入模式：当 delegation_logs 表为空时，
    直接将 benchmark routing pairs 作为种子记录插入。
    动态探测 DB 列，只插入存在的字段。
    """
    cols = get_table_columns(conn)
    results = {
        "total_pairs": len(pairs),
        "rows_inserted": 0,
        "errors": [],
        "details": [],
    }

    for i, pair in enumerate(pairs):
        input_text = pair["input"]
        expected_action = pair["expected_action"]
        actual_action = pair.get("actual_action", "direct_answer")
        scenario = pair.get("scenario", "unknown")
        routed_action = actual_action
        routing_success = pair.get("matched", routed_action == expected_action)
        routing_reason = f"Benchmark seed: expected={expected_action}, routed={routed_action}"

        log_id = str(uuid.uuid4())
        session_id = f"benchmark-seed-{i+1:03d}"

        # 构建 INSERT 语句，只包含 DB 中存在的列
        base_fields = {
            "id": log_id,
            "user_id": "benchmark-user",
            "session_id": session_id,
            "turn_id": 1,
            "task_id": log_id,
            "routing_version": "v2",
            "routed_action": routed_action,
            "routing_reason": routing_reason,
            "execution_status": "success",
            "execution_correct": routing_success,
            "routing_success": routing_success,
        }
        # NOT NULL 且无默认值的字段（迁移 012 要求）
        always_fill = {
            "llm_scores": Json({}),
            "llm_confidence": 0.0,
            "system_confidence": 0.0,
            "calibrated_scores": Json({}),
            "policy_overrides": Json([]),
            "did_rerank": False,
            "rerank_rules": Json([]),
        }
        # 可选填充（迁移 013）
        optional_v13 = {
            "value_success": None,
            "user_success": None,
        }

        # 只保留 DB 中存在的列
        all_vals = {}
        for k, v in {**always_fill, **base_fields}.items():
            if k in cols:
                all_vals[k] = v
        for k, v in optional_v13.items():
            if k in cols:
                all_vals[k] = v

        placeholders = ", ".join(["%s"] * len(all_vals))
        col_names = ", ".join(all_vals.keys())
        values = list(all_vals.values())

        if dry_run:
            results["rows_inserted"] += 1
            results["details"].append({
                "id": log_id,
                "scenario": scenario,
                "input_preview": input_text[:40],
                "expected_action": expected_action,
                "routed_action": routed_action,
                "routing_success": routing_success,
                "dry_run": True,
            })
        else:
            try:
                sql = f"INSERT INTO delegation_logs ({col_names}) VALUES ({placeholders})"
                with conn.cursor() as cur:
                    cur.execute(sql, values)
                results["rows_inserted"] += 1
                results["details"].append({
                    "id": log_id,
                    "scenario": scenario,
                    "input_preview": input_text[:40],
                    "expected_action": expected_action,
                    "routed_action": routed_action,
                    "routing_success": routing_success,
                    "dry_run": False,
                })
            except Exception as e:
                err_str = str(e)
                # 遇到 "current transaction is aborted" 跳过后续（级联错误）
                if "aborted" in err_str.lower():
                    results["errors"].append({
                        "pair_input": input_text[:40],
                        "error": "transaction aborted (possibly cascade from earlier error) - check DB state",
                    })
                else:
                    results["errors"].append({
                        "pair_input": input_text[:40],
                        "error": err_str,
                    })

    return results


def run_backfill_update(pairs: list[dict], dry_run: bool, conn) -> dict:
    """
    更新模式：对已有 delegation_logs 记录，更新 routing_success 字段。
    适用于有真实生产数据的场景。
    """
    cols = get_table_columns(conn)
    has_routing_success = "routing_success" in cols

    results = {
        "total_pairs": len(pairs),
        "rows_updated": 0,
        "rows_matched_not_updated": 0,
        "rows_skipped": 0,
        "errors": [],
        "details": [],
    }

    if not has_routing_success:
        results["errors"].append({
            "pair_input": "table",
            "error": "routing_success column not found in delegation_logs",
        })
        return results

    for pair in pairs:
        expected_action = pair["expected_action"]
        input_text = pair["input"]
        scenario = pair.get("scenario", "unknown")
        match_key = input_text[:20].rstrip(".！？，.")

        try:
            query_sql = """
                SELECT id, routed_action, routing_reason, execution_status
                FROM delegation_logs
                WHERE routing_success IS NULL
                  AND execution_status IS NOT NULL
                  AND routing_reason LIKE '%' || %s || '%'
                ORDER BY created_at DESC
                LIMIT 5
            """
            with conn.cursor() as cur:
                cur.execute(query_sql, (match_key,))
                rows = cur.fetchall()

            if not rows:
                results["rows_skipped"] += 1
                continue

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
                    update_sql = "UPDATE delegation_logs SET routing_success = %s WHERE id = %s"
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
            results["errors"].append({
                "pair_input": input_text[:40],
                "error": str(e),
            })

    return results


def main():
    parser = argparse.ArgumentParser(
        description="G4 routing_success backfill tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # First time (table empty): seed insert from benchmark data
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-2026-04-27.json --seed-from-benchmark

  # Preview (with real data)
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-2026-04-24.json --dry-run

  # Write (with real data)
  python scripts/backfill_routing_success.py --file evaluation/results/routing-pairs-2026-04-24.json

  # With explicit DATABASE_URL
  DATABASE_URL="postgresql://user:pass@host:5432/db" python scripts/backfill_routing_success.py --file output.json
""",
    )
    parser.add_argument("--file", "-f", required=True,
                         help="routing pairs JSON file (generated by benchmark-ci.cjs --backfill)")
    parser.add_argument("--dry-run", "-n", action="store_true",
                         help="preview only, no DB writes")
    parser.add_argument("--seed-from-benchmark", "-s", action="store_true",
                         help="seed insert mode: insert benchmark pairs as delegation_logs records (for empty tables)")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"error: file not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    pairs = load_pairs(args.file)
    print(f"[G4 Backfill] loaded {len(pairs)} routing pairs")
    print(f"[G4 Backfill] file: {args.file}")

    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL:
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DATABASE_URL="):
                        DATABASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break

    if not DATABASE_URL:
        print("error: DATABASE_URL not set", file=sys.stderr)
        print("hint: set DATABASE_URL env var or check backend_real/.env", file=sys.stderr)
        sys.exit(1)

    print(f"[G4 Backfill] connecting to DB...")
    conn = psycopg2.connect(DATABASE_URL)

    try:
        if args.seed_from_benchmark:
            results = seed_from_benchmark(pairs, args.dry_run, conn)
        else:
            results = run_backfill_update(pairs, args.dry_run, conn)
        if not args.dry_run:
            conn.commit()
        _print_summary(results, args.dry_run,
                        mode="seed" if args.seed_from_benchmark else "update")
    finally:
        conn.close()


def _print_summary(results: dict, dry_run: bool, mode: str):
    mode_label = "seed insert" if mode == "seed" else "match update"
    action_label = "dry-run" if dry_run else "write"

    print(f"\n{'='*50}")
    print(f"[G4 Backfill] Summary ({mode_label} | {action_label})")
    print(f"{'='*50}")
    print(f"  total pairs:        {results['total_pairs']}")
    if mode == "seed":
        print(f"  inserted:           {results['rows_inserted']}")
    else:
        print(f"  updated:            {results['rows_updated']}")
        print(f"  matched/dry-run:   {results['rows_matched_not_updated']}")
        print(f"  skipped:           {results['rows_skipped']}")
    print(f"  errors:            {len(results['errors'])}")

    if results["errors"]:
        print(f"\nErrors (first 5):")
        for err in results["errors"][:5]:
            print(f"  [{err['pair_input']}] {err['error'][:120]}")

    if dry_run:
        print(f"\n[DRY-RUN] Preview (first 20):")
        for detail in results["details"][:20]:
            status = "[OK]" if detail["routing_success"] else "[FAIL]"
            print(f"  {status} [{detail['scenario'][:20]}] "
                  f"exp:{detail['expected_action']:<20} got:{detail['routed_action']:<20} "
                  f"| {detail['input_preview']}")

    if not dry_run:
        print(f"\n[COMMITTED] delegation_logs routing_success {'inserted' if mode == 'seed' else 'updated'}")
    else:
        print(f"\n[DRY-RUN] No DB writes performed.")


if __name__ == "__main__":
    main()
