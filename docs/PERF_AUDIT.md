# 前端性能审核与实现清单

> **审核日期**：2026-06-15
> **工程**：Next.js 15 (App Router) + React 19 移动端世界杯 PWA
> **运行时范围**：`src/app/(wc)/`、`src/components/worldcup/`、`src/lib/`
> （模板残留的 admin/dashboard 页面不在运行时路径，除非特别说明，**不要动**）
>
> 本文档供实现 agent 直接执行。每个任务含：证据(file:line) → 改动 → 验收。
> 严格按「执行顺序」分批做，前 3 批为零架构风险快赢，H3 单独验证。

---

## ⚠️ 实现前必读：以下是「伪问题」，不要改

初轮自动审查夸大了下列项，已逐条核实源码证伪。**不要在这些上花时间**：

| 伪问题 | 真相 |
|---|---|
| StatusBar 1s 定时器导致「整页」重渲染 | 错。`tick` setState 只重渲 `StatusBar.tsx:26` 这一个小文本组件，不波及 SchedulePage / MatchCard 列表。可忽略。 |
| `dateLabel/todayCN` 每秒重算 | 错。只在 SchedulePage 自身重渲时跑（25s/30min 轮询），非每秒。 |
| LocaleContext value 未 memo → 全体 consumer 重渲 | 基本非问题。`LocaleProvider` 仅 `locale` 一个 state，只在切换语言时重渲，那正是 consumer 该更新之时。memo 收益≈0。 |
| localStorage 同步读阻塞首屏 | 夸大。读取在 `useEffect`（`context.tsx:25`）首次绘制之后执行，不阻塞 FCP。 |
| chakra/apexcharts/mapbox/fullcalendar 进了 bundle | 错。(wc) 链路零引用，`Card` 也不依赖 chakra，已被 tree-shake，不在 (wc) 包内。 |
| 赛程列表需虚拟滚动 | 错。按天约 16 行，无需虚拟化。 |
| Service Worker 跨版本白屏风险 | v2 设计正确（导航 network-first，放行 /_next + /api），无需改。 |
| `routes.tsx` / `variables/charts.ts` 拖累 (wc) 包 | 已核实不在 (wc) 包内（仅模板组件引用，tree-shake 掉）。纯整洁性，低优先。 |

---

## 执行顺序总览

| 批次 | 任务 | 投入 | 收益 | 风险 |
|---|---|---|---|---|
| **批 1** | H1 字体 | 低 | FCP↑↑ | 无 |
| **批 1** | H2 framer-motion→CSS | 低 | JS 体积↓↓ | 无 |
| **批 2** | M1 删模板 CSS | 极低 | CSS↓ | 无 |
| **批 2** | M2 img 尺寸/优化 | 低 | CLS 消除 + 带宽↓ | 无 |
| **批 3** | M3 oddsMap + normalizeTeam 缓存 | 中 | 轮询 CPU↓ | 低 |
| **批 3** | M4 列表行 memo | 低 | 同上（依赖 M3） | 低 |
| **批 3** | M5 fetcher 超时 + 全局 SWRConfig | 低 | 弱网可靠性 | 低 |
| **批 4** | N1 optimizePackageImports | 极低 | 保险 | 无 |
| **批 5** | H3 拆除 (wc) 的 NoSSR | 中 | 首屏↑↑ | **中（需 hydration 回归）** |

> 批 1–3 可在半天内落地、零架构风险，优先。H3 单独开一轮，改完 `next build` + 真机/弱网回归。

---

## 🔴 批 1

### H1. 渲染阻塞的 Google Fonts `@import` + 整套未用 Poppins

**证据**
- `src/styles/index.css:1` → `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@100;200;300;400;500;600;700;800&display=swap')` —— Poppins 8 字重，(wc) 全程用 DM Sans，**Poppins 未使用**。
- `src/styles/index.css:2` 与 `src/styles/App.css:1` 各导一遍 DM Sans；App.css 那份还含 6 个斜体变体（`0,400;0,500;0,700;1,400;1,500;1,700`），UI 无斜体使用。

