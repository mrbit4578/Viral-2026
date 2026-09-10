"use strict";
var AgentCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var agent_core_exports = {};
  __export(agent_core_exports, {
    MAX_REVIEW_ROUNDS: () => MAX_REVIEW_ROUNDS,
    STEP_WEIGHTS: () => STEP_WEIGHTS,
    clampCount: () => clampCount,
    clampProgress: () => clampProgress,
    fallbackTrends: () => fallbackTrends,
    normaliseReview: () => normaliseReview,
    normaliseTrends: () => normaliseTrends,
    pickBestTrend: () => pickBestTrend,
    planNext: () => planNext,
    weightProgress: () => weightProgress
  });
  const MAX_REVIEW_ROUNDS = 2;
  const STEP_WEIGHTS = {
    trends: 5,
    blueprint: 10,
    review: 10,
    revise: 10,
    images: 50,
    voice: 15,
    distribution: 10,
    finish: 0,
    abort: 0
  };
  function clampCount(value) {
    if (value === null || value === void 0 || value === "") return 5;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 5;
    return Math.max(3, Math.min(6, n));
  }
  function clampProgress(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }
  function planNext(state) {
    if (!state.trendsDone) return { step: "trends" };
    if (!state.blueprintDone) return { step: "blueprint" };
    if (state.lastDecision === null) return { step: "review" };
    if (state.lastDecision === "revise") {
      if (state.reviewRounds >= MAX_REVIEW_ROUNDS) {
        return {
          step: "abort",
          reason: `QA t\u1EEB ch\u1ED1i sau ${state.reviewRounds} l\u01B0\u1EE3t ki\u1EC3m duy\u1EC7t (gi\u1EDBi h\u1EA1n ${MAX_REVIEW_ROUNDS}). H\xE3y \u0111\u1ED5i ch\u1EE7 \u0111\u1EC1/niche ho\u1EB7c t\u1EF1 ch\u1EC9nh blueprint r\u1ED3i ch\u1EA1y l\u1EA1i.`
        };
      }
      return { step: "revise" };
    }
    if (state.pendingShots.length) return { step: "images" };
    if (!state.voiceDone) return { step: "voice" };
    if (!state.distributionDone) return { step: "distribution" };
    return { step: "finish" };
  }
  function weightProgress(doneSteps, imagesFrac = 1) {
    const frac = Math.max(0, Math.min(1, Number.isFinite(Number(imagesFrac)) ? Number(imagesFrac) : 1));
    let total = 0;
    let hasImages = false;
    for (const step of doneSteps) {
      if (step === "images") {
        hasImages = true;
        continue;
      }
      total += STEP_WEIGHTS[step] || 0;
    }
    if (hasImages) total += STEP_WEIGHTS.images * frac;
    return clampProgress(total);
  }
  function pickBestTrend(trends) {
    if (!Array.isArray(trends) || !trends.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const item of trends) {
      if (!item || typeof item !== "object") continue;
      const score = Number(item.score);
      if (!Number.isFinite(score)) continue;
      if (!best || score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }
  function cleanString(value, fallback = "") {
    const s = String(value ?? "").trim();
    return s || fallback;
  }
  function cleanStringArray(value, limit) {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, limit);
  }
  function fallbackTrends(niche, count) {
    const n = cleanString(niche, "Ki\u1EBFn th\u1EE9c t\u1ED5ng h\u1EE3p");
    const templates = [
      {
        topic: `3 \u0111i\u1EC1u nhi\u1EC1u ng\u01B0\u1EDDi hi\u1EC3u sai v\u1EC1 ${n}`,
        angle: "\u0110\u1EA3o ng\u01B0\u1EE3c m\u1ED9t ni\u1EC1m tin ph\u1ED5 bi\u1EBFn r\u1ED3i ch\u1EE9ng minh b\u1EB1ng v\xED d\u1EE5 \u0111\u1EDDi th\u01B0\u1EDDng",
        hook: `N\u1EBFu b\u1EA1n v\u1EABn tin \u0111i\u1EC1u n\xE0y v\u1EC1 ${n}, 30 gi\xE2y t\u1EDBi s\u1EBD khi\u1EBFn b\u1EA1n ph\u1EA3i suy ngh\u0129 l\u1EA1i.`,
        why: "M\u1EDF \u0111\u1EA7u t\u1EA1o kho\u1EA3ng tr\u1ED1ng t\xF2 m\xF2; n\u1ED9i dung ph\u1EA3n bi\u1EC7n c\xF3 v\xED d\u1EE5 d\u1EC5 gi\u1EEF ng\u01B0\u1EDDi xem t\u1EDBi cu\u1ED1i.",
        trend_driver: "D\u1EA1ng video myth-buster lu\xF4n n\u1EB1m trong nh\xF3m \u0111\u01B0\u1EE3c l\u01B0u l\u1EA1i nhi\u1EC1u",
        format: "Myth-buster"
      },
      {
        topic: `5 chi ti\u1EBFt nh\u1ECF trong ${n} t\u1EA1o kh\xE1c bi\u1EC7t l\u1EDBn`,
        angle: "Gom c\xE1c chi ti\u1EBFt \xEDt ai \u0111\u1EC3 \xFD th\xE0nh danh s\xE1ch \u0111\u1EBFm ng\u01B0\u1EE3c",
        hook: "Chi ti\u1EBFt s\u1ED1 3 g\u1EA7n nh\u01B0 kh\xF4ng ai n\xF3i \u0111\u1EBFn, nh\u01B0ng n\xF3 quy\u1EBFt \u0111\u1ECBnh t\u1EA5t c\u1EA3.",
        why: "Listicle c\xF3 nh\u1ECBp nhanh, d\u1EC5 c\u1EAFt scene v\xE0 d\u1EC5 b\u1EA5m xem l\u1EA1i.",
        trend_driver: "\u0110\u1ECBnh d\u1EA1ng \u0111\u1EBFm ng\u01B0\u1EE3c gi\xFAp gi\u1EEF retention \u1EDF n\u1EEDa sau video",
        format: "Listicle"
      },
      {
        topic: `M\u1ED9t thay \u0111\u1ED5i nh\u1ECF trong ${n} v\xE0 k\u1EBFt qu\u1EA3 sau 30 ng\xE0y`,
        angle: "K\u1EC3 theo d\xF2ng th\u1EDDi gian tr\u01B0\u1EDBc \u2013 sau, kh\xF4ng t\xF4 h\u1ED3ng",
        hook: "M\xECnh \u0111\xE3 th\u1EED \u0111i\u1EC1u n\xE0y trong 30 ng\xE0y, \u0111\xE2y l\xE0 nh\u1EEFng g\xEC th\u1EADt s\u1EF1 x\u1EA3y ra.",
        why: "C\u1EA5u tr\xFAc tr\u01B0\u1EDBc\u2013sau t\u1EA1o l\xFD do xem h\u1EBFt \u0111\u1EC3 bi\u1EBFt k\u1EBFt qu\u1EA3.",
        trend_driver: "D\u1EA1ng th\u1EED th\xE1ch 30 ng\xE0y lu\xF4n c\xF3 l\u01B0\u1EE3t t\xECm ki\u1EBFm \u1ED5n \u0111\u1ECBnh",
        format: "Story"
      },
      {
        topic: `${n} ho\u1EA1t \u0111\u1ED9ng th\u1EBF n\xE0o \u2014 gi\u1EA3i th\xEDch trong 60 gi\xE2y`,
        angle: "D\xF9ng m\u1ED9t \u1EA9n d\u1EE5 \u0111\u1EDDi th\u01B0\u1EDDng xuy\xEAn su\u1ED1t \u0111\u1EC3 gi\u1EA3i th\xEDch nguy\xEAn l\xFD",
        hook: "H\xE3y t\u01B0\u1EDFng t\u01B0\u1EE3ng ${n} gi\u1ED1ng nh\u01B0 m\u1ED9t th\u1EE9 b\u1EA1n th\u1EA5y m\u1ED7i ng\xE0y \u2014 \u0111\xE2y l\xE0 c\xE1ch n\xF3 v\u1EADn h\xE0nh.",
        why: "Explainer c\xF3 \u1EA9n d\u1EE5 r\xF5 d\u1EC5 hi\u1EC3u, ph\xF9 h\u1EE3p kh\xE1n gi\u1EA3 m\u1EDBi.",
        trend_driver: "N\u1ED9i dung gi\u1EA3i th\xEDch nhanh \u0111\u01B0\u1EE3c n\u1EC1n t\u1EA3ng \u0111\u1EC1 xu\u1EA5t cho ng\u01B0\u1EDDi m\u1EDBi v\xE0o ch\u1EE7 \u0111\u1EC1",
        format: "Explainer"
      },
      {
        topic: `Checklist tr\u01B0\u1EDBc khi b\u1EAFt \u0111\u1EA7u v\u1EDBi ${n}`,
        angle: "Bi\u1EBFn ki\u1EBFn th\u1EE9c th\xE0nh danh s\xE1ch ki\u1EC3m tra l\xE0m \u0111\u01B0\u1EE3c ngay",
        hook: "Tr\u01B0\u1EDBc khi b\u1EAFt \u0111\u1EA7u v\u1EDBi " + n + ", h\xE3y ki\u1EC3m tra 5 \u0111i\u1EC1u n\xE0y.",
        why: "Checklist c\xF3 gi\xE1 tr\u1ECB l\u01B0u l\u1EA1i \u2014 t\xEDn hi\u1EC7u m\u1EA1nh v\u1EDBi thu\u1EADt to\xE1n.",
        trend_driver: "N\u1ED9i dung c\xF3 t\u1EF7 l\u1EC7 l\u01B0u cao th\u01B0\u1EDDng \u0111\u01B0\u1EE3c \u0111\u1EA9y ti\u1EBFp",
        format: "Checklist"
      },
      {
        topic: `C\xE1ch l\xE0m c\u0169 vs c\xE1ch l\xE0m m\u1EDBi trong ${n}`,
        angle: "So s\xE1nh song song tr\u1EF1c quan, kh\xF4ng b\xEAnh b\xEAn n\xE0o v\xF4 c\u0103n c\u1EE9",
        hook: "C\xF9ng m\u1ED9t vi\u1EC7c, hai c\xE1ch l\xE0m \u2014 k\u1EBFt qu\u1EA3 kh\xE1c nhau t\u1EEB l\xFAc n\xE0o kh\xF4ng hay bi\u1EBFt.",
        why: "So s\xE1nh tr\u1EF1c quan t\u1EA1o tranh lu\u1EADn l\xE0nh m\u1EA1nh trong ph\u1EA7n b\xECnh lu\u1EADn.",
        trend_driver: "Video so s\xE1nh d\u1EC5 nh\u1EADn t\u01B0\u01A1ng t\xE1c b\xECnh lu\u1EADn",
        format: "Comparison"
      }
    ];
    return templates.slice(0, Math.max(3, Math.min(6, count))).map((tpl, i) => ({
      ...tpl,
      score: Math.max(1, Math.min(100, 78 - i * 3))
    }));
  }
  function normaliseTrends(data, niche, count) {
    const wanted = clampCount(count);
    const raw = data && typeof data === "object" ? data : null;
    const list = Array.isArray(raw?.trends) ? raw.trends : [];
    const cleaned = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item;
      const topic = cleanString(rec.topic);
      if (topic.length < 2) continue;
      const score = Math.round(Number(rec.score));
      cleaned.push({
        topic: topic.slice(0, 160),
        angle: cleanString(rec.angle, "G\xF3c ti\u1EBFp c\u1EADn ch\u01B0a r\xF5 \u2014 h\xE3y t\u1EF1 ki\u1EC3m tra l\u1EA1i"),
        hook: cleanString(rec.hook),
        why: cleanString(rec.why),
        trend_driver: cleanString(rec.trend_driver),
        format: cleanString(rec.format, "Explainer"),
        score: Number.isFinite(score) ? Math.max(1, Math.min(100, score)) : 60
      });
      if (cleaned.length >= wanted) break;
    }
    if (cleaned.length >= 3) return { trends: cleaned, ai: true };
    return {
      trends: fallbackTrends(niche, wanted),
      ai: false,
      note: "Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c g\xF3c xu h\u01B0\u1EDBng t\u1EEB AI \u2014 d\xF9ng khu\xF4n m\u1EABu n\u1ED9i dung b\u1EC1n v\u1EEFng c\xF3 s\u1EB5n."
    };
  }
  function normaliseReview(data) {
    const safeApprove = (issues) => ({
      decision: "approve",
      score: 70,
      issues,
      suggestions: [],
      ai: false,
      note: "Kh\xF4ng ki\u1EC3m duy\u1EC7t \u0111\u01B0\u1EE3c b\u1EB1ng AI \u2014 h\xE3y t\u1EF1 r\xE0 checklist tr\u01B0\u1EDBc khi \u0111\u0103ng."
    });
    if (!data || typeof data !== "object") {
      return safeApprove(["Ph\u1EA3n h\u1ED3i ki\u1EC3m duy\u1EC7t tr\u1ED1ng ho\u1EB7c sai \u0111\u1ECBnh d\u1EA1ng."]);
    }
    const rec = data;
    const decisionRaw = cleanString(rec.decision).toLowerCase();
    if (decisionRaw !== "approve" && decisionRaw !== "revise") {
      return safeApprove([`Quy\u1EBFt \u0111\u1ECBnh kh\xF4ng h\u1EE3p l\u1EC7 ("${cleanString(rec.decision).slice(0, 40)}") \u2014 m\u1EB7c \u0111\u1ECBnh cho qua k\xE8m c\u1EA3nh b\xE1o.`]);
    }
    const score = Math.round(Number(rec.score));
    return {
      decision: decisionRaw,
      score: Number.isFinite(score) ? Math.max(1, Math.min(100, score)) : 70,
      issues: cleanStringArray(rec.issues, 10),
      suggestions: cleanStringArray(rec.suggestions, 10),
      ai: true
    };
  }
  return __toCommonJS(agent_core_exports);
})();
