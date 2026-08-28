"use strict";

/* ── 팔레트 ──
   유일한 정의는 styles.css 의 :root 다. 여기서는 읽기만 한다.
   SVG 표현 속성(fill="…")은 var() 를 못 받으므로 값 자체가 필요한데,
   그렇다고 사본을 두면 어긋난다 — 실제로 --chalk3 를 고칠 때 CSS 만 바꿔서
   도면과 인라인 스타일 42곳이 옛 색으로 남은 적이 있다. 그래서 실행 시점에 읽어온다.
   app.js 는 </body> 직전에 로드되므로 이 시점엔 스타일이 이미 적용돼 있다. */
const C = {};
(function palette(){
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["ink","slab","rule","rule2","chalk","chalk2","chalk3","ok","mid","bad"])
    C[k] = cs.getPropertyValue("--" + k).trim();
  /* 스타일시트가 안 붙으면 도면이 통째로 사라진다. 조용히 깨지지 않게 알린다 */
  if (!C.ok || !C.chalk3)
    console.error("팔레트를 못 읽었습니다 — styles.css 의 :root 변수를 확인하세요", C);
})();

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const num = el => { const v = parseFloat(el.value); return isNaN(v) ? null : v; };
/* 계측기는 자릿수를 고정한다. Math.round(v*10)/10 이면 52.0 이 "52" 로 나와
   tabular-nums 로 맞춰둔 자릿수 정렬이 65.3 옆에서 무너진다. cm 표시 3곳에만 쓴다 */
const r1 = v => v.toFixed(1);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const IN = 2.54;
/* SVG 라벨 폭 어림 — 계수는 브라우저 실측(표본 55개)으로 맞췄습니다.
     모노 (IBM Plex Mono + 한글 폴백) : 넓은 글자 1.00em · 나머지 0.60em  → 최대오차 5.6%
     본문 (IBM Plex Sans KR)          : 넓은 글자 0.89em · 공백 0.26em · 나머지 0.55em
   화살표 ←→ 는 모노 폰트에 없어 한글과 같이 폴백되므로 넓은 글자로 셉니다.
   좁은 글자로 세던 탓에 「← 감도 높음」 폭을 12% 낮게 잡고 있었습니다. */
/* tw() 는 어림이라 최대 6% 남짓 틀린다. 뷰박스 경계를 잡을 때는 이만큼 부풀려 쓴다 —
   「나 10.9cm (범위 밖)」에서 6.4% 모자라 라벨이 왼쪽으로 2.2유닛 삐져나간 적이 있다 */
const TWPAD = 1.09;
const WIDE = /[가-힣㄰-㆏—·←→×⇄°]/;
const tw = (t,px,sans) => {
  let w = 0;
  for (const c of t)
    w += WIDE.test(c) ? px*(sans ? 0.89 : 1)
       : c === " "    ? px*(sans ? 0.26 : 0.6)
       :                px*(sans ? 0.55 : 0.6);
  return w;
};
const isMob = () => (typeof window.matchMedia === "function")
  ? window.matchMedia("(max-width:680px)").matches : window.innerWidth <= 680;
let MOB = isMob();

/* ── 게임 상수. yaw = 감도 1.0에서 1카운트가 만드는 회전각(도) ── */
const GAMES = {
  valorant : {n:"발로란트",       yaw:0.07,   ev:"ok",  step:0.001, hint:"예: 0.25"},
  cs2      : {n:"CS2",           yaw:0.022,  ev:"ok",  step:0.01,  hint:"예: 0.80"},
  csgo     : {n:"CS:GO",         yaw:0.022,  ev:"ok",  step:0.01,  hint:"CS2와 동일"},
  apex     : {n:"Apex Legends",  yaw:0.022,  ev:"ok",  step:0.01,  hint:"Source 계열"},
  ow2      : {n:"오버워치 2",     yaw:0.0066, ev:"ok",  step:0.01,  hint:"예: 5.0"},
  cod      : {n:"CoD · Warzone", yaw:0.0066, ev:"ok",  step:0.01,  hint:"기본 조준 기준"},
  fortnite : {n:"포트나이트",     yaw:0.5555, ev:"ok",  step:0.1, scale:0.01, hint:"%로 입력 (예: 7)"}
};
const EVTXT = {ok:["검증","t-ok"], mid:["추론","t-mid"], bad:["미지원","t-bad"]};
const SRC = {
  valorant:["게임 엔진 상수. 다수 출처 일치","2026-08-28"],
  cs2     :["m_yaw 기본값. 발로란트↔CS2 3.18182 배율로 교차검증","2026-08-28"],
  csgo    :["CS2와 같은 m_yaw","2026-08-28"],
  apex    :["Source 계열 — CS2와 동일 값이라는 출처 다수","2026-08-28"],
  ow2     :["다수 출처 일치","2026-08-28"],
  cod     :["오버워치2와 동일 yaw(1:1 변환). 발로란트 대비 배율 10.6061과 교차확인했고 0.07÷0.0066이 그 값에 맞습니다. 힙파이어 기준이며 조준(ADS)은 별개입니다","2026-08-28"],
  fortnite:["발로란트 대비 배율 0.1260과 교차확인했고 0.07÷0.5555=0.12601로 맞습니다. 다만 슬라이더와 FOV에 의존하는 값이라 엔진 상수는 아니고, FOV 설정이 다르면 어긋납니다","2026-08-28"]
};

const eff     = (g,v) => v * (GAMES[g].scale || 1);
const cm360   = (g,dpi,s) => (360*IN)/(GAMES[g].yaw * eff(g,s) * dpi);
const convert = (from,to,dpi,s,toDpi) =>
  (GAMES[from].yaw * eff(from,s) * dpi) / (GAMES[to].yaw * (toDpi||dpi)) / (GAMES[to].scale || 1);
const sensForCm = (g,dpi,cm) => (360*IN)/(GAMES[g].yaw * dpi * cm) / (GAMES[g].scale || 1);

/* ── 프로 10인 (대회 방송·본인 공개 자료 교차확인) ── */
const PROS = [
  {g:"CS",  n:"ZywOo",    t:"Vitality",   dpi:400,  s:2.00,  cm:52.0, mon:'24.5"', pad:"Pulsar Chosen",        pw:null, ph:null},
  {g:"CS",  n:"donk",     t:"Spirit",     dpi:800,  s:1.25,  cm:41.6, mon:'24.5"', pad:"QcK Large",            pw:450,  ph:400},
  {g:"CS",  n:"ropz",     t:"Vitality",   dpi:400,  s:1.77,  cm:58.7, mon:'24.5"', pad:"VAXEE PA",             pw:480,  ph:400},
  {g:"CS",  n:"m0NESY",   t:"Falcons",    dpi:400,  s:2.30,  cm:45.2, mon:'24.5"', pad:"QcK Heavy",            pw:450,  ph:400},
  {g:"CS",  n:"sh1ro",    t:"Spirit",     dpi:800,  s:1.04,  cm:50.0, mon:'24.5"', pad:"QcK Heavy",            pw:450,  ph:400},
  {g:"VAL", n:"primmie",  t:"Full Sense", dpi:800,  s:0.32,  cm:51.0, mon:'24.5"', pad:"Artisan Zero Soft",    pw:null, ph:null},
  {g:"VAL", n:"invy",     t:"Paper Rex",  dpi:1600, s:0.135, cm:60.5, mon:"미확인", pad:"Artisan Ninja FX Zero",pw:null, ph:null},
  {g:"VAL", n:"keiko",    t:"NRG",        dpi:800,  s:0.25,  cm:65.3, mon:'24"',   pad:"Artisan Raiden FX XL", pw:490,  ph:420},
  {g:"VAL", n:"vo0kashu", t:"DRG",        dpi:800,  s:0.211, cm:77.4, mon:'24.5"', pad:"VAXEE PD250",          pw:null, ph:null},
  {g:"VAL", n:"Derke",    t:"Vitality",   dpi:400,  s:0.74,  cm:44.1, mon:'24.5"', pad:"Logitech G640",        pw:460,  ph:400}
];
/* ── 스코프 배율 — 십자선 기준(0% 매칭) ──
   값의 근거와 한계는 「조준 · 스코프」 섹션 각주에 있습니다. 하나의 숫자로 요약하지 마세요.
   calc:false 는 설정값을 곱하는 방향이 확인되지 않아 cm/360 환산을 내지 않는다는 뜻입니다.
   값은 문자열로 둡니다 — 0.870 을 숫자로 두면 0.87 로 찍혀 자릿수가 무너집니다.
   계산에는 +r 로 씁니다. */
const SCOPE = {
  ow2:{lab:"영웅", col:"영웅 · 스코프", calc:true, pct:true,
    note:`<b>FOV 103 기준입니다.</b> 오버워치 2는 시야각을 바꿀 수 있고, 바꾸면 이 값도 달라집니다.`,
    rows:[
      ["위도우메이커 · 아나","저격 스코프 · 약 2.0×","37.89%"],
      ["애쉬",              "조준경 · 약 1.6×",    "51.47%"]]},
  valorant:{lab:"배율", col:"배율 · 무기", calc:true, rows:[
    ["1.15×","스팅어 · 스펙터 · 아레스 · 오딘","0.908"],
    ["1.25×","불독 · 팬텀 · 밴달",           "0.870"],
    ["1.5×", "가디언 · 헤드헌터",             "0.815"],
    ["2.5×", "오퍼레이터 1단 · 투르 드 포스",  "0.747"],
    ["3.5×", "마샬 · 아웃로",                "0.731"],
    ["5×",   "오퍼레이터 2단",               "0.723"]]},
  cs2 :{lab:"줌", col:"줌 · 무기", calc:true, rows:[["1단 줌","AWP · SSG 08","0.818933"]]},
  csgo:{lab:"줌", col:"줌 · 무기", calc:true, rows:[["1단 줌","AWP · SSG 08","0.818933"]]},
  /* 2×·3× 는 선형(cm/360) 매칭이라 이 사이트의 다른 조준 표(0% 매칭)와 기준이 다르다.
     4× 이상은 교차확인된 출처가 없어 미확인으로 둔다 — 「불가」라고 단정하지 않는다 */
  apex:{lab:"배율", col:"배율", calc:false, oneX:true, rows:[
    ["2×","","1.111"],["3×","","1.333"],
    ["4×","","미확인"],["6×","","미확인"],["8×","","미확인"],["10×","","미확인"]]}
};
/* ── Apex 1x ──  EA 공식 포럼에서 확인된 것은 「조준 시야가 얼마나 좁아지는가」뿐이다.
   AR·LMG·저격 18% 낮음, SMG·산탄총·권총 12% 낮음. 여기까지가 사실이다.
   슬라이더 값은 내지 않는다 — Apex 가 슬라이더를 곱하는지 나누는지 확인되지 않았고,
   방향을 모른 채 배수를 내면 역수를 답으로 내놓을 수 있다. */