**机制**：CSS 内 `@import url(fonts.googleapis.com...)` 是渲染阻塞二级请求链（CSS→fonts CSS→字体文件），弱网推迟 FCP 数百 ms；Poppins 8 字重纯属白下。

**改动**
1. 删除 `src/styles/index.css:1`（Poppins 整行）。
2. 删除 `src/styles/index.css:2` 与 `src/styles/App.css:1` 的 DM Sans `@import`（改用 next/font，见下）。
3. 在 `src/app/layout.tsx` 用 `next/font/google` 注入 DM Sans（自托管 + preload + swap）：
   ```ts
   import { DM_Sans } from 'next/font/google';
   const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400','500','700'], display: 'swap' });
   // <html lang="zh-CN" className={dmSans.className}> ...
   ```
4. `src/styles/App.css` 里 `body { font-family: 'DM Sans', sans-serif; }` 可保留（next/font 会注入同名 family），或改用 `dmSans.style.fontFamily`。确认 `tailwind.config.js` 的 `fontFamily` 若引用 DM Sans 仍生效。

**验收**
- DevTools Network 无 `fonts.googleapis.com` 阻塞请求。
- 字体由 `/_next/static/media/*.woff2` 提供。
- 页面文字渲染外观不变。

---

### H2. framer-motion 仅为两个淡入动画被打进 (wc) 包

**证据**：(wc) 链路里 framer-motion 只出现在 `src/components/worldcup/MatchCard.tsx:4` 与 `src/components/worldcup/OddsCard.tsx:4`，都只做入场淡入（`MatchCard.tsx:56-60` 的 `initial/animate opacity+y`，0.25s）。是 (wc) 包内**唯一真正被拉入的重运行时库**（~30–40KB gzip）。

**改动**
1. 在某个被全局加载的 CSS（如 `src/styles/index.css` 的 `@layer` 外，或新建 `src/styles/animations.css` 并在 `AppWrappers.tsx` import）加：
   ```css
   @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
   .fade-in-up { animation: fadeInUp .25s ease-out both; }
   ```
2. `MatchCard.tsx`：删 `import { motion } from 'framer-motion'`；`<motion.div initial={...} animate={...} transition={...}>` → `<div className="fade-in-up">`。
3. `OddsCard.tsx`：同样替换。
4. 确认全工程再无 framer-motion 引用（`grep -rn "framer-motion" src`），可从 `package.json` 移除依赖。

**验收**
- 入场淡入动画视觉效果与之前一致。
- (wc) 路由 bundle 不再含 framer-motion（`next build` 后对比 chunk 体积或 `@next/bundle-analyzer`）。

---

## 🟠 批 2

### M1. 全局引入未使用的模板 CSS

**证据**：`src/app/AppWrappers.tsx:7` import `styles/MiniCalendar.css`（4.4KB，react-calendar 用，(wc) 不用）；`src/styles/Plugins.css`（3.4KB，FullCalendar/Kanban）、`src/styles/Contact.css`（25B 僵尸）为模板残留。

**改动**
1. `AppWrappers.tsx`：移除 `import 'styles/MiniCalendar.css'`（确认 (wc) 无 react-calendar 后）。
2. 删除文件 `src/styles/Plugins.css`、`src/styles/Contact.css`，并移除其所有 import（`grep -rn "Plugins.css\|Contact.css" src`）。
3. 若 admin 模板页面确需 MiniCalendar.css，改为在那些页面局部 import，不要全局。

**验收**：(wc) 各页面样式不变；`grep` 确认无悬空 import。

---

### M2. 远程队徽：`unoptimized:true` + 无 `width/height`

**证据**：`next.config.js:25` `images.unoptimized:true`；`src/components/worldcup/TeamBadge.tsx` 用 `<img ... className="h-5 w-5" loading="lazy">` **无 width/height 属性**；`src/app/(wc)/match/[id]/page.tsx:86,113` 队徽同样缺尺寸。

