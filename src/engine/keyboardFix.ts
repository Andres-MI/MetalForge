/**
 * Fix for Phaser 3.90 keyboard events being delivered several times.
 *
 * Root cause (not our handlers): `KeyboardManager` pushes every DOM key event onto `queue` and then immediately
 * emits MANAGER_PROCESS; each `KeyboardPlugin.update` walks the WHOLE queue from index 0, and the queue is only
 * emptied at POST_STEP (once per frame). So with k key events inside one frame, the first one is dispatched k
 * times, the second k-1 times, and so on (only an event identical to the one just before it is skipped).
 * Two quick key presses (4 DOM events) gave 3 to 5 moves in a selector, in every scene that listens to
 * `keydown-*`.
 *
 * Fix: each plugin remembers how much of the queue it has already dispatched and only processes the new tail.
 * A plugin that starts mid-frame (a scene change caused by a key) skips what is already queued, so the key
 * that changed the scene cannot fire again in the next scene.
 */
import Phaser from 'phaser';

interface Patched {
  manager: { queue: unknown[] };
  _kbQueue?: unknown[];
  _kbDone?: number;
}

let installed = false;

export function installKeyboardFix(): void {
  if (installed) return;
  installed = true;
  const proto = Phaser.Input.Keyboard.KeyboardPlugin.prototype as unknown as {
    update: (this: Patched) => void;
    start: (this: Patched) => void;
  };
  const update = proto.update;
  const start = proto.start;
  proto.start = function (this: Patched) {
    start.call(this);
    this._kbQueue = this.manager.queue;
    this._kbDone = this.manager.queue.length;
  };
  proto.update = function (this: Patched) {
    const m = this.manager;
    if (this._kbQueue !== m.queue) {
      // A new frame (the manager replaced its queue): everything in it is new.
      this._kbQueue = m.queue;
      this._kbDone = 0;
    }
    const done = this._kbDone ?? 0;
    const full = m.queue;
    if (done >= full.length) return;
    this._kbDone = full.length;
    // Let the stock update see only the events not yet dispatched by this plugin.
    m.queue = full.slice(done);
    try {
      update.call(this);
    } finally {
      m.queue = full;
    }
  };
}
