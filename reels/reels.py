#!/usr/bin/env python3
"""인스타 릴스 분석 — Apify 로 모으고, 숫자로 정리하고, (선택) Gemini 로 요약한다.

표준 라이브러리만 씁니다. 설치할 것이 없습니다.

  python reels/reels.py collect --tag 티원 --tag 롤 --limit 30    모으기 + 분석
  python reels/reels.py collect --url https://www.instagram.com/t1lol/
  python reels/reels.py import <Apify 실행 ID> ...                 이미 돌린 실행 가져오기 (추가 비용 없음)
  python reels/reels.py analyze reels/out/<폴더> --ai              다시 분석 · Gemini 요약
  python reels/reels.py usage                                      이번 달 사용량 · 최근 실행

키는 환경변수 APIFY_TOKEN · GEMINI_API_KEY 로 받습니다.
프록시가 키를 넣어 주는 환경(클라우드 세션)에서는 없어도 됩니다.
"""
import argparse
import csv
import html
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

APIFY = "https://api.apify.com/v2"
GEMINI = "https://generativelanguage.googleapis.com/v1beta"
HASHTAG_ACTOR = "apify~instagram-hashtag-scraper"   # 해시태그·키워드 → 릴스
REEL_ACTOR = "apify~instagram-reel-scraper"         # 계정·릴스 URL → 릴스
ADDONS = {"shares": "shares-count", "transcript": "transcript"}  # 플래그 → 과금 이벤트 이름
OUT = Path(__file__).resolve().parent / "out"
KST = timezone(timedelta(hours=9))
WEEK = "월화수목금토일"
MIN_N = 5   # 이보다 작은 묶음은 값을 흐리게 두고 판단을 보류한다
CTA = re.compile(r"저장|공유|댓글|팔로우")


class Fail(Exception):
    code = None   # HTTP 상태 코드 — 다시 시도할지 가를 때 쓴다


def say(*a):
    print(*a, flush=True)


# ── HTTP ─────────────────────────────────────────────────────────────

def request(method, url, body=None, headers=None, timeout=120):
    data = None if body is None else json.dumps(body).encode()
    h = {"Content-Type": "application/json"} if data else {}
    h.update(headers or {})
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method=method),
                                      timeout=timeout)
    except urllib.error.HTTPError as e:
        f = Fail(f"HTTP {e.code} — {method} {url.split('?')[0]}\n{e.read().decode('utf-8', 'replace')[:400]}")
        f.code = e.code
        raise f
    except urllib.error.URLError as e:
        raise Fail(f"연결 실패 — {url.split('?')[0]} ({e.reason})")