const APEX_R = [["AR · LMG · 저격", 0.82, "18% 낮음"], ["SMG · 산탄총 · 권총", 0.88, "12% 낮음"]];
let GRAFT = null, PFILTER = "all", prevGame = "valorant";

/* ── 상태 ── */
const S = {};
function read(){
  S.game = $("#game").value;
  S.dpi  = num($("#dpi"))  || 800;
  S.sens = num($("#sens")) || 0.25;
  S.padW = num($("#padW")) || 450;
  S.padH = num($("#padH")) || 400;
  S.deskW = num($("#deskW")) || 140;
  S.deskD = num($("#deskD")) || 70;
  S.kbW  = parseFloat($("#kbLayout").value);
  S.fov  = clamp(num($("#apexFov")) || 90, 70, 120);   /* Apex 조준 시야 계산용 */
  S.cm   = cm360(S.game, S.dpi, S.sens);
  S.half = S.cm / 2;
  S.edpi = S.dpi * eff(S.game, S.sens);
}

/* ══ 변환 ══════════════════════════════════════════ */
function drawConvert(){
  const tg = $("#toGame").value, td = num($("#toDpi")) || S.dpi;
  const ts = convert(S.game, tg, S.dpi, S.sens, td);
  const tcm = cm360(tg, td, ts);
  const dec = GAMES[tg].scale ? 2 : 3;
  const set = (id,v) => { const e = $(id); if (e && document.activeElement !== e) e.value = v; };

  set("#toSens", +ts.toFixed(dec+1));
  set("#cmIn",  +tcm.toFixed(2));
  set("#inIn",  +(tcm/IN).toFixed(2));
  $("#toSens").step = GAMES[tg].scale ? 0.01 : 0.0001;
  $("#sensHint").textContent = GAMES[S.game].hint;
  $("#sens").step = GAMES[S.game].step;
  $("#toHint").textContent = (tg === S.game && td === S.dpi)
    ? "지금과 같은 조합입니다" : "직접 입력하면 왼쪽이 역산됩니다";

  $("#resCm").textContent   = r1(tcm) + "cm";
  $("#resHalf").textContent = r1(tcm/2) + "cm";
  $("#resEdpi").textContent = Math.round(td * eff(tg, ts));
  const inB = tcm >= 20 && tcm <= 80, b = $("#resBand");
  b.textContent = inB ? "최적 구간 안 (20~80)" : (tcm < 20 ? "구간 밖 · 너무 높음" : "구간 밖 · 너무 낮음");
  b.style.color = inB ? C.ok : C.bad;
  b.style.borderColor = inB ? "rgba(67,197,158,.42)" : "rgba(226,96,63,.42)";

  /* 반올림 영향 */
  const rows = [], seen = new Set();
  let worst = 0;
  for (let d = (GAMES[tg].scale ? 0 : 1); d <= dec+1; d++){
    const rv = +ts.toFixed(d);
    if (rv <= 0 || seen.has(rv)) continue;
    seen.add(rv);
    const rcm = cm360(tg, td, rv), diff = rcm - tcm, ad = Math.abs(diff);
    if (d <= dec) worst = Math.max(worst, ad);
    const col = ad < 0.3 ? C.ok : ad < 1 ? C.mid : C.bad;
    const jd  = ad < 0.3 ? "차이 없음" : ad < 1 ? "체감 경계" : "다시 적응해야 함";
    rows.push(`<tr${d===dec+1?' class="me"':""}>
      <td class="num">${rv.toFixed(d)}${GAMES[tg].scale?"%":""}
        <span style="color:${C.chalk3};font-size:11px">${d}자리${d===dec+1?" · 권장":""}</span></td>
      <td class="num">${rcm.toFixed(2)}</td>
      <td class="num" style="color:${col}">${diff>=0?"+":""}${diff.toFixed(2)}cm</td>
      <td style="color:${col};font-size:13px">${jd}</td></tr>`);
  }
  $("#roundBody").innerHTML = rows.join("");
  $("#roundNote").innerHTML = worst < 0.3
    ? `<b>이 값은 반올림해도 됩니다.</b> 자리를 줄여도 cm/360이 ${worst.toFixed(2)}cm밖에 안 움직이는데,
       패드 위에서 손으로 구분되지 않는 거리입니다.`
    : `<b>끝자리까지 넣으세요.</b> 반올림하면 cm/360이 최대 ${worst.toFixed(2)}cm 어긋납니다.
       반 바퀴 플릭으로는 ${(worst/2).toFixed(2)}cm 차이입니다.
       게임이 안 받으면 받는 만큼만 넣고, 검산 절차로 실제 값을 확인하세요.`;

  /* 전체 게임 */
  $("#convBody").innerHTML = Object.keys(GAMES).map(g => {
    const sv = (g === S.game) ? S.sens : convert(S.game, g, S.dpi, S.sens);
    const dc = GAMES[g].scale ? 2 : 3, [t,cl] = EVTXT[GAMES[g].ev];
    return `<tr class="${g===S.game?"me":""}">
      <td>${GAMES[g].n}${g===S.game?` <span style="color:${C.chalk3};font-size:11px">← 지금</span>`:""}</td>
      <td class="num">${sv.toFixed(dc)}${GAMES[g].scale?"%":""}</td>
      <td class="num">${Math.round(S.dpi*eff(g,sv))}</td>
      <td class="num">${cm360(g,S.dpi,sv).toFixed(1)}</td>
      <td class="num" style="color:${C.chalk3}">${GAMES[g].yaw}</td>
      <td><span class="tag ${cl}">${t}</span></td></tr>`;
  }).join("");

  /* 상수 */
  $("#constBody").innerHTML = Object.keys(GAMES).map(g => {
    const [t,cl] = EVTXT[GAMES[g].ev], sc = SRC[g];
    return `<tr><td>${GAMES[g].n}</td><td class="num">${GAMES[g].yaw}</td>
      <td style="font-size:13px;color:${C.chalk2}">${GAMES[g].scale?"퍼센트 (7 = 7%)":"배수 (0.25, 1.5 …)"}</td>
      <td><span class="tag ${cl}">${t}</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:${C.chalk3}">${sc[1]}</span>
        <br><span style="font-size:12.5px;color:${C.chalk3};line-height:1.7">${sc[0]}</span></td></tr>`;
  }).join("");
}

/* ══ 스코프 ════════════════════════════════════════
   설정값 자체는 모두에게 같은 상수라 표만으로 충분합니다. 여기서 더하는 건
   「그 배율로 조준하면 내 cm/360이 얼마가 되는가」 — 이건 사람마다 다릅니다. */
function drawScope(){
  const sc = SCOPE[S.game], sum = $("#scopeSum"), el = $("#scopeBody");
  $("#scopeFov").hidden = !(sc && sc.oneX);   /* Apex 에서만 시야각 입력을 낸다 */
  if (!sc){
    sum.textContent = `스코프 — ${GAMES[S.game].n}은 아직 확인하지 못했습니다`;
    el.innerHTML = `<p class="premise">${GAMES[S.game].n}의 배율별 조준 감도는 출처를 교차확인하지
      못했습니다. 확인되면 넣습니다.</p>`;
    return;
  }
  sum.textContent = `스코프 — ${GAMES[S.game].n} ${sc.lab}별 조준 감도`;
  /* 확인된 사실(조준 화각)만 계산하고 슬라이더 값은 내지 않는다 */
  const oneX = sc.oneX ? `<div class="scroll"><table>
      <thead><tr><th>1× 기본 조준 · 무기군</th><th>조준 시야</th><th>조준 화각</th><th>슬라이더 값</th></tr></thead>
      <tbody>${APEX_R.map(([n,r,d]) => `<tr>
        <td>${n}<span class="wep">힙파이어보다 ${d}</span></td>
        <td class="num" style="color:${C.chalk3}">${Math.round(r*100)}%</td>
        <td class="num">${(S.fov*r).toFixed(1)}°</td>
        <td style="color:${C.mid};font-size:13px">미해결</td></tr>`).join("")}</tbody></table></div>
    <p class="premise"><b>슬라이더는 하나인데 무기군은 둘입니다.</b>
      두 무기군의 조준 화각이 다른데 1× 슬라이더를 공유하므로 <b>한 값으로 둘 다 맞출 수 없습니다.</b>
      설정으로 해결되지 않는 게임 구조 문제입니다.
      값을 안 내놓는 이유는 따로 있습니다 — Apex가 이 슬라이더를 곱하는지 나누는지
      확인되지 않아, 배수를 계산하면 <b>역수를 답으로 내놓을 위험</b>이 있습니다.
      화각까지가 EA 공식 포럼에서 확인된 사실입니다.</p>` : "";
  const rows = sc.rows.map(([z,w,r]) => {
    let calc;
    if (sc.calc){
      /* OW2 는 퍼센트 표기라 100 으로 나눈다. 100% = 각속도 동일(cm/360 유지) */
      const cm = S.cm / (sc.pct ? parseFloat(r)/100 : +r), half = cm/2, ok = S.padW/10 >= half;
      calc = `<td class="num">${cm.toFixed(1)}</td>
              <td class="num" style="color:${ok?C.ok:C.bad}">${half.toFixed(1)}cm</td>`;
    } else {
      calc = `<td class="num" style="color:${C.chalk3}">–</td>
              <td style="color:${C.chalk3};font-size:13px">적용 방향 미확인</td>`;
    }
    return `<tr><td>${z}${w?`<span class="wep">${w}</span>`:""}</td>
      <td class="num">${r}</td>${calc}</tr>`;
  }).join("");
  el.innerHTML = oneX + `<div class="scroll"><table>
      <thead><tr><th>${sc.col}</th><th>설정값</th><th>조준 cm/360</th><th>반 바퀴</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="premise">설정값은 십자선 기준(0% 매칭)이고 게임 설정에 그대로 넣는 수입니다.
      ${sc.calc
        ? `조준 cm/360은 지금 감도에 그 값을 적용한 결과입니다. 반 바퀴가 패드(${S.padW}mm)를 넘으면 빨갛게 표시됩니다.`
        : `2×·3×의 1.111 · 1.333은 <b>선형(cm/360) 매칭</b>이라 이 사이트의 다른 조준 표(0% 매칭)와
           <b>기준이 다릅니다.</b> 슬라이더 적용 방향도 확인되지 않아 cm/360 환산은 내지 않습니다.
           4× 이상은 교차확인된 출처가 없어 미확인입니다 — 불가능하다는 뜻은 아닙니다.`}
      ${sc.note || ""}
      값의 근거와 오차는 아래 「조준 · 스코프」 표를 보세요.</p>`;
}

