// プレイヤー名の検証（クライアントとサーバーで共通）
export const NAME_MAX = 12;
export const DEFAULT_NAME = '名もなき挑戦者';

const BANNED = [
  'fuck', 'shit', 'nigg', 'cunt', 'bitch', 'porn', 'sex', 'rape', 'nazi', 'hitler',
  'ちんこ', 'ちんぽ', 'まんこ', 'セックス', 'レイプ', '死ね', 'しね', 'ころす', '殺す', 'ナチス',
  'admin', '運営', '公式',
];

export function normalizeName(raw: string): string {
  return raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').trim();
}

/** 問題なければ正規化済みの名前、だめなら null */
export function validateName(raw: string): string | null {
  const n = normalizeName(raw);
  if (n.length === 0) return DEFAULT_NAME;
  if ([...n].length > NAME_MAX) return null;
  if (/[<>&"'`\\]/.test(n)) return null;
  const low = n.toLowerCase().replace(/[\s._\-]/g, '');
  for (const w of BANNED) if (low.includes(w)) return null;
  return n;
}
