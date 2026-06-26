import { runRefreshersWhenVisible } from 'lib/hooks/useRefreshOnVisible';

describe('runRefreshersWhenVisible', () => {
  it('不可见时一个都不调用', () => {
    const a = jest.fn();
    const b = jest.fn();
    expect(runRefreshersWhenVisible([a, b], false)).toBe(0);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('可见时按序调用全部刷新器', () => {
    const a = jest.fn();
    const b = jest.fn();
    expect(runRefreshersWhenVisible([a, b], true)).toBe(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('单个刷新抛错不影响其余,且不计入成功数', () => {
    const a = jest.fn(() => {
      throw new Error('boom');
    });
    const b = jest.fn();
    expect(runRefreshersWhenVisible([a, b], true)).toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('空数组安全返回 0', () => {
    expect(runRefreshersWhenVisible([], true)).toBe(0);
  });
});
