#!/usr/bin/env python3
"""Generate the Channel Club viewing dashboard (who watched what, used/unused channels).

Data sources:
  - Loki: structured presence events from the channel-club container
    (session.start/stop, watch.start/stop, channel.change) emitted as loguru
    JSON with bound fields, so every query is `{container="channel-club"} | json`.
  - Infinity: live channel catalogue from the Dispatcharr HDHR lineup and the
    ErsatzTV XMLTV, outer-joined to Loki watch time to surface unused channels.

Deploy:
  set -a; . ~/.config/grafana/claude-code.env; set +a
  curl -X POST http://192.168.50.79:3000/api/dashboards/db \
    -H "Authorization: Bearer $GRAFANA_TOKEN" -H "Content-Type: application/json" \
    -d @ops/grafana/dashboards/channel-club.json
"""

import json
from pathlib import Path

LOKI_DS = {"type": "loki", "uid": "P8E80F9AEF21F6940"}
INFINITY_DS = {"type": "yesoreyeram-infinity-datasource", "uid": "infinity"}

DISPATCHARR_LINEUP_URL = "https://streams.example.com/hdhr/lineup.json"
ERSATZTV_XMLTV_URL = "http://192.168.50.108:8409/iptv/xmltv.xml"

# Base stream: JSON-parsed channel-club logs, filtered by the dashboard variables.
# Only watch.* and programme.* carry a view: session.* (every client connects as the
# unified TV view) and channel.change (the shared live channel) filter on the user
# alone, through USER_BASE.
BASE = '{container="channel-club"} | json | record_extra_user=~"$user" | record_extra_view=~"$view"'
# Watch events leave out the phantom 'Live' watches pre-R2 bundles logged on the
# empty Live slot, under its synthetic id.
WATCH_BASE = BASE + ' | record_extra_channel_id!="live-channel-0"'
# Watch time accrues as it happens: watch.progress (every 5 minutes) and watch.stop
# carry delta_s, the seconds since the watch's last accounting. watch.stop lines
# from before R3 have no delta_s, so their whole duration_s counts instead.
WATCH_TIME = (
    WATCH_BASE
    + ' | record_extra_event=~"watch.progress|watch.stop"'
    + " | label_format watch_s=`{{ or .record_extra_delta_s .record_extra_duration_s }}`"
    + " | unwrap watch_s"
)
USER_BASE = '{container="channel-club"} | json | record_extra_user=~"$user"'

_pid = [0]


def pid() -> int:
    _pid[0] += 1
    return _pid[0]


# ============================================================
# Query helpers
# ============================================================
def loki(expr: str, legend: str = "", ref: str = "A", instant: bool = False) -> dict:
    t = {
        "datasource": LOKI_DS,
        "expr": expr,
        "legendFormat": legend,
        "refId": ref,
        "editorMode": "code",
    }
    if instant:
        t["queryType"] = "instant"
        t["instant"] = True
        t["range"] = False
    return t


def infinity(ref: str, kind: str, url: str, root: str, columns: list[dict]) -> dict:
    return {
        "datasource": INFINITY_DS,
        "refId": ref,
        "type": kind,
        "source": "url",
        "url": url,
        "format": "table",
        "parser": "backend",
        "root_selector": root,
        "columns": columns,
        "url_options": {"method": "GET", "data": ""},
        "filters": [],
        "global_query_id": "",
    }


# The lineup carries no id field, but each entry's stream URL ends in the channel's
# UUID, which is the app's channel id: a JSONata root (Infinity's backend parser)
# takes its last path segment.
DISPATCHARR_ROOT = '$.{"channel": GuideName, "number": GuideNumber, "channel_id": $split(URL, "/")[-1]}'


def dispatcharr_catalogue(ref: str = "A") -> dict:
    return infinity(
        ref,
        "json",
        DISPATCHARR_LINEUP_URL,
        DISPATCHARR_ROOT,
        [
            {"selector": "channel", "text": "channel", "type": "string"},
            {"selector": "number", "text": "number", "type": "string"},
            {"selector": "channel_id", "text": "channel_id", "type": "string"},
        ],
    )


def ersatztv_catalogue(ref: str = "B") -> dict:
    return infinity(
        ref,
        "xml",
        ERSATZTV_XMLTV_URL,
        "tv.channel",
        [
            {"selector": "display-name.2", "text": "channel", "type": "string"},
            {"selector": "-id", "text": "channel_id", "type": "string"},
        ],
    )


# ============================================================
# Panel helpers
# ============================================================
def grid(x: int, y: int, w: int, h: int) -> dict:
    return {"h": h, "w": w, "x": x, "y": y}


