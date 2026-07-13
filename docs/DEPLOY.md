# 部署指南 — 2026.vpanel.cc

生产宿主:**`dmitsvr`(DMIT LAX,`179.255.116.33`,Ubuntu 26.04,nginx 1.28)**,一台 nginx 边缘机,同时反代 `design.vpanel.cc / invoce.vpanel.cc / sync.imava.net`。**严格隔离,绝不影响这些既有域名。**

> 历史:2026-07 之前生产在 `nextpanel` 共享 VPS(`38.175.193.100`);该机退役,已整体迁至 dmitsvr(数据 `/opt/apps/worldcup-data` server→server rsync 搬迁,域名不变)。

## 架构
- CI(GitHub Actions)构建 standalone 产物 → SSH(**密钥认证**)传到 dmitsvr `/opt/apps/worldcup`
- dmitsvr **只跑不构建**:pm2 进程 `worldcup`,端口 **3100**(`127.0.0.1` 绑定)
- Nginx 独立 server block(`2026.vpanel.cc → 127.0.0.1:3100`)+ Let's Encrypt 证书
- 隔离对照见下表 / `docs/PLAN.md`

## 一次性配置(dmitsvr 已完成,供重建参考)

### 1. GitHub 仓库 Secrets(Settings → Secrets and variables → Actions → Secrets)
| Secret | 值 |
|--------|-----|
| `SSH_HOST` | `179.255.116.33`(dmitsvr) |
| `SSH_USER` | `root` |
| `SSH_PORT` | `22` |
| `SSH_KEY` | **专用部署私钥**(ed25519;公钥加到 dmitsvr `~/.ssh/authorized_keys`)。dmitsvr 仅密钥登录,故 workflow 用 `key:` 而非 `password:` |
| `CERTBOT_EMAIL` | Let's Encrypt 邮箱 |
| `ODDS_API_KEY` | The Odds API key |

> 其余 App 密钥(`ODDS_API_IO_KEY`/`ADMIN_TOKEN`/`AIGC_API_KEY`/`API_FOOTBALL_KEY`/`TG_*`/`PNL_*`/`WX_*` 等)与服务器无关,迁移时原样沿用。

### 2. GitHub Variables(同页 → Variables)
| Variable | 值 |
|----------|-----|
| `DOMAIN` | `2026.vpanel.cc` |

### 3. Cloudflare DNS
- A 记录:`2026` → `179.255.116.33`
- 代理状态:**DNS only(灰云)** ← 重要,让 certbot HTTP-01/webroot 验证通过

### 4. dmitsvr 手工前置(CI 首跑前一次性)
dmitsvr 是边缘机、有自己的 nginx/证书约定(`sites-available/<域名>.conf`、`listen <IP>:port`、**certbot webroot** `-w /var/www/certbot` + deploy-hook 续期),**不走 CI 脚本里的 `certbot --nginx` 自动段**,以免扰乱其它域名的续期。所以:
- 装 **Node 22 + pm2**(边缘机默认无 Node)、装 **`cron`**(默认无 `crontab`,否则定时任务静默不注册)
- 按上述约定手工建 `2026.vpanel.cc.conf` + 签发证书
- **预置哨兵 `/opt/.worldcup_setup_done`** → CI 部署脚本据此跳过其自带的 nginx/证书首配段
- 数据目录 `/opt/apps/worldcup-data`(部署目录之外,`rm -rf APP_DIR` 不丢)

## 部署
- push 到 `main` 自动触发(`**.md` / `docs/**` 改动不触发);或 Actions 页手动 `workflow_dispatch`
- 哨兵已置 → 每次部署只做:解包 → 原子切换 → pm2 重启 → 注册 cron → 播种 engine/intel/scenarios/research → 注册 TG webhook

## 回滚
- 重新 push 上一个可用 commit;或在 dmitsvr 上 `pm2 restart worldcup`

## 隔离保证(绝不碰 dmitsvr 上其它域名)
| 资源 | dmitsvr 其它域名 | 世界杯 App |
|------|-----------|-----------|
| 端口 | 各远端上游 | **本地 127.0.0.1:3100** |
| 目录 | — | **/opt/apps/worldcup(+ worldcup-data)** |
| Nginx | `design/invoce/sync.*.conf` | **`2026.vpanel.cc.conf`(`listen 179.255.116.33:80/443`)** |
| pm2 | 无(纯反代) | **worldcup** |
| 证书 | 各自 live/ | **2026.vpanel.cc** |

## 运行时密钥
standalone `server.js` 只读 `process.env`(不读 `.env` 文件),密钥由部署脚本 `export` 后经 `pm2 --update-env` 注入,**不写入磁盘、不入库**。
