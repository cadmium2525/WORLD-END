// 決定論的な乱数（mulberry32）。ステージ生成に使う。整数演算のみ。
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** [0, n) の整数 */
  int(n: number): number {
    return this.next() % n;
  }
  /** [a, b] の整数 */
  range(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

export function hashSeed(n: number, salt = 0x9e3779b9): number {
  let h = (n ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
