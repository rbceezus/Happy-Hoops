// Teclado e mouse -> InputFrame. W/S/A/D relativos à câmera (W = em direção à cesta).
import { InputFrame, InputEvent } from '../../shared/types';

export class Controls {
  private keys = new Set<string>();
  private ev: InputEvent[] = [];
  private contestMouse = false;
  private spaceDown: number | null = null;
  private onFlush: (() => void) | null = null;
  /** time com a posse? (define o que o clique direito faz) */
  hasPossession: () => boolean = () => false;
  onMute: (() => void) | null = null;
  enabled = true;
  /** quando o espaço é pressionado/solto — para o medidor de arremesso */
  onShoot: ((down: boolean, t0: number) => void) | null = null;
  private handlers: [string, EventListener][] = [];

  constructor(private target: HTMLElement) {
    const on = (type: string, fn: (e: never) => void, el: EventTarget = window) => {
      el.addEventListener(type, fn as EventListener);
      this.handlers.push([type, fn as EventListener]);
      if (el !== window) { /* alvo específico */ }
    };
    on('keydown', (e: KeyboardEvent) => this.keydown(e));
    on('keyup', (e: KeyboardEvent) => this.keyup(e));
    on('blur', () => this.reset());
    on('mousedown', (e: MouseEvent) => this.mousedown(e));
    on('mouseup', (e: MouseEvent) => { if (e.button === 2) this.contestMouse = false; });
    on('contextmenu', (e: MouseEvent) => { if (this.target.contains(e.target as Node)) e.preventDefault(); });
  }

  setFlush(fn: () => void) { this.onFlush = fn; }

  /** usado pelos cartões clicáveis do HUD */
  inject(e: InputEvent) { if (this.enabled) this.push(e); }

  private push(e: InputEvent) { this.ev.push(e); this.onFlush?.(); }

  reset() {
    if (this.spaceDown !== null) { this.onShoot?.(false, this.spaceDown); }
    this.keys.clear(); this.contestMouse = false; this.spaceDown = null;
  }

  private keydown(e: KeyboardEvent) {
    if (!this.enabled) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.code;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(k);
    switch (k) {
      case 'Space': {
        this.spaceDown = performance.now();
        this.onShoot?.(true, this.spaceDown);
        this.push({ k: 'shootDown' });
        break;
      }
      case 'KeyF': this.push({ k: 'pass', kind: 'chest' }); break;
      case 'KeyG': this.push({ k: 'pass', kind: 'bounce' }); break;
      case 'KeyQ': this.push({ k: 'cross', dir: -1 }); break;
      case 'KeyE': this.push({ k: 'cross', dir: 1 }); break;
      case 'KeyR': this.push({ k: 'spin' }); break;
      case 'KeyX': this.push({ k: 'dunk' }); break;
      case 'Tab': this.push({ k: 'switch' }); break;
      case 'Digit1': this.push({ k: 'select', slot: 0 }); break;
      case 'Digit2': this.push({ k: 'select', slot: 1 }); break;
      case 'Enter': this.push({ k: 'check' }); break;
      case 'KeyM': this.onMute?.(); break;
    }
  }

  private keyup(e: KeyboardEvent) {
    this.keys.delete(e.code);
    if (e.code === 'Space' && this.spaceDown !== null) {
      const hold = performance.now() - this.spaceDown;
      this.onShoot?.(false, this.spaceDown);
      this.spaceDown = null;
      this.push({ k: 'shootUp', hold });
    }
  }

  private mousedown(e: MouseEvent) {
    if (!this.enabled || !this.target.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest?.('.pc, button')) return;
    if (e.button === 0) this.push({ k: 'pass', kind: 'chest' });
    else if (e.button === 2) {
      if (this.hasPossession()) this.push({ k: 'pass', kind: 'bounce' });
      else this.contestMouse = true;
    }
  }

  frame(): InputFrame {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    const f: InputFrame = {
      mx, mz, run: k.has('ShiftLeft') || k.has('ShiftRight'),
      contest: this.contestMouse || k.has('KeyC'), ev: this.ev,
    };
    this.ev = [];
    return f;
  }

  dispose() {
    for (const [t, fn] of this.handlers) window.removeEventListener(t, fn);
    this.handlers = [];
  }
}
