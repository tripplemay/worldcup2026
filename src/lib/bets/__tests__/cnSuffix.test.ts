/**
 * 中文队名后缀折叠:识别常带「共和国/国家队/队」等冗余后缀(如 佛得角共和国),
 * 精确匹配失败时剥后缀重查映射;未命中仍原样透传(不吐剥了一半的名字)。
 */
import { toCanonicalName } from 'lib/bets/cnTeams';

describe('toCanonicalName 后缀折叠', () => {
  it('佛得角共和国 → Cape Verde(生产真实案例)', () => {
    expect(toCanonicalName('佛得角共和国')).toBe('Cape Verde');
  });
  it('XX队 / XX国家队 → 剥后缀命中', () => {
    expect(toCanonicalName('巴西队')).toBe('Brazil');
    expect(toCanonicalName('韩国国家队')).toBe(toCanonicalName('韩国'));
  });
  it('双层后缀(共和国+队)也能折', () => {
    expect(toCanonicalName('佛得角共和国队')).toBe('Cape Verde');
  });
  it('剥后仍未命中 → 原样透传(不吐半剥名)', () => {
    expect(toCanonicalName('多米尼加共和国')).toBe('多米尼加共和国');
  });
  it('精确命中优先,行为不变', () => {
    expect(toCanonicalName('阿根廷')).toBe('Argentina');
    expect(toCanonicalName('  巴西 ')).toBe('Brazil');
  });
});
