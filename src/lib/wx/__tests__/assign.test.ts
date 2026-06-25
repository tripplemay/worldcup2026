import { resolveAssignChoice, assignPrompt } from '../assign';

const bettors = [
  { id: 'b1', name: '张三' },
  { id: 'b2', name: '李四' },
  { id: 'b3', name: 'Wang Wu' },
];

describe('resolveAssignChoice', () => {
  it('按序号选择', () => {
    expect(resolveAssignChoice('2', bettors)).toBe('b2');
    expect(resolveAssignChoice('1', bettors)).toBe('b1');
  });
  it('序号越界 → null', () => {
    expect(resolveAssignChoice('0', bettors)).toBeNull();
    expect(resolveAssignChoice('9', bettors)).toBeNull();
  });
  it('按姓名精确匹配', () => {
    expect(resolveAssignChoice('张三', bettors)).toBe('b1');
    expect(resolveAssignChoice(' 李四 ', bettors)).toBe('b2');
  });
  it('姓名大小写不敏感', () => {
    expect(resolveAssignChoice('wang wu', bettors)).toBe('b3');
  });
  it('无匹配 / 空 → null', () => {
    expect(resolveAssignChoice('赵六', bettors)).toBeNull();
    expect(resolveAssignChoice('', bettors)).toBeNull();
  });
});

describe('assignPrompt', () => {
  it('生成编号列表', () => {
    const p = assignPrompt(bettors);
    expect(p).toContain('1) 张三');
    expect(p).toContain('2) 李四');
    expect(p).toContain('3) Wang Wu');
  });
});
