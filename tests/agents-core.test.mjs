/**
 * Test Agent — bộ kiểm thử ĐỘC LẬP cho Agent Crew.
 *
 * Nguyên tắc "Độc lập hoàn toàn" (Spec BR, Sổ tay Prompt SDD): các test dưới đây
 * được viết CHỈ dựa vào specs/spec-agent-crew.md (TC1–TC6), kiểm tra đầu vào →
 * đầu ra của hợp đồng hàm mô tả trong Design, không quan tâm cách Dev cài đặt.
 *
 * Chạy: npm test   (node --test tests/ — Node 23.6+ đọc thẳng .ts erasable-syntax)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REVIEW_ROUNDS,
  clampCount,
  clampProgress,
  planNext,
  weightProgress,
  pickBestTrend,
  normaliseTrends,
  normaliseReview,
  fallbackTrends,
} from '../src/lib/agent-core.ts';

/* Trạng thái hợp lệ để tái dùng trong các test planner. */
function state(overrides = {}) {
  return {
    trendsDone: false,
    blueprintDone: false,
    reviewRounds: 0,
    lastDecision: null,
    pendingShots: [],
    voiceDone: false,
    distributionDone: false,
    ...overrides,
  };
}

/* ============================== TC4 — kẹp biên đầu vào ============================== */

test('TC4: clampCount kẹp số lượng trend vào 3–6', () => {
  assert.equal(clampCount(1), 3);
  assert.equal(clampCount(2), 3);
  assert.equal(clampCount(3), 3);
  assert.equal(clampCount(5), 5);
  assert.equal(clampCount(6), 6);
  assert.equal(clampCount(99), 6);
  // Đầu vào rác phải an toàn, không ném exception
  assert.equal(clampCount(undefined), 5);
  assert.equal(clampCount('abc'), 5);
  assert.equal(clampCount(null), 5);
});

test('TC4: clampProgress kẹp tiến độ vào 0–100', () => {
  assert.equal(clampProgress(-5), 0);
  assert.equal(clampProgress(0), 0);
  assert.equal(clampProgress(50), 50);
  assert.equal(clampProgress(100), 100);
  assert.equal(clampProgress(150), 100);
  assert.equal(clampProgress(undefined), 0);
  assert.equal(clampProgress('x'), 0);
});

/* ============================== TC3 — fallback khi không có AI ============================== */

test('TC3: normaliseTrends(null) trả >= 3 góc nội dung hợp lệ, ai=false ở tầng payload', () => {
  const res = normaliseTrends(null, 'Tài chính cá nhân', 5);
  assert.equal(Array.isArray(res.trends), true);
  assert.ok(res.trends.length >= 3, `mong >= 3, nhận ${res.trends.length}`);
  assert.equal(res.ai, false);
  for (const t of res.trends) {
    assert.ok(typeof t.topic === 'string' && t.topic.length >= 2, `topic phải >= 2 ký tự: ${JSON.stringify(t.topic)}`);
    assert.ok(typeof t.angle === 'string' && t.angle.length > 0, 'angle không được rỗng');
    assert.ok(Number.isInteger(t.score) && t.score >= 1 && t.score <= 100, `score phải nằm trong 1–100: ${t.score}`);
  }
  // Cờ AI không được lọt vào từng phần tử (Spec Inputs: cờ nằm ở tầng response)
  for (const t of res.trends) assert.equal('ai' in t, false);
});

test('TC3: JSON AI rác (thiếu trends / item rỗng) phải rơi về fallback, không ném lỗi', () => {
  const cases = [{}, { trends: [] }, { trends: [null, {}, { topic: 'a' }] }, 'string', 42];
  for (const bad of cases) {
    const res = normaliseTrends(bad, 'Kiến thức', 4);
    assert.equal(res.ai, false);
    assert.ok(res.trends.length >= 3);
  }
});