/* ══ 최적 구간 곡선 ════════════════════════════════
   가로축만 실제 데이터(cm/360, 로그)입니다. 세로축은 눈금이 없습니다 —
   연구는 골짜기의 위치를 보고했지 완료 시간의 절대값을 주지 않았습니다.
   눈금을 달면 없는 정밀도를 주장하게 되므로 라벨만 답니다. */
function drawBand(){
  const VW = MOB?460:800, VH = MOB?300:260, F = MOB?1.7:1;
  const fs = n => +(n*F).toFixed(1);
  /* 선 굵기도 폰트와 같은 배율을 탄다. 안 그러면 모바일에서 글자만 커지고 선은
     36% 얇아져 잉크 균형이 뒤집힌다. 세 단계뿐 —
     1 참조선(중심선·눈금·치수선) · 1.5 사물(외곽선·원) · 2.4 측정값(스윙선·나 마커) */
  const sw = n => +(n*F).toFixed(2);
  /* 왼쪽 여백은 세로축 라벨(「느림」·「빠름」) 폭이 정한다.
     모바일 fs(9.5)=16.2px 두 글자 + 축과의 간격 fs(8) 이 들어가야 한다 */
  const L = MOB?52:64, R = VW-(MOB?16:34), lo = 10, hi = 200;
  const lg = Math.log, span = lg(hi)-lg(lo);
  const x = cm => L + (lg(clamp(cm,lo,hi))-lg(lo))/span*(R-L);
  const AX = VH - fs(52), TOP = fs(26), valley = AX - fs(16);
  /* 골짜기는 20~80 의 기하 중심인 40. 편차는 log 거리의 제곱 — 양쪽 끝이 대칭으로 나빠진다 */
  const K = Math.pow(lg(hi/40),2);
  const y = cm => valley - (valley-TOP)*Math.min(1, Math.pow(lg(cm/40),2)/K);
  const T = (xx,yy,t,fill,size,anchor,weight) =>
    `<text x="${xx}" y="${yy}" fill="${fill}" font-family="IBM Plex Mono,monospace" font-size="${fs(size)}"${anchor?` text-anchor="${anchor}"`:""}${weight?` font-weight="${weight}"`:""}>${t}</text>`;
  const p = [];

  /* 최적 구간 20~80 */
  p.push(`<rect x="${x(20)}" y="${TOP}" width="${x(80)-x(20)}" height="${AX-TOP}" fill="rgba(67,197,158,.07)"/>`);
  [20,80].forEach(c => p.push(`<line x1="${x(c)}" y1="${TOP}" x2="${x(c)}" y2="${AX}" stroke="${C.ok}" stroke-opacity=".45"/>`));
  p.push(T((x(20)+x(80))/2, TOP+fs(13), "최적 구간", C.ok, 10, "middle", 600));

  /* 곡선 */
  const pts = [];
  for (let i=0;i<=80;i++){
    const cm = lo*Math.pow(hi/lo, i/80);
    pts.push(`${x(cm).toFixed(1)} ${y(cm).toFixed(1)}`);
  }
  p.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${C.chalk2}" stroke-width="2" stroke-linejoin="round"/>`);

  /* 가로축 */
  p.push(`<line x1="${L}" y1="${AX}" x2="${R}" y2="${AX}" stroke="${C.rule2}" stroke-width="${sw(1)}"/>`);
  [10,20,40,80,200].forEach(c => {
    const band = c===20||c===80;
    p.push(`<line x1="${x(c)}" y1="${AX}" x2="${x(c)}" y2="${AX+6}" stroke="${band?C.ok:C.rule2}"/>`);
    p.push(T(x(c), AX+fs(18), c, band?C.ok:C.chalk3, 10, "middle", band?600:null));
  });
  p.push(T(L, AX+fs(38), "← 감도 높음", C.chalk3, 10));
  p.push(T(R, AX+fs(38), "감도 낮음 →", C.chalk3, 10, "end"));

  /* 세로축은 눈금 없이 방향만 */
  p.push(T(L-fs(8), TOP+fs(9), "느림", C.chalk3, 9.5, "end"));
  p.push(T(L-fs(8), valley,    "빠름", C.chalk3, 9.5, "end"));

  /* 내 값 */
  const out = S.cm < lo || S.cm > hi, inB = S.cm >= 20 && S.cm <= 80;
  const col = inB ? C.ok : C.bad, mx = x(S.cm);
  p.push(`<line x1="${mx}" y1="${fs(24)}" x2="${mx}" y2="${AX+8}" stroke="${col}" stroke-width="2"/>`);
  p.push(`<circle cx="${mx}" cy="${y(S.cm)}" r="${fs(3.4)}" fill="${col}"/>`);
  const mt = `나 ${r1(S.cm)}cm${out?" (범위 밖)":""}`, mw = tw(mt, fs(12))*TWPAD;
  p.push(T(clamp(mx, 6+mw/2, VW-6-mw/2), fs(16), mt, col, 12, "middle", 600));

  const el = $("#band");
  el.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
  el.innerHTML = p.join("");
  $("#rdMine").textContent = inB ? "구간 안" : (S.cm < 20 ? "너무 높음" : "너무 낮음");
  $("#rdMine").style.color = col;
}

/* ══ 책상 평면도 — 공통 바탕 ═══════════════════════
   #bench(스윙 폭)와 #verify(검산 절차)가 같은 책상을 그린다.
   좌표계·배율·라벨 도구를 여기서 만들고 도면별 요소만 각자 얹는다.
   복제하면 한쪽만 고쳐져 어긋난다 — 팔레트 사본에서 이미 겪었다.
   p 에 바탕을 채워 돌려주고, 호출부가 제 요소를 push 한 뒤 tail() 로 마무리한다.
   순서를 이렇게 나눈 이유는 치수선·경고가 도면별 요소보다 뒤에 와야 하기 때문이다. */
/* ══ 도형 공통 도구층 ═══════════════════════════════
   좌표계가 아니라 「글자와 선을 어떻게 얹느냐」만 담는다.
   책상 평면도(benchBase)와 측면도(sideBase)는 좌표계가 서로 다르지만
   배율·라벨·장애물 회피는 같은 규칙을 써야 한다. 복제하면 한쪽만 고쳐져 어긋난다.
     OB   라벨이 올라타면 안 되는 도형 목록. 호출부가 채운다
     p    SVG 조각 배열. 호출부가 push 한 뒤 paint() 로 끝낸다 */
function figBase(VW, VH, F){
  const fs = n => +(n*F).toFixed(1);
  /* 선 굵기도 폰트와 같은 배율을 탄다. 안 그러면 모바일에서 글자만 커지고 선은
     36% 얇아져 잉크 균형이 뒤집힌다. 세 단계뿐 —
     1 참조선(중심선·눈금·치수선) · 1.5 사물(외곽선·원) · 2.4 측정값(스윙선·나 마커) */
  const sw = n => +(n*F).toFixed(2);
  const TP = (x,y,t,fill,px,anchor,weight) =>
    `<text x="${x}" y="${y}" fill="${fill}" font-family="IBM Plex Mono,monospace" font-size="${+px.toFixed(1)}"${anchor?` text-anchor="${anchor}"`:""}${weight?` font-weight="${weight}"`:""}>${t}</text>`;
  const T = (x,y,t,fill,size,anchor,weight) => TP(x,y,t,fill,fs(size),anchor,weight);

  const OB = [];
  /* 한글 어센트는 em 상자를 넘는다 — 9.5px 글자에서 9.83px (tools/audit.js 실측).
     0.88로 잡았더니 「몸 중심선」이 모니터 막대에 0.8px 물렸다 */
  const ASC = 1.05;
  /* 글자 상자가 도형에 물리면 그 도형 아래로 내린다 */
  const clearY = (y,px,ax,bx) => {
    for (const o of OB)
      if (bx > o.a && ax < o.b && y > o.t - px*ASC && y - px*ASC < o.u) y = o.u + px*(ASC+0.15);
    return y;
  };
  const p = [];
  /* 가운데 정렬 라벨: 너무 넓으면 줄이고, 도형이나 뷰박스에 물리면 옆으로 민다 */
  /* bound=[좌,우] 를 주면 그 안에 가둔다 — 패드 안에 두는 라벨이 테두리를 넘지 않게.
     안 주면 뷰박스만 본다(기존 동작) */
  const put = (x,y,t,fill,size,weight,maxW,bound) => {
    let px = fs(size), w = tw(t,px)*TWPAD;
    const lim = Math.min(VW-12, maxW || Infinity);
    if (w > lim){ px = Math.max(px*0.62, px*lim/w); w = tw(t,px)*TWPAD; }
    let lo = 6 + w/2; let hi = VW - 6 - w/2;
    if (bound){ lo = Math.max(lo, bound[0] + w/2); hi = Math.min(hi, bound[1] - w/2); }
    for (const o of OB)
      if (y > o.t - px*ASC && y - px*ASC < o.u && x > o.b) lo = Math.max(lo, o.b + fs(4) + w/2);
    p.push(TP(clamp(x, Math.min(lo,hi), hi), y, t, fill, px, "middle", weight));
  };
  const paint = id => {
    const el = $(id);
    el.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
    el.innerHTML = p.join("");
  };
  return { VW, VH, F, fs, sw, TP, T, OB, ASC, clearY, p, put, paint };
}

