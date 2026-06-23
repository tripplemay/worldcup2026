/**
 * GET /api/worldcup/bet-image?file=<betId>.jpg — 取注单原图(复核用)。
 * 与盈亏页同级公开(个人小范围应用);文件名做路径穿越防护。
 */
import { readBetImage } from 'lib/bets/images';
import { isViewAuthed } from 'lib/bets/viewAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isViewAuthed(req)) return new Response('unauthorized', { status: 401 });
  const file = new URL(req.url).searchParams.get('file') ?? '';
  const buf = readBetImage(file);
  if (!buf) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=3600',
    },
  });
}