**机制**：ESPN 原图按原分辨率下载（仅显示 20px，浪费带宽）；缺尺寸属性 → CLS 抖动。`loading="lazy"` 已正确。

**改动（分两档，先做① 必做，② 可选）**
1. **① 补尺寸属性（零成本消 CLS）**：所有渲染队徽的 `<img>` 加 `width={20} height={20}`（详情页按实际显示尺寸填，如 32/40）。
2. **② 带宽优化（可选）**：评估对 `i.ibb.co` / ESPN 域名重新启用 Next 图片优化（`unoptimized:false` + `images.remotePatterns`），或经图片 CDN 缩放到 2× 目标尺寸。注意：当前 `unoptimized:true` 可能是部署约束（standalone/无优化服务），改前确认部署环境支持 Next Image Optimization。

**验收**：Lighthouse CLS 改善；队徽显示不变。

---

## 🟠 批 3

### M3. `findMatch` 每次渲染重建 + `normalizeTeam` 无缓存

**证据**
- `src/app/(wc)/schedule/page.tsx:151-161`：`.map` 内对每行调 `findMatch(oddsMatches, m.homeTeam, m.awayTeam, m.commenceTime)`。
- `src/lib/match/normalize.ts:55-62`：`findMatch` 对整个 odds 数组 `find`，每次 `matchKey` 跑 2× `normalizeTeam`（`normalize.ts:27-35` NFD + 两次正则）。
- 每次 SchedulePage 重渲（25s/30min 轮询）都全量重算，且让传给 `MatchCard` 的 `odds` 每次是新引用 → 阻碍 M4 的 memo。

**改动**
1. 在 `schedule/page.tsx`（或 `useWorldCup.ts` 暴露）用 `useMemo` 建索引，行内 O(1) 取：
   ```ts
   import { matchKey } from 'lib/match/normalize';
   const oddsMap = useMemo(() => {
     const map = new Map<string, MatchOdds>();
     for (const o of oddsMatches) map.set(matchKey(o.homeTeam, o.awayTeam, o.commenceTime), o);
     return map;
   }, [oddsMatches]);
   // 行内：
   // odds={oddsMap.get(matchKey(m.homeTeam, m.awayTeam, m.commenceTime))}
   ```
2. 给 `normalizeTeam` 加进程内缓存（48 队恒定，命中率≈100%）：
   ```ts
   const _normCache = new Map<string, string>();
   export function normalizeTeam(name: string): string {
     const hit = _normCache.get(name);
     if (hit !== undefined) return hit;
     const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
       .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
     const out = ALIASES[base] ?? base;
     _normCache.set(name, out);
     return out;
   }
   ```
   > 注意：保持原正则字符类语义（去变音符），上面用 `̀-ͯ` 等价表达更可移植。改后跑 `src/lib/match/__tests__/normalize.test.ts` 必须全绿。

**验收**：`normalize.test.ts` 全绿；赔率与赛程对齐结果不变；SchedulePage 重渲时不再重建整个查找索引。

---

### M4. 列表行组件未 `React.memo`

**证据**：`MatchCard`（`MatchCard.tsx:43`）、`OddsCard`、`WinnerList` 行均未 memo。**依赖 M3**：只有当 `odds` 引用稳定后 memo 才生效。

**改动**：对 `MatchCard`、`OddsCard` 包 `React.memo`（默认浅比较即可，因 M3 后 props 引用稳定）。`WinnerList` 行同理。
```tsx
export default React.memo(function MatchCard({ m, odds }: {...}) { ... });
```

**验收**：轮询刷新时，数据未变的行不再重渲（React DevTools Profiler 验证）。

> ⚠️ 必须在 M3 之后做；单独做会因 props 每次新建而无效。

---

### M5. fetcher 无超时 + 无全局 SWRConfig

**证据**：`src/lib/hooks/fetcher.ts:4-11` 裸 `fetch` 无超时；`src/lib/hooks/useWorldCup.ts:39-51` 各 hook 重复传 `common/oddsCommon`，无顶层 `SWRConfig`。