function benchBase(){
  const VW = MOB?460:800, VH = MOB?300:372, F = MOB?1.75:1;
  const B = figBase(VW, VH, F);
  const { fs, sw, T, OB, clearY, p, put } = B;
  const PX = MOB?16:26, PY = MOB?14:22, BOT = MOB?30:26;
  const dw = S.deskW, dd = S.deskD;
  const k = Math.min((VW - PX*2)/dw, (VH - PY*2 - BOT)/dd);     /* px per cm */
  const W = dw*k, H = dd*k, x0 = (VW-W)/2, y0 = PY;
  const cx = x0 + W/2, front = y0 + H;
  const pw = S.padW/10*k, ph = S.padH/10*k;
  const kw = S.kbW*k, kh = 13*k;
  const kbCx = cx - 19*k, kbCy = front - (9*k + kh/2);
  let padL = Math.max(kbCx + kw/2 + 2*k, cx + 3*k);
  const padT = front - 4*k - ph;
  const over = (padL + pw) > (x0 + W);
  if (over) padL = Math.max(x0 + 2, x0 + W - pw);

  const my = padT + ph*0.55, sx = padL + pw*0.5;
  const fits = S.half <= S.padW/10;
  const col = fits ? C.ok : C.bad;
  /* ── 라벨이 올라타면 안 되는 도형들 ──
     모니터 막대와 (18° 기울어진) 키보드. 라벨 배치는 이 목록을 보고 피한다. */
  const mw = 55*k, monY = y0+5, monH = 5;
  const KC = Math.cos(18*Math.PI/180), KS = Math.sin(18*Math.PI/180);
  const kbEx = (kw/2)*KC + (kh/2)*KS, kbEy = (kw/2)*KS + (kh/2)*KC;
  const kbL = kbCx-kbEx, kbR = kbCx+kbEx, kbT = kbCy-kbEy, kbB = kbCy+kbEy;
  OB.push({a:cx-mw/2, b:cx+mw/2, t:monY, u:monY+monH});   /* 모니터 */
  OB.push({a:kbL, b:kbR, t:kbT, u:kbB});                  /* 키보드 회전 bbox */

  p.push(`<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(238,241,244,.10)" stroke-width="${sw(1)}"/></pattern></defs>`);
  p.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#0F1419" stroke="${C.rule2}" stroke-width="${sw(1.5)}"/>`);
  p.push(`<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${front}" stroke="rgba(238,241,244,.16)" stroke-width="${sw(1)}" stroke-dasharray="3 5"/>`);
  p.push(`<rect x="${cx-mw/2}" y="${monY}" width="${mw}" height="${monH}" fill="${C.chalk3}"/>`);
  p.push(T(cx-mw/2, y0+fs(25), "모니터", C.chalk3, 9.5));
  /* 중심선 라벨은 모니터 막대 위에 얹히던 자리였다. 막대 아래로 비켜 앉힌다 */
  const clw = tw("몸 중심선", fs(9.5));
  p.push(T(cx+4, clearY(y0+fs(13), fs(9.5), cx+4, cx+4+clw), "몸 중심선", C.chalk3, 9.5));
  p.push(`<g transform="rotate(18 ${kbCx} ${kbCy})">
    <rect x="${kbCx-kw/2}" y="${kbCy-kh/2}" width="${kw}" height="${kh}" fill="#161C23" stroke="${C.rule2}" stroke-width="${sw(1.5)}"/>
    <rect x="${kbCx-kw/2+kw*0.10}" y="${kbCy-kh/2+kh*0.16}" width="${kh*0.62}" height="${kh*0.62}" fill="rgba(238,241,244,.28)"/></g>`);
  /* 라벨은 회전 그룹 밖에 수평으로 둔다. 제도판에서 부재 라벨이 기울면 안 읽히고,
     18° 회전 때문에 375px 에서 책상 앞변 아래로 14.8px 삐져나가기도 했다.
     키보드 회전 bbox 왼쪽 위에 붙인다 */
  p.push(T(kbL, kbT - fs(5), "키보드 " + S.kbW + "cm", C.chalk3, 9.5));
  p.push(`<rect x="${padL}" y="${padT}" width="${pw}" height="${ph}" fill="url(#hatch)" stroke="${C.chalk3}" stroke-width="${sw(1.5)}"/>`);
  p.push(T(padL+4, padT+fs(13), `패드 ${S.padW}×${S.padH}`, C.chalk3, 9.5));

  /* 치수선·책상 라벨·경고는 도면별 요소보다 뒤에 와야 한다 */
  const tail = () => {
    p.push(`<line x1="${x0}" y1="${front+fs(12)}" x2="${x0+W}" y2="${front+fs(12)}" stroke="${C.chalk3}" stroke-width="${sw(1)}"/>`);
    p.push(T(cx, front+fs(26), `책상 ${dw} × ${dd} cm`, C.chalk3, 10, "middle"));
    /* 경고는 도면 위쪽에 두면 모바일에서 뷰박스 밖으로 잘린다. 치수선 아래로 내린다 */
    if (over) p.push(T(x0+W, front+fs(38), "패드가 책상 폭을 넘습니다", C.bad, 10, "end"));
  };
  return { ...B, tail,
           k, x0, y0, W, H, cx, front, padL, padT, pw, ph, my, sx, over, fits, col };
}

/* ══ 책상 평면도 — 스윙 폭 ═════════════════════════ */
function drawBench(){
  const B = benchBase();
  const { fs, sw, put, p, k, padT, pw, ph, my, sx, fits, col } = B;
  const swing = S.half * k;
  const sL = sx - swing/2, sR = sx + swing/2;

  p.push(`<line x1="${sL}" y1="${my}" x2="${sR}" y2="${my}" stroke="${col}" stroke-width="${sw(2.4)}"/>`);
  [sL,sR].forEach(x => p.push(`<line x1="${x}" y1="${my-fs(9)}" x2="${x}" y2="${my+fs(9)}" stroke="${col}" stroke-width="${sw(2.4)}"/>`));
  p.push(`<circle cx="${sx}" cy="${my}" r="${fs(3)}" fill="${col}"/>`);
  put(sx, my-fs(17), `180° = ${S.half.toFixed(1)}cm`, col, 12, 600, pw-fs(6));
  const judge = fits
    ? ["패드 안", `${(S.padW/10 - S.half).toFixed(1)}cm 남음`]
    : [`패드 밖으로 ${(S.half - S.padW/10).toFixed(1)}cm`, "들어야 합니다"];
  /* 두 줄이 패드 아래 테두리를 넘지 않게 블록째 위로 당긴다.
     패드 크기가 작아지면 my 아래 공간이 줄어드는데 고정 오프셋이면 마지막 줄이 밖으로 나간다 */
  if (MOB) {
    const gap = fs(14), last = padT + ph - fs(5);
    const jy = Math.min(my + fs(24), last - gap);
    judge.forEach((t,i) => put(sx, jy + i*gap, t, col, 10.5, null, pw-fs(6)));
  }
  else      put(sx, my+fs(28), judge.join(" — "), col, 10.5);

  B.tail();
  B.paint("#bench");

  $("#rdNeed").textContent = S.half.toFixed(1) + "cm";
  const m = S.padW/10 - S.half;
  $("#rdPad").textContent  = (m >= 0 ? "+" : "") + m.toFixed(1) + "cm";
  $("#rdPad").style.color  = col;
}

/* ══ 검산 절차 평면도 ══════════════════════════════
   4단계 표는 순서를 말하고, 이 도면은 「어디서 어디까지」를 말한다.
   표를 대체하지 않는다. 수치는 전부 사용자 입력에서 나온다.
   색은 패드 판정 하나뿐 — 절차 단계에는 색을 쓰지 않는다 */
function drawVerify(){
  const B = benchBase();
  const { fs, sw, T, put, p, k, x0, W, padL, pw, my, col } = B;
  const deskR = x0 + W, padR = padL + pw;
  const s0 = padL + fs(6);                       /* 마우스 시작 — 패드 왼쪽 끝 */
  const eHalf = s0 + S.half*k, eFull = s0 + S.cm*k;
  const stop = deskR;
  const offDesk = eFull > stop;                  /* 책상 밖으로 나가면 잘라 그린다 */
  const cut = Math.min(eFull, stop);
  const tick = (x,c,h) => p.push(`<line x1="${x}" y1="${my-fs(h)}" x2="${x}" y2="${my+fs(h)}" stroke="${c}" stroke-width="${sw(2.4)}"/>`);

  /* 미는 경로. 판정색이 아니라 중립색이다 — 색은 패드 판정에만 쓴다 */
  p.push(`<line x1="${s0}" y1="${my}" x2="${cut}" y2="${my}" stroke="${C.chalk2}" stroke-width="${sw(2.4)}"/>`);
  tick(s0, C.chalk2, 9);
  p.push(`<circle cx="${s0}" cy="${my}" r="${fs(3)}" fill="${C.chalk2}"/>`);
  /* 패드를 넘는 지점에는 선을 긋지 않는다 — padR 은 패드 테두리와 같은 자리라
     무슨 선을 그어도 테두리에 묻혀 안 보인다(그려봤다). 경로가 해치 밖으로
     빠져나가는 것 자체가 표시이고, 라벨이 그 지점을 가리킨다 */
  /* 반 바퀴 지점 — 여기만 패드 판정색 */
  if (eHalf <= stop) tick(eHalf, col, 9);
  /* 끝 지점, 또는 책상 밖으로 이어진다는 표시 */
  if (!offDesk) tick(eFull, C.chalk2, 9);
  else [0,fs(5)].forEach(d => p.push(
    `<line x1="${cut-fs(9)+d}" y1="${my-fs(7)}" x2="${cut-fs(3)+d}" y2="${my}" stroke="${C.chalk2}" stroke-width="${sw(1.5)}"/>
     <line x1="${cut-fs(9)+d}" y1="${my+fs(7)}" x2="${cut-fs(3)+d}" y2="${my}" stroke="${C.chalk2}" stroke-width="${sw(1.5)}"/>`));

  /* 라벨은 패드 안에 가둔다. 패드 위 빈 띠는 모바일에서 48유닛뿐이라 두 줄이 안 들어가고,
     모니터 막대·몸 중심선 라벨과 부딪힌다. 패드 안은 세로로 넉넉하다.
     bound 를 주지 않으면 경로가 패드를 넘는 만큼 라벨도 테두리를 넘는다 */
  const bnd = [padL + fs(4), padR - fs(4)], lim = pw - fs(10);
  put((s0+cut)/2, my-fs(15), `한 바퀴 = ${r1(S.cm)}cm`, C.chalk, 12, 600, lim, bnd);
  /* 아래쪽 두 줄. 눈금이 my±fs(9) 까지 내려오므로 첫 줄은 fs(22) 부터다 —
     fs(13) 에 뒀더니 반 바퀴 눈금이 「패드 끝」을 관통했다.
     패드 자체 라벨(패드 500×500)이 위를 쓰고 있어 아래로 내려온 것이다 */
  p.push(T(s0, my+fs(22), "시작", C.chalk2, 9.5));
  if (eFull > padR && padR < stop) put(padR, my+fs(22), "패드 끝", C.chalk3, 9.5, null, lim, bnd);
  if (eHalf <= stop) put(eHalf, my+fs(35), `반 바퀴 ${r1(S.half)}cm`, col, 10.5, null, lim, bnd);

  B.tail();
  B.paint("#verify");
  $("#rdFull").textContent  = r1(S.cm) + "cm";
  $("#rdHalfW").textContent = r1(S.half) + "cm";
  $("#rdHalfW").style.color = col;
}

