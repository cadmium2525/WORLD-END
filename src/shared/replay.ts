// 入力ログの圧縮（ランレングス）と、サーバー検証用の再生処理。
import { getStage } from './stages';
import { Sim } from './sim';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 1バイト = 下位3bit 入力値 + 上位5bit (連続フレーム数-1) を URL-safe base64 に */
export function encodeInputs(inputs: ArrayLike<number>): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < inputs.length) {
    const v = inputs[i] & 7;
    let n = 1;
    while (i + n < inputs.length && (inputs[i + n] & 7) === v && n < 32) n++;
    bytes.push(v | ((n - 1) << 3));
    i += n;
  }
  let out = '';
  for (let j = 0; j < bytes.length; j += 3) {
    const a = bytes[j];
    const b = j + 1 < bytes.length ? bytes[j + 1] : 0;
    const c = j + 2 < bytes.length ? bytes[j + 2] : 0;
    const t = (a << 16) | (b << 8) | c;
    out += B64[(t >> 18) & 63] + B64[(t >> 12) & 63];
    if (j + 1 < bytes.length) out += B64[(t >> 6) & 63];
    if (j + 2 < bytes.length) out += B64[t & 63];
  }
  return out;
}

export function decodeInputs(s: string, maxFrames = 60 * 60 * 10): number[] | null {
  const vals: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]);
    if (v < 0) return null;
    vals.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const n = Math.min(4, vals.length - i);
    if (n === 1) return null;
    const t = (vals[i] << 18) | (vals[i + 1] << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
    bytes.push((t >> 16) & 255);
    if (n >= 3) bytes.push((t >> 8) & 255);
    if (n >= 4) bytes.push(t & 255);
  }
  const out: number[] = [];
  for (const b of bytes) {
    const v = b & 7;
    const n = (b >> 3) + 1;
    for (let k = 0; k < n; k++) out.push(v);
    if (out.length > maxFrames) return null;
  }
  return out;
}

export interface VerifyResult {
  ok: boolean;
  frames: number;
  reason?: string;
}

/** 入力ログを再生し、最後のフレームでちょうどクリアしているかを確認する */
export function verifyStage(stage: number, inputs: number[]): VerifyResult {
  const sim = new Sim(getStage(stage));
  for (let i = 0; i < inputs.length; i++) {
    sim.step(inputs[i]);
    if (sim.dead) return { ok: false, frames: i + 1, reason: 'dead' };
    if (sim.cleared) {
      if (i !== inputs.length - 1) return { ok: false, frames: i + 1, reason: 'trailing' };
      return { ok: true, frames: inputs.length };
    }
  }
  return { ok: false, frames: inputs.length, reason: 'not_cleared' };
}