def row(title: str, y: int) -> dict:
    return {"id": pid(), "type": "row", "title": title, "gridPos": grid(0, y, 24, 1), "collapsed": False}


def stat(title: str, targets: list, x: int, y: int, w: int = 4, h: int = 4, unit: str = "short", ds: dict = LOKI_DS, transformations: list | None = None) -> dict:
    p = {
        "id": pid(),
        "type": "stat",
        "title": title,
        "gridPos": grid(x, y, w, h),
        "datasource": ds,
        "targets": targets,
        "fieldConfig": {"defaults": {"unit": unit, "color": {"mode": "fixed", "fixedColor": "blue"}}, "overrides": []},
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "colorMode": "value",
            "graphMode": "none",
            "textMode": "value",
            "justifyMode": "center",
        },
    }
    if transformations:
        p["transformations"] = transformations
    return p


def bargauge(title: str, targets: list, x: int, y: int, w: int = 12, h: int = 10, unit: str = "s") -> dict:
    return {
        "id": pid(),
        "type": "bargauge",
        "title": title,
        "gridPos": grid(x, y, w, h),
        "datasource": LOKI_DS,
        "targets": targets,
        "fieldConfig": {"defaults": {"unit": unit, "min": 0, "color": {"mode": "continuous-BlPu"}}, "overrides": []},
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "horizontal",
            "displayMode": "gradient",
            "showUnfilled": True,
            "valueMode": "color",
            "namePlacement": "left",
            "sizing": "auto",
            "minVizHeight": 16,
            "maxVizHeight": 32,
        },
        "transformations": [{"id": "sortBy", "options": {"sort": [{"field": "Value", "desc": True}]}}],
    }


def timeseries(title: str, targets: list, x: int, y: int, w: int = 12, h: int = 8, unit: str = "short", bars: bool = False, stack: bool = False) -> dict:
    return {
        "id": pid(),
        "type": "timeseries",
        "title": title,
        "gridPos": grid(x, y, w, h),
        "datasource": LOKI_DS,
        "targets": targets,
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "color": {"mode": "palette-classic"},
                "custom": {
                    "drawStyle": "bars" if bars else "line",
                    "lineInterpolation": "smooth",
                    "lineWidth": 1,
                    "fillOpacity": 80 if bars else 10,
                    "showPoints": "never",
                    "spanNulls": False,
                    "stacking": {"mode": "normal" if stack else "none"},
                    "axisBorderShow": False,
                },
            },
            "overrides": [],
        },
        "options": {
            "legend": {"displayMode": "list", "placement": "bottom", "calcs": ["sum"]},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
    }


def event_table(title: str, event: str, columns: list[str], x: int, y: int, w: int = 12, h: int = 12, unit_overrides: dict | None = None, base: str = BASE, defaults: dict | None = None) -> dict:
    """Table of raw Loki events: the extracted log labels become columns.

    ``defaults`` gives a column the text to show when its field is null or unset.
    """
    defaults = defaults or {}
    fields = ", ".join(
        f'{c}=`{{{{ or .record_extra_{c} "{defaults[c]}" }}}}`' if c in defaults else f"{c}=record_extra_{c}"
        for c in columns
    )
    expr = f'{base} | record_extra_event="{event}" | label_format {fields} | line_format ""'
    keep = {"Time": True, **{c: True for c in columns}}
    overrides = []
    for name, unit in (unit_overrides or {}).items():
        overrides.append({"matcher": {"id": "byName", "options": name}, "properties": [{"id": "unit", "value": unit}]})
    return {
        "id": pid(),
        "type": "table",
        "title": title,
        "gridPos": grid(x, y, w, h),
        "datasource": LOKI_DS,
        "targets": [loki(expr)],
        "fieldConfig": {"defaults": {"custom": {"filterable": True}}, "overrides": overrides},
        "options": {"showHeader": True, "sortBy": [{"displayName": "Time", "desc": True}], "cellHeight": "sm"},
        "transformations": [
            {"id": "extractFields", "options": {"source": "labels", "format": "auto", "replace": False, "keepTime": True}},
            {"id": "organize", "options": {"excludeByName": {}, "includeByName": keep, "indexByName": {"Time": 0, **{c: i + 1 for i, c in enumerate(columns)}}}},
        ],
    }


# ============================================================
# Panels
# ============================================================
panels: list = []
y = 0

# ── Row: Viewers ─────────────────────────────────────────────
panels.append(row("Viewers", y)); y += 1

watch_time_expr = f'sum by (record_extra_user) (sum_over_time({WATCH_TIME} [$__range]))'

