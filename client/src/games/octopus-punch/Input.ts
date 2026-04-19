export class Input {
  private keys = new Set<string>();
  private _justPressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', e => {
      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
  }

  held(code: string): boolean { return this.keys.has(code); }
  pressed(code: string): boolean { return this._justPressed.has(code); }

  flush(): void { this._justPressed.clear(); }

  get moveX(): number {
    return (this.held('ArrowRight') || this.held('KeyD') ? 1 : 0)
         - (this.held('ArrowLeft')  || this.held('KeyA') ? 1 : 0);
  }
  get moveY(): number {
    return (this.held('ArrowDown')  || this.held('KeyS') ? 1 : 0)
         - (this.held('ArrowUp')   || this.held('KeyW') ? 1 : 0);
  }
  get punch(): boolean {
    return this.pressed('Space') || this.pressed('KeyZ');
  }
}