def http(method, url, body=None, headers=None, timeout=120):
    with request(method, url, body, headers, timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def apify(method, path, body=None, **query):
    tok = os.environ.get("APIFY_TOKEN")
    q = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    return http(method, f"{APIFY}{path}{'?' + q if q else ''}", body,
                {"Authorization": f"Bearer {tok}"} if tok else None)


def dataset_items(ds):
    items, off = [], 0
    while True:
        page = apify("GET", f"/datasets/{ds}/items", format="json", clean=1, offset=off, limit=1000)
        items += page
        if len(page) < 1000:
            return items
        off += 1000


def actor_name(act_id, cache={}):
    if act_id not in cache:
        a = apify("GET", f"/acts/{act_id}")["data"]
        cache[act_id] = f"{a['username']}~{a['name']}"
    return cache[act_id]


def estimate(actor, n, addons):
    """최대 비용 — 가장 비싼 요금 등급 기준. 과금 방식이 다르면 None."""
    info = (apify("GET", f"/acts/{actor}")["data"].get("pricingInfos") or [{}])[-1]
    events = (info.get("pricingPerEvent") or {}).get("actorChargeEvents")
    if not events:
        return None
    usd = 0
    for key, ev in events.items():
        tiers = ev.get("eventTieredPricingUsd")
        price = max(t["tieredEventPriceUsd"] for t in tiers.values()) if tiers else ev.get("eventPriceUsd") or 0
        if ev.get("isOneTimeEvent") or "start" in key:
            usd += price
        elif not ev.get("eventTitle", "").startswith("Add-on") or key in addons:
            usd += price * n
    return usd


def run_actor(actor, inp, max_items, max_usd):
    r = apify("POST", f"/acts/{actor}/runs", inp, waitForFinish=60,
              maxItems=max_items, maxTotalChargeUsd=max_usd)["data"]
    t0 = time.time()
    while r["status"] in ("READY", "RUNNING", "TIMING-OUT", "ABORTING"):
        say(f"  … 실행 중 {int(time.time() - t0)}초")
        r = apify("GET", f"/actor-runs/{r['id']}", waitForFinish=60)["data"]
    if r["status"] != "SUCCEEDED":
        say(f"  ! {r['status']} — {r.get('statusMessage') or ''} (받은 만큼만 씁니다)")
    return r


def settle(run, items):
    """결과당 과금은 실행이 끝나고 몇 초 뒤에 비용에 잡힌다 — 끝난 직후엔 $0 으로 보인다."""
    for _ in range(6):
        if run.get("usageTotalUsd") or not items:
            return run
        time.sleep(5)
        run = apify("GET", f"/actor-runs/{run['id']}")["data"]
    return {**run, "usageTotalUsd": None} if items else run


def record(run, actor, inp, items):
    return {"id": run["id"], "actor": actor, "input": inp, "status": run["status"],
            "usd": run.get("usageTotalUsd"), "finished": run.get("finishedAt"), "items": len(items)}


def save(runs, items, name):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    # 폴더 이름은 영문만 — 윈도우에서 한글 경로가 인코딩 문제를 일으킨다
    tail = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")
    d = OUT / (stamp + ("-" + tail if tail else ""))
    d.mkdir(parents=True)
    done = [r["finished"] for r in runs if r["finished"]]
    meta = {"collected_at": max(done) if done else datetime.now(timezone.utc).isoformat(), "runs": runs}
    (d / "raw.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), "utf-8")
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
    say(f"저장 {len(items)}개 → {d}")
    return d


# ── 명령 ─────────────────────────────────────────────────────────────

def split(vals, strip_hash=False):
    out = [v.strip() for s in vals for v in s.split(",") if v.strip()]
    return [v.lstrip("#") for v in out] if strip_hash else out


def cmd_collect(a):
    tags, urls = split(a.tag, True), split(a.url)
    if not tags and not urls:
        raise Fail("--tag 나 --url 중 하나는 있어야 합니다")
    if a.limit < 1:
        raise Fail("--limit 는 1 이상이어야 합니다")
    jobs = []
    if tags:
        jobs.append(("태그 " + ", ".join(tags), HASHTAG_ACTOR,
                     {"hashtags": tags, "keywordSearch": not a.exact, "resultsType": "reels",
                      "resultsLimit": a.limit}, len(tags) * a.limit, ()))
    if urls:
        addons = [ADDONS[k] for k in ADDONS if getattr(a, k)]
        jobs.append(("URL " + ", ".join(urls), REEL_ACTOR,
                     {"username": urls, "resultsLimit": a.limit,
                      "includeSharesCount": a.shares, "includeTranscript": a.transcript},
                     len(urls) * a.limit, addons))
    elif a.shares or a.transcript:
        say("! --shares · --transcript 는 --url 수집에만 붙습니다 (태그 수집은 공유 수가 있으면 그냥 옵니다)")

    lim = apify("GET", "/users/me/limits")["data"]
    left = lim["limits"]["maxMonthlyUsageUsd"] - lim["current"]["monthlyUsageUsd"]
    say(f"이번 달 남은 크레딧 ${left:.3f}")
    cap = a.max_usd / len(jobs)

    runs, items = [], []
    for label, actor, inp, n, addons in jobs:
        est = estimate(actor, n, addons)
        say(f"{label} — 최대 {n}개 · 예상 ≤ ${est:.3f}" if est is not None else f"{label} — 최대 {n}개",
            f"· 상한 ${cap:.2f}")
        r = run_actor(actor, inp, n, cap)
        got = dataset_items(r["defaultDatasetId"])
        r = settle(r, got)
        cost = f"${r['usageTotalUsd']:.4f}" if r.get("usageTotalUsd") is not None else "집계 전 (usage 로 확인)"
        say(f"  받음 {len(got)}개 · 비용 {cost} · 실행 {r['id']}")
        runs.append(record(r, actor, inp, got))
        items += got
    if not items:
        raise Fail("받은 결과가 없습니다 — 태그·URL 철자와 계정 공개 여부를 확인하세요")
    a.dir = save(runs, items, a.name)
    cmd_analyze(a)


def cmd_import(a):
    runs, items = [], []
    for rid in a.run_ids:
        r = apify("GET", f"/actor-runs/{rid}")["data"]
        actor = actor_name(r["actId"])
        try:
            inp = apify("GET", f"/key-value-stores/{r['defaultKeyValueStoreId']}/records/INPUT")
        except Fail:
            inp = None
        try:
            got = dataset_items(r["defaultDatasetId"])
        except Fail as e:
            raise Fail(f"{rid} 결과를 못 받았습니다 — 보존 기간(무료 플랜 7일)이 지났을 수 있습니다\n{e}")
        say(f"{rid} {actor} — {len(got)}개")
        runs.append(record(r, actor, inp, got))
        items += got
    if not items:
        raise Fail("가져온 결과가 없습니다")
    a.dir = save(runs, items, a.name)
    cmd_analyze(a)


def cmd_usage(a):
    me = apify("GET", "/users/me")["data"]
    lim = apify("GET", "/users/me/limits")["data"]
    cyc, L, C = lim["monthlyUsageCycle"], lim["limits"], lim["current"]
    say(f"플랜 {me['plan']['id']} · 이번 달 ${C['monthlyUsageUsd']:.3f} / ${L['maxMonthlyUsageUsd']:.2f}"
        f" · 주기 {cyc['startAt'][:10]} ~ {cyc['endAt'][:10]} · 결과 보존 {L['dataRetentionDays']}일")
    runs = apify("GET", "/actor-runs", desc=1, limit=a.n)["data"]["items"]
    if runs:
        say(f"\n최근 실행 {len(runs)}개 — `import <ID>` 로 가져올 수 있습니다")
    for r in runs:
        try:
            inp = apify("GET", f"/key-value-stores/{r['defaultKeyValueStoreId']}/records/INPUT")
            what = next((", ".join(map(str, inp[k])) if isinstance(inp[k], list) else str(inp[k])
                         for k in ("hashtags", "username", "keywords", "search", "postUrls") if inp.get(k)), "")
        except Fail:
            what = ""
        when = parse_ts(r["startedAt"]).astimezone(KST).strftime("%m-%d %H:%M")
        say(f"  {r['id']}  {when}  {r['status']:<9} ${r.get('usageTotalUsd') or 0:.4f}"
            f"  {actor_name(r['actId'])}  {what[:60]}")


# ── 정리 ─────────────────────────────────────────────────────────────

def parse_ts(s):
    if not s:
        return None
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def count(v):
    # 좋아요를 숨긴 릴스는 -1 이 온다 — 0 으로 세면 참여율이 틀린다
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


def source_of(u):
    if not u:
        return "URL 지정"
    p = urllib.parse.urlparse(u)
    path = urllib.parse.unquote(p.path).strip("/").split("/")
    q = urllib.parse.parse_qs(p.query).get("q")
    if q:
        return q[0]                                   # explore/search/keyword/?q=티원
    if path[:2] == ["explore", "tags"] and len(path) > 2:
        return "#" + path[2]
    if path[0] == "popular" and len(path) > 1:
        return path[1].replace("-", " ")
    if not path[0] or path[0] in ("p", "reel", "reels"):
        return "URL 지정"
    return "@" + path[0]


def from_details(it):
    """data-slayer~instagram-post-details 결과를 apify 스크래퍼 모양으로 — 저장 수가 여기만 있다."""
    m, u, cap = it.get("metrics") or {}, it.get("user") or {}, it.get("caption")
    text = (cap or {}).get("text") if isinstance(cap, dict) else cap or ""
    return {"shortCode": it.get("code"), "ownerUsername": u.get("username"),
            "timestamp": it.get("taken_at_date"), "videoPlayCount": m.get("play_count"),
            "likesCount": m.get("like_count"), "commentsCount": m.get("comment_count"),
            "sharesCount": m.get("share_count"), "savesCount": m.get("save_count"),
            "videoDuration": it.get("video_duration"), "caption": text,
            "hashtags": re.findall(r"#(\w+)", text or "")}


def normalize(raw, at):
    rows, skipped, merged = {}, Counter(), 0
    for it in raw:
        if "code" in it and "metrics" in it:
            it = from_details(it)
        code = it.get("shortCode")
        views = next((v for v in (count(it.get(k)) for k in
                      ("videoPlayCount", "igPlayCount", "videoViewCount")) if v is not None), None)
        if it.get("error") or not code:
            skipped["오류·식별자 없음"] += 1
            continue
        if views is None:
            skipped["조회수 없음 (사진·캐러셀)"] += 1
            continue
        posted = parse_ts(it.get("timestamp"))
        music = it.get("musicInfo") or {}
        orig = music.get("uses_original_audio") if music else None
        cap = it.get("caption") or ""
        tr = it.get("transcript") or ""
        if isinstance(tr, list):
            tr = " ".join(x.get("text", "") if isinstance(x, dict) else str(x) for x in tr)
        r = {
            "code": code, "url": f"https://www.instagram.com/reel/{code}/",
            "sources": {source_of(it.get("inputUrl"))}, "owner": it.get("ownerUsername") or "",
            "posted": posted.astimezone(KST) if posted else None, "views": views,
            "likes": count(it.get("likesCount")), "comments": count(it.get("commentsCount")),
            "shares": count(it.get("sharesCount")), "saves": count(it.get("savesCount")),
            "duration": count(it.get("videoDuration")), "orig_audio": orig,
            "song": None if orig or not music else
                    " — ".join(x for x in (music.get("artist_name"), music.get("song_name")) if x) or None,
            "paid": bool(it.get("paidPartnership")),
            "tags": sorted({t.lower() for t in it.get("hashtags") or []}),
            "caption": cap, "hook": next((l.strip() for l in cap.splitlines() if l.strip()), "")[:60],
            "transcript": str(tr).strip(),
        }
        if code in rows:
            # 같은 릴스가 여러 실행에 걸리면 하나로 — 먼저 온 값을 두고 빈 칸만 채운다 (저장 수는 상세 스크래퍼만 준다)
            old = rows[code]
            old["sources"] |= r["sources"]
            for k, v in r.items():
                if old[k] in (None, "", []) and v not in (None, "", []):
                    old[k] = v
            merged += 1
        else:
            rows[code] = r

    for r in rows.values():
        v, p = r["views"], r["posted"]
        rate = (lambda x: x / v if v and x is not None else None)
        r["age"] = max((at - p).total_seconds() / 86400, 0) if p else None
        r["vpd"] = v / max(r["age"], 1) if r["age"] is not None else None
        r["like_rate"], r["comment_rate"] = rate(r["likes"]), rate(r["comments"])
        r["share_rate"], r["save_rate"] = rate(r["shares"]), rate(r["saves"])
        r["er"] = rate(r["likes"] + r["comments"]) if None not in (r["likes"], r["comments"]) else None
    return list(rows.values()), skipped, merged


# ── 통계 ─────────────────────────────────────────────────────────────

def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def fmt_n(v):
    if v is None:
        return "—"
    if v >= 1e8:
        return f"{v / 1e8:.1f}억"
    if v >= 1e4:
        return f"{v / 1e4:.1f}만"
    return f"{v:,.0f}"


def pct(v, d=1):
    return "—" if v is None else f"{v * 100:.{d}f}%"


def sec(v):
    return "—" if v is None else f"{v:.0f}초"


def dur_bucket(r):
    d = r["duration"]
    if d is None:
        return None
    return next(lab for lim, lab in ((10, "~10초"), (20, "10~20초"), (30, "20~30초"),
                                     (60, "30~60초"), (1e9, "60초~")) if d < lim)


def hour_bucket(r):
    if not r["posted"]:
        return None
    h = r["posted"].hour
    return ("새벽 0~6시", "오전 6~12시", "오후 12~18시", "저녁 18~24시")[h // 6]


def cap_bucket(r):
    n = len(r["caption"])
    return next(lab for lim, lab in ((30, "~30자"), (100, "30~100자"), (300, "100~300자"),
                                     (1e9, "300자~")) if n < lim)


def audio_kind(r):
    return {True: "원본 오디오", False: "음원 사용"}.get(r["orig_audio"], "정보 없음")


# ── 보고서 ───────────────────────────────────────────────────────────

esc = html.escape


def table(head, body, few=()):
    """head = [(이름, 숫자열인가)], body = [[셀 HTML]]. few 에 든 줄은 흐리게."""
    th = "".join(f'<th{" class=n" if num else ""}>{esc(h)}</th>' for h, num in head)
    tr = []
    for i, row in enumerate(body):
        tds = "".join(f'<td class="{"n" if num else ("t" if h in ("첫 줄", "캡션") else "")}">{c}</td>'
                      for (h, num), c in zip(head, row))
        tr.append(f'<tr{" class=few" if i in few else ""}>{tds}</tr>')
    return f'<div class=tw><table><thead><tr>{th}</tr></thead><tbody>{"".join(tr)}</tbody></table></div>'


GROUP_HEAD = [("묶음", False), ("n", True), ("조회수 중앙값", True), ("하루 조회수", True),
              ("참여율", True), ("공유율", True), ("길이", True)]


def group_table(rows, keyfn, order=None, first="묶음"):
    g = defaultdict(list)
    for r in rows:
        for k in keyfn(r):
            if k is not None:
                g[k].append(r)
    keys = [k for k in order if k in g] if order else sorted(g, key=lambda k: -len(g[k]))
    body, few = [], set()
    for i, k in enumerate(keys):
        rs = g[k]
        if len(rs) < MIN_N:
            few.add(i)
        body.append([esc(str(k)), f"{len(rs)}{' · 보류' if len(rs) < MIN_N else ''}",
                     fmt_n(med(r["views"] for r in rs)), fmt_n(med(r["vpd"] for r in rs)),
                     pct(med(r["er"] for r in rs)), pct(med(r["share_rate"] for r in rs)),
                     sec(med(r["duration"] for r in rs))])
    return table([(first, False)] + GROUP_HEAD[1:], body, few) if body else "<p class=note>데이터 없음</p>"


def reel_table(rs):
    head = [("계정", False), ("출처", False), ("조회수", True), ("하루 조회수", True), ("참여율", True),
            ("공유율", True), ("길이", True), ("게시 (KST)", False), ("첫 줄", False)]
    body = [[f'<a href="{esc(r["url"])}">@{esc(r["owner"])}</a>', esc(" · ".join(sorted(r["sources"]))),
             fmt_n(r["views"]), fmt_n(r["vpd"]), pct(r["er"]), pct(r["share_rate"]), sec(r["duration"]),
             r["posted"].strftime("%y-%m-%d ") + WEEK[r["posted"].weekday()] if r["posted"] else "—",
             esc(r["hook"])] for r in rs]
    return table(head, body)


def md_html(text, rows):
    """Gemini 답(마크다운 일부)을 HTML 로. 본문에 나온 shortCode 는 릴스 링크로 바꾼다."""
    codes = sorted((r["code"] for r in rows), key=len, reverse=True)
    pat = re.compile(r"(?<![\w-])(" + "|".join(map(re.escape, codes)) + r")(?![\w-])") if codes else None

    def inline(s):
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", esc(s))
        return pat.sub(r'<a href="https://www.instagram.com/reel/\1/">\1</a>', s) if pat else s

    out, ul = [], False
    for line in text.splitlines():
        s = line.strip()
        li = s.startswith(("- ", "* "))
        if ul and not li:
            out.append("</ul>")
            ul = False
        if not s:
            continue
        if s.startswith("#"):
            out.append(f"<h3>{inline(s.lstrip('#').strip())}</h3>")
        elif li:
            if not ul:
                out.append("<ul>")
                ul = True
            out.append(f"<li>{inline(s[2:])}</li>")
        else:
            out.append(f"<p>{inline(s)}</p>")
    if ul:
        out.append("</ul>")
    return "\n".join(out)


CSS = """
:root{--bg:#fff;--fg:#1b1e22;--mute:#6b7280;--rule:#e3e5e8;--card:#f5f6f8}
@media (prefers-color-scheme:dark){:root{--bg:#101215;--fg:#e6e8eb;--mute:#9aa1a9;--rule:#2a2f36;--card:#181b20}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);word-break:keep-all;overflow-wrap:break-word;
 font:15px/1.65 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:1120px;margin:0 auto;padding:36px 16px 96px}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:18px;margin:44px 0 6px;padding-top:18px;border-top:1px solid var(--rule)}
h3{font-size:15px;margin:20px 0 4px}
p{margin:6px 0}
.sub,.note{color:var(--mute);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin:22px 0}
.card{background:var(--card);padding:12px 14px;font-size:13px;color:var(--mute)}
.card b{display:block;font-size:21px;color:var(--fg);font-variant-numeric:tabular-nums}
.tw{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid var(--rule);text-align:left;white-space:nowrap;vertical-align:top}
th{font-weight:600;color:var(--mute)}
.n{text-align:right;font-variant-numeric:tabular-nums}
td.t{white-space:normal;min-width:240px}
tr.few td{color:var(--mute)}
a{color:inherit}
ul{padding-left:20px;margin:6px 0}
.ai{background:var(--card);padding:6px 18px 14px}
"""


def report(rows, skipped, merged, meta, ai):
    srcs = Counter(s for r in rows for s in r["sources"])
    title = " · ".join(s for s, _ in srcs.most_common(4)) + (" 외" if len(srcs) > 4 else "")
    at = parse_ts(meta["collected_at"]).astimezone(KST)
    usd = sum(r.get("usd") or 0 for r in meta["runs"])
    unsettled = any(r.get("usd") is None for r in meta["runs"])
    with_sh = sum(r["share_rate"] is not None for r in rows)
    with_sv = sum(r["save_rate"] is not None for r in rows)
    mv = med(r["views"] for r in rows)
    searched = {s.lstrip("#@").lower().replace(" ", "") for s in srcs}

    H = [f"<h1>릴스 분석 — {esc(title)}</h1>",
         f'<p class=sub>수집 {at:%Y-%m-%d %H:%M} KST · Apify 실행 {len(meta["runs"])}회 · '
         f'{esc(" · ".join(f"{a} ×{n}" if n > 1 else a for a, n in Counter(r["actor"] for r in meta["runs"]).items()))}</p>',
         "<div class=cards>",
         f"<div class=card>릴스<b>{len(rows)}</b></div>",
         f"<div class=card>출처<b>{len(srcs)}</b></div>",
         f"<div class=card>조회수 중앙값<b>{fmt_n(mv)}</b></div>",
         f"<div class=card>참여율 중앙값<b>{pct(med(r['er'] for r in rows))}</b></div>",
         f"<div class=card>공유율 중앙값<b>{pct(med(r['share_rate'] for r in rows))}</b>{with_sh}/{len(rows)}개에만 있음</div>",
         f"<div class=card>수집 비용<b>${usd:.3f}</b>{'일부 집계 전' if unsettled else ''}</div>",
         "</div>"]
    notes = [f"중복 {merged}개는 하나로 합쳤습니다 (출처는 모두 셈)"] if merged else []
    notes += [f"{k} {v}개 제외" for k, v in skipped.items()]
    if notes:
        H.append(f"<p class=note>{esc(' · '.join(notes))}</p>")

    H += ["<h2>출처별</h2>",
          "<p class=note>해시태그·키워드·계정마다. 한 릴스가 여러 출처에 걸리면 양쪽에 다 셉니다.</p>",
          group_table(rows, lambda r: r["sources"], first="출처")]

    top = sorted(rows, key=lambda r: -r["views"])[:10]
    H += ["<h2>조회수 상위 10</h2>", reel_table(top)]
    pool = [r for r in rows if r["er"] is not None and mv is not None and r["views"] >= mv]
    H += ["<h2>참여율 상위 10</h2>",
          "<p class=note>조회수 중앙값 이상인 릴스 중에서만 — 조회수가 작으면 좋아요 몇 개로 비율이 튑니다.</p>",
          reel_table(sorted(pool, key=lambda r: -r["er"])[:10])]
    if with_sv:
        sv = sorted((r for r in rows if r["save_rate"] is not None), key=lambda r: -r["save_rate"])[:10]
        H += ["<h2>저장율 상위</h2>", f"<p class=note>저장 수가 있는 {with_sv}개만.</p>",
              table([("계정", False), ("조회수", True), ("저장", True), ("저장율", True), ("첫 줄", False)],
                    [[f'<a href="{esc(r["url"])}">@{esc(r["owner"])}</a>', fmt_n(r["views"]),
                      fmt_n(r["saves"]), pct(r["save_rate"], 2), esc(r["hook"])] for r in sv])]

    H += ["<h2>길이</h2>",
          group_table(rows, lambda r: [dur_bucket(r)], ["~10초", "10~20초", "20~30초", "30~60초", "60초~"], "길이"),
          "<h2>게시 시각 (KST)</h2>",
          group_table(rows, lambda r: [WEEK[r["posted"].weekday()] if r["posted"] else None], list(WEEK), "요일"),
          group_table(rows, lambda r: [hour_bucket(r)],
                      ["새벽 0~6시", "오전 6~12시", "오후 12~18시", "저녁 18~24시"], "시간대"),
          "<h2>오디오</h2>",
          group_table(rows, lambda r: [audio_kind(r)], ["원본 오디오", "음원 사용", "정보 없음"], "오디오")]
    songs = Counter(r["song"] for r in rows if r["song"])
    if any(n > 1 for n in songs.values()):
        H += ["<h3>두 번 이상 쓰인 음원</h3>",
              group_table([r for r in rows if songs.get(r["song"], 0) > 1], lambda r: [r["song"]], first="음원")]

    H += ["<h2>캡션</h2>",
          "<p class=note>참여 유도 = 캡션에 「저장 · 공유 · 댓글 · 팔로우」 중 하나가 있음.</p>",
          group_table(rows, lambda r: ["참여 유도 있음" if CTA.search(r["caption"]) else "없음"],
                      ["참여 유도 있음", "없음"], "문구"),
          group_table(rows, lambda r: [cap_bucket(r)], ["~30자", "30~100자", "100~300자", "300자~"], "캡션 길이")]

    tags = Counter(t for r in rows for t in r["tags"])
    common = {t for t, n in tags.most_common(20) if n > 1}
    if common:
        H += ["<h2>함께 쓰인 해시태그</h2>",
              "<p class=note>두 번 이상 나온 것 중 상위 20. (검색어) 표시는 수집에 쓴 말과 같은 태그입니다.</p>",
              group_table(rows, lambda r: [t + (" (검색어)" if t in searched else "") for t in r["tags"]
                                           if t in common], first="해시태그")]

    owners = Counter(r["owner"] for r in rows if r["owner"])
    if any(n > 1 for n in owners.values()):
        H += ["<h2>두 번 이상 나온 계정</h2>",
              group_table([r for r in rows if owners[r["owner"]] > 1], lambda r: ["@" + r["owner"]], first="계정")]

    if ai:
        H += ["<h2>Gemini 요약</h2>",
              "<p class=note>캡션과 지표만 보고 쓴 글입니다. 영상은 안 봤습니다. "
              "링크된 릴스를 직접 열어 맞는지 확인하세요.</p>",
              f"<div class=ai>{md_html(ai, rows)}</div>"]

    H += ["<h2>읽을 때 주의</h2><ul>",
          "<li><b>표본이 무작위가 아닙니다.</b> 인스타 검색·프로필 결과라 인기·최신 쪽으로 쏠려 있습니다. "
          "「이 해시태그 릴스 전체」를 대표하지 않습니다.</li>",
          "<li><b>조회수는 수집 시점의 누적값입니다.</b> 오래된 릴스일수록 유리합니다. "
          "하루 조회수(조회수 ÷ 경과일)는 반대로 최근 릴스에 유리합니다. 둘을 같이 보세요.</li>",
          "<li><b>참여율 = (좋아요 + 댓글) ÷ 조회수.</b> 공유·저장 수는 일부 릴스에만 있어서 참여율에 넣지 않고 "
          f"따로 냈습니다 (공유 {with_sh}개 · 저장 {with_sv}개). 있는 것과 없는 것을 섞으면 같은 자로 잰 값이 "
          "아니게 됩니다.</li>",
          f"<li><b>n &lt; {MIN_N} 인 묶음은 흐리게 두었습니다.</b> 값은 보이지만 판단은 보류하세요.</li>",
          "<li>모든 비교는 상관입니다. 「짧으면 조회수가 높다」가 보여도 짧게 만들어서 높아졌다는 뜻은 아닙니다.</li>",
          "</ul>"]

    return (f'<!doctype html><html lang=ko><head><meta charset=utf-8>'
            f'<meta name=viewport content="width=device-width,initial-scale=1">'
            f"<title>릴스 분석 — {esc(title)}</title><style>{CSS}</style></head>"
            f"<body><main>{''.join(H)}</main></body></html>")


CSV_COLS = [("shortCode", "code"), ("링크", "url"), ("출처", "sources"), ("계정", "owner"),
            ("게시_KST", "posted"), ("조회수", "views"), ("좋아요", "likes"), ("댓글", "comments"),
            ("공유", "shares"), ("저장", "saves"), ("길이_초", "duration"), ("경과일", "age"),
            ("하루조회수", "vpd"), ("참여율", "er"), ("좋아요율", "like_rate"), ("댓글률", "comment_rate"),
            ("공유율", "share_rate"), ("저장율", "save_rate"), ("원본오디오", "orig_audio"), ("음원", "song"),
            ("유료광고", "paid"), ("해시태그", "tags"), ("캡션", "caption")]


def write_csv(path, rows):
    # utf-8-sig — BOM 이 없으면 엑셀이 한글을 깨뜨린다
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(h for h, _ in CSV_COLS)
        for r in sorted(rows, key=lambda r: -r["views"]):
            out = []
            for _, k in CSV_COLS:
                v = r[k]
                if isinstance(v, (set, list)):
                    v = " ".join(sorted(v))
                elif isinstance(v, datetime):
                    v = v.strftime("%Y-%m-%d %H:%M")
                elif isinstance(v, float):
                    v = round(v, 4)
                out.append("" if v is None else v)
            w.writerow(out)


# ── Gemini ───────────────────────────────────────────────────────────

PROMPT = """아래는 인스타그램 릴스 {n}개 표본입니다. 한 줄에 릴스 하나, JSON 입니다.
{groups}

규칙
- 데이터에 있는 것만 말하세요. 숫자를 지어내지 마세요.
- 주장마다 근거가 되는 릴스의 code 를 2개 이상 괄호로 다세요.
- 표본이 작고 무작위가 아닙니다. 「경향」으로만 말하고 인과를 주장하지 마세요.
- 영상은 못 봤습니다. 캡션·지표·오디오 정보로 알 수 없는 것은 모른다고 쓰세요.
- 한국어로, 아래 제목 그대로, 각 항목은 짧은 글머리표로.

## 잘 된 릴스의 공통점
## 덜 된 릴스와 다른 점
## 첫 줄(훅) 유형
## 다음에 해볼 것 (3개, 각각 근거 포함)
## 이 표본으로는 알 수 없는 것
"""


def gemini_stream(model, body, key):
    text, last = [], {}
    with request("POST", f"{GEMINI}/models/{model}:streamGenerateContent?alt=sse", body,
                 {"x-goog-api-key": key} if key else None, timeout=300) as r:
        for raw in r:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            last = json.loads(line[5:])
            parts = (((last.get("candidates") or [{}])[0]).get("content") or {}).get("parts") or []
            text += [p.get("text", "") for p in parts if not p.get("thought")]
    return text, last


def summarize(rows, model):
    rs = sorted(rows, key=lambda r: -r["views"])

    def line(r):
        return json.dumps({
            "code": r["code"], "출처": sorted(r["sources"]), "조회수": r["views"],
            "하루조회수": round(r["vpd"]) if r["vpd"] is not None else None,
            "참여율%": round(r["er"] * 100, 2) if r["er"] is not None else None,
            "공유율%": round(r["share_rate"] * 100, 2) if r["share_rate"] is not None else None,
            "길이초": round(r["duration"]) if r["duration"] is not None else None,
            "오디오": r["song"] or audio_kind(r),
            "게시": f"{WEEK[r['posted'].weekday()]} {r['posted'].hour}시" if r["posted"] else None,
            "캡션": r["caption"][:300], **({"전사": r["transcript"][:300]} if r["transcript"] else {}),
        }, ensure_ascii=False)

    if len(rs) >= 10:
        k = min(15, len(rs) // 2)
        groups = (f"\n[조회수 상위 {k}개]\n" + "\n".join(map(line, rs[:k])) +
                  f"\n\n[조회수 하위 {k}개]\n" + "\n".join(map(line, rs[-k:])))
    else:
        groups = "\n[전체 — 표본이 작아 상위·하위로 나누지 않았습니다]\n" + "\n".join(map(line, rs))
    key = os.environ.get("GEMINI_API_KEY")
    say(f"Gemini 요약 중 ({model}) …")
    # 스트리밍으로 받는다 — 생각하는 모델은 첫 글자까지 30초를 넘기기도 해서 중간 프록시가 끊는다
    body = {"contents": [{"role": "user", "parts": [{"text": PROMPT.format(n=len(rs), groups=groups)}]}],
            "generationConfig": {"temperature": 0.3}}
    for wait in (10, 30, None):
        try:
            text, last = gemini_stream(model, body, key)
            break
        except Fail as e:
            # 429 · 5xx 는 대개 잠깐 몰린 것 — 두 번까지 다시 시도한다
            if wait is None or not (e.code == 429 or (e.code or 0) >= 500):
                raise
            say(f"  HTTP {e.code} — {wait}초 뒤 다시")
            time.sleep(wait)
    text = "".join(text).strip()
    if not text:
        raise Fail(f"빈 답 — {json.dumps(last.get('promptFeedback') or last.get('candidates'), ensure_ascii=False)[:300]}")
    return text


def cmd_analyze(a):
    d = Path(a.dir)
    try:
        meta = json.loads((d / "meta.json").read_text("utf-8"))
        raw = json.loads((d / "raw.json").read_text("utf-8"))
    except FileNotFoundError as e:
        raise Fail(f"{d} 에 raw.json · meta.json 이 없습니다 — collect 나 import 로 만든 폴더인지 확인하세요 ({e.filename})")
    rows, skipped, merged = normalize(raw, parse_ts(meta["collected_at"]))
    if not rows:
        raise Fail(f"분석할 릴스가 없습니다 — {dict(skipped)}")
    write_csv(d / "reels.csv", rows)
    ai = None
    if a.ai:
        try:
            ai = summarize(rows, a.model)
            (d / "ai.md").write_text(ai, "utf-8")
        except (Fail, OSError, ValueError) as e:
            say(f"! Gemini 요약 실패 — 나머지 보고서는 그대로 씁니다\n{e}")
    elif (d / "ai.md").exists():
        ai = (d / "ai.md").read_text("utf-8")   # 같은 raw.json 이면 지난 요약이 그대로 맞다
    (d / "report.html").write_text(report(rows, skipped, merged, meta, ai), "utf-8")
    say(f"릴스 {len(rows)}개 · 조회수 중앙값 {fmt_n(med(r['views'] for r in rows))}"
        f" · 참여율 중앙값 {pct(med(r['er'] for r in rows))}")
    say(f"→ {d / 'report.html'}\n→ {d / 'reels.csv'}")


def main():
    p = argparse.ArgumentParser(prog="reels.py", description="인스타 릴스 분석 — Apify 수집 · 지표 정리 · Gemini 요약")
    sub = p.add_subparsers(dest="cmd", required=True)

    def ai_opts(sp):
        sp.add_argument("--ai", action="store_true", help="Gemini 로 상위·하위 릴스 비교 요약")
        sp.add_argument("--model", default="gemini-flash-latest", help="Gemini 모델 (기본 gemini-flash-latest)")

    c = sub.add_parser("collect", help="Apify 로 모으고 분석")
    c.add_argument("--tag", action="append", default=[], help="해시태그·키워드. 여러 번 또는 쉼표로")
    c.add_argument("--exact", action="store_true", help="키워드 검색 대신 해시태그 페이지만")
    c.add_argument("--url", action="append", default=[], help="계정·릴스 URL 또는 아이디. 여러 번 또는 쉼표로")
    c.add_argument("--limit", type=int, default=30, help="태그·계정마다 최대 개수 (기본 30)")
    c.add_argument("--shares", action="store_true", help="--url 수집에 공유 수 (유료 추가 옵션)")
    c.add_argument("--transcript", action="store_true", help="--url 수집에 음성 전사 (유료 · 비쌈)")
    c.add_argument("--max-usd", type=float, default=0.5, help="이번 수집 비용 상한 USD (기본 0.5)")
    c.add_argument("--name", default="", help="결과 폴더 이름 뒤 꼬리표 (영문)")
    ai_opts(c)

    i = sub.add_parser("import", help="이미 돌린 Apify 실행 결과를 가져와 분석 (추가 비용 없음)")
    i.add_argument("run_ids", nargs="+", metavar="RUN_ID")
    i.add_argument("--name", default="", help="결과 폴더 이름 뒤 꼬리표 (영문)")
    ai_opts(i)

    an = sub.add_parser("analyze", help="저장된 폴더를 다시 분석")
    an.add_argument("dir")
    ai_opts(an)

    u = sub.add_parser("usage", help="이번 달 Apify 사용량과 최근 실행")
    u.add_argument("-n", type=int, default=10, help="최근 실행 몇 개 (기본 10)")

    a = p.parse_args()
    try:
        {"collect": cmd_collect, "import": cmd_import, "analyze": cmd_analyze, "usage": cmd_usage}[a.cmd](a)
    except Fail as e:
        sys.exit(f"✘ {e}")


if __name__ == "__main__":
    main()
