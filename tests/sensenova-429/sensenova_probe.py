# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx[socks]>=0.27",
# ]
# ///
"""
SenseNova 429 限流维度测试脚本

测试 rpm/tpm 限制是 per-key、per-account、per-machine 还是全局。
使用 Key-5~8（4 个不同账号）+ 3 个 chat 模型进行交叉验证。

用法:
    uv run sensenova_probe.py send -k 5 -m deepseek-v4-flash
    uv run sensenova_probe.py probe -k 5 -m deepseek-v4-flash
    uv run sensenova_probe.py exp1
    uv run sensenova_probe.py exp4
"""

import httpx
import json
import time
import argparse
import sys
from datetime import datetime
from pathlib import Path

# Windows GBK 终端兼容
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ============================================================
# 配置
# ============================================================

KEYS = {
    5: "sk-rcjv8D1cYpm4qZHqcOM9mF5q4rfc8KIb",
    6: "sk-Z13iTyU3DFnACYkpckFMLORFhdg8V4OV",
    7: "sk-JAuaBSd87xYHgkfxiyYosnHfePmaV3BY",
    8: "sk-UGZEzgPQonCdR13fDi47JSLBQzxZA1BU",
}

BASE_URL = "https://token.sensenova.cn/v1/chat/completions"
PROXY = "socks5://127.0.0.1:2080"
RESULTS_FILE = Path(__file__).parent / "results.jsonl"
RUN_ID = datetime.now().strftime("%Y%m%d_%H%M%S")

# ============================================================
# 核心函数
# ============================================================


def make_body(model: str, size: str = "small") -> dict:
    """构造请求体。size='large' 时生成 ~90KB content 用于 tpm 测试。"""
    if size == "small":
        return {"model": model, "messages": [{"role": "user", "content": "1"}], "max_tokens": 1, "stream": False}
    else:
        # ~90000 字符 ≈ 22500 tokens，足以触发 tpm 限制
        content = "hello " * 15000
        return {"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": 1, "stream": False}


def send(key_num: int, model: str, size: str = "small", use_proxy: bool = False,
         timeout: float = 120.0, exp: str = "") -> dict:
    """发送单个请求，返回结构化结果字典。"""
    api_key = KEYS[key_num]
    body = make_body(model, size)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    client_kwargs = {"timeout": timeout}
    if use_proxy:
        client_kwargs["proxy"] = PROXY

    t0 = time.time()
    try:
        with httpx.Client(**client_kwargs) as client:
            resp = client.post(BASE_URL, json=body, headers=headers)
            elapsed_ms = round((time.time() - t0) * 1000)
            result = {
                "ts": datetime.now().isoformat(timespec="seconds"),
                "run": RUN_ID,
                "exp": exp,
                "key": key_num,
                "model": model,
                "size": size,
                "proxy": use_proxy,
                "status": resp.status_code,
                "latency_ms": elapsed_ms,
                "body": resp.text[:2000],
                "error": None,
            }
    except Exception as e:
        elapsed_ms = round((time.time() - t0) * 1000)
        result = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "run": RUN_ID,
            "exp": exp,
            "key": key_num,
            "model": model,
            "size": size,
            "proxy": use_proxy,
            "status": 0,
            "latency_ms": elapsed_ms,
            "body": "",
            "error": str(e)[:500],
        }
    save(result)
    return result


