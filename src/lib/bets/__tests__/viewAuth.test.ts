/**
 * 盈亏页看/改分权鉴权。viewAuth 仅读 req.headers.get('cookie') 与 env,用最小 mock。
 */
import {
  isViewAuthed,
  isAdminAuthed,
  PNL_COOKIE,
  PNL_ADMIN_COOKIE,
} from '../viewAuth';

const mkReq = (cookie: string): Request =>
  ({
    headers: { get: (k: string) => (k === 'cookie' ? cookie : null) },
  } as unknown as Request);

const VIEW = 'view-pw';
const ADMIN = 'admin-pw';

describe('viewAuth 看/改分权', () => {
  afterEach(() => {
    delete process.env.PNL_VIEW_PASSWORD;
    delete process.env.PNL_ADMIN_PASSWORD;
  });

  it('fail-closed:都没配 → 一律拒绝', () => {
    const req = mkReq(`${PNL_COOKIE}=anything`);
    expect(isViewAuthed(req)).toBe(false);
    expect(isAdminAuthed(req)).toBe(false);
  });

  it('未配管理密码(兼容旧行为):浏览密码 cookie 即可看也可改', () => {
    process.env.PNL_VIEW_PASSWORD = VIEW;
    const req = mkReq(`${PNL_COOKIE}=${VIEW}`);
    expect(isViewAuthed(req)).toBe(true);
    expect(isAdminAuthed(req)).toBe(true); // 退回旧行为:view 即 admin
  });

  it('配了管理密码:浏览 cookie 只能看,不能改', () => {
    process.env.PNL_VIEW_PASSWORD = VIEW;
    process.env.PNL_ADMIN_PASSWORD = ADMIN;
    const req = mkReq(`${PNL_COOKIE}=${VIEW}`);
    expect(isViewAuthed(req)).toBe(true);
    expect(isAdminAuthed(req)).toBe(false); // 看/改已分权
  });

  it('配了管理密码:管理 cookie 既能看也能改', () => {
    process.env.PNL_VIEW_PASSWORD = VIEW;
    process.env.PNL_ADMIN_PASSWORD = ADMIN;
    const req = mkReq(`${PNL_ADMIN_COOKIE}=${ADMIN}`);
    expect(isViewAuthed(req)).toBe(true);
    expect(isAdminAuthed(req)).toBe(true);
  });

  it('错误 cookie → 都拒绝', () => {
    process.env.PNL_VIEW_PASSWORD = VIEW;
    process.env.PNL_ADMIN_PASSWORD = ADMIN;
    expect(isAdminAuthed(mkReq(`${PNL_ADMIN_COOKIE}=wrong`))).toBe(false);
    expect(isViewAuthed(mkReq(`${PNL_COOKIE}=wrong`))).toBe(false);
  });

  it('容忍 Next 传输 URL 编码的 cookie 值(含特殊字符如 #)', () => {
    process.env.PNL_ADMIN_PASSWORD = 'adm#in';
    const encoded = encodeURIComponent('adm#in'); // 'adm%23in'
    expect(isAdminAuthed(mkReq(`${PNL_ADMIN_COOKIE}=${encoded}`))).toBe(true);
  });
});