/* ══ 시야각 비교 ═══════════════════════════════════
   섹션이 이미 말하는 세 값(발로란트 103° · CS2 4:3 90° · CS2 16:9 약 106°)을 그림으로만 옮긴다.
   새 주장을 더하지 않는다. CS2 는 세로 FOV 고정이라 4:3 수평 90° 에서 세로 73.74° 가 나오고,
   그 세로로 16:9 를 풀면 수평 106.26° — 사이트 표기 「약 106°」와 맞는다.
   화면 폭은 셋 다 같다. 달라지는 건 모니터가 아니라 담기는 각도다.
   표적 위치 = 반폭 × tan(표적각) ÷ tan(FOV/2)  (직선 투영)
   사용자 입력에 안 따라 움직이므로 render() 루프가 아니라 초기화·중단점 변경 때만 그린다 */
const FOV_T = 20;                                   /* 비교에 쓰는 표적 각도 */
const FOVS = [["CS2 4:3", 90, "90°"], ["발로란트", 103, "103°"], ["CS2 16:9", 106.26, "약 106°"]];
function drawFov(){
  /* VH 는 내용 끝(주석 디센더)에서 역산했다 — 데스크탑 163 · 모바일 277 유닛.
     이 도형은 정적이라 조건부로 나타나는 요소가 없어 여백을 그냥 걷어내도 된다 */
  const VW = MOB?460:800, VH = MOB?292:176, F = MOB?1.7:1;
  const fs = n => +(n*F).toFixed(1);
  const sw = n => +(n*F).toFixed(2);
  const L = MOB?30:60, R = VW - L, cx = (L+R)/2, hw = (R-L)/2;
  const top = fs(30), rowH = fs(52);
  const T = (x,y,t,fill,size,anchor,weight) =>
    `<text x="${x}" y="${y}" fill="${fill}" font-family="IBM Plex Mono,monospace" font-size="${fs(size)}"${anchor?` text-anchor="${anchor}"`:""}${weight?` font-weight="${weight}"`:""}>${t}</text>`;
  const p = [];
  const tan = d => Math.tan(d*Math.PI/360);          /* tan(각/2) */

  FOVS.forEach(([name, fov, lab], i) => {
    const y = top + i*rowH;
    const dx = hw * Math.tan(FOV_T*Math.PI/180) / tan(fov);
    p.push(T(L, y-fs(11), `${name} · ${lab}`, C.chalk3, 9.5));
    /* 화면 — 폭은 셋 다 같다 */
    p.push(`<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${C.rule2}" stroke-width="${sw(1.5)}"/>`);
    [L,R].forEach(x => p.push(`<line x1="${x}" y1="${y-fs(7)}" x2="${x}" y2="${y+fs(7)}" stroke="${C.rule2}" stroke-width="${sw(1.5)}"/>`));
    /* 화면 중앙 — 크로스헤어 자리 */
    p.push(`<line x1="${cx}" y1="${y-fs(4)}" x2="${cx}" y2="${y+fs(4)}" stroke="rgba(238,241,244,.22)" stroke-width="${sw(1)}"/>`);
    /* 같은 각도의 표적 */
    p.push(`<line x1="${cx+dx}" y1="${y-fs(9)}" x2="${cx+dx}" y2="${y+fs(9)}" stroke="${C.chalk}" stroke-width="${sw(2.4)}"/>`);
    p.push(`<circle cx="${cx+dx}" cy="${y}" r="${fs(2.6)}" fill="${C.chalk}"/>`);
    /* 중앙에서 표적까지가 얼마나 벌어졌는지 — 가는 연결선 */
    p.push(`<line x1="${cx}" y1="${y}" x2="${cx+dx}" y2="${y}" stroke="${C.chalk}" stroke-width="${sw(2.4)}"/>`);
  });
  p.push(T(cx, top + 2*rowH + fs(26), `가운데 = 크로스헤어 · 흰 점 = ${FOV_T}° 표적`, C.chalk3, 9.5, "middle"));

  const el = $("#fov");
  el.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
  el.innerHTML = p.join("");
}

