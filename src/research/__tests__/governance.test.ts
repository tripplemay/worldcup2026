/**
 * P3c 治理层单测:configHash、试验注册表、holdout manifest 隔离、G0–G7 串行闸门。
 */
import {
  configHash,
  newRegistry,
  registerTrial,
  trialCount,
  distinctTrialCount,
  buildHoldoutManifest,
  excludeHoldout,
  holdoutSlice,
  evaluateGates,
} from '../governance';
import type { GateEvidence } from '../governance';
import type { EngineDataset } from '../engine';
import type { ResultMatch } from 'lib/predict/types';

describe('configHash', () => {
  it('确定性 + 键序无关 + 不同参不同哈希', () => {
    expect(configHash({ a: 1, b: 2 })).toBe(configHash({ b: 2, a: 1 }));
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }));
  });
});

describe('试验注册表(钉死分母)', () => {
  it('累计 N 含重复;去重数独立', () => {
    let reg = newRegistry();
    reg = registerTrial(reg, { gs: 0.6 });
    reg = registerTrial(reg, { gs: 0.6 }); // 重复
    reg = registerTrial(reg, { gs: 0.8 });
    expect(trialCount(reg)).toBe(3); // 分母用累计 N
    expect(distinctTrialCount(reg)).toBe(2);
  });
});

describe('holdout manifest 物理隔离', () => {
  const mk = (id: string, date: string): ResultMatch => ({
    eventId: id,
    date: `${date}T12:00:00Z`,
    homeNorm: 'a',
    awayNorm: 'b',
    homeGoals: 1,
    awayGoals: 0,
  });
  const ds: EngineDataset = {
    allHist: [],
    allRes: [
      mk('1', '2024-01-01'),
      mk('2', '2024-06-01'),
      mk('3', '2025-01-01'),
      mk('4', '2025-06-01'),
    ],
    odds: {},
  };
  it('excludeHoldout 剔除 L3、holdoutSlice 仅留 L3、两者互补', () => {
    const m = buildHoldoutManifest(ds, '2025-01-01', 0);
    expect(m.holdoutEventIds.sort()).toEqual(['3', '4']);
    expect(excludeHoldout(ds, m).allRes.map((r) => r.eventId)).toEqual(['1', '2']);
    expect(holdoutSlice(ds, m).allRes.map((r) => r.eventId)).toEqual(['3', '4']);
  });
});

describe('G0–G7 串行晋级闸门', () => {
  const passEv = (): GateEvidence => ({
    noLeak: true,
    clv: { n: 150, t: 3, avgClv: 0.01, posRate: 0.6 },
    roi: { dsr: 0.97, spaP: 0.02, ciLower: 0.01, n: 3000 },
    pbo: 0.05,
    robust: {
      subperiodsPositiveFrac: 0.8,
      segmentsNoCollapse: true,
      anchoredPositive: true,
      rollingPositive: true,
    },
    drawdown: { historicalMaxDD: 0.2, mc95DD: 0.3, ruinPath: false },
    holdout: { clvPositive: true, roiNotSigNeg: true, noNewCollapse: true },
    forward: { liveBets: 200, liveClvT: 2.5 },
  });

  it('全达标 → 全过', () => {
    const v = evaluateGates(passEv());
    expect(v.passedAll).toBe(true);
    expect(v.blockedAt).toBeNull();
  });

  it('CLV t 不足 → 卡 G1,后闸 skip', () => {
    const ev = passEv();
    ev.clv.t = 1.5;
    const v = evaluateGates(ev);
    expect(v.blockedAt).toBe('G1');
    expect(v.gates.find((g) => g.id === 'G2')!.status).toBe('skip');
  });

  it('CLV 转负 → G1 一票否决', () => {
    const ev = passEv();
    ev.clv.avgClv = -0.01;
    const v = evaluateGates(ev);
    expect(v.blockedAt).toBe('G1');
    expect(v.gates.find((g) => g.id === 'G1')!.veto).toBe(true);
  });

  it('PBO 超标 → 卡 G3(G0–G2 过)', () => {
    const ev = passEv();
    ev.pbo = 0.52;
    const v = evaluateGates(ev);
    expect(v.blockedAt).toBe('G3');
    expect(v.gates.find((g) => g.id === 'G2')!.status).toBe('pass');
  });

  it('破产路径 → G5 一票否决', () => {
    const ev = passEv();
    ev.drawdown.ruinPath = true;
    const v = evaluateGates(ev);
    expect(v.blockedAt).toBe('G5');
    expect(v.gates.find((g) => g.id === 'G5')!.veto).toBe(true);
  });

  it('缺 holdout → 卡 G6', () => {
    const ev = passEv();
    delete ev.holdout;
    const v = evaluateGates(ev);
    expect(v.blockedAt).toBe('G6');
  });
});
