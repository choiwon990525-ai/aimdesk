"use strict";
/* ─────────────────────────────────────────────────────────
   에임데스크 시각 검사기 — 좌표 추정 대신 실제 렌더를 잰다.

     node tools/audit.js              페이지 2개 × 폭 1280 · 768 · 375 전부
     node tools/audit.js 375          한 폭만
     node tools/audit.js posture      한 페이지만 (파일명 일부로 고름)
     node tools/audit.js --shots      섹션 스크린샷도 저장
     node tools/audit.js --contrast   명도 대비를 접지 않고 전부 나열

   검사 항목
     1 콘솔 에러 · 페이지 예외
     2 가로 오버플로우 (페이지 가로스크롤 / 뷰포트 밖 요소)
     3 명도 대비 WCAG 2.1 (본문 4.5:1 · 큰 글자 3:1)
     4 탭 타겟 44px — 의사요소 오버레이까지 elementFromPoint 로 실측
     5 요소 가림 — 각 인터랙티브 요소가 제 영역을 얼마나 뺏겼는지
     6 SVG text — getBBox 로 뷰박스 이탈 · 라벨끼리 겹침 · 도형 위 올라탐

   주의: elementFromPoint 는 보이는 뷰포트에서만 동작한다. 그래서 요소마다
   scrollIntoView 로 화면 가운데에 올린 뒤 잰다 (스티키 헤더를 피하려고 center).
   ───────────────────────────────────────────────────────── */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT  = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "shots");

/* 정적 페이지 목록. 새 페이지를 만들면 여기에 추가한다 —
   빠뜨리면 그 페이지는 아무도 안 본다 */
const FILES = ["index.html", "posture.html"];

const args   = process.argv.slice(2);
const SHOT   = args.includes("--shots");
const FULLC  = args.includes("--contrast");
const picked = args.filter(a => /^\d+$/.test(a)).map(Number);
const WIDTHS = picked.length ? picked : [1280, 768, 375];

/* 숫자도 --옵션도 아닌 인자는 페이지 이름 조각으로 본다 */
const pick  = args.filter(a => !/^\d+$/.test(a) && !a.startsWith("--"));
const PAGES = FILES
  .filter(f => !pick.length || pick.some(q => f.includes(q)))
  .map(f => ({
    file: f,
    slug: f.replace(/\.html$/, ""),
    url:  "file:///" + path.join(ROOT, f).split(path.sep).join("/"),
    here: fs.existsSync(path.join(ROOT, f))
  }));

const TAP_MIN  = 44;
const CONTRAST = 4.5;