/* ══ 프로 ══════════════════════════════════════════ */
function applyPro(i){
  const pr = PROS[i], g = $("#game").value, dpi = num($("#dpi")) || 800;
  if (!GRAFT) GRAFT = {prev:{game:g, dpi:$("#dpi").value, sens:$("#sens").value}};
  GRAFT.pro = pr; GRAFT.i = i;
  $("#sens").value = +sensForCm(g, dpi, pr.cm).toFixed(GAMES[g].scale ? 2 : 4);
  render();
  /* 결과를 바로 보라고 변환 패널로 올린다.
     behavior 를 명시하면 CSS 의 scroll-behavior:auto 재정의를 덮으므로
     prefers-reduced-motion 은 여기서 직접 확인해야 한다 */
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  const conv = $(".conv");
  if (conv && conv.scrollIntoView)
    conv.scrollIntoView({behavior: still ? "auto" : "smooth", block: "center"});
  /* 어디가 바뀌었는지 짧게 밝힌다. 색이 아니라 밝기로 — 색은 확신의 정도 전용 */
  [$("#sens").parentElement, $(".readout")].forEach(lit);
}
/* 240ms 분필빛 워시. 연달아 눌러도 다시 걸리도록 리플로를 한 번 강제한다 */
function lit(el){
  if (!el) return;
  el.classList.remove("lit"); void el.offsetWidth; el.classList.add("lit");
  setTimeout(() => el.classList.remove("lit"), 260);
}
function revertPro(){
  if (!GRAFT) return;
  $("#game").value = GRAFT.prev.game; $("#dpi").value = GRAFT.prev.dpi; $("#sens").value = GRAFT.prev.sens;
  prevGame = GRAFT.prev.game; GRAFT = null; render();
}
function drawPro(){
  $("#proCards").innerHTML = PROS.map((pr,i) => {
    if (PFILTER !== "all" && pr.g !== PFILTER) return "";
    const half = pr.cm/2, ok = S.padW/10 >= half;
    const on = GRAFT && GRAFT.i === i;
    return `<div class="pcard${on?" on":""}">
      <div class="top"><span class="nm">${pr.n}</span><span class="tm lat lat-sm">${pr.g==="CS"?"CS2":"VAL"}</span></div>
      <div class="tm lat lat-sm lat-mix">${pr.t}</div>
      <div class="big">${pr.cm}<u>cm/360</u></div>
      <div class="meta">${pr.dpi} DPI × ${pr.s}<br>${pr.pad}${pr.pw?` ${pr.pw}×${pr.ph}`:" (크기 미확인)"}<br>
        180° = ${half.toFixed(1)}cm · <span style="color:${ok?C.ok:C.bad}">내 패드로 ${ok?"가능":"불가"}</span></div>
      <button data-pro="${i}">${on ? "적용됨" : "내 세팅으로 가져오기"}</button></div>`;
  }).join("");
  $$("#proCards button[data-pro]").forEach(b =>
    b.addEventListener("click", () => applyPro(+b.dataset.pro)));

  if (!GRAFT || !GRAFT.pro){
    $("#graft").innerHTML = `<div class="empty">선수를 하나 고르면 여기에 이식 리포트가 나옵니다.
      환산된 감도, 패드가 감당하는지, 무엇이 안 옮겨지는지를 함께 적습니다.</div>`;
  } else {
    const pr = GRAFT.pro, F = [];
    const add = (p,t,w) => F.push(`<div class="graft ${p}"><div class="t">${t}</div><div class="w">${w}</div></div>`);
    add("p3", `감도 — ${GAMES[S.game].n} ${S.dpi} DPI 에서 ${S.sens}${GAMES[S.game].scale?"%":""}`,
      `${pr.n}의 ${pr.cm}cm/360을 내 게임·DPI로 옮긴 값입니다. 오차 ${Math.abs(S.cm-pr.cm).toFixed(2)}cm.
       <b>${pr.n}의 ${pr.s}를 그대로 넣으면 안 됩니다.</b> ${pr.dpi} DPI 를 전제로 나온 값이니까요.`);
    if (S.padW/10 >= S.half)
      add("p3", `패드 — ${S.padW}mm로 됩니다`,
        `180°에 ${S.half.toFixed(1)}cm가 필요하고 ${(S.padW/10 - S.half).toFixed(1)}cm 남습니다.` +
        (pr.pw ? ` 참고로 ${pr.n}은 ${pr.pw}×${pr.ph}mm를 씁니다.` : ` ${pr.n}의 패드 크기는 확인되지 않았습니다.`));
    else
      add("p1", `패드 — ${Math.round((S.half - S.padW/10)*10)}mm 모자랍니다`,
        `180°에 ${S.half.toFixed(1)}cm가 필요한데 패드가 ${(S.padW/10).toFixed(1)}cm입니다.
         이 감도는 <b>패드를 먼저 바꿔야</b> 씁니다. 감도만 옮기면 교전마다 마우스를 듭니다.`);
    if (pr.mon !== "미확인")
      add("p2", `모니터 — ${pr.n} · ${pr.mon}`,
        `cm/360이 같아도 화면 크기가 다르면 각도당 픽셀이 달라 <b>같은 거리인데 다르게 느껴집니다.</b>
         눈이 적응하는 부분이라 데스매치 한두 판이면 붙습니다. 그 사이 감도를 다시 만지면 처음으로 돌아갑니다.`);
    add("p1", "따라할 수 없는 것 — 의자 · 책상 · 모니터 높이",
      `${pr.n}의 키와 오금높이는 공개된 적이 없습니다. 높이를 따라할 방법이 원리적으로 없습니다.
       감도는 이식할 수 있지만 몸은 이식할 수 없습니다.`);
    $("#graft").innerHTML =
      `<div style="display:flex;align-items:center;flex-wrap:wrap;margin-bottom:12px">
         <span><b>${pr.n}</b> (${pr.t}) → 내 세팅으로 이식됨</span>
         <button class="revert" id="revertBtn">원래대로</button></div>` + F.join("");
    $("#revertBtn").addEventListener("click", revertPro);
  }

  /* 분포 */
  const VW = MOB?460:800, VH = MOB?300:210, F = MOB?1.7:1;
  const fs = n => +(n*F).toFixed(1);
  /* 선 굵기도 폰트와 같은 배율을 탄다. 안 그러면 모바일에서 글자만 커지고 선은
     36% 얇아져 잉크 균형이 뒤집힌다. 세 단계뿐 —
     1 참조선(중심선·눈금·치수선) · 1.5 사물(외곽선·원) · 2.4 측정값(스윙선·나 마커) */
  const sw = n => +(n*F).toFixed(2);
  const L = MOB?42:54, R = VW-(MOB?14:30), lo = 38, hi = 82;
  const x = cm => L + (clamp(cm,lo,hi)-lo)/(hi-lo)*(R-L);
  const T = (xx,yy,t,fill,size,anchor,weight) =>
    `<text x="${xx}" y="${yy}" fill="${fill}" font-family="IBM Plex Mono,monospace" font-size="${fs(size)}"${anchor?` text-anchor="${anchor}"`:""}${weight?` font-weight="${weight}"`:""}>${t}</text>`;
  /* 축 아래에는 눈금·화살표·요약문 세 줄이 들어간다. 비율(VH*0.71)로 잡으면
     모바일 1.7배 글자에서 요약문이 뷰박스 밖으로 나간다 — 필요 높이에서 역산한다 */
  const p = [], AX = VH - fs(67);
  p.push(`<line x1="${L}" y1="${AX}" x2="${R}" y2="${AX}" stroke="${C.rule2}" stroke-width="${sw(1)}"/>`);
  for (let c=40;c<=80;c+=10){
    p.push(`<line x1="${x(c)}" y1="${AX}" x2="${x(c)}" y2="${AX+6}" stroke="${C.rule2}" stroke-width="${sw(1)}"/>`);
    p.push(T(x(c), AX+fs(19), c, C.chalk3, 10, "middle"));
  }
  p.push(T(L, AX+fs(40), "← 감도 높음", C.chalk3, 10));
  p.push(T(R, AX+fs(40), "감도 낮음 →", C.chalk3, 10, "end"));
  const rowY = {VAL: fs(56), CS: fs(92)};
  p.push(T(L-6, rowY.CS+fs(3.5), "CS2", C.chalk3, 10, "end"));
  p.push(T(L-6, rowY.VAL+fs(3.5), "VAL", C.chalk3, 10, "end"));
  const mx = x(S.cm), out = S.cm<lo || S.cm>hi;
  /* 1패스 — 자리부터 정한다. 단은 「같은 단에 가로로 겹치지 않을 것」 하나로만 고른다.
     줄기까지 조건에 넣었더니 모바일에서 단이 6까지 쌓여 뷰박스를 넘었다.
     라벨 위치가 줄기보다 중요하므로, 줄기는 2패스에서 끊어 피한다 */
  const marks = [];
  ["CS","VAL"].forEach(g => {
    const tier = [];
    PROS.filter(pr=>pr.g===g).sort((a,b)=>a.cm-b.cm).forEach(pr => {
      const px = x(pr.cm), py = rowY[g], w = tw(pr.n, fs(9.5));
      let t = 0;
      while (tier[t] !== undefined && px - w/2 < tier[t] + fs(5)) t++;
      tier[t] = px + w/2;
      const base = py - (fs(9) + t*fs(13));
      marks.push({px, py, base, n:pr.n,
        box:{x0:px-w/2, x1:px+w/2, y0:base-fs(11), y1:base+fs(3.5)}});
    });
  });
  /* 세로선을 라벨 상자를 피해 토막내 그린다. 라벨을 옆으로 밀면 원과의 연결이 끊기므로
     선 쪽을 끊는 게 맞다. 마커와 줄기가 같은 문제를 겪어 같은 함수를 쓴다 */
  const vline = (vx, yA, yB, stroke, width, skipOwn) => {
    const half = width/2 + fs(2);
    const gaps = marks.map(m=>m.box)
      .filter(b => b !== skipOwn && b.x1 > vx-half && b.x0 < vx+half && b.y1 > yA && b.y0 < yB)
      .map(b => [b.y0, b.y1]).sort((a,b)=>a[0]-b[0]);
    let cy = yA;
    const seg = (a,b) => { if (b-a > 1)
      p.push(`<line x1="${vx}" y1="${a.toFixed(1)}" x2="${vx}" y2="${b.toFixed(1)}" stroke="${stroke}" stroke-width="${width}"/>`); };
    for (const [g0,g1] of gaps){ if (g0 > cy) seg(cy, Math.min(g0,yB)); cy = Math.max(cy,g1); }
    seg(cy, yB);
  };
  /* 2패스 — 그린다. 축까지 내리던 드롭선은 짧은 발로 바꿨다.
     열 개가 세로줄을 이뤄 바코드처럼 보였고 VAL 드롭선이 CS2 라벨 밴드를 관통했다.
     분포도는 위치로 읽는 그림이라 축까지 잇지 않아도 뜻이 상하지 않는다 */
  marks.forEach(m => {
    vline(m.px, m.py+fs(3.6), m.py+fs(9), "rgba(238,241,244,.16)", sw(1), m.box);
    vline(m.px, m.base+fs(3), m.py-fs(3.6), "rgba(238,241,244,.38)", sw(1), m.box);
    p.push(`<circle cx="${m.px}" cy="${m.py}" r="${fs(3.6)}" fill="none" stroke="${C.chalk2}" stroke-width="${sw(1.5)}"/>`);
    p.push(T(m.px, m.base, m.n, C.chalk2, 9.5, "middle"));
  });
  vline(mx, fs(26), AX+8, C.chalk, sw(2.4));
  /* 「(범위 밖)」이 붙으면 라벨이 뷰박스보다 넓어질 수 있다. 그러면 clamp 범위가 뒤집혀
     오히려 밖으로 밀린다 — put() 에서 이미 겪은 함정이라 같은 방식으로 줄여 맞춘다 */
  const mt = `나 ${r1(S.cm)}cm${out?" (범위 밖)":""}`;
  let mp = fs(12), mwx = tw(mt, mp)*TWPAD;
  if (mwx > VW-12){ mp = Math.max(mp*0.7, mp*(VW-12)/mwx); mwx = tw(mt, mp)*TWPAD; }
  const mlx = clamp(mx, 6+mwx/2, Math.max(6+mwx/2, VW-6-mwx/2));
  p.push(`<text x="${mlx.toFixed(1)}" y="${fs(19)}" fill="${C.chalk}" font-family="IBM Plex Mono,monospace" font-size="${mp.toFixed(1)}" text-anchor="middle" font-weight="600">${mt}</text>`);
  const below = PROS.filter(pr=>pr.cm < S.cm).length;
  const st = `프로 10명 중 ${below}명이 나보다 짧게 돌립니다.`;
  /* 모바일 1.7배에서는 한 줄이 뷰박스보다 넓다. 축 오른쪽 끝까지만 쓰도록 줄인다 */
  /* 이 문장만 Sans KR 이라 sans 계수로 잰다. 모노 계수로 재던 탓에 폭을 25% 넘게
     잡아 필요 없이 글자를 줄이고 있었다 */
  let sp = fs(12); const sMax = VW - L - 6, stw = tw(st, sp, true);
  if (stw > sMax) sp = sp * sMax / stw;
  p.push(`<text x="${L}" y="${AX+fs(62)}" fill="${C.chalk2}" font-family="IBM Plex Sans KR,sans-serif" font-size="${+sp.toFixed(1)}">${st}</text>`);
  const el = $("#dist");
  el.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
  el.innerHTML = p.join("");
}

/* ══ 표 스크롤 안내 ══════════════════════════════
   실제로 넘칠 때만 단다. 안 넘치는 표에 「밀 수 있습니다」가 붙어 있으면
   그게 더 나쁜 신호다 — 1280px 에서는 일곱 표 모두 안 넘친다.
   접힌 <details> 안의 표는 폭이 0이라 재면 안 되므로 건너뛴다 */
const SWIPE = "← 좁은 화면에서는 표를 옆으로 밀 수 있습니다";
function markScroll(){
  $$(".scroll").forEach(sc => {
    if (!sc.clientWidth) return;
    const over = sc.scrollWidth - sc.clientWidth > 2;
    /* 레일 — 넘칠 때만. 손잡이 폭 = 보이는 비율, 위치 = 스크롤 위치 */
    let rail = sc.nextElementSibling;
    rail = rail && rail.classList && rail.classList.contains("rail") ? rail : null;
    if (over && !rail){
      rail = document.createElement("div");
      rail.className = "rail"; rail.innerHTML = "<i></i>";
      sc.after(rail);
      sc.addEventListener("scroll", () => moveRail(sc, rail), {passive:true});
    } else if (!over && rail){ rail.remove(); rail = null; }
    if (rail) moveRail(sc, rail);

    const after = rail || sc;
    const next = after.nextElementSibling;
    const tip = next && next.dataset && next.dataset.auto === "1" ? next : null;
    if (over && !tip){
      const el = document.createElement("p");
      el.className = "swipe"; el.dataset.auto = "1"; el.textContent = SWIPE;
      after.after(el);
    } else if (!over && tip) tip.remove();
  });
}
function moveRail(sc, rail){
  const f = sc.clientWidth / sc.scrollWidth;
  const th = rail.firstElementChild;
  th.style.width = (f*100).toFixed(2) + "%";
  th.style.left  = (sc.scrollLeft / sc.scrollWidth * 100).toFixed(2) + "%";
}

/* ══ 렌더 ══ */
function render(){ read(); drawConvert(); drawScope(); drawBand(); drawBench(); drawVerify(); drawPro(); markScroll(); }

/* ══ 초기화 ══ */
/* ══════════════════════════════════════════════════
   자세 캘리브레이션 (posture.html)
   ══════════════════════════════════════════════════
   여기 있는 값은 전부 사용자가 직접 잰 것이다.
   ★ 키에서 비율로 몸 치수를 추정하지 않는다. research/06 의
     R={pop:.2310, elb:.1504, eye:.4590} 이 그 코드였고, 그게 자세 기능이
     통째로 빠진 이유다. 「빈칸이 불편하다」는 이유로 되살리지 말 것 —
     tools/values.js 17번이 이걸 막는다. 안 잰 값은 비워 둔다. */