**改动**
1. fetcher 加 `AbortController` 超时：
   ```ts
   export async function fetcher<T>(url: string, timeoutMs = 10_000): Promise<T> {
     const ctrl = new AbortController();
     const id = setTimeout(() => ctrl.abort(), timeoutMs);
     try {
       const res = await fetch(url, { signal: ctrl.signal });
       const json = (await res.json()) as ApiResponse<T>;
       if (!json.success || json.data == null) throw new Error(json.error || `请求失败: ${res.status}`);
       return json.data;
     } finally { clearTimeout(id); }
   }
   ```
2. 在 `src/app/(wc)/layout.tsx` 套 `<SWRConfig>` 收敛公共策略（`dedupingInterval`、`errorRetryCount: 2` 降低失败风暴等）。注意**不要**覆盖各 hook 的 `refreshInterval` 与 odds 类的 `revalidateOnFocus:false`（配额相关，须保留）。

**验收**：断网/慢网下请求 10s 内中止并触发 SWR 错误态而非无限挂起；轮询/配额行为不变。

---

## 🟢 批 4

### N1. `next.config.js` 加 `optimizePackageImports`

**证据**：(wc) 15 处具名 `from 'react-icons/md'` 已能 tree-shake，加配置作保险。

**改动**：`next.config.js` 加
```js
experimental: { optimizePackageImports: ['react-icons'] },
```
**验收**：`next build` 通过；图标显示不变。

---

## 🔵 批 5（单独开一轮，需回归）

### H3. 整个 App 被 `dynamic(ssr:false)` 包裹，放弃 SSR 首屏

**证据**：`src/app/AppWrappers.tsx:14-18,47` —— `NoSSR = dynamic(() => Promise.resolve(_NoSSR), { ssr:false })` 包住全部 children（根布局，作用于含 (wc) 的所有路由）。

**机制**：首屏 HTML 空壳，须等 JS 下载 + hydration 才出现内容；弱网/低端机 FCP/LCP 拉长。与历史 commit `63dc086`「白屏」同源。

**诚实补充**：数据全走 SWR 客户端拉取，去掉 NoSSR **不会让数据更早出现**，但能让布局骨架/字体/底部 Tab/loading skeleton 立即服务端绘制 —— 对「白屏感」是质变。

**改动（择一，建议 A）**
- **A（推荐）**：`AppWrappers.tsx` 去掉 NoSSR 包裹，直接渲染 `ConfiguratorContext.Provider`；其内对只能客户端跑的逻辑（如 `theme` 写 `document.documentElement`，已在 `useEffect` 内，安全）保持守卫即可。
- **B（保守）**：仅模板 admin 路由保留 NoSSR，为 (wc) 路由组提供干净 provider。

**验收（关键）**
- `next build` 通过，无 hydration mismatch 警告（控制台无 "Hydration failed"）。
- (wc) 各页面 SSR 后骨架/Tab 立即出现；真机 + Chrome DevTools「Slow 3G」回归首屏。
- 主题/暗色（`layout.tsx:38` body `className="dark"`）表现不变。

> 因有 hydration 风险，**必须**单独提交、单独验证，不与批 1–4 混合。

---

## 验证清单（每批完成后）

- [ ] `yarn build` 成功（注意 `next.config.js` 已设 `typescript.ignoreBuildErrors` / `eslint.ignoreDuringBuilds`，**不代表**类型/lint 真通过，改动需自查）。
- [ ] `yarn test` —— 至少 `src/lib/match/__tests__/normalize.test.ts` 全绿（M3 改了 normalize）。
- [ ] 真机或 DevTools Slow 3G 下，schedule / odds / predict / 详情页 功能与视觉无回归。
- [ ] Lighthouse（移动）对比改前后：FCP / LCP / CLS / Total Blocking Time。
- [ ] The Odds API 配额相关的轮询间隔（`useWorldCup.ts` 的 `ODDS_MS`/`oddsCommon`）未被无意改动。