/* ══ 페이지 안에서 도는 측정 코드 ══════════════════════ */
function collect(opts) {
  const { TAP_MIN, CONTRAST } = opts;
  const out = { overflow: [], contrast: [], tap: [], tapInline: [], occluded: [], svg: [] };
  const vw = window.innerWidth;

  const shown = el => el.checkVisibility
    ? el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true, opacityProperty: true })
    : true;
  const name = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const c = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
    if (c.length) s += "." + c.slice(0, 3).join(".");
    return s;
  };
  const txt = el => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 34);

  /* ── 2 가로 오버플로우 ── */
  const doc = document.documentElement;
  out.pageScrollX = doc.scrollWidth > Math.ceil(vw) ? doc.scrollWidth - vw : 0;
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    let inScroller = false;
    for (let p = el.parentElement; p; p = p.parentElement)
      if (getComputedStyle(p).overflowX !== "visible") { inScroller = true; break; }
    if (inScroller) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1 || r.left < -1)
      out.overflow.push({ el: name(el), text: txt(el),
        left: +r.left.toFixed(1), right: +r.right.toFixed(1), vw });
  }

  /* ── 3 명도 대비 ── */
  const parse = c => {
    const m = (c || "").match(/[\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? parseFloat(m[3]) : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = el => {
    let acc = null;
    for (let p = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (!c || c.a === 0) continue;
      acc = acc ? over(acc, c) : c;
      if (acc.a >= 0.999) return acc;
    }
    return acc || { r: 255, g: 255, b: 255, a: 1 };
  };
  const rgb = c => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
  const check = (el, fgRaw, size, weight, label) => {
    const fg = parse(fgRaw); if (!fg) return;
    const bg = bgOf(el);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const big = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = big ? 3 : CONTRAST;
    const got = ratio(eff, bg);
    if (got < need)
      out.contrast.push({ el: label, text: txt(el), ratio: +got.toFixed(2), need,
        size: +size.toFixed(1), fg: rgb(eff), bg: rgb(bg) });
  };
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    check(el, s.color, parseFloat(s.fontSize), parseInt(s.fontWeight) || 400, name(el));
  }
  for (const t of document.querySelectorAll("svg text")) {
    if (!(t.textContent || "").trim()) continue;
    const s = getComputedStyle(t);
    check(t, s.fill, parseFloat(t.getAttribute("font-size")) || parseFloat(s.fontSize),
          parseInt(t.getAttribute("font-weight")) || 400, "svg text «" + txt(t) + "»");
  }

  /* ── 4·5 탭 타겟 + 가림 ──
     44px 는 손가락 기준이라 pointer:coarse 일 때만 불합격으로 센다.
     마우스 환경의 작은 컨트롤은 의도된 것이므로 크기만 참고로 남긴다 */
  out.coarse = matchMedia("(pointer:coarse)").matches;
  const owns = (hit, el) => !!hit && (hit === el || el.contains(hit));
  /* WCAG 2.5.8 은 「문장 안에 흐르는 링크」를 44px 기준에서 뺀다.
     글줄 한가운데 링크를 44px 로 키우면 줄 간격이 무너지고, 그건 이 사이트에서
     본문 리듬을 깨는 짓이다. 대신 따로 세어 보여준다 — 조용히 넘기지는 않는다 */
  const inlineText = el => el.tagName === "A" && getComputedStyle(el).display === "inline"
    && !!el.parentElement
    && (el.parentElement.textContent || "").trim() !== (el.textContent || "").trim();
  for (const el of document.querySelectorAll("button, a[href], select, input, summary, [role=button]")) {
    if (!shown(el)) continue;
    /* behavior:instant 가 필수 — html{scroll-behavior:smooth} 면 스크롤이 비동기라
       바로 뒤에 읽는 좌표가 이동 전 값이고 elementFromPoint 가 전부 빗나간다 */
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;

    const P = 40, S = 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let x = r.left - P; x <= r.right + P; x += S)
      for (let y = r.top - P; y <= r.bottom + P; y += S) {
        if (x < 0 || y < 0 || x > vw - 1 || y > vh - 1) continue;
        if (!owns(document.elementFromPoint(x, y), el)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    const hw = x1 >= x0 ? x1 - x0 + S : 0, hh = y1 >= y0 ? y1 - y0 + S : 0;
    if (hw < TAP_MIN || hh < TAP_MIN)
      (inlineText(el) ? out.tapInline : out.tap).push({ el: name(el), text: txt(el),
        box: `${r.width.toFixed(0)}x${r.height.toFixed(0)}`, hit: `${hw.toFixed(0)}x${hh.toFixed(0)}` });

    /* 줄바꿈된 인라인 링크는 getBoundingClientRect 가 두 줄을 통째로 감싼 상자라
       가운데가 텅 비어 있다. 그 빈 곳을 「가림」으로 세면 안 된다 —
       줄 조각(getClientRects)마다 따로 훑는다. 블록 요소면 조각이 하나라 결과가 같다 */
    const CX = 24, CY = 6; let lost = 0, total = 0; const thieves = {};
    for (const q of el.getClientRects()) {
      if (q.width < 1 || q.height < 1) continue;
      /* 테두리에서 1px 안쪽만 훑는다. 글줄 조각의 마지막 1px 미만은 elementFromPoint 가
         바깥으로 반올림해서 「가림」으로 잡히는데 실제로 가린 건 없다 (실측 0.78px).
         진짜 가림은 이 테두리보다 훨씬 넓게 덮으므로 이 여유로 놓치지 않는다 */
      const ix = Math.min(1, q.width / 4), iy = Math.min(1, q.height / 4);
      const L = q.left + ix, T = q.top + iy, W = q.width - ix * 2, H = q.height - iy * 2;
      for (let i = 0; i < CX; i++) for (let j = 0; j < CY; j++) {
        const x = L + W * (i + 0.5) / CX, y = T + H * (j + 0.5) / CY;
        if (x < 0 || y < 0 || x > vw - 1 || y > vh - 1) continue;
        total++;
        const hit = document.elementFromPoint(x, y);
        if (owns(hit, el)) continue;
        lost++; const k = hit ? name(hit) : "(없음)"; thieves[k] = (thieves[k] || 0) + 1;
      }
    }
    if (lost) out.occluded.push({ el: name(el), text: txt(el), lost, total,
      pct: +(lost / total * 100).toFixed(1),
      by: Object.entries(thieves).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ") });
  }

  /* ── 6 SVG ──
     getBBox() 는 그 요소의 로컬 사용자 좌표다. 회전 <g> 안이면 루트 좌표로 환산해야 한다.
     getCTM() 은 viewBox 배율까지 섞인 뷰포트 좌표라 쓰면 안 된다 — getScreenCTM 끼리 나눈다. */
  for (const svg of document.querySelectorAll("svg[viewBox]")) {
    const [, , VW, VH] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
    const rootInv = svg.getScreenCTM() && svg.getScreenCTM().inverse();
    const toRoot = el => {
      const b = el.getBBox();
      const m = rootInv && el.getScreenCTM() ? rootInv.multiply(el.getScreenCTM()) : null;
      if (!m) return { x: b.x, y: b.y, w: b.width, h: b.height };
      const pt = (px, py) => { const p = svg.createSVGPoint(); p.x = px; p.y = py; return p.matrixTransform(m); };
      const cs = [pt(b.x, b.y), pt(b.x + b.width, b.y), pt(b.x, b.y + b.height), pt(b.x + b.width, b.y + b.height)];
      const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
      return { x: Math.min(...xs), y: Math.min(...ys),
               w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const hit = (a, b) => {
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return ox > 0.5 && oy > 0.5 ? { ox, oy } : null;
    };
    const inside = (a, b) => a.x >= b.x - .5 && a.y >= b.y - .5 &&
                             a.x + a.w <= b.x + b.w + .5 && a.y + a.h <= b.y + b.h + .5;

    /* 회전 <g> 안의 요소끼리는 각자의 로컬 좌표로 비교해야 정확하다.
       루트 좌표로 환산하면 기울어진 사각형의 축정렬 상자가 부풀어 오탐이 난다 */
    const ctxOf = el => {
      for (let p = el.parentNode; p && p !== svg; p = p.parentNode)
        if (p.getAttribute && p.getAttribute("transform")) return p;
      return svg;
    };
    const raw = el => { const b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };

    const texts = [];
    for (const t of svg.querySelectorAll("text")) {
      if (!(t.textContent || "").trim()) continue;
      let bb; try { bb = toRoot(t); } catch (e) { continue; }
      const label = (t.textContent || "").trim().slice(0, 24);
      if (bb.x < -0.5 || bb.y < -0.5 || bb.x + bb.w > VW + 0.5 || bb.y + bb.h > VH + 0.5)
        out.svg.push({ svg: svg.id, kind: "이탈", a: label, view: `${VW}x${VH}`,
          box: `x=[${bb.x.toFixed(1)},${(bb.x + bb.w).toFixed(1)}] y=[${bb.y.toFixed(1)},${(bb.y + bb.h).toFixed(1)}]` });
      texts.push({ el: t, ctx: ctxOf(t), label, root: bb, loc: raw(t) });
    }
    const pair = (a, b) => a.ctx === b.ctx ? [a.loc, b.loc] : [a.root, b.root];
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const [A, B] = pair(texts[i], texts[j]);
      const h = hit(A, B);
      if (h) out.svg.push({ svg: svg.id, kind: "겹침", a: texts[i].label, b: texts[j].label,
        area: `${h.ox.toFixed(1)}x${h.oy.toFixed(1)}` });
    }
    /* ── 선이 글자를 관통하는지 ──
       도형(칠해진 면)만 보던 사각지대였다. 실제로 「나」 세로선이 선수 이름을 뚫고 지나갔는데
       텍스트↔텍스트와 텍스트↔면만 검사해서 못 잡았다.
       글자 상자를 1유닛 안쪽으로 좁혀서, 스치는 선이 아니라 진짜 관통만 센다 */
    const segHitsRect = (x1,y1,x2,y2,r) => {
      let t0 = 0, t1 = 1;
      const dx = x2-x1, dy = y2-y1;
      const P = [-dx, dx, -dy, dy];
      const Q = [x1-r.x, r.x+r.w-x1, y1-r.y, r.y+r.h-y1];
      for (let i=0;i<4;i++){
        if (P[i] === 0){ if (Q[i] < 0) return false; continue; }
        const t = Q[i]/P[i];
        if (P[i] < 0){ if (t > t1) return false; if (t > t0) t0 = t; }
        else         { if (t < t0) return false; if (t < t1) t1 = t; }
      }
      return t1 > t0;
    };
    const ptToRoot = (el,x,y) => {
      const m = rootInv && el.getScreenCTM() ? rootInv.multiply(el.getScreenCTM()) : null;
      if (!m) return { x, y };
      const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m);
    };
    for (const ln of svg.querySelectorAll("line")) {
      const st = ln.getAttribute("stroke");
      if (!st || st === "none") continue;
      let a, b; try {
        a = ptToRoot(ln, +ln.getAttribute("x1"), +ln.getAttribute("y1"));
        b = ptToRoot(ln, +ln.getAttribute("x2"), +ln.getAttribute("y2"));
      } catch (e) { continue; }
      for (const t of texts) {
        const pad = Math.min(2, t.root.h*0.22);
        const box = { x:t.root.x+pad, y:t.root.y+pad, w:t.root.w-pad*2, h:t.root.h-pad*2 };
        if (box.w <= 0 || box.h <= 0) continue;
        if (segHitsRect(a.x,a.y,b.x,b.y,box))
          out.svg.push({ svg: svg.id, kind:"관통", a: t.label,
            b: `line ${(+ln.getAttribute("stroke-width")||1)}폭`, area:"글자 위" });
      }
    }

    /* 칠해진 도형 위에 글자가 걸치는지. 도형이 글자를 통째로 품으면 배경이므로 넘어간다 */
    for (const sh of svg.querySelectorAll("rect, circle")) {
      const f = (sh.getAttribute("fill") || "").trim();
      /* url() 채움(해치 패드)도 도형이다. 제외했더니 라벨이 패드 테두리에 걸치는 걸 못 잡았다 */
      if (!f || f === "none") continue;
      let s; try { s = { ctx: ctxOf(sh), root: toRoot(sh), loc: raw(sh) }; } catch (e) { continue; }
      for (const t of texts) {
        const [A, B] = pair(t, s);
        const h = hit(A, B);
        if (h && !inside(A, B))
          out.svg.push({ svg: svg.id, kind: "도형", a: t.label,
            b: `${sh.tagName} fill=${f}`, area: `${h.ox.toFixed(1)}x${h.oy.toFixed(1)}` });
      }
    }
  }
  return out;
}

/* ══ 리포트 ══════════════════════════════════════════ */
const P = s => process.stdout.write(s + "\n");
const rule = c => P(c.repeat(74));

(async () => {
  if (SHOT) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  let fails = 0;

  /* 없는 파일은 조용히 건너뛰지 않는다 — 「조용한 실패」 함정 */
  const gone = PAGES.filter(p => !p.here);
  if (gone.length) {
    fails += gone.length;
    rule("═"); P("  ✘ 목록에 있는데 파일이 없는 페이지");
    gone.forEach(p => P("      " + p.file));
  }

  /* 페이지 × 폭을 미리 펼쳐 둔다 */
  const RUNS = [];
  for (const pg of PAGES.filter(p => p.here))
    for (const width of WIDTHS) RUNS.push({ pg, width });

  for (const { pg, width } of RUNS) {
    /* 사이트의 모바일 분기(≤680px)는 터치 환경으로 본다 — 그래야 pointer:coarse 규칙이 걸린다 */
    const touch = width <= 680;
    const ctx  = await browser.newContext({ viewport: { width, height: 900 },
                                            deviceScaleFactor: 2, hasTouch: touch });
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
    page.on("pageerror", e => errs.push("pageerror: " + e.message));

    await page.goto(pg.url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    const r = await page.evaluate(collect, { TAP_MIN, CONTRAST });

    rule("═");
    P(`  ${pg.file}   ${width}px   pointer: ${r.coarse ? "coarse (터치)" : "fine (마우스)"}`);
    rule("═");

    const sec = (title, list, fmt) => {
      if (!list.length) { P(`  ✔ ${title}`); return; }
      fails += list.length;
      P(`  ✘ ${title} — ${list.length}건`);
      list.forEach(x => P("      " + fmt(x)));
    };

    sec("콘솔 에러", errs, x => x);
    if (r.pageScrollX) { fails++; P(`  ✘ 페이지 가로스크롤 ${r.pageScrollX}px`); }
    else P("  ✔ 페이지 가로스크롤 없음");
    sec("뷰포트 밖 요소", r.overflow, x => `${x.el} «${x.text}» x=[${x.left},${x.right}] vw=${x.vw}`);

    /* 대비는 같은 색 조합이 수십 건씩 나오므로 접어서 보여준다 */
    if (!r.contrast.length) P(`  ✔ 명도 대비 (본문 ${CONTRAST}:1 · 큰 글자 3:1)`);
    else if (FULLC) sec(`명도 대비`, r.contrast,
      x => `${x.ratio}:1 (필요 ${x.need}) ${x.size}px ${x.el} «${x.text}»  ${x.fg} on ${x.bg}`);
    else {
      fails += r.contrast.length;
      const g = new Map();
      for (const c of r.contrast) {
        const k = `${c.fg}|${c.bg}|${c.ratio}|${c.need}`;
        if (!g.has(k)) g.set(k, { ...c, n: 0, ex: [] });
        const v = g.get(k); v.n++; if (v.ex.length < 3) v.ex.push(c.text || c.el);
      }
      P(`  ✘ 명도 대비 (본문 ${CONTRAST}:1 · 큰 글자 3:1) — ${r.contrast.length}건 / 색조합 ${g.size}종`);
      [...g.values()].sort((a, b) => a.ratio - b.ratio).forEach(v =>
        P(`      ${v.ratio}:1 (필요 ${v.need})  ${v.fg} on ${v.bg}  ×${v.n}  예: ${v.ex.join(" · ")}`));
      P(`      (전체 나열은 --contrast)`);
    }

    if (r.coarse) {
      sec(`탭 타겟 ${TAP_MIN}px 미만`, r.tap, x => `${x.el} «${x.text}» 상자 ${x.box} → 실제 히트 ${x.hit}`);
      /* WCAG 2.5.8 인라인 예외. 불합격은 아니지만 몇 개인지는 보이게 둔다 */
      if (r.tapInline.length)
        P(`  · 문장 안 링크 ${r.tapInline.length}건 — 인라인 예외라 안 셈 (${
          r.tapInline.map(x => `«${x.text}» ${x.hit}`).join(" · ")})`);
    }
    else if (!r.tap.length) P(`  ✔ 탭 타겟 ${TAP_MIN}px 이상 (pointer:fine 이라 기준 미적용)`);
    else P(`  · 탭 타겟 — pointer:fine 이라 불합격으로 세지 않음 (${r.tap.length}건: ${
      [...new Set(r.tap.map(x => x.hit))].join(" · ")})`);
    sec("가려진 인터랙티브 요소", r.occluded, x => `${x.el} «${x.text}» ${x.lost}/${x.total} (${x.pct}%) 가림: ${x.by}`);
    sec("SVG 라벨 이탈·겹침", r.svg, x =>
        x.kind === "이탈" ? `[${x.svg}] 이탈 «${x.a}» ${x.box} 뷰박스 ${x.view}`
      : x.kind === "겹침" ? `[${x.svg}] 겹침 «${x.a}» × «${x.b}» ${x.area}`
      : x.kind === "관통" ? `[${x.svg}] 관통 «${x.a}» 를 ${x.b} 이 가로지름`
      :                     `[${x.svg}] 도형 «${x.a}» 위에 ${x.b} ${x.area}`);

    if (SHOT) {
      const secs = await page.$$("header, section, footer");
      for (let i = 0; i < secs.length; i++)
        await secs[i].screenshot({ path: path.join(SHOTS, `${pg.slug}-${width}-${String(i).padStart(2, "0")}.png`) }).catch(() => {});
      P(`  · 스크린샷 ${secs.length}장 → tools/shots/`);
    }
    await ctx.close();
  }

  await browser.close();
  rule("─");
  P(fails ? `  합계 ${fails}건` : "  전부 통과");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
