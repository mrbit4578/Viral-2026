/**
 * Smoke test HTTP cho API Agent Crew — gọi thẳng vào bundle production
 * (server/function-bundle.cjs) qua adapter Node req/res, KHÔNG cần Vercel/DB/AI key.
 *
 * Mục đích theo Spec: BR2 (không có AI vẫn chạy, không lỗi 500), BR7 (validate đầu vào),
 * và các test case TC1/TC3 ở tầng HTTP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.resolve(here, '../server/function-bundle.cjs');

// Bundle là sản phẩm của `npm run build` — bỏ qua smoke nếu chưa build.
const hasBundle = existsSync(bundlePath);

function makeRequest(method, pathname, body) {
  const chunks = body ? [new TextEncoder().encode(body)] : [];
  return {
    method,
    // Vercel Node runtime truyền req.url dạng tương đối ("/agents"),
    // handler của vercel-entry dùng điều kiện này để nhận diện kiểu invocation.
    url: pathname,
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      'x-forwarded-proto': 'http',
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      if (chunk && chunk.length) this.body = Buffer.from(chunk);
    },
  };
}

async function call(method, pathname, body) {
  const require = createRequire(import.meta.url);
  const mod = require(bundlePath);
  const handler = mod.default ?? mod;
  const res = makeResponse();
  await handler(makeRequest(method, pathname, body), res);
  const text = res.body ? res.body.toString('utf8') : '';
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.statusCode, json, text };
}

test('HTTP smoke: GET /agents trả trang đội tác nhân', { skip: !hasBundle }, async () => {
  const res = await call('GET', '/agents');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('RA LỆNH CHO CẢ ĐỘI'), 'phải có nút ra lệnh cho đội');
  assert.ok(res.text.includes('TREND SCOUT'), 'phải có thẻ tác nhân');
});

test('BR2: POST /api/agents/trends không có AI key → 200 + fallback (không 500)', { skip: !hasBundle }, async () => {
  const res = await call('POST', '/api/agents/trends', JSON.stringify({ niche: 'Tài chính cá nhân' }));
  assert.equal(res.status, 200);
  assert.equal(res.json.ai, false);
  assert.ok(Array.isArray(res.json.trends) && res.json.trends.length >= 3);
  for (const t of res.json.trends) {
    assert.ok(t.topic.length >= 2);
    assert.ok(t.score >= 1 && t.score <= 100);
  }
});

test('BR7: POST /api/agents/trends kẹp count=0 về biên dưới 3', { skip: !hasBundle }, async () => {
  const res = await call('POST', '/api/agents/trends', JSON.stringify({
    niche: 'Kỹ năng học tập',
    count: 0,
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.ai, false);
  assert.equal(res.json.trends.length, 3);
});

test('BR2/TC1: review fallback vẫn kẹp score blueprint vào 1–100', { skip: !hasBundle }, async () => {
  const res = await call('POST', '/api/agents/review', JSON.stringify({
    blueprint: { viral_score: 999, shots: [{}] },
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.review.ai, false);
  assert.equal(res.json.review.score, 100);
});

test('TC7/BR5: Coordinator gọi mỗi gói phân phối bằng một request riêng', () => {
  const source = readFileSync(path.resolve(here, '../public/static/agents.js'), 'utf8');
  assert.match(source, /for \(const platform of platforms\)/);
  assert.match(source, /platforms: \[platform\]/);
  assert.doesNotMatch(source, /platforms: \['tiktok', 'facebook', 'instagram', 'x'\]/);
});

test('BR7: POST /api/agents/trends niche quá ngắn → 400 kèm thông điệp tiếng Việt', { skip: !hasBundle }, async () => {
  const res = await call('POST', '/api/agents/trends', JSON.stringify({ niche: 'a' }));
  assert.equal(res.status, 400);
  assert.ok(res.json.error && res.json.error.length > 0);
});

test('TC1/BR2: POST /api/agents/review không có AI key → approve an toàn kèm cảnh báo', { skip: !hasBundle }, async () => {
  const blueprint = {
    viral_score: 70,
    hook: 'Bạn có bao giờ tự hỏi…?',
    script: 'Đoạn kịch bản demo.',
    shots: [{ start_sec: 0, end_sec: 6, purpose: 'Hook', visual: 'Cảnh mở đầu', narration: 'Câu mở', on_screen_text: 'DỪNG LẠI', image_prompt: 'vertical 9:16' }],
    seo: { description: '', hashtags: [], pinned_comment: '' },
    monetization: { angle: '', cta: '', disclosure: '' },
  };
  const res = await call('POST', '/api/agents/review', JSON.stringify({ blueprint }));
  assert.equal(res.status, 200);
  assert.equal(res.json.review.decision, 'approve');
  assert.equal(res.json.review.ai, false);
  assert.ok(Array.isArray(res.json.review.issues));
});

test('BR7: POST /api/agents/review blueprint thiếu shots → 400', { skip: !hasBundle }, async () => {
  const res = await call('POST', '/api/agents/review', JSON.stringify({ blueprint: { shots: [] } }));
  assert.equal(res.status, 400);
  assert.ok(res.json.error);
});

test('BR4: GET /api/agents/jobs khi DB chưa cấu hình → 200 với danh sách rỗng (không 500)', { skip: !hasBundle }, async () => {
  const res = await call('GET', '/api/agents/jobs');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { jobs: [] });
});