panels.append(stat("Unique viewers", [loki(f'count(sum by (record_extra_user) (count_over_time({USER_BASE} | record_extra_event="session.start" [$__range])))', instant=True)], 0, y))
# A session a deploy splits (closed with server_restart, then reconnected) counts once
panels.append(stat("Sessions", [loki(f'sum(count_over_time({USER_BASE} | record_extra_event="session.stop" | record_extra_reason!="server_restart" [$__range]))', instant=True)], 4, y))
panels.append(stat("Watch time", [loki(f'sum(sum_over_time({WATCH_TIME} [$__range]))', instant=True)], 8, y, unit="s"))
# Personal choices only: not a first start, a reconnect or following the Live slot
panels.append(stat("Channel switches", [loki(f'sum(count_over_time({WATCH_BASE} | record_extra_event="watch.start" | record_extra_reason="switch" [$__range]))', instant=True)], 12, y))
panels.append(stat("Channels watched", [loki(f'count(sum by (record_extra_channel) (count_over_time({WATCH_BASE} | record_extra_event="watch.start" [$__range])))', instant=True)], 16, y))
panels.append(stat("Live channel changes", [loki(f'sum(count_over_time({{container="channel-club"}} | json | record_extra_event="channel.change" [$__range]))', instant=True)], 20, y))
y += 4

panels.append(event_table(
    "Watch history", "watch.stop",
    ["user", "view", "channel", "programme", "duration_s", "reason"],
    0, y, w=14, h=12, unit_overrides={"duration_s": "s"}, base=WATCH_BASE,
))
panels.append(bargauge("Watch time by user", [loki(watch_time_expr, legend="{{record_extra_user}}", instant=True)], 14, y, w=10, h=12))
y += 12

panels.append(timeseries(
    "Connections per hour",
    [loki(f'sum by (record_extra_user) (count_over_time({USER_BASE} | record_extra_event="session.start" [1h]))', legend="{{record_extra_user}}")],
    0, y, w=12, bars=True, stack=True,
))
# Stopping Live logs a channel.change with no channel
panels.append(event_table("Shared live channel changes", "channel.change", ["user", "channel"], 12, y, w=12, h=8, base=USER_BASE, defaults={"channel": "stopped"}))
y += 8

# One row per titled programme segment: a title change or the watch ending closes it
panels.append(event_table(
    "Programmes watched", "programme.stop",
    ["user", "view", "channel", "programme", "duration_s"],
    0, y, w=24, h=10, unit_overrides={"duration_s": "s"},
))
y += 10

# ── Row: Channels ────────────────────────────────────────────
panels.append(row("Channels", y)); y += 1

channel_time_expr = f'sum by (record_extra_channel, record_extra_view) (sum_over_time({WATCH_TIME} [$__range]))'
panels.append(bargauge("Watch time by channel (top 25)", [loki(f"topk(25, {channel_time_expr})", legend="{{record_extra_channel}} ({{record_extra_view}})", instant=True)], 0, y, w=12, h=14))
panels.append(timeseries(
    "Channel starts over time",
    [loki(f'sum by (record_extra_channel) (count_over_time({WATCH_BASE} | record_extra_event="watch.start" [$__auto]))', legend="{{record_extra_channel}}")],
    12, y, w=12, h=14, bars=True, stack=True,
))
y += 14

# Following the shared Live slot (true) or a channel of one's own (false); no value before R2
slot_time_expr = f'sum by (record_extra_on_live) (sum_over_time({WATCH_TIME} [$__range]))'
panels.append(bargauge("Watch time: Live slot vs own pick", [loki(slot_time_expr, legend="Live slot: {{record_extra_on_live}}", instant=True)], 0, y, w=24, h=5))
y += 5

# Catalogue usage: Infinity catalogue (A+B) outer-joined with Loki watch time (C) and starts (D)
# on the channel id, so a renamed channel keeps its history. The ErsatzTV '-id' is the
# app's channel id (the tvg-id); label_replace names the Loki side's id to match.
def by_channel_id(expr: str) -> str:
    return f'label_replace({expr}, "channel_id", "$1", "record_extra_channel_id", "(.+)")'


