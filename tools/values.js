"use strict";
/* CLAUDE.md 「바꾼 뒤 반드시 확인」 1~7번을 실제 브라우저에서 돌린다.
   시각 검사(audit.js)와 달리 계산 결과가 안 흔들렸는지를 본다.   node tools/values.js */
const { chromium } = require("playwright");
const path = require("path");
/* 검사 내용이 페이지마다 달라서 audit.js 처럼 한 벌을 순회시키지 않는다.
   1~12 는 index.html, 13 은 posture.html */
const url  = f => "file:///" + path.join(__dirname, "..", f).split(path.sep).join("/");
const PAGE = url("index.html");

let bad = 0;
const eq = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "✔" : "✘"} ${label}: ${got}${ok ? "" : `  (기대 ${want})`}`);
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(PAGE);
  await p.evaluate(() => document.fonts.ready);

  const val = s => p.$eval(s, e => e.value);
  const txt = s => p.$eval(s, e => e.textContent.trim());
  const set = async (s, v) => { await p.fill(s, ""); await p.type(s, v); await p.waitForTimeout(60); };

  console.log("1 기본값");
  eq("cm/360", await txt("#resCm"), "65.3cm");
  eq("오른쪽 감도", await val("#toSens"), "0.7955");

  console.log("2 오른쪽에 1.0 입력 → 왼쪽 역산");
  await set("#toSens", "1.0");
  eq("왼쪽 감도", await val("#sens"), "0.3143");
  eq("cm/360", await txt("#resCm"), "52.0cm");

  console.log("3 ⇄ 교체");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  const before = { g: await val("#game"), tg: await val("#toGame") };
  await p.click("#swapBtn"); await p.waitForTimeout(60);
  eq("왼쪽 게임", await val("#game"), before.tg);
  eq("오른쪽 게임", await val("#toGame"), before.g);

  console.log("4 고급 cm/360 에 30");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  await p.click("details.adv > summary");
  await set("#cmIn", "30");
  eq("cm/360 반영", await txt("#resCm"), "30.0cm");

  console.log("5 감도 1.5 → 밴드");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  await set("#sens", "1.5");
  eq("밴드", await txt("#resBand"), "구간 밖 · 너무 높음");
  eq("밴드 색(빨강)", await p.$eval("#resBand", e => getComputedStyle(e).color), "rgb(226, 96, 63)");

  console.log("6 패드 300mm → 도면 경고");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  await set("#padW", "300");
  const svg = await p.$eval("#bench", e => e.textContent);
  eq("「들어야 합니다」 표시", /들어야 합니다/.test(svg), "true");

  console.log("7 프로 카드 이식 → 되돌리기");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  const orig = await val("#sens");
  await p.click("#proCards button[data-pro='0']"); await p.waitForTimeout(120);
  eq("이식 리포트 줄수", await p.$$eval("#graft .graft", n => n.length), 4);
  await p.click("#revertBtn"); await p.waitForTimeout(120);
  eq("되돌리기", await val("#sens"), orig);

  console.log("8 근거 태그");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  const tags = await p.$$eval("#constBody tr", rs => rs.map(r =>
    [r.children[0].textContent.trim(), r.querySelector(".tag").textContent.trim()]));
  for (const [g, t] of tags) console.log(`     ${g.padEnd(14)} ${t}`);
  eq("CoD · Warzone", tags.find(t => t[0].startsWith("CoD"))[1], "검증");
  eq("포트나이트", tags.find(t => t[0] === "포트나이트")[1], "검증");
  /* 예전에는 「발로란트 미지원 칸 유지」를 지켰지만 2026-08-28에 배율별로 채웠다.
     이제 지킬 것은 「하나의 숫자로 요약하지 않는다」 — CLAUDE.md 절대 바꾸지 말 것 5번.
     요약하는 순간 다시 틀린 값이 된다 */
  /* 「게임 · 설정」 헤더는 8번 섹션 근거표에만 있다 — 변환 패널의 스코프 표와 구분된다 */
  eq("근거표 행 수 (CS2 2 + 발로란트 6 + OW2 2 + Apex 3)", await p.evaluate(() =>
    [...document.querySelectorAll("table")]
      .find(t => /게임 · 설정/.test(t.textContent))
      .querySelectorAll("tbody tr").length), 13);
  eq("발로란트 배율 6종 전부 표기", await p.evaluate(() =>
    ["0.908","0.870","0.815","0.747","0.731","0.723"]
      .every(v => document.body.textContent.includes(v))), true);
  eq("Apex 근거표 — 1× 미해결 · 2×/3× 선형값", await p.evaluate(() => {
    const t = [...document.querySelectorAll("table")].find(t => /게임 · 설정/.test(t.textContent)).textContent;
    return /미해결/.test(t) && t.includes("1.111") && t.includes("1.333");
  }), true);
  /* 2026-08-28 철회분. 방향(곱셈/나눗셈)이 확인되지 않아 역수를 답으로 낼 위험이 있어
     전부 폐기했다. 다시 들어오면 여기서 걸린다 */
  eq("폐기된 Apex 배수값 없음", await p.evaluate(() =>
    ["1.332","1.209","1.220","1.136","1.818","2.500","3.333","5.000"]
      .filter(v => document.body.textContent.includes(v)).join(" ") || "없음"), "없음");

  console.log("9 스코프 패널 (변환 패널 안)");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  eq("기본 접힘", await p.$eval("#scopeBody", e => e.closest("details").open), false);
  eq("요약이 현재 게임을 따라감", await p.$eval("#scopeSum", e => e.textContent.trim()),
     "스코프 — 발로란트 배율별 조준 감도");
  /* 발로란트 팬텀 1.25× : 65.31cm ÷ 0.870 = 75.1cm, 반 바퀴 37.5cm */
  eq("팬텀 조준 cm/360", await p.$$eval("#scopeBody tbody tr", rs =>
    rs.find(r => r.textContent.includes("팬텀")).children[2].textContent.trim()), "75.1");
  /* 게임을 바꾸면 감도가 소수점 3자리로 반올림돼 cm/360 이 아주 조금 움직인다.
     발로란트 0.25 → OW2 2.652 이면 cm 65.2988, ÷0.3789 = 172.3.
     이어서 OW2 → CS2 0.796 이면 cm 65.2699, ÷0.818933 = 79.7.
     이론값(172.4 · 79.8)과 0.1 차이 나는 게 정상이다 — 반올림 누적이 그만큼이라는 뜻이고,
     이 사이트의 「반올림하면 얼마나 어긋나나」가 다루는 현상이다. */
  const pick = async g => p.evaluate(async g => {
    const s = document.querySelector("#game");
    s.value = g; s.dispatchEvent(new Event("change")); s.dispatchEvent(new Event("input"));
    await new Promise(r => setTimeout(r, 80));
    const rows = [...document.querySelectorAll("#scopeBody tbody tr")];
    return { head: document.querySelector("#scopeBody th").textContent.trim(),
             n: rows.length, first: rows[0].children[2].textContent.trim(),
             note: document.querySelector("#scopeBody .premise").textContent };
  }, g);
  const ow = await pick("ow2");
  eq("OW2 열 제목", ow.head, "영웅 · 스코프");
  eq("OW2 행 2줄", ow.n, 2);
  eq("OW2 위도우 조준 cm/360", ow.first, "172.3");
  eq("OW2 FOV 103 단서 명시", /FOV 103 기준/.test(ow.note), true);
  const cs = await pick("cs2");
  eq("CS2 열 제목", cs.head, "줌 · 무기");
  eq("CS2 행 1줄", cs.n, 1);
  eq("CS2 조준 cm/360", cs.first, "79.7");

  const ax = await p.evaluate(async () => {
    const s = document.querySelector("#game");
    s.value = "apex"; s.dispatchEvent(new Event("change")); s.dispatchEvent(new Event("input"));
    await new Promise(r => setTimeout(r, 80));
    const tb = [...document.querySelectorAll("#scopeBody table")];
    return { one: tb[0].querySelectorAll("tbody tr").length,
             main: tb[1].querySelectorAll("tbody tr").length,
             deg: tb[0].querySelectorAll("tbody tr")[0].children[2].textContent.trim(),
             fov: !document.querySelector("#scopeFov").hidden,
             body: document.querySelector("#scopeBody").textContent };
  });
  eq("Apex 1× 표 2줄 + 배율 표 6줄", `${ax.one}+${ax.main}`, "2+6");
  eq("Apex 조준 화각 (FOV 90 × 0.82)", ax.deg, "73.8°");
  eq("Apex 1× 슬라이더 값 = 미해결", /미해결/.test(ax.body), true);
  /* 4×~10× 는 「미확인」이어야 한다. 철회된 것은 「상한 2.000 초과라 불가능」이라는 단정이다
     — 「불가능하다는 뜻은 아닙니다」 같은 부정문까지 막지 않도록 단정 표현만 본다 */
  eq("Apex 4× 이상 미확인 4줄", (ax.body.match(/미확인/g) || []).length >= 4, true);
  eq("철회된 「2.000 상한이라 불가」 단정 없음",
     /못 닿|초과로 불가|2\.000/.test(ax.body), false);
  eq("Apex cm/360 환산 안 함", /적용 방향 미확인/.test(ax.body), true);
  eq("FOV 입력칸 노출", ax.fov, true);

  console.log("10 헤더 · 마크 · 파비콘");
  const hb = await p.$eval(".hbar", e => e.getBoundingClientRect().height);
  eq("헤더 막대 높이 (--hdr)", hb, 56);
  eq("header 총높이 (테두리 1px 포함)", await p.$eval("header", e => e.getBoundingClientRect().height), 57);
  const mk = await p.$eval(".brand .mk", e => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             aria: e.getAttribute("aria-hidden"),
             color: getComputedStyle(e).color };
  });
  eq("마크 크기", `${mk.w}x${mk.h}`, "20x20");
  eq("aria-hidden", mk.aria, "true");
  eq("currentColor = 글자색", mk.color, "rgb(238, 241, 244)");
  eq("마크·워드마크 간격", await p.$eval(".brand", e => getComputedStyle(e).gap), "9px");
  /* 파비콘 데이터 URI 가 실제로 디코드되는지 — 깨져도 콘솔 에러가 안 나므로 직접 그려본다 */
  eq("파비콘 디코드", await p.evaluate(() => new Promise(res => {
    const href = document.querySelector("link[rel=icon]").href;
    const i = new Image();
    i.onload = () => res(i.width > 0 && i.height > 0);
    i.onerror = () => res(false);
    i.src = href;
  })), true);

  console.log("11 팔레트 단일 출처");
  /* #resBand 의 색은 app.js 가 C.ok 로 칠한다. 그게 CSS 의 --ok 와 같은 값이면
     JS 가 CSS 를 읽어왔다는 뜻이다 — 사본이 있으면 언젠가 여기서 갈린다 */
  eq("JS 가 칠한 색 = CSS 변수", await p.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ok)";
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(document.querySelector("#resBand")).color === want;
  }), true);
  const src = require("fs").readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  eq("app.js 에 팔레트 값 복제 없음",
     ["#43C59E","#E5A93C","#E2603F","#7B8794","#EEF1F4","#96A1AE"].filter(h => src.includes(h)).join(" ") || "없음",
     "없음");


  console.log("12 검산 평면도");
  await p.reload(); await p.evaluate(() => document.fonts.ready);
  const vf = await p.evaluate(() => {
    const e = document.querySelector('#verify');
    const t = [...e.querySelectorAll('text')].map(x => x.textContent.trim());
    return { has: !!e, n: e.querySelectorAll('*').length, txt: t.join(' | '),
             vb: e.getAttribute('viewBox'),
             bench: document.querySelector('#bench').getAttribute('viewBox') };
  });
  eq("#verify 존재", vf.has, true);
  eq("#bench 와 같은 좌표계", vf.vb, vf.bench);
  eq("한 바퀴 라벨", /한 바퀴 = 65.3cm/.test(vf.txt), true);
  eq("반 바퀴 라벨", /반 바퀴 32.7cm/.test(vf.txt), true);
  eq("시작 · 패드 끝 표시", /시작/.test(vf.txt) && /패드 끝/.test(vf.txt), true);
  /* 패드를 900mm 로 키우면 한 바퀴가 패드 안에 들어와 「패드 끝」이 사라져야 한다 */
  eq("패드가 넉넉하면 「패드 끝」 없음", await p.evaluate(async () => {
    const e=document.querySelector('#padW'); e.value='900'; e.dispatchEvent(new Event('input'));
    await new Promise(r=>setTimeout(r,60));
    return /패드 끝/.test(document.querySelector('#verify').textContent);
  }), false);


  console.log("13 「일부러 안 넣은 것」 표 — 자세 항목 일부 복귀");
  await p.goto(PAGE); await p.evaluate(() => document.fonts.ready);
  const lo = await p.evaluate(() => {
    const s = document.querySelector("#left-out");
    return { keys: [...s.querySelectorAll("tbody tr")].map(r => r.children[0].textContent.trim()),
             rows: s.querySelectorAll("tbody tr").length,
             link: !!s.querySelector('a[href="posture.html"]'),
             cols: s.querySelectorAll("thead th").length };
  });
  eq("표 3열 유지 (열 늘리지 않음)", lo.cols, 3);
  eq("뺀 기능 6줄 유지", lo.rows, 6);
  eq("기능 칸 이름 — 자세 점수", lo.keys.includes("자세 점수 · 집계식"), true);
  eq("기능 칸 이름 — 키보드 각도", lo.keys.includes("키보드 각도 — 크기"), true);
  eq("기능 칸 이름 — 높이", lo.keys.includes("높이 — cm 단위 지시"), true);
  eq("자세 페이지 링크", lo.link, true);

  console.log("14 자세 페이지 (posture.html)");
  await p.goto(url("posture.html")); await p.evaluate(() => document.fonts.ready);
  const po = await p.evaluate(() => {
    const li = [...document.querySelectorAll(".chk > li")];
    const probe = document.createElement("span");
    probe.style.color = "var(--chalk)"; document.body.appendChild(probe);
    const chalk = getComputedStyle(probe).color; probe.remove();
    return { n: li.length,
             tagged: li.filter(l => l.querySelector(".ct .tag")).length,
             body: document.body.textContent.replace(/\s+/g, " "),
             /* 지시문(제목 + 본문)과 각주(.premise)를 나눠 본다. 각주에서 「이 숫자는 안 씁니다」라고
                밝히는 것과, 지시문에서 그 숫자를 시키는 것은 정반대다 */
             instr: li.map(l => [...l.querySelectorAll("p:not(.premise)")]
                      .map(e => e.textContent).join(" ")).join(" ").replace(/\s+/g, " "),
             script: document.querySelectorAll("script").length,
             /* 점수를 낼 수 있는 입력 장치가 하나도 없어야 한다 */
             widgets: document.querySelectorAll("input,progress,meter,output,select").length,
             back: !!document.querySelector('a.brand[href="index.html"]'),
             /* 링크 색이 분필색이어야 한다 — 파란 기본 링크면 근거등급 신호가 깨진다 */
             linkOK: [...document.querySelectorAll("section a")]
               .every(a => getComputedStyle(a).color === chalk) };
  });
  eq("체크리스트 5줄", po.n, 5);
  eq("5줄 전부 근거 태그", po.tagged, 5);
  eq("점수용 입력 요소 0개", po.widgets, 0);
  eq("「점수를 내지 않습니다」 선언", /점수를 내지 않습니다/.test(po.body), true);
  /* 「총점」이라는 낱말 자체는 「총점을 안 냅니다」라고 밝히려면 필요하다.
     막아야 하는 건 낱말이 아니라 실제로 매겨진 숫자다 */
  eq("매겨진 점수 없음", /\d+\s*점(?!수)|\/\s*100\b/.test(po.body), false);
  /* 스크립트가 없으면 점수를 계산할 방법 자체가 없다 — 가장 센 보장이다 */
  eq("스크립트 0개 (계산 수단 없음)", po.script, 0);
  eq("헤더에 index 로 돌아가는 링크", po.back, true);
  eq("링크에 색 안 씀 (분필색)", po.linkOK, true);
  /* 2026-08-28 확정. research/04 의 「반시계 · 오른쪽 끝을 앞으로」는 폐기됐다.
     방향 부호가 뒤집히면 정반대 지시가 되므로 서술 표현만 남긴다 —
     CLAUDE.md 「research/ 안의 폐기된 주장」 */
  eq("회전 방향 확정 표현", /오른쪽 끝을 몸쪽으로/.test(po.body), true);
  eq("폐기된 회전 표현 없음", /반시계|시계 방향|오른쪽 끝을 앞으로/.test(po.body), false);
  /* 지시문에는 각도도 cm 도 없어야 한다. 각주에서 「이 숫자는 근거가 모자라 안 씁니다」라고
     밝히는 건 오히려 지켜야 할 것이므로 .premise 는 제외하고 본다 */
  eq("지시문에 각도 수치 없음", /\d+\s*°|\d+~\d+/.test(po.instr), false);
  eq("지시문에 cm 수치 없음", /\d+\s*cm/.test(po.instr), false);

  console.log("15 두 페이지가 공유하는 사본");
  /* 빌드 도구가 없어 헤더 마크와 파비콘이 복제돼 있다. 한쪽만 고치면 여기서 갈린다 */
  const fs2 = require("fs");
  const grab = (f, re) => (fs2.readFileSync(path.join(__dirname, "..", f), "utf8").match(re) || [""])[0];
  for (const [what, re] of [["마크 SVG", /<svg class="mk"[\s\S]*?<\/svg>/],
                            ["범례",     /<div class="legend">[\s\S]*?<\/div>\s*<\/div>/],
                            ["파비콘",   /<link rel="icon"[^>]*>/]]) {
    const a = grab("index.html", re), b = grab("posture.html", re);
    eq(`${what} 두 페이지 동일`, a && a === b ? "같음" : "갈림", "같음");
  }

  eq("페이지 예외 0", errs.length, 0);
  await b.close();
  console.log(bad ? `\n✘ ${bad}건 어긋남` : "\n✔ 전부 통과");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
