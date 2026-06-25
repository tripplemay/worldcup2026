// wx-link 是纯 ESM,jest(CJS)无法解析 → 虚拟 mock(本测试只验纯函数,不需要真实现)
jest.mock('wx-link', () => ({ WxLinkClient: class {} }), { virtual: true });

import { botKey, envWxTokens, listWxTokens } from '../client';

describe('botKey', () => {
  it('稳定、区分不同 token、定长 12', () => {
    expect(botKey('abc')).toBe(botKey('abc'));
    expect(botKey('abc')).not.toBe(botKey('abd'));
    expect(botKey('abc')).toHaveLength(12);
  });
});

describe('envWxTokens / listWxTokens', () => {
  const orig = process.env.WX_BOT_TOKEN;
  afterEach(() => {
    if (orig === undefined) delete process.env.WX_BOT_TOKEN;
    else process.env.WX_BOT_TOKEN = orig;
  });

  it('env 逗号分隔 + trim + 去空(保留重复)', () => {
    process.env.WX_BOT_TOKEN = ' t1 , t2 ,, t1 ';
    expect(envWxTokens()).toEqual(['t1', 't2', 't1']);
  });

  it('未配置 → 空', () => {
    delete process.env.WX_BOT_TOKEN;
    expect(envWxTokens()).toEqual([]);
  });

  it('listWxTokens 汇总去重(同 token 仅一次)', () => {
    process.env.WX_BOT_TOKEN = 't1,t2,t1';
    const l = listWxTokens();
    expect(l.filter((x) => x === 't1')).toHaveLength(1);
    expect(l).toContain('t2');
  });
});
