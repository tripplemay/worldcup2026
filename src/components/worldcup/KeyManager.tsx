'use client';

import { useEffect, useState } from 'react';
import { MdVpnKey } from 'react-icons/md';
import Card from 'components/card';
import { useLocale } from 'lib/i18n/context';

interface KeyRow {
  masked: string;
  remaining: number | null;
  used: number | null;
}

const TOKEN_KEY = 'wc_admin_token';

/** API key 管理:输入管理口令后可查看(打码)+ 添加 key(后端自动校验有效性)。 */
export default function KeyManager() {
  const { t } = useLocale();
  const [token, setToken] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(tok: string) {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/worldcup/keys', {
        headers: { 'x-admin-token': tok },
      });
      if (res.status === 403) {
        setDisabled(true);
        return;
      }
      if (!res.ok) {
        setUnlocked(false);
        setMsg(t('settings.wrongToken'));
        return;
      }
      const json = await res.json();
      setKeys(json.data.keys ?? []);
      setUnlocked(true);
      localStorage.setItem(TOKEN_KEY, tok);
    } catch {
      setMsg(t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      load(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    const key = input.trim();
    if (!key || busy) return;
    setBusy(true);
    setMsg(`${t('settings.validating')}`);
    try {
      const res = await fetch('/api/worldcup/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ key }),
      });
      const json = await res.json();
      if (res.ok) {
        setKeys(json.data.keys ?? []);
        setInput('');
        setMsg(`${t('settings.keyAdded')} ${json.data.masked}`);
      } else if (res.status === 409) {
        setMsg(`${json.error}`);
      } else if (res.status === 400) {
        setMsg(`${t('settings.keyInvalid')}`);
      } else if (res.status === 401) {
        setUnlocked(false);
        setMsg(t('settings.wrongToken'));
      } else {
        setMsg(`${json.error ?? ''}`);
      }
    } catch {
      setMsg(t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-navy-700 outline-none focus:border-brand-500 dark:border-white/10 dark:bg-navy-900 dark:text-white';
  const btnCls =
    'rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white active:scale-95 disabled:opacity-50';

  return (
    <Card extra="p-4">
      <div className="mb-1 flex items-center gap-1 font-medium text-navy-700 dark:text-white">
        <MdVpnKey className="text-brand-500 dark:text-brand-400" />
        {t('settings.keyMgmt')}
      </div>
      <div className="mb-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {t('settings.keyMgmtDesc')}
      </div>

      {disabled ? (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-navy-900 dark:text-gray-400">
          {t('settings.keyDisabled')}
        </div>
      ) : !unlocked ? (
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(token)}
            placeholder={t('settings.adminToken')}
            className={inputCls}
          />
          <button
            onClick={() => load(token)}
            disabled={busy || !token}
            className={btnCls}
          >
            {t('settings.unlock')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            {keys.map((k, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-lightPrimary px-3 py-1.5 text-xs dark:bg-navy-700"
              >
                <span className="font-mono text-navy-700 dark:text-white">
                  {k.masked}
                </span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                  {k.remaining == null
                    ? '—'
                    : `${k.remaining} ${t('settings.remainingShort')}`}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder={t('settings.addKeyPlaceholder')}
              className={inputCls}
            />
            <button onClick={add} disabled={busy || !input} className={btnCls}>
              {t('settings.addBtn')}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          {msg}
        </div>
      )}
    </Card>
  );
}
