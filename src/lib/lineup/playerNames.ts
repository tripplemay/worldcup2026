/**
 * 球员中文名:LLM 翻译 + 缓存(原名 → 中文)。
 * 复用 AIGC 网关(默认 gpt-5.5,INTEL_LLM_MODEL 可覆盖);缓存落 WC_DATA_DIR/player-names.json(部署不丢)+ 进程内。
 * 未配置 AIGC_API_KEY 时跳过(回退原名);空名单不调用(赛前无阵容时零成本)。
 * 知名球员=媒体通用译名,冷门球员=音译。LLM 未返回的名字记原名,避免反复调用。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.AIGC_BASE ?? 'https://aigc.guangai.ai/v1';
const MODEL = process.env.INTEL_LLM_MODEL ?? 'gpt-5.5';
const DATA_DIR = process.env.WC_DATA_DIR ?? '.data';
const FILE = join(DATA_DIR, 'player-names.json');

let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

function save(c: Record<string, string>): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(c));
  } catch (e) {
    console.error('[player-names] 写缓存失败', e);
  }
}

const SYSTEM = `你是足球译名专家。把给定的球员英文/拉丁名翻成中文(用中文足球媒体通用译名,知名球员用约定俗成译名,冷门球员音译)。\
只输出一个 JSON 对象:键为原名(原样照抄),值为对应中文名。不要解释、不要额外字段。`;

async function llmTranslate(names: string[]): Promise<Record<string, string>> {
  const key = process.env.AIGC_API_KEY;
  if (!key || !names.length) return {};
  const payload: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 2000,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(names) },
    ],
  };
  if (/qwen/i.test(MODEL)) payload.enable_thinking = false; // 关思考省 token
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return {};
    const obj = JSON.parse(content) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

const inflight = new Set<string>(); // 正在翻译的名字,避免并发重复调用

/** 取已缓存的中文名(同步,不调用 LLM)。只含有译名的(回退原名由调用方处理)。 */
export function cachedNames(names: string[]): Record<string, string> {
  const c = load();
  const out: Record<string, string> = {};
  for (const n of new Set(names.filter(Boolean))) {
    if (c[n] && c[n] !== n) out[n] = c[n];
  }
  return out;
}

/**
 * 后台补齐缺失球员名的翻译(不阻塞;fire-and-forget)。
 * 译好后落缓存,下次请求(详情页 SWR ~30s 轮询)即可拿到中文名。
 */
export function ensureNames(names: string[]): void {
  if (!process.env.AIGC_API_KEY) return;
  const c = load();
  const missing = [...new Set(names.filter(Boolean))].filter(
    (n) => !(n in c) && !inflight.has(n),
  );
  if (!missing.length) return;
  missing.forEach((n) => inflight.add(n));
  void llmTranslate(missing)
    .then((fresh) => {
      for (const n of missing) c[n] = fresh[n] ?? n; // 未返回的记原名,避免反复调用
      save(c);
    })
    .finally(() => missing.forEach((n) => inflight.delete(n)));
}
