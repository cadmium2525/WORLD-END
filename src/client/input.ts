// キーボード・タッチ（マルチタッチ）・ゲームパッドの入力をまとめて 3bit にする
import { IN_JUMP, IN_LEFT, IN_RIGHT } from '../shared/constants';

export class Input {
  private keys = new Set<string>();
  private touchDir = new Map<number, number>(); // pointerId → -1 / 1
  private jumpPointers = new Set<number>();
  onPause: (() => void) | null = null;
  onRetry: (() => void) | null = null;
  onAnyInput: (() => void) | null = null;

  constructor(dpad: HTMLElement, jump: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.onAnyInput?.();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause?.();
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyR' && !e.repeat) {
        this.onRetry?.();
        return;
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());

    const dpadSide = (e: PointerEvent) => {
      const r = dpad.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2 ? -1 : 1;
    };
    dpad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onAnyInput?.();
      dpad.setPointerCapture(e.pointerId);
      this.touchDir.set(e.pointerId, dpadSide(e));
      this.updateDpadVisual(dpad);
    });
    dpad.addEventListener('pointermove', (e) => {
      if (!this.touchDir.has(e.pointerId)) return;
      this.touchDir.set(e.pointerId, dpadSide(e));
      this.updateDpadVisual(dpad);
    });
    const dpadUp = (e: PointerEvent) => {
      this.touchDir.delete(e.pointerId);
      this.updateDpadVisual(dpad);
    };
    dpad.addEventListener('pointerup', dpadUp);
    dpad.addEventListener('pointercancel', dpadUp);
    dpad.addEventListener('lostpointercapture', dpadUp);

    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onAnyInput?.();
      jump.setPointerCapture(e.pointerId);
      this.jumpPointers.add(e.pointerId);
      jump.classList.add('on');
    });
    const jumpUp = (e: PointerEvent) => {
      this.jumpPointers.delete(e.pointerId);
      if (this.jumpPointers.size === 0) jump.classList.remove('on');
    };
    jump.addEventListener('pointerup', jumpUp);
    jump.addEventListener('pointercancel', jumpUp);
    jump.addEventListener('lostpointercapture', jumpUp);
    // iOS の長押しメニュー・ダブルタップズーム抑止
    for (const el of [dpad, jump]) {
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    }
  }

  private updateDpadVisual(dpad: HTMLElement) {
    let l = false;
    let r = false;
    for (const d of this.touchDir.values()) {
      if (d < 0) l = true;
      else r = true;
    }
    dpad.classList.toggle('l-on', l);
    dpad.classList.toggle('r-on', r);
  }

  clear() {
    this.keys.clear();
  }

  read(): number {
    const k = this.keys;
    let left = k.has('ArrowLeft') || k.has('KeyA');
    let right = k.has('ArrowRight') || k.has('KeyD');
    let jump = k.has('Space') || k.has('KeyZ') || k.has('ArrowUp') || k.has('KeyW') || k.has('KeyK') || k.has('KeyJ');
    for (const d of this.touchDir.values()) {
      if (d < 0) left = true;
      else right = true;
    }
    if (this.jumpPointers.size > 0) jump = true;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      if (ax < -0.4 || gp.buttons[14]?.pressed) left = true;
      if (ax > 0.4 || gp.buttons[15]?.pressed) right = true;
      if (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed) jump = true;
    }
    let v = 0;
    if (left && !right) v |= IN_LEFT;
    if (right && !left) v |= IN_RIGHT;
    if (jump) v |= IN_JUMP;
    return v;
  }
}