/* ★ 이 페이지는 [검증] 만 싣는다. [추론] 이 붙는 항목은 아예 안 넣는다.
   시선 하방각(15~20°)이 그래서 빠졌다 — ISO 9241-5 와 충돌해 어느 쪽도 사실로 못 낸다.
   모든 출처가 동의하는 「화면 상단 ≤ 눈높이」만 남긴다. 각도 밴드도 각주도 되살리지 말 것. */

const PM = {};                       /* 잰 값. null 이면 「안 쟀다」 */
function readPosture(){
  for (const k of ["mPop","mElb","mEye","mSeat","mDesk","mTop","mMonH","mDist"])
    PM[k] = $("#"+k) ? num($("#"+k)) : null;
  PM.fix = $("#mFix") && $("#mFix").value === "fix";
  const P = {};
  /* 앉은 눈높이는 바닥 기준으로 잰다(research/07 ④). 좌면 기준으로 바꾸려면
     같이 잰 현재 좌면을 뺀다. 추정이 아니라 잰 값끼리의 뺄셈이다 */
  P.eyeSeat = (PM.mEye != null && PM.mSeat != null) ? PM.mEye - PM.mSeat : null;
  P.seat    = PM.mPop != null ? PM.mPop + 1 : null;                /* 발바닥이 바닥에 닿는 높이 */
  P.foot    = null;
  if (PM.fix && PM.mDesk != null && PM.mElb != null){
    /* 책상이 기준점 — 팔에 맞춰 좌면을 역산하고 모자란 만큼 발을 받친다 */
    P.desk = PM.mDesk;
    P.seat = PM.mDesk - PM.mElb - 1;
    if (PM.mPop != null) P.foot = P.seat - (PM.mPop + 1);
  } else if (P.seat != null && PM.mElb != null){
    P.desk = P.seat + PM.mElb + 1;
  }
  P.eye = (P.seat != null && P.eyeSeat != null) ? P.seat + P.eyeSeat : null;
  /* 화면 상단은 눈높이 이하 — 고개는 중립으로 두고 눈만 내린다.
     모든 출처가 동의하는 유일한 화면 기준이다. 각도는 안 낸다 */
  P.topMax = P.eye;
  return P;
}

/* ── 모순 검사 (research/07) ── */
function postureWarn(P){
  const w = [];
  if (PM.mSeat != null && PM.mPop != null){
    const g = PM.mSeat - PM.mPop;
    if (g > 2.5) w.push(["bad", `좌면이 오금높이보다 <b>${r1(g)}cm</b> 높습니다 — 계산상 발이 떠야 합니다.
      발이 안 뜬다면 둘 중 하나가 틀렸습니다: 좌면을 <b>빈 의자</b>나 <b>좌판 뒤쪽</b>에서 쟀거나,
      오금높이를 <b>무릎 앞·위</b>로 쟀을 가능성.
      앉은 채로 발밑에 손바닥을 넣어보세요 — 안 들어가면 좌면 쪽이 틀렸습니다.`]);
    else if (g < -3) w.push(["mid", `좌면이 오금높이보다 <b>${r1(-g)}cm</b> 낮습니다.
      무릎이 골반보다 올라가 골반이 뒤로 말립니다.`]);
  }
  if (PM.mSeat != null && PM.mDesk != null){
    const g = PM.mDesk - PM.mSeat;
    if (g < 18) w.push(["mid", `책상과 좌면 간격이 <b>${r1(g)}cm</b>로 좁습니다. 허벅지가 상판에 닿을 수 있습니다.`]);
    else if (g > 32) w.push(["mid", `책상과 좌면 간격이 <b>${r1(g)}cm</b>로 넓습니다. 팔을 올리거나 어깨를 들어야 할 가능성이 있습니다.`]);
  }
  if (PM.mTop != null && PM.mMonH != null && PM.mMonH >= PM.mTop)
    w.push(["bad", `모니터 세로 길이가 화면 상단 높이보다 큽니다 — 둘 중 하나를 잘못 쟀습니다.`]);
  if (PM.mEye != null && PM.mSeat != null && PM.mEye - PM.mSeat < 40)
    w.push(["bad", `앉은 눈높이 − 좌면 = <b>${r1(PM.mEye-PM.mSeat)}cm</b>. 사람 상체로는 너무 짧습니다.
      앉은 눈높이는 <b>바닥에서</b> 재는 값입니다 — 좌면에서 재지 않았는지 확인하세요.`]);
  const el = $("#mWarn");
  el.innerHTML = w.length
    ? `<p class="mlab">모순 검사</p>` + w.map(([c,t]) =>
        `<div class="note wn-${c}">${t}</div>`).join("")
    : "";
}

/* ── 목표 표 ── */
function postureTable(P){
  const miss = "<span class='mno'>재야 나옵니다</span>";
  /* 전부 [검증] 이다. 근거가 갈리는 항목은 표에 넣지 않는다 — 태그로 낮춰 싣지도 않는다 */
  const rows = [
    ["좌면 높이", PM.fix ? "책상 − 앉은 팔꿈치높이 − 1cm" : "오금높이 + 1cm",
     P.seat != null ? r1(P.seat)+"cm" : miss,
     PM.fix ? "책상이 고정이라 좌면을 역산합니다" : "발바닥 전체가 바닥에 닿는 높이"],
    ["책상 높이", PM.fix ? "지금 값 고정" : "좌면 + 앉은 팔꿈치높이 + 1cm",
     P.desk != null ? r1(P.desk)+"cm" : miss,
     "책상이 팔꿈치보다 높으면 어깨 거상·척측편위가 늡니다 (Rempel 2009)"],
    ["눈높이", "목표 좌면 + (앉은 눈높이 − 지금 좌면)", P.eye != null ? r1(P.eye)+"cm" : miss,
     "잰 값끼리의 산수입니다. 추정 없음"],
    ["화면 상단", "눈높이 이하", P.topMax != null ? "≤ "+r1(P.topMax)+"cm" : miss,
     "고개는 중립으로 두고 눈만 내립니다. 모든 출처가 동의하는 유일한 화면 기준입니다"],
  ];
  if (P.foot != null) rows.push(["발판 높이", "목표 좌면 − (오금높이 + 1cm)",
    P.foot <= 0.5 ? "불필요" : r1(P.foot)+"cm",
    P.foot <= 0.5 ? "이 좌면에서 발이 바닥에 닿습니다"
                  : "좌면을 올린 만큼 발을 받쳐 하체 90°를 되찾습니다"]);
  $("#targetBody").innerHTML = rows.map(([a,b,c,d]) =>
    `<tr><td>${a}</td><td class="lat-mix">${b}</td><td><b>${c}</b></td>
     <td><span class="tag t-ok">검증</span> ${d}</td></tr>`).join("");
}

/* ══ 측면도 ═══════════════════════════════════════
   좌표계는 책상 평면도와 다르다(옆에서 본 높이). 공유하는 건 좌표가 아니라
   figBase() 의 배율·라벨·장애물 회피다.
   안 잰 값은 그리지 않는다 — 그럴듯한 기본값을 넣으면 그게 추정이다. */
