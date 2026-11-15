/** Tuner screen: the first thing a player needs and the simplest end-to-end test of the input chain. */
import { startInput, type InputHandle } from '../audio/input';
import { INSTRUMENTS, centsOff, freqToMidi, noteName, type InstrumentId } from '../model/instrument';
import { STRING_COLORS } from './palette';

export function mountTuner(root: HTMLElement): void {
  root.innerHTML = `
    <section class="tuner">
      <h1>ABISAL</h1>
      <div class="row" id="instruments"></div>
      <div class="strings" id="strings"></div>
      <div class="note" id="note" data-testid="note">—</div>
      <div class="meter"><div class="needle" id="needle"></div><div class="centre"></div></div>
      <div class="cents" id="cents" data-testid="cents">Pulsa «Escuchar» y toca una cuerda</div>
      <button id="listen" data-testid="listen">Escuchar</button>
      <p class="error" id="error" role="alert"></p>
    </section>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  let instrument: InstrumentId = 'guitar';
  let handle: InputHandle | null = null;
  const heard: number[] = [];
  (window as unknown as { __abisal: unknown }).__abisal = { heard };

  const drawStrings = (active: number | null) => {
    const inst = INSTRUMENTS[instrument];
    $('strings').innerHTML = inst.openStrings
      .map((m, i) => {
        const on = active === m ? ' on' : '';
        return `<span class="string${on}" style="--c:${STRING_COLORS[i % STRING_COLORS.length]}">${noteName(m)}</span>`;
      })
      .join('');
  };

  $('instruments').innerHTML = Object.values(INSTRUMENTS)
    .map((i) => `<button class="pick" data-id="${i.id}" aria-pressed="${i.id === instrument}">${i.label}</button>`)
    .join('');
  root.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) =>
    b.addEventListener('click', () => {
      instrument = b.dataset.id as InstrumentId;
      root.querySelectorAll('.pick').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawStrings(null);
      if (handle) {
        handle.stop();
        handle = null;
        void listen();
      }
    }),
  );
  drawStrings(null);

  const show = (freq: number) => {
    const midi = Math.round(freqToMidi(freq));
    const cents = centsOff(freq);
    $('note').textContent = noteName(midi);
    $('needle').style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    const ok = Math.abs(cents) < 5;
    $('needle').classList.toggle('ok', ok);
    $('cents').textContent = ok ? 'Afinada' : cents < 0 ? `${cents.toFixed(0)} cents · sube` : `+${cents.toFixed(0)} cents · baja`;
    drawStrings(midi);
  };

  async function listen(): Promise<void> {
    $('error').textContent = '';
    try {
      handle = await startInput(INSTRUMENTS[instrument], (e) => {
        if (e.type === 'note') heard.push(e.midi);
        if (e.type === 'note' || e.type === 'pitch') show(e.freq);
      });
      $('listen').textContent = 'Escuchando…';
      $('cents').textContent = 'Toca una cuerda';
    } catch (err) {
      $('error').textContent = `No se pudo abrir la entrada de audio: ${(err as Error).message}`;
    }
  }
  $('listen').addEventListener('click', () => {
    if (!handle) void listen();
  });
}