test('TC3: JSON AI hợp lệ được giữ nguyên là ai=true, score kẹp 1–100', () => {
  const good = {
    trends: [
      { topic: 'Góc 1', angle: 'A', hook: 'H', why: 'W', trend_driver: 'D', format: 'Listicle', score: 88 },
      { topic: 'Góc 2', angle: 'A', score: 150 },          // score vượt biên → kẹp 100
      { topic: 'Góc 3', angle: 'A', score: 'không-số' },    // score rác → giá trị mặc định trong 1–100
      { topic: '', angle: 'bị loại vì topic quá ngắn' },    // topic rỗng → loại
    ],
  };
  const res = normaliseTrends(good, 'X', 5);
  assert.equal(res.ai, true);
  assert.equal(res.trends.length, 3);
  assert.equal(res.trends[1].score, 100);
  assert.ok(res.trends[2].score >= 1 && res.trends[2].score <= 100);
});

test('BR2: fallbackTrends luôn cho >= 3 góc dùng được bất kể count kiểu gì', () => {
  for (const count of [3, 5, 6, 10, 1]) {
    const list = fallbackTrends('Nghề tay chân', count);
    assert.ok(list.length >= 3);
    for (const t of list) assert.ok(t.topic.length >= 2 && t.score >= 1 && t.score <= 100);
  }
});

/* ============================== TC1 + TC6 — QA Reviewer ============================== */

test('TC1: review approve hợp lệ → decision=approve, score 1–100, issues là mảng', () => {
  const res = normaliseReview({ decision: 'approve', score: 87, issues: [], suggestions: [] });
  assert.equal(res.decision, 'approve');
  assert.ok(res.score >= 1 && res.score <= 100);
  assert.deepEqual(res.issues, []);
  assert.deepEqual(res.suggestions, []);
  assert.equal(res.ai, true);
});

test('TC1: review revise hợp lệ giữ nguyên decision và các góp ý', () => {
  const res = normaliseReview({
    decision: 'revise',
    score: 42,
    issues: ['Hook chưa tạo tò mò trong 3 giây', 'Shot 3 quá 12 giây'],
    suggestions: ['Viết lại hook thành câu hỏi'],
  });
  assert.equal(res.decision, 'revise');
  assert.equal(res.score, 42);
  assert.deepEqual(res.issues, ['Hook chưa tạo tò mò trong 3 giây', 'Shot 3 quá 12 giây']);
  assert.deepEqual(res.suggestions, ['Viết lại hook thành câu hỏi']);
});

test('TC6: normaliseReview(null) → approve an toàn kèm cảnh báo, KHÔNG ném exception', () => {
  let res;
  assert.doesNotThrow(() => { res = normaliseReview(null); });
  assert.equal(res.decision, 'approve');
  assert.equal(res.ai, false);
  assert.ok(Array.isArray(res.issues) && res.issues.length >= 1, 'phải có ít nhất 1 cảnh báo');
});

test('TC6: JSON review sai schema (decision lạ / rác) → approve an toàn kèm cảnh báo', () => {
  for (const bad of [undefined, {}, 'approve', { decision: 'maybe', score: 50 }, { decision: '' }]) {
    let res;
    assert.doesNotThrow(() => { res = normaliseReview(bad); });
    assert.equal(res.decision, 'approve', `đầu vào ${JSON.stringify(bad)} phải cho approve an toàn`);
    assert.equal(res.ai, false);
    assert.ok(res.issues.length >= 1);
  }
});

test('TC6: score rác hoặc vượt biên được kẹp về trong 1–100', () => {
  assert.equal(normaliseReview({ decision: 'approve', score: 999 }).score, 100);
  assert.equal(normaliseReview({ decision: 'approve', score: -3 }).score, 1);
  const nanScore = normaliseReview({ decision: 'approve', score: 'abc' });
  assert.ok(nanScore.score >= 1 && nanScore.score <= 100);
});

/* ============================== TC2 + TC5 — Coordinator planner ============================== */

test('BR3: hằng số giới hạn vòng review đúng như Spec (2 lượt)', () => {
  assert.equal(MAX_REVIEW_ROUNDS, 2);
});

test('TC5: state trống → bước đầu tiên là trends', () => {
  assert.deepEqual(planNext(state()), { step: 'trends' });
});