def save(r: dict):
    """追加结果到 JSONL 文件。"""
    with open(RESULTS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")


def show(r: dict, idx=None):
    """控制台打印单条结果。"""
    status = r["status"]
    key = r["key"]
    model = r["model"][:28]
    proxy = "PROXY" if r["proxy"] else "DIRECT"
    ms = r["latency_ms"]
    prefix = f"  [{idx:3d}] " if idx is not None else "       "

    if status == 200:
        print(f"{prefix}Key-{key} | {model:28s} | {proxy:6s} | {status} | {ms}ms")
    elif status == 429:
        msg = ""
        try:
            msg = json.loads(r["body"]).get("error", {}).get("message", "")[:50]
        except Exception:
            msg = r["body"][:50]
        print(f"{prefix}Key-{key} | {model:28s} | {proxy:6s} | {status} | {ms}ms | {msg}")
    else:
        err = r.get("error") or r["body"][:50]
        print(f"{prefix}Key-{key} | {model:28s} | {proxy:6s} | {status} | {ms}ms | {err}")


def do(key, model, size="small", proxy=False, exp="", idx=None):
    """发送 + 保存 + 打印，返回结果字典。"""
    r = send(key, model, size, proxy, exp=exp)
    show(r, idx)
    return r


def probe(key, model, size="small", proxy=False, max_tries=50, interval=0.2, exp=""):
    """连发直到 429。返回成功次数 (int) 或 None（未触发 429）。"""
    ok = 0
    for i in range(max_tries):
        r = do(key, model, size, proxy, exp=exp, idx=i)
        if r["status"] == 200:
            ok += 1
        elif r["status"] == 429:
            print(f"       >> 429 触发，成功 {ok} 次后耗尽")
            return ok
        else:
            print(f"       >> 异常 {r['status']}，停止")
            return None
        if interval > 0:
            time.sleep(interval)
    print(f"       >> {max_tries} 次未触发 429，成功 {ok} 次")
    return None


def trigger_tpm(key, model, exp_prefix="", max_tries=20):
    """连发大请求直到 tpm 429。返回是否成功触发。"""
    for i in range(max_tries):
        r = do(key, model, size="large", exp=f"{exp_prefix}-{i}", idx=i)
        if r["status"] == 429:
            return True
        if r["status"] != 200:
            print(f"       >> 异常 {r['status']}，停止")
            return False
        time.sleep(0.3)
    print(f"       >> {max_tries} 次大请求未触发 tpm 429")
    return False


# ============================================================
# 实验函数
# ============================================================


def exp1():
    """实验 1: rpm key 维度定位"""
    print("=" * 64)
    print("实验 1: rpm key 维度定位")
    print("目标: rpm 限制是 per-key、per-account 还是 per-machine/global")
    print("方法: Key-5 连发 deepseek-v4-flash → 429 → 立即 Key-6/Key-7 测试")
    print("=" * 64)

    print("\n--- 1a: Key-5 直连连发 deepseek-v4-flash ---")
    n = probe(5, "deepseek-v4-flash", exp="1a", max_tries=50, interval=0.2)
    if n is None:
        print("  ⚠ 未触发 429，实验中止")
        return

    print("\n--- 1b: 立即 Key-6 直连 ---")
    r = do(6, "deepseek-v4-flash", exp="1b")
    if r["status"] == 200:
        print("  >> Key-6 不受影响 → rpm 非 per-machine/global → per-account 或 per-key")
    elif r["status"] == 429:
        print("  >> Key-6 也 429 → rpm 是 per-machine 或全局 → 需实验 2")

    print("\n--- 1c: 立即 Key-7 直连 ---")
    r = do(7, "deepseek-v4-flash", exp="1c")

    print("\n--- 1d: 等 70s → Key-5 直连 ---")
    print("  等待 70s...", end="", flush=True)
    time.sleep(70)
    print(" OK")
    r = do(5, "deepseek-v4-flash", exp="1d")
    if r["status"] == 200:
        print("  >> 60s 窗口确认")
    else:
        print("  >> 仍 429，可能更长锁定")

    print("\n" + "=" * 64)
    print("⚠ 请记录后台数据: Key-5/6/7 的 deepseek-v4-flash 调用次数")
    print("=" * 64)


def exp2():
    """实验 2: rpm IP/机器维度（仅当实验 1b=429 时执行）"""
    print("=" * 64)
    print("实验 2: rpm IP/机器维度")
    print("目标: 区分 rpm 是 per-machine(IP) 还是全局/平台级")
    print("方法: Key-5 直连触发 429 → 立即 Key-5 代理(不同IP)测试")
    print("=" * 64)

    print("\n--- 2a: Key-5 直连连发 deepseek-v4-flash ---")
    n = probe(5, "deepseek-v4-flash", exp="2a", max_tries=50, interval=0.2)
    if n is None:
        print("  ⚠ 未触发 429，实验中止")
        return

    print("\n--- 2b: 立即 Key-5 通过代理(不同IP) ---")
    r = do(5, "deepseek-v4-flash", proxy=True, exp="2b")
    if r["status"] == 200:
        print("  >> 代理IP不受影响 → rpm = per-machine/IP")
    elif r["status"] == 429:
        print("  >> 代理IP也429 → rpm = 全局/平台级（不限IP）")


def exp3():
    """实验 3: rpm model 维度"""
    print("=" * 64)
    print("实验 3: rpm model 维度")
    print("目标: rpm 限制是否 per-model 独立")
    print("方法: Key-7 + deepseek-v4-flash 触发 429 → 立即 Key-7 + flash-lite")
    print("=" * 64)

    print("\n--- 3a: Key-7 直连连发 deepseek-v4-flash ---")
    n = probe(7, "deepseek-v4-flash", exp="3a", max_tries=50, interval=0.2)
    if n is None:
        print("  ⚠ 未触发 429，实验中止")
        return

    print("\n--- 3b: 立即 Key-7 + sensenova-6.7-flash-lite ---")
    r = do(7, "sensenova-6.7-flash-lite", exp="3b")
    if r["status"] == 200:
        print("  >> flash-lite 不受影响 → rpm per-model 独立")
    elif r["status"] == 429:
        print("  >> flash-lite 也429 → rpm 跨 model 共享")


def exp4():
    """实验 4: tpm key 维度定位"""
    print("=" * 64)
    print("实验 4: tpm key 维度定位")
    print("目标: tpm 限制是 per-key、per-account、per-machine 还是全局")
    print("方法: Key-5 + glm-5.2 大prompt → tpm 429 → 立即 Key-6/7/8 交叉测试")
    print("=" * 64)

    print("\n--- 4a: Key-5 直连 glm-5.2 大prompt 连发触发 tpm 429 ---")
    if not trigger_tpm(5, "glm-5.2", exp_prefix="4a"):
        print("  ⚠ 无法触发 tpm 429，实验中止")
        return

    print("\n--- 4b: 立即 Key-6 直连 glm-5.2 大prompt ---")
    r = do(6, "glm-5.2", size="large", exp="4b")
    if r["status"] == 200:
        print("  >> Key-6 不受影响 → tpm 非 per-machine/global → per-account 或 per-key")
    elif r["status"] == 429:
        print("  >> Key-6 也 429 → tpm 是 per-machine 或全局")

    print("\n--- 4c: 立即 Key-7 直连 glm-5.2 大prompt ---")
    r = do(7, "glm-5.2", size="large", exp="4c")
    if r["status"] == 429:
        print("  >> Key-7 也 429 → tpm = 全局/平台级（符合'太多人用'线索）")
    elif r["status"] == 200:
        print("  >> Key-7 不受影响 → tpm 非 全局")

    print("\n--- 4d: Key-8 直连 deepseek-v4-flash 大prompt ---")
    r = do(8, "deepseek-v4-flash", size="large", exp="4d")
    if r["status"] == 200:
        print("  >> deepseek-v4-flash 不受影响 → tpm 全局但 per-model")
    elif r["status"] == 429:
        print("  >> deepseek-v4-flash 也 429 → tpm 全局跨 model")

    print("\n" + "=" * 64)
    print("⚠ 请记录后台数据: glm-5.2 是否出现统计、各 key 调用次数")
    print("=" * 64)


def exp5():
    """实验 5: tpm model 维度（仅当实验 4b=200 时有意义）"""
    print("=" * 64)
    print("实验 5: tpm model 维度")
    print("目标: tpm 限制是否 per-model 独立")
    print("方法: Key-5 + glm-5.2 大prompt → 429 → 立即 Key-5 + deepseek-v4-flash")
    print("=" * 64)

    print("\n--- 5a: Key-5 直连 glm-5.2 大prompt 连发触发 tpm 429 ---")
    if not trigger_tpm(5, "glm-5.2", exp_prefix="5a"):
        print("  ⚠ 无法触发 tpm 429，实验中止")
        return

    print("\n--- 5b: 立即 Key-5 + deepseek-v4-flash 大prompt ---")
    r = do(5, "deepseek-v4-flash", size="large", exp="5b")
    if r["status"] == 200:
        print("  >> deepseek-v4-flash 不受影响 → tpm per-model 独立")
    elif r["status"] == 429:
        print("  >> deepseek-v4-flash 也 429 → tpm 跨 model")


def exp6():
    """实验 6: tpm 恢复窗口"""
    print("=" * 64)
    print("实验 6: tpm 恢复窗口")
    print("目标: 测量 tpm 429 后的恢复时间")
    print("方法: 触发 tpm 429 → 每 10s 探测恢复")
    print("=" * 64)

    print("\n--- 6a: Key-5 直连 glm-5.2 大prompt 连发触发 tpm 429 ---")
    if not trigger_tpm(5, "glm-5.2", exp_prefix="6a-trigger"):
        print("  ⚠ 无法触发 tpm 429，实验中止")
        return

    print("\n--- 6b: 每 10s 探测恢复 ---")
    for i in range(1, 61):
        time.sleep(10)
        r = do(5, "glm-5.2", size="large", exp=f"6b-probe-{i}", idx=i)
        if r["status"] == 200:
            print(f"       >> 恢复！耗时约 {i * 10}s")
            return
        if r["status"] != 429:
            print(f"       >> 异常 {r['status']}，停止")
            return
    print("       >> 10 分钟内未恢复")


def exp7():
    """实验 7: rpm 限额精确值 + 恢复窗口"""
    print("=" * 64)
    print("实验 7: rpm 限额精确值 + 恢复窗口")
    print("目标: 测量 rpm 精确限额 + 恢复时间 + 是否完全重置")
    print("方法: Key-8 连发 deepseek-v4-flash → 429 → 每 5s 探测 → 恢复后再连发")
    print("=" * 64)

    print("\n--- 7a: Key-8 连发 deepseek-v4-flash ---")
    n = probe(8, "deepseek-v4-flash", exp="7a", max_tries=50, interval=0.2)
    if n is None:
        print("  ⚠ 未触发 429，实验中止")
        return
    print(f"  >> rpm 限额 ≈ {n}")

    print("\n--- 7b: 每 5s 探测恢复 ---")
    recovered = False
    for i in range(1, 61):
        time.sleep(5)
        r = do(8, "deepseek-v4-flash", exp=f"7b-probe-{i}", idx=i)
        if r["status"] == 200:
            print(f"       >> 恢复！耗时约 {i * 5}s")
            recovered = True
            break
        if r["status"] != 429:
            print(f"       >> 异常 {r['status']}，停止")
            break

    if not recovered:
        print("       >> 5 分钟内未恢复")
        return

    print("\n--- 7c: 恢复后立即连发 ---")
    n2 = probe(8, "deepseek-v4-flash", exp="7c", max_tries=50, interval=0.2)
    if n2 is not None:
        print(f"  >> 恢复后 rpm 限额 ≈ {n2}")
        if n == n2:
            print("  >> 完全重置")
        else:
            print(f"  >> 部分重置（{n} → {n2}）")

    print("\n" + "=" * 64)
    print("⚠ 请记录后台数据: Key-8 deepseek-v4-flash 调用次数")
    print("=" * 64)


# ============================================================
# CLI
# ============================================================


def cmd_send(args):
    r = do(args.key, args.model, args.size, args.proxy)
    print(json.dumps(r, ensure_ascii=False, indent=2))


def cmd_probe_cli(args):
    probe(args.key, args.model, args.size, args.proxy, args.max_tries, args.interval)


def main():
    parser = argparse.ArgumentParser(description="SenseNova 429 限流维度测试")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # send
    ps = sub.add_parser("send", help="单发请求")
    ps.add_argument("-k", "--key", type=int, required=True, choices=[5, 6, 7, 8])
    ps.add_argument("-m", "--model", required=True)
    ps.add_argument("-s", "--size", default="small", choices=["small", "large"])
    ps.add_argument("-p", "--proxy", action="store_true")
    ps.set_defaults(func=cmd_send)

    # probe
    pp = sub.add_parser("probe", help="连发直到 429")
    pp.add_argument("-k", "--key", type=int, required=True, choices=[5, 6, 7, 8])
    pp.add_argument("-m", "--model", required=True)
    pp.add_argument("-s", "--size", default="small", choices=["small", "large"])
    pp.add_argument("-p", "--proxy", action="store_true")
    pp.add_argument("-n", "--max-tries", type=int, default=50)
    pp.add_argument("-i", "--interval", type=float, default=0.2)
    pp.set_defaults(func=cmd_probe_cli)

    # experiments
    exp_map = {f"exp{i}": i for i in range(1, 8)}
    for name, num in exp_map.items():
        pe = sub.add_parser(name, help=f"实验 {num}")
        pe.set_defaults(exp_num=num)

    args = parser.parse_args()

    if hasattr(args, "exp_num"):
        globals()[f"exp{args.exp_num}"]()
    else:
        args.func(args)


if __name__ == "__main__":
    main()
