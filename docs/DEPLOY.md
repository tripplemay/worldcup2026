# 部署指南 — 2026.vpanel.cc

同机复用 `nextpanel` 生产 VPS,**严格隔离,不影响 nextpanel**。

## 架构
- CI(GitHub Actions)构建 standalone 产物 → SSH 传到 VPS `/opt/apps/worldcup`
- VPS **只跑不构建**:pm2 进程 `worldcup`,端口 **3100**
- Nginx 独立 server block(`2026.vpanel.cc → 127.0.0.1:3100`)+ certbot 证书
- 隔离对照见 `docs/PLAN.md`

## 一次性配置

### 1. GitHub 仓库 Secrets(Settings → Secrets and variables → Actions → Secrets)
| Secret | 值 |
|--------|-----|
| `SSH_HOST` | nextpanel 同一台 VPS 的 IP |
| `SSH_USER` | SSH 用户(如 root) |
| `SSH_PORT` | SSH 端口 |
| `SSH_PASSWORD` | SSH 密码 |
| `CERTBOT_EMAIL` | Let's Encrypt 邮箱 |
| `ODDS_API_KEY` | The Odds API key |

> 提示:前 4 项与 nextpanel 仓库里的同名 Secret 取值相同(同一台机)。

### 2. GitHub Variables(同页 → Variables)
| Variable | 值 |
|----------|-----|
| `DOMAIN` | `2026.vpanel.cc` |

### 3. Cloudflare DNS
- 加 A 记录:`2026` → VPS IP
- 代理状态:**DNS only(灰云)** ← 重要,让 `certbot --nginx` 的 HTTP-01 验证通过

## 部署
- push 到 `main` 自动触发;或 Actions 页手动 `workflow_dispatch`
- **首次部署**自动建 nginx server block + 签发证书(幂等,后续跳过)

## 回滚
- 重新 push 上一个可用 commit;或在 VPS 上 `pm2 restart worldcup`

## 隔离保证(绝不碰 nextpanel)
| 资源 | nextpanel | 世界杯 App |
|------|-----------|-----------|
| 端口 | 3000 / 3001 | **3100** |
| 目录 | /opt/apps/nextpanel | **/opt/apps/worldcup** |
| Nginx | sites/nextpanel | **sites/worldcup** |
| pm2 | nextpanel-server/web | **worldcup** |
| 证书 | vpanel.cc | **2026.vpanel.cc** |

## 运行时密钥
standalone `server.js` 只读 `process.env`(不读 `.env` 文件),密钥由部署脚本 `export` 后经 `pm2 --update-env` 注入,**不写入磁盘、不入库**。
