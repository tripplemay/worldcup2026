import {
  STEAM_WINDOW,
  STEAM_COOLDOWN,
  BREAKOUT_WINDOW,
  BREAKOUT_COOLDOWN,
  RLM_WINDOW,
  RLM_REFIRE,
} from '../radar';

// 滑窗去重不变式:检测器拿"现值 vs 窗口前值"比较,一次穿越在整个窗口期内都为真;
// 故触发冷却必须 ≥ 回看窗口,否则同一次穿越会在冷却到期、窗口未滑过时重复触发。
describe('radar 去重不变式:cooldown ≥ 回看窗口', () => {
  it.each([
    ['STEAM', STEAM_COOLDOWN, STEAM_WINDOW],
    ['BREAKOUT', BREAKOUT_COOLDOWN, BREAKOUT_WINDOW],
    ['RLM', RLM_REFIRE, RLM_WINDOW],
  ])('%s:同一次穿越不重复触发', (_name, cooldown, window) => {
    expect(cooldown).toBeGreaterThanOrEqual(window);
  });
});