function drawSide(){
  const P = readPosture();
  const VW = MOB ? 460 : 800, VH = MOB ? 340 : 420, F = MOB ? 1.75 : 1;
  const B = figBase(VW, VH, F);
  const { fs, sw, T, TP, p, put, paint } = B;

  const hs = [PM.mSeat, PM.mDesk, PM.mTop, PM.mEye, P.seat, P.eye, P.desk]
    .filter(v => v != null);
  if (!hs.length){
    p.push(TP(VW/2, VH/2, "재야 나옵니다 — 위에 값을 넣으세요", C.chalk3, fs(13), "middle", 500));
    paint("#side"); $("#sideOut").innerHTML = ""; return;
  }

  const GUT = fs(92);                                    /* 오른쪽 높이 라벨 자리 */
  const L = fs(10), R = VW - GUT, TOPY = fs(18), BOT = VH - fs(30);
  const maxH = Math.max(...hs) + 14;
  const dist = PM.mDist;
  const spanX = 26 + (dist != null ? dist + 16 : 72);
  const k = Math.min((R - L)/spanX, (BOT - TOPY)/maxH);  /* px per cm */
  /* 세로가 병목이면 가로에 여유가 남는다. 왼쪽에 몰아 두면 도면이 한쪽으로 쏠린다 */
  const OFF = Math.max(0, (R - L - spanX*k) / 2);
  const X = c => L + OFF + (c + 26)*k;
  const Y = c => BOT - c*k;

  /* 오른쪽에 붙는 높이 라벨. 겹치면 아래위로 벌린다 */
  const lab = [];
  const addLab = (h, t, col, weight) => { if (h != null) lab.push({ y: Y(h), t, col, weight: weight || 500 }); };

  p.push(`<defs><pattern id="band" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(238,241,244,.13)" stroke-width="${sw(1)}"/></pattern></defs>`);

  /* 바닥 */
  p.push(`<line x1="${X(-26)}" y1="${BOT}" x2="${R}" y2="${BOT}" stroke="${C.chalk3}" stroke-width="${sw(1.5)}"/>`);
  p.push(T(X(-26), BOT + fs(15), "바닥", C.chalk3, 9.5));

  /* 목표선 — 점선 한 줄. 구간이 아니라 값이다.
     구간으로 그리던 항목(책상 ±2cm · 시선각)은 근거가 갈려서 아예 뺐다 */
  const goal = (h, x0, x1) => {
    if (h == null) return;
    p.push(`<line x1="${X(x0)}" y1="${Y(h)}" x2="${X(x1)}" y2="${Y(h)}" stroke="${C.chalk}" stroke-width="${sw(1.5)}" stroke-dasharray="6 4"/>`);
  };

  /* ── 의자 ── */
  if (PM.mSeat != null){
    p.push(`<rect x="${X(-22)}" y="${Y(PM.mSeat)}" width="${40*k}" height="${sw(5)}" fill="${C.chalk3}"/>`);
    p.push(`<rect x="${X(-22)}" y="${Y(PM.mSeat+40)}" width="${sw(5)}" height="${40*k}" fill="${C.chalk3}"/>`);
    p.push(`<line x1="${X(-2)}" y1="${Y(PM.mSeat)}" x2="${X(-2)}" y2="${BOT}" stroke="${C.chalk3}" stroke-width="${sw(2.4)}"/>`);
    addLab(PM.mSeat, `지금 좌면 ${r1(PM.mSeat)}`, C.chalk2);
  }
  goal(P.seat, -24, 18);
  if (P.seat != null) addLab(P.seat, `목표 좌면 ${r1(P.seat)}`, C.chalk, 600);

  /* ── 책상 ── */
  const dx1 = dist != null ? dist + 6 : 66;
  if (PM.mDesk != null){
    p.push(`<rect x="${X(2)}" y="${Y(PM.mDesk)}" width="${(dx1-2)*k}" height="${sw(5)}" fill="${C.chalk2}"/>`);
    addLab(PM.mDesk, `지금 책상 ${r1(PM.mDesk)}`, C.chalk2);
  }
  if (!PM.fix){
    goal(P.desk, 2, dx1);
    if (P.desk != null) addLab(P.desk, `목표 책상 ${r1(P.desk)}`, C.chalk, 600);
  }

  /* ── 몸: 눈 ── */
  if (PM.mEye != null){
    p.push(`<circle cx="${X(0)}" cy="${Y(PM.mEye)}" r="${sw(5)}" fill="${C.chalk2}"/>`);
    addLab(PM.mEye, `지금 눈높이 ${r1(PM.mEye)}`, C.chalk2);
  }
  if (P.eye != null){
    p.push(`<line x1="${X(-24)}" y1="${Y(P.eye)}" x2="${X(dist != null ? dist : 60)}" y2="${Y(P.eye)}" stroke="${C.chalk}" stroke-width="${sw(1)}" stroke-dasharray="6 4"/>`);
    addLab(P.eye, `목표 눈높이 ${r1(P.eye)}`, C.chalk, 600);
  }

  /* ── 모니터 · 시선 ── */
  if (dist != null && PM.mTop != null && PM.mMonH != null){
    p.push(`<rect x="${X(dist)-sw(4)}" y="${Y(PM.mTop)}" width="${sw(8)}" height="${PM.mMonH*k}" fill="${C.chalk3}"/>`);
    if (PM.mDesk != null)
      p.push(`<line x1="${X(dist)}" y1="${Y(PM.mTop-PM.mMonH)}" x2="${X(dist)}" y2="${Y(PM.mDesk)}" stroke="${C.chalk3}" stroke-width="${sw(1)}"/>`);
    addLab(PM.mTop, `화면 상단 ${r1(PM.mTop)}`, C.chalk3);
    /* 각도는 그리지 않는다 — 눈에서 화면으로 잇는 선 하나만 그어도 그게 시선각이 되고,
       15~20° 가 ISO 9241-5 와 충돌해 뺀 바로 그 주장이 그림으로 되살아난다.
       판정은 「화면 상단이 눈높이 아래인가」 하나뿐이라 세로 눈금으로만 표시한다 */
    if (P.topMax != null){
      const ok = PM.mTop <= P.topMax + 0.05;
      p.push(`<line x1="${X(dist)-sw(9)}" y1="${Y(PM.mTop)}" x2="${X(dist)+sw(9)}" y2="${Y(PM.mTop)}" stroke="${ok?C.ok:C.bad}" stroke-width="${sw(2.4)}"/>`);
      if (!ok)
        p.push(`<line x1="${X(dist)}" y1="${Y(PM.mTop)}" x2="${X(dist)}" y2="${Y(P.topMax)}" stroke="${C.bad}" stroke-width="${sw(2.4)}"/>`);
    }
  } else if (dist == null){
    p.push(T(R - fs(4), TOPY + fs(10), "모니터 — 눈↔화면 거리를 재야 그려집니다", C.chalk3, 9.5, "end"));
  }

  /* 높이 라벨을 겹치지 않게 벌린다 */
  lab.sort((a,b) => a.y - b.y);
  const gap = fs(13);
  for (let i = 1; i < lab.length; i++)
    if (lab[i].y - lab[i-1].y < gap) lab[i].y = lab[i-1].y + gap;
  const shift = Math.max(0, lab.length ? lab[lab.length-1].y - (VH - fs(6)) : 0);
  for (const l of lab)
    p.push(TP(VW - fs(6), l.y - shift + fs(3.4), l.t, l.col, fs(10), "end", l.weight));

  paint("#side");
  sideVerdict(P);
}

/* 도면 아래 판정 — 차이를 cm 로 적는다. 3단계와 달리 여기서는 cm 가 본체다 */
function sideVerdict(P){
  const out = [];
  /* 차이를 cm 로 적되 「틀렸다」로 칠하지 않는다 — 최적점이 ±2cm 움직인다는 걸
     페이지가 이미 밝혔다. 빨강은 출처가 한목소리로 금지하는 것에만 쓴다 */
  const cmp = (now, goal, what, how) => {
    if (now == null || goal == null) return;
    const d = goal - now;
    if (Math.abs(d) <= 0.5){ out.push(["ok", `<b>${what}</b> — 목표와 같습니다.`]); return; }
    out.push(["mid", `<b>${what}</b> — 목표보다 ${r1(Math.abs(d))}cm ${d > 0 ? "낮습니다" : "높습니다"}.
      ${r1(Math.abs(d))}cm ${d > 0 ? "올리면" : "내리면"} 목표입니다. ${how||""}`]);
  };
  if (!PM.fix) cmp(PM.mDesk, P.desk, "책상", "책상을 못 바꾸면 위 「책상 높이 조절」을 고정으로 두세요.");
  cmp(PM.mSeat, P.seat, "좌면");
  if (PM.mTop != null && P.topMax != null)
    out.push(PM.mTop <= P.topMax + 0.05
      ? ["ok", `<b>화면 상단</b> — 눈높이 이하입니다.`]
      : ["bad", `<b>화면 상단</b>이 눈높이보다 <b>${r1(PM.mTop - P.topMax)}cm</b> 높습니다. 모니터를 내리세요.`]);
  if (P.foot != null && P.foot > 0.5)
    out.push(["mid", `책상이 고정이라 좌면을 올려야 합니다. <b>발판 ${r1(P.foot)}cm</b>로
      발을 받쳐 하체 90°를 되찾으세요. 넓고 단단한 것이 좋습니다.`]);
  $("#sideOut").innerHTML = out.length
    ? out.map(([c,t]) => `<div class="note wn-${c}">${t}</div>`).join("")
    : `<div class="note"><b>아직 비교할 값이 없습니다.</b> 위에서 잰 값을 넣으면 여기에 차이가 cm로 나옵니다.</div>`;
}

function renderPosture(){ const P = readPosture(); postureWarn(P); postureTable(P); drawSide(); }

(function init(){
  /* 두 페이지가 같은 파일을 쓴다. #calib 이 있으면 자세 페이지다 */
  if ($("#calib")){
    $$("#measure input, #measure select").forEach(el => el.addEventListener("input", renderPosture));
    $("#mFix").addEventListener("change", renderPosture);
    let pt;
    window.addEventListener("resize", () => {
      clearTimeout(pt);
      pt = setTimeout(() => { const m = isMob(); if (m !== MOB){ MOB = m; drawSide(); } }, 160);
    });
    renderPosture();
    return;
  }

  const opts = Object.keys(GAMES).map(g => `<option value="${g}">${GAMES[g].n}</option>`).join("");
  $("#game").innerHTML = opts;   $("#game").value = "valorant";
  $("#toGame").innerHTML = opts; $("#toGame").value = "cs2";

  const REVERSE = ["toSens","cmIn","inIn"];   /* 역방향 칸은 전용 핸들러가 처리 */
  $$("input, select").forEach(el => { if (!REVERSE.includes(el.id)) el.addEventListener("input", render); });

  $("#toSens").addEventListener("input", () => {
    const v = num($("#toSens")); if (!v || v <= 0) return;
    const tg = $("#toGame").value, td = num($("#toDpi")) || num($("#dpi")) || 800;
    const g = $("#game").value;
    $("#sens").value = +convert(tg, g, td, v, num($("#dpi")) || 800).toFixed(GAMES[g].scale ? 2 : 4);
    render();
  });
  const fromDist = cm => {
    if (!cm || cm <= 0) return;
    const g = $("#game").value, d = num($("#dpi")) || 800;
    $("#sens").value = +sensForCm(g, d, cm).toFixed(GAMES[g].scale ? 2 : 4);
    render();
  };
  $("#cmIn").addEventListener("input", () => fromDist(num($("#cmIn"))));
  $("#inIn").addEventListener("input", () => { const v = num($("#inIn")); if (v) fromDist(v*IN); });

  $("#swapBtn").addEventListener("click", () => {
    const g = $("#game").value, tg = $("#toGame").value;
    const d = $("#dpi").value, tdv = $("#toDpi").value, ns = num($("#toSens"));
    $("#game").value = tg;  $("#toGame").value = g;
    $("#dpi").value = tdv;  $("#toDpi").value = d;
    if (ns) $("#sens").value = +ns.toFixed(GAMES[tg].scale ? 2 : 4);
    prevGame = tg; render();
  });

  $("#copyBtn").addEventListener("click", async function(){
    try { await navigator.clipboard.writeText($("#toSens").value); this.textContent = "복사됨"; }
    catch(e){ this.textContent = "직접 선택"; }
    setTimeout(() => { this.textContent = "복사"; }, 1600);
  });

  /* 왼쪽 게임을 바꾸면 감도도 같은 손으로 환산 */
  $("#game").addEventListener("change", () => {
    const g = $("#game").value;
    if (g !== prevGame){
      const d = num($("#dpi")) || 800, s = num($("#sens")) || 0.25;
      $("#sens").value = +convert(prevGame, g, d, s).toFixed(GAMES[g].scale ? 2 : 3);
      prevGame = g; render();
    }
  });

  $$("#proFilter button").forEach(b => b.addEventListener("click", () => {
    $$("#proFilter button").forEach(x => x.setAttribute("aria-pressed","false"));
    b.setAttribute("aria-pressed","true"); PFILTER = b.dataset.v; drawPro();
  }));

  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { const m = isMob(); if (m !== MOB){ MOB = m; render(); drawFov(); } else markScroll(); }, 160);
  });

  /* 접힌 표는 폭이 0이라 못 잰다. 펼치는 순간 다시 잰다 */
  $$("details").forEach(d => d.addEventListener("toggle", markScroll));

  drawFov();   /* 정적 도형 — 입력에 안 따라 움직이므로 render() 밖에서 한 번만 */

  render();
})();