test('TC5: có trends + blueprint + approve → sang images với đúng danh sách shot còn thiếu', () => {
  const plan = planNext(state({
    trendsDone: true,
    blueprintDone: true,
    lastDecision: 'approve',
    reviewRounds: 1,
    pendingShots: [2, 3, 5],
  }));
  assert.deepEqual(plan, { step: 'images' });
});

test('TC5: đủ hết → finish (không bao giờ lặp vô hạn)', () => {
  const plan = planNext(state({
    trendsDone: true,
    blueprintDone: true,
    lastDecision: 'approve',
    reviewRounds: 1,
    pendingShots: [],
    voiceDone: true,
    distributionDone: true,
  }));
  assert.deepEqual(plan, { step: 'finish' });
});

test('BR1: trước review phải qua blueprint; review chạy khi lastDecision=null', () => {
  assert.equal(planNext(state({ trendsDone: true })).step, 'blueprint');
  assert.equal(planNext(state({ trendsDone: true, blueprintDone: true })).step, 'review');
});

test('TC2: revise lần 1 → cho sửa (revise); revise lần 2 → ABORT, không bao giờ có vòng thứ 3', () => {
  // Lượt 1 đã chạy (reviewRounds=1) và QA vẫn đòi sửa → còn quyền sửa 1 lần
  const round1 = planNext(state({ trendsDone: true, blueprintDone: true, reviewRounds: 1, lastDecision: 'revise' }));
  assert.equal(round1.step, 'revise');

  // Lượt 2 đã chạy (reviewRounds=2=MAX) mà vẫn revise → phải abort kèm lý do
  const round2 = planNext(state({ trendsDone: true, blueprintDone: true, reviewRounds: 2, lastDecision: 'revise' }));
  assert.equal(round2.step, 'abort');
  assert.ok(typeof round2.reason === 'string' && round2.reason.length > 0, 'abort phải kèm lý do');

  // Cứng hơn: kể cả reviewRounds vượt quá giới hạn vẫn phải abort (phòng lỗi đếm)
  const overLimit = planNext(state({ trendsDone: true, blueprintDone: true, reviewRounds: 5, lastDecision: 'revise' }));
  assert.equal(overLimit.step, 'abort');
});

test('BR1: sau images mới tới voice, sau voice mới tới distribution', () => {
  const base = { trendsDone: true, blueprintDone: true, lastDecision: 'approve', reviewRounds: 1 };
  assert.equal(planNext(state({ ...base, pendingShots: [], voiceDone: false })).step, 'voice');
  assert.equal(planNext(state({ ...base, pendingShots: [], voiceDone: true, distributionDone: false })).step, 'distribution');
});

/* ============================== Bổ trợ — trọng số & chọn trend ============================== */

test('weightProgress luôn nằm trong 0–100 với mọi tổ hợp', () => {
  assert.equal(weightProgress([]), 0);
  assert.equal(weightProgress(['trends', 'blueprint', 'review', 'images', 'voice', 'distribution']), 100);
  assert.equal(weightProgress(['trends'], 0), 5);
  const half = weightProgress(['trends', 'blueprint', 'review', 'images'], 0.5);
  assert.ok(half >= 0 && half <= 100);
  // imagesFrac rác không được làm vỡ
  for (const frac of [-1, 2, NaN, 'x']) {
    const v = weightProgress(['images'], frac);
    assert.ok(v >= 0 && v <= 100, `imagesFrac=${frac} cho ${v} ngoài biên`);
  }
});

test('pickBestTrend chọn điểm cao nhất; hoà điểm lấy phần tử đầu; rác → null', () => {
  const list = [
    { topic: 'A', score: 60 },
    { topic: 'B', score: 85 },
    { topic: 'C', score: 85 },
  ];
  assert.equal(pickBestTrend(list).topic, 'B');
  assert.equal(pickBestTrend([]), null);
  assert.equal(pickBestTrend(null), null);
  assert.equal(pickBestTrend([{}, { score: 'x' }, { topic: 'Z', score: 3 }]).topic, 'Z');
});
