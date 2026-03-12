#!/usr/bin/env python3.11
from __future__ import annotations

import asyncio
import json
import os
import sys
import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


class TaskRisk(StrEnum):
    NORMAL = "normal"
    AT_RISK = "at-risk"
    BLOCKED = "blocked"


@dataclass(slots=True)
class ReporterConfig:
    alert_limit: int = 4
    memory_tip_limit: int = 5
    stale_minutes: int = 8
    at_risk_minutes: int = 4


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _minutes_since(iso_text: str, now: datetime) -> int:
    dt = _parse_iso(iso_text)
    if not dt:
        return 0
    delta = now - dt
    return max(0, int(delta.total_seconds() // 60))


def _load_config(path: str) -> ReporterConfig:
    if not path or not os.path.exists(path):
        return ReporterConfig()

    with open(path, "rb") as f:
        data = tomllib.load(f)

    reporting = data.get("reporting", {}) if isinstance(data, dict) else {}
    alert_limit = int(reporting.get("alert_limit", 4) or 4)
    memory_tip_limit = int(reporting.get("memory_tip_limit", 5) or 5)
    stale_minutes = int(reporting.get("stale_minutes", 8) or 8)
    at_risk_minutes = int(reporting.get("at_risk_minutes", 4) or 4)

    return ReporterConfig(
        alert_limit=max(1, min(12, alert_limit)),
        memory_tip_limit=max(1, min(10, memory_tip_limit)),
        stale_minutes=max(1, min(60, stale_minutes)),
        at_risk_minutes=max(1, min(30, at_risk_minutes)),
    )


async def build_live_brief(payload: dict[str, Any], config: ReporterConfig, now: datetime) -> str:
    roles = payload.get("roles") or []
    tasks = payload.get("tasks") or []
    executor = payload.get("executor") or {}

    total = len(tasks)
    blocked = sum(1 for t in tasks if str(t.get("status", "")).lower() == "blocked")
    at_risk = sum(1 for t in tasks if str(t.get("runtimeRisk", "")).lower() == TaskRisk.AT_RISK)
    running = sum(1 for t in tasks if str(t.get("status", "")).lower() in {"running", "pending"})
    avg_score = round(sum(float(r.get("score", 0) or 0) for r in roles) / max(1, len(roles)))

    enabled = bool(executor.get("enabled"))
    tick = int((executor.get("tickMs") or 0) / 1000)
    auto_completed = int((executor.get("stats") or {}).get("autoCompleted") or 0)

    return (
        f"任务总量 {total}｜进行中 {running}｜风险 {at_risk}｜阻塞 {blocked}｜"
        f"角色均分 {avg_score}｜执行器 {'ON' if enabled else 'OFF'}"
        f"(tick {max(1, tick)}s / auto-close {auto_completed})"
    )


async def build_alerts(payload: dict[str, Any], config: ReporterConfig, now: datetime) -> list[str]:
    tasks = payload.get("tasks") or []
    cause_labels = payload.get("causeLabels") or {}

    ranked: list[tuple[int, str]] = []
    for task in tasks:
        status = str(task.get("status", "")).lower()
        runtime_risk = str(task.get("runtimeRisk", "")).lower()
        if status not in {"blocked", "running", "pending"}:
            continue

        lag_min = _minutes_since(task.get("lastHeartbeatAt") or task.get("createdAt"), now)
        title = str(task.get("title") or task.get("id") or "unknown")
        role_name = str(task.get("roleName") or task.get("roleId") or "-")

        if status == "blocked":
            reason_code = str(task.get("blockedReasonCode") or "heartbeat_timeout")
            reason_label = str(cause_labels.get(reason_code) or reason_code)
            score = 1000 + lag_min
            text = f"[BLOCKED] {title} @ {role_name}｜静默 {lag_min}m｜原因 {reason_label}"
            ranked.append((score, text))
            continue

        if runtime_risk == TaskRisk.AT_RISK or lag_min >= config.at_risk_minutes:
            score = 500 + lag_min
            text = f"[AT-RISK] {title} @ {role_name}｜静默 {lag_min}m｜建议先补心跳"
            ranked.append((score, text))

    ranked.sort(key=lambda x: x[0], reverse=True)
    return [text for _, text in ranked[: config.alert_limit]]


async def build_memory_tips(payload: dict[str, Any], config: ReporterConfig, now: datetime) -> list[str]:
    tasks = payload.get("tasks") or []

    completed = [t for t in tasks if str(t.get("status", "")).lower() == "completed"]
    completed.sort(key=lambda t: str(t.get("gradedAt") or t.get("lastHeartbeatAt") or ""), reverse=True)

    tips: list[str] = []
    for task in completed[: config.memory_tip_limit]:
        title = str(task.get("title") or task.get("id") or "unknown")
        role_name = str(task.get("roleName") or task.get("roleId") or "-")
        completion = int(float(task.get("completion") or 0))
        quality = int(float(task.get("quality") or 0))
        reward = int(float(task.get("rewardBonus") or 0))
        tip = f"记忆候选：{role_name} 完成《{title}》 (完成度{completion}/质量{quality}/奖励+{reward})"
        tips.append(tip)

    blocked = [t for t in tasks if str(t.get("status", "")).lower() == "blocked"]
    blocked.sort(key=lambda t: _minutes_since(t.get("lastHeartbeatAt") or t.get("createdAt"), now), reverse=True)
    for task in blocked[: max(1, config.memory_tip_limit // 2)]:
        title = str(task.get("title") or task.get("id") or "unknown")
        reason = str(task.get("blockedRootCause") or task.get("stalledReason") or "阻塞未归因")
        tips.append(f"复盘候选：阻塞任务《{title}》根因：{reason}")

    return tips[: config.memory_tip_limit]


async def build_report(payload: dict[str, Any], config: ReporterConfig) -> dict[str, Any]:
    now = _now_utc()

    brief = ""
    alerts: list[str] = []
    memory_tips: list[str] = []
    errors: list[str] = []

    try:
        async with asyncio.TaskGroup() as tg:
            t_brief = tg.create_task(build_live_brief(payload, config, now))
            t_alert = tg.create_task(build_alerts(payload, config, now))
            t_memory = tg.create_task(build_memory_tips(payload, config, now))
        brief = t_brief.result()
        alerts = t_alert.result()
        memory_tips = t_memory.result()
    except* Exception as eg:
        errors.extend(str(exc) for exc in eg.exceptions)

    if not brief:
        roles = payload.get("roles") or []
        tasks = payload.get("tasks") or []
        brief = f"降级播报：角色 {len(roles)}｜任务 {len(tasks)}"

    return {
        "engine": "py311-taskgroup-v1",
        "generatedAt": now.isoformat(),
        "liveBrief": brief,
        "alerts": alerts,
        "memoryTips": memory_tips,
        "errors": errors,
    }


def main() -> int:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    config_path = str(payload.get("configPath") or os.environ.get("SQUAD_REPORTER_CONFIG") or "").strip()
    config = _load_config(config_path)
    report = asyncio.run(build_report(payload, config))
    sys.stdout.write(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
