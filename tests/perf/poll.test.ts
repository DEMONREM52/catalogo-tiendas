import { test } from "node:test";
import assert from "node:assert/strict";
import { startPoll, type PollEnv } from "../../src/lib/net/poll";

/** Reloj y pestaña de mentiras: el tiempo solo avanza con advance(). */
function fakeEnv() {
  let t = 0;
  let visible = true;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; every: number | null }>();
  const returns = new Set<() => void>();
  const env: PollEnv = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn, every: null }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { timers.delete(id as number); },
    visible: () => visible,
    onReturn: (fn) => { returns.add(fn); return () => returns.delete(fn); },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, x] = due;
      t = x.at;
      if (x.every === null) timers.delete(id); else x.at += x.every;
      x.fn();
    }
    t = end;
  };
  return {
    env, advance,
    hide: () => { visible = false; },
    show: () => { visible = true; returns.forEach((f) => f()); },
    focus: () => returns.forEach((f) => f()),
    listeners: () => returns.size + timers.size,
  };
}

test("poll: revisa al empezar y con el reloj de respaldo", () => {
  const f = fakeEnv();
  let n = 0;
  const p = startPoll(() => { n++; }, { every: 10_000, firstDelay: 500, env: f.env });
  f.advance(499); assert.equal(n, 0);
  f.advance(1); assert.equal(n, 1);
  f.advance(10_000); assert.equal(n, 2);
  f.advance(20_000); assert.equal(n, 4);
  p.stop();
});

test("poll: el foco seguido no repite la consulta (minGap)", () => {
  const f = fakeEnv();
  let n = 0;
  const p = startPoll(() => { n++; }, { every: 60_000, minGap: 15_000, firstDelay: 0, env: f.env });
  f.advance(0); assert.equal(n, 1);
  // Cerrar la ventana de imprimir, volver de WhatsApp, etc.: varias veces en pocos segundos.
  f.advance(2000); f.focus(); f.advance(3000); f.focus(); f.advance(4000); f.focus();
  assert.equal(n, 1, "dentro de los 15 s no vuelve a consultar");
  f.advance(7000); f.focus();
  assert.equal(n, 2, "pasados 15 s sí revisa al volver");
  p.stop();
});

test("poll: con la pestaña oculta no consulta; al volver revisa una vez", () => {
  const f = fakeEnv();
  let n = 0;
  const p = startPoll(() => { n++; }, { every: 10_000, minGap: 5000, firstDelay: 0, env: f.env });
  f.advance(0); assert.equal(n, 1);
  f.hide();
  f.advance(120_000);
  assert.equal(n, 1, "oculta: el reloj no consulta");
  f.show();
  assert.equal(n, 2, "al volver a la pestaña revisa");
  p.stop();
});

test("poll: un evento en vivo (run) hace que el reloj se salte su turno", () => {
  const f = fakeEnv();
  let n = 0;
  const p = startPoll(() => { n++; }, { every: 20_000, firstDelay: null, env: f.env });
  f.advance(15_000); p.run(); assert.equal(n, 1);
  f.advance(5000); assert.equal(n, 1, "el tic de los 20 s se salta: hubo revisión hace 5 s");
  f.advance(20_000); assert.equal(n, 2, "el siguiente sí");
  p.stop();
});

test("poll: firstDelay null no consulta al empezar; poke respeta minGap", () => {
  const f = fakeEnv();
  let n = 0;
  const p = startPoll(() => { n++; }, { every: 60_000, minGap: 10_000, firstDelay: null, env: f.env });
  p.poke(); assert.equal(n, 0, "recién cargada la pantalla, poke no repite");
  f.advance(10_000); p.poke(); assert.equal(n, 1);
  p.stop();
});

test("poll: stop limpia el reloj y los eventos; un error no detiene las siguientes", async () => {
  const f = fakeEnv();
  let n = 0;
  const p = startPoll(async () => { n++; throw new Error("sin conexión"); }, { every: 10_000, firstDelay: 0, env: f.env });
  f.advance(0); f.advance(10_000);
  assert.equal(n, 2);
  await new Promise((r) => setTimeout(r, 0));
  p.stop();
  assert.equal(f.listeners(), 0);
  f.advance(60_000); f.focus(); p.run();
  assert.equal(n, 2, "después de stop no consulta");
});