catalogue_watch = by_channel_id(f'sum by (record_extra_channel_id) (sum_over_time({WATCH_TIME} [$__range]))')
catalogue_starts = by_channel_id(f'sum by (record_extra_channel_id) (count_over_time({WATCH_BASE} | record_extra_event="watch.start" [$__range]))')
panels.append({
    "id": pid(),
    "type": "table",
    "title": "Catalogue usage (unused channels sort first)",
    "description": "Every channel in the Dispatcharr lineup and ErsatzTV XMLTV, joined by channel id to watch events in the selected range. 'never watched' means no watch time (watch.progress or watch.stop) in range.",
    "gridPos": grid(0, y, 24, 16),
    "datasource": {"type": "datasource", "uid": "-- Mixed --"},
    "targets": [
        dispatcharr_catalogue("A"),
        ersatztv_catalogue("B"),
        loki(catalogue_watch, ref="C", instant=True),
        loki(catalogue_starts, ref="D", instant=True),
    ],
    "transformations": [
        # Loki instant vectors come back as one frame per series: turn them into channel rows.
        {"id": "merge", "options": {}},
        {"id": "joinByField", "options": {"byField": "channel_id", "mode": "outer"}},
        {"id": "organize", "options": {
            "excludeByName": {"Time": True, "Time 1": True, "Time 2": True, "Time 3": True, "Time 4": True, "record_extra_channel_id": True},
            "renameByName": {"Value #C": "watch time", "Value #D": "starts", "number": "live #"},
            "indexByName": {"channel": 0, "live #": 1, "channel_id": 2, "watch time": 3, "starts": 4},
        }},
        {"id": "sortBy", "options": {"sort": [{"field": "watch time", "desc": False}]}},
    ],
    "fieldConfig": {
        "defaults": {"custom": {"filterable": True, "align": "auto"}, "mappings": [{"type": "special", "options": {"match": "null", "result": {"text": "never watched", "color": "red"}}}]},
        "overrides": [
            {"matcher": {"id": "byName", "options": "watch time"}, "properties": [{"id": "unit", "value": "s"}, {"id": "custom.cellOptions", "value": {"type": "color-text"}}, {"id": "color", "value": {"mode": "thresholds"}}, {"id": "thresholds", "value": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}}]},
        ],
    },
    "options": {"showHeader": True, "cellHeight": "sm", "footer": {"show": True, "reducer": ["count"], "fields": ["channel"]}},
})
y += 16

panels.append(stat("Channels in catalogue", [dispatcharr_catalogue("A"), ersatztv_catalogue("B")], 0, y, w=6, ds=INFINITY_DS,
                   transformations=[{"id": "merge", "options": {}}, {"id": "reduce", "options": {"reducers": ["count"], "mode": "reduceFields", "includeTimeField": False}}, {"id": "filterFieldsByName", "options": {"include": {"names": ["channel"]}}}]))

# ============================================================
# Dashboard
# ============================================================
dashboard = {
    "dashboard": {
        "id": None,
        "uid": "channel-club",
        "title": "Channel Club - Viewing",
        "tags": ["channel-club", "iptv", "loki"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 1,
        "refresh": "1m",
        "time": {"from": "now-7d", "to": "now"},
        "editable": True,
        "graphTooltip": 1,
        "panels": panels,
        "templating": {
            "list": [
                {
                    "name": "user", "label": "User", "type": "query", "datasource": LOKI_DS,
                    "query": {"label": "record_extra_user", "stream": '{container="channel-club"} | json | record_extra_event="session.start"', "type": 1, "refId": "LokiVariableQueryEditor-VariableQuery"},
                    "definition": "label_values(record_extra_user)",
                    "includeAll": True, "multi": True, "allValue": ".*", "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
                    "refresh": 2, "sort": 1,
                },
                {
                    "name": "view", "label": "View", "type": "custom", "query": "live,ersatztv",
                    "options": [{"text": "All", "value": "$__all", "selected": True}, {"text": "live", "value": "live", "selected": False}, {"text": "ersatztv", "value": "ersatztv", "selected": False}],
                    "includeAll": True, "multi": True, "allValue": ".*", "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
                },
            ]
        },
        "annotations": {"list": [{"builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"}, "enable": True, "hide": True, "iconColor": "rgba(0, 211, 255, 1)", "name": "Annotations & Alerts", "type": "dashboard"},
            # Deploys: each start of the app logs server.start with its version and build
            {
                "name": "Deploys", "datasource": LOKI_DS, "enable": True, "hide": False, "iconColor": "orange",
                "expr": '{container="channel-club"} | json | record_extra_event="server.start"',
                "titleFormat": "Server start", "textFormat": "{{record_extra_version}} build {{record_extra_build_id}}",
            },
        ]},
        "links": [{"title": "Channel Club", "type": "link", "url": "https://tv.example.com", "targetBlank": True}],
    },
    "overwrite": True,
    "message": "Channel Club viewing dashboard",
}

OUTPUT_PATH = Path(__file__).parent / "dashboards" / "channel-club.json"


def main(path: Path = OUTPUT_PATH) -> None:
    with open(path, "w") as f:
        json.dump(dashboard, f, indent=2)

    print(f"Dashboard generated: {len(panels)} panels")
    print(f"Written to {path}")


# Importable without writing: the backend contract test reads `dashboard`.
if __name__ == "__main__":
    main()
