/**
 * 比赛时间统一显示(全站唯一实现,以赛程页为准)。
 * 北京时间(Asia/Shanghai),格式:月/日 时:分(按 locale)。
 */
export function formatMatchTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return iso;
  }
}
