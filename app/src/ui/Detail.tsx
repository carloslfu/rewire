// The detail panel (section 5.2): always what the tapped part is, its real numbers, and its control.
import { useEffect, useMemo, useState } from "react";
import type { FloorDetail } from "../model/types.ts";
import { chipsWith, floorDetail, liveEngine, pathData, pick, piece, setFocus, stepAction } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { fmt, pct, signed } from "./color.ts";
import { multOf, withMult } from "./describe.ts";
import { Knob } from "./Knob.tsx";
import { Strip } from "./Strip.tsx";
import { type Chosen, chosen, HEADS, headIndex, memIndex } from "./word.ts";

export function Detail() {
  const focus = useStore((s) => s.focus);
  const turns = useStore((s) => s.turns);
  const word = useStore((s) => s.word);
  const fork = useStore((s) => s.fork);
  const c = useMemo(() => chosen({ turns, word, fork }), [turns, word, fork]);
  switch (focus.kind) {
    case "head": return <HeadPanel c={c} floor={focus.floor} head={focus.head} />;
    case "memory": return <MemoryPanel c={c} floor={focus.floor} />;
    case "floor": return <FloorPanel c={c} floor={focus.floor} />;
    case "dictionary": return <WordsInPanel c={c} />;
    case "words-in": return <WordsInPanel c={c} position={focus.position} />;
    case "words-out": return <WordsOutPanel c={c} />;
    case "bits": return <BitsPanel />;
    default: return <WordPanel c={c} />;
  }
}

function Head({ kicker, title, def, std, code }: { kicker: string; title: string; def: string; std?: string; code?: string }) {
  return (
    <section>
      <div className="kicker">{S.what}</div>
      <div className="title">{title}</div>
      <p className="std">{kicker}{std ? ` · ${std}` : ""}{code ? ` · ${code}` : ""}</p>
      <p className="def">{def}</p>
    </section>
  );
}

function useDetail(c: Chosen | null): { detail: FloorDetail | null; loading: boolean } {
  const [st, setSt] = useState<{ detail: FloorDetail | null; loading: boolean }>({ detail: null, loading: false });
  const key = c ? `${c.ref.turn}.${c.ref.side}.${c.ref.index}.${c.tok.id}.${c.reply.done}` : "";
  useEffect(() => {
    if (!c || !c.reply.done) { setSt({ detail: null, loading: false }); return; }
    let live = true;
    setSt({ detail: null, loading: true });
    floorDetail(c.ref).then((d) => live && setSt({ detail: d, loading: false }), () => live && setSt({ detail: null, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return st;
}

function NoWord() {
  return <p className="note">{S.towerNone}</p>;
}

const wordText = (id: number) => {
  const t = piece(id);
  return t.trim() ? t.trim() : JSON.stringify(t);
};

// ------------------------------------------------------------------ word

function WordPanel({ c }: { c: Chosen | null }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const temperature = useStore((s) => s.temperature);
  if (!c) return (
    <>
      <Head kicker={S.terms.token[0]} title={S.terms.token[0]} std={S.terms.token[1]} def={D.token} />
      <NoWord />
    </>
  );
  const t = c.tok;
  const chosenP = t.cands.find((x) => x.id === t.id)?.p ?? 0;
  const canPick = c.reply.done && !c.reply.stale;
  return (
    <>
      <Head kicker={model.id === "tiny" ? "Letter" : `${S.terms.token[0]} · ${S.terms.token[1]}`} title={`"${wordText(t.id)}"`} def={D.word} code={`id ${t.id}`} />
      <section>
        <div className="kicker">{S.numbers}</div>
        <dl className="kv">
          <dt>Probability when drawn</dt><dd className="num">{pct(chosenP)} at temperature {temperature}</dd>
          <dt>At temperature 1</dt><dd className="num">{pct(Math.exp(t.lp1))}</dd>
          {c.forced && <><dt>Changed model</dt><dd className="num changed-text">{pct(Math.exp(c.forced.lp1))}</dd></>}
          {t.picked && <><dt>Picked by</dt><dd>you</dd></>}
        </dl>
        <h3 style={{ marginTop: 12 }}>{S.candidates}</h3>
        <p className="note">{S.candidatesNote(t.cut)}</p>
        <table className="cands">
          <tbody>
            {t.cands.map((x, i) => (
              <tr key={x.id} className={`${x.id === t.id ? "chosen" : ""}${i >= t.cut ? " dropped" : ""}${i === t.cut ? " cutline" : ""}`}>
                <td><span className="num faint">{i + 1}.</span> {wordText(x.id)}</td>
                <td className="p num">{pct(x.p)}</td>
                <td className="barc"><div className="bar" style={{ width: `${Math.max(1, x.p * 100)}%` }} /></td>
                <td>
                  {canPick && x.id !== t.id && (
                    <button type="button" className="btn quiet small" onClick={() => void pick(c.ref, x.id)}
                      aria-label={`${S.forcePick}: ${wordText(x.id)}`}>{S.forcePick}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {t.guesses && <Guesses c={c} />}
      </section>
      <section>
        <div className="kicker">{S.control}</div>
        <SwapControl id={t.id} />
      </section>
    </>
  );
}

function Guesses({ c }: { c: Chosen }) {
  const g = c.tok.guesses!;
  return (
    <div style={{ marginTop: 12 }}>
      <h3>{S.floorGuesses} <span className="std">({S.terms.lens[1]})</span></h3>
      <p className="note">{S.guessesNote}</p>
      <table className="cands">
        <tbody>
          {g.map((row, L) => ({ row, L })).reverse().map(({ row, L }) => (
            <tr key={L}>
              <td className="num faint" style={{ width: 28 }}>{L + 1}</td>
              <td>
                <span style={{ fontWeight: row[0].id === c.tok.id ? 700 : 400 }}>{wordText(row[0].id)}</span>
                <span className="faint small"> {row.slice(1).map((x) => wordText(x.id)).join(", ")}</span>
              </td>
              <td className="p num">{pct(row[0].p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SwapControl({ id }: { id: number }) {
  const chips = useStore((s) => s.chips);
  const mode = useStore((s) => s.mode);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const pairs = pathData()?.swap_pairs ?? [];
  const current = (chips.swaps ?? []).find(([a, b]) => a === id || b === id);
  const suggestions = pairs.filter((p) => p.ids.includes(id));
  const doSwap = (a: number, b: number) => chipsWith((s) => ({ ...s, swaps: [...(s.swaps ?? []).filter(([x, y]) => x !== a && y !== a && x !== b && y !== b), [a, b]] }));
  const typed = async () => {
    const eng = liveEngine();
    if (!eng || !text.trim()) return;
    const w = text.trim();
    const ids = await eng.plain(` ${w}`);
    if (ids.length !== 1) { setMsg(S.swapNotSingle); return; }
    setMsg("");
    await doSwap(id, ids[0]);
  };
  return (
    <div>
      <h3>{S.swapWith}</h3>
      {current ? (
        <p className="note">Swapped with "{wordText(current[0] === id ? current[1] : current[0])}".{" "}
          <button type="button" className="linkish" onClick={() => void chipsWith((s) => ({ ...s, swaps: (s.swaps ?? []).filter((p) => p !== current && !(p[0] === current[0] && p[1] === current[1])) }))}>{S.undo}</button>
        </p>
      ) : (
        <>
          {suggestions.length > 0 && (
            <div className="suggest">
              {suggestions.map((p) => {
                const other = p.ids[0] === id ? p.ids[1] : p.ids[0];
                return <button key={other} type="button" className="btn change" onClick={() => void doSwap(id, other)}>Swap with "{wordText(other)}"</button>;
              })}
            </div>
          )}
          {mode === "live" && (
            <div className="composer">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Another word" aria-label="Word to swap with" />
              <button type="button" className="btn" onClick={() => void typed()}>Swap</button>
            </div>
          )}
          {msg && <p className="note">{msg}</p>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ head

function HeadPanel({ c, floor, head }: { c: Chosen | null; floor: number; head: number }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const chips = useStore((s) => s.chips);
  const view = useStore((s) => s.view);
  const { detail, loading } = useDetail(c);
  const at = useMemo(() => {
    const a = pathData()?.atlas;
    const has = (l?: [number, number][]) => l?.some(([f, h]) => f === floor && h === head);
    return has(a?.copying) ? "a copying head (induction head)" : has(a?.start_marker) ? "a head that rests on the start marker" : has(a?.answer_heads) ? "one of the heads pushing hardest toward answers" : null;
  }, [floor, head]);
  const push = c?.tok.pushes[headIndex(floor, head)];
  const diff = c?.forced ? c.forced.pushes[headIndex(floor, head)] - (push ?? 0) : undefined;
  const mult = multOf(chips, "head", floor, head);
  const probs = detail?.get(`f${floor}.probs`);
  const n = probs ? probs.length / HEADS : 0;
  const row = probs ? probs.subarray(head * n, head * n + n) : null;
  const top = row ? [...row].map((p, j) => ({ p, j })).sort((a, b) => b.p - a.p).slice(0, 8) : [];
  const ctx = c ? contextTokens(c) : [];
  return (
    <>
      <Head kicker={`${S.terms.head[0]} · ${S.terms.head[1]}`} title={`${S.headN(head + 1)} on ${S.floorN(floor + 1).toLowerCase()}`}
        def={D.head} code={S.zeroBased(floor) + `, head ${head}`} />
      {at && <p className="note" style={{ marginTop: -10, marginBottom: 14 }}>This is {at}, {S.foundByTesting}.</p>}
      <section>
        <div className="kicker">{S.numbers}</div>
        {!c ? <NoWord /> : (
          <>
            <dl className="kv">
              <dt>Push</dt><dd className="num">{signed(push!)} toward "{wordText(c.tok.id)}"</dd>
              {diff !== undefined && <><dt>{view === "difference" ? "Difference" : "Changed minus normal"}</dt><dd className="num changed-text">{signed(diff)}</dd></>}
            </dl>
            <p className="note" style={{ marginTop: 6 }}>{D.push}</p>
            <h3 style={{ marginTop: 12 }}>{S.attentionLines}</h3>
            {loading && <p className="note">{S.inspecting}</p>}
            {!loading && !row && <p className="note">{S.noDetail}</p>}
            {row && (
              <div className="attn">
                {top.map(({ p, j }) => (
                  <div className="attn-row" key={j}>
                    <span className="w" title={`position ${j}`}>{j === 0 ? "start marker" : JSON.stringify(piece(ctx[j] ?? 0)).slice(1, -1)}</span>
                    <span className="b" style={{ width: `${Math.max(1, p * 100)}%` }} />
                    <span className="num">{pct(p)}</span>
                  </div>
                ))}
                <p className="note">Where head {head + 1} looks from this word, out of {n} earlier positions.</p>
              </div>
            )}
          </>
        )}
      </section>
      <section>
        <div className="kicker">{S.control}</div>
        <Knob label={`Head ${head + 1} on floor ${floor + 1}`} value={mult}
          onChange={(v) => void chipsWith((s) => withMult(s, "head", floor, head, v))} />
        <p className="note" style={{ marginTop: 6 }}>Off sets its output to zero. Studies often substitute its average output instead, so effects here can be larger than published ones.</p>
      </section>
    </>
  );
}

function contextTokens(c: Chosen): number[] {
  const s = store.get();
  const out: number[] = [];
  for (let i = 0; i <= c.ref.turn; i++) {
    const t = s.turns[i];
    const r = c.ref.side === "changed" && s.fork >= 0 && i >= s.fork && t.changed ? t.changed : t.normal;
    out.push(...r.read);
    if (i < c.ref.turn) out.push(...r.toks.map((x) => x.id));
  }
  out.push(...c.reply.toks.slice(0, c.ref.index).map((x) => x.id));
  return out;
}

// ------------------------------------------------------------------ memory block

function MemoryPanel({ c, floor }: { c: Chosen | null; floor: number }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const chips = useStore((s) => s.chips);
  const { detail, loading } = useDetail(c);
  const push = c?.tok.pushes[memIndex(floor)];
  const mult = multOf(chips, "memory", floor);
  const act = detail?.get(`f${floor}.act`);
  const unitPush = detail?.get(`f${floor}.unit_push`);
  const topAct = act ? [...act].map((v, j) => ({ v, j })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 8) : [];
  const topPush = unitPush ? [...unitPush].map((v, j) => ({ v, j })).sort((a, b) => b.v - a.v).slice(0, 8) : [];
  return (
    <>
      <Head kicker={`${S.terms.mlp[0]} · ${S.terms.mlp[1]}`} title={`${S.memoryBlock} on ${S.floorN(floor + 1).toLowerCase()}`}
        def={D.memory} code={S.zeroBased(floor)} />
      <section>
        <div className="kicker">{S.numbers}</div>
        {!c ? <NoWord /> : (
          <>
            <dl className="kv">
              <dt>Push</dt><dd className="num">{signed(push!)} toward "{wordText(c.tok.id)}"</dd>
              {c.forced && <><dt>Changed minus normal</dt><dd className="num changed-text">{signed(c.forced.pushes[memIndex(floor)] - push!)}</dd></>}
            </dl>
            {loading && <p className="note">{S.inspecting}</p>}
            {!loading && !act && <p className="note">{S.noDetail}</p>}
            {topPush.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>{S.topUnitsPush}</h3>
                <div className="units">
                  {topPush.map(({ v, j }) => <Unit key={j} j={j} v={v} a={act?.[j]} />)}
                </div>
              </>
            )}
            {topAct.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>{S.topUnitsActive}</h3>
                <div className="units">
                  {topAct.map(({ v, j }) => <Unit key={j} j={j} a={v} />)}
                </div>
              </>
            )}
            {act && <div style={{ marginTop: 10 }}><Strip values={act} label={`All ${act.length.toLocaleString("en-US")} units`} /></div>}
          </>
        )}
      </section>
      <section>
        <div className="kicker">{S.control}</div>
        <Knob label={`Memory block on floor ${floor + 1}`} value={mult} onChange={(v) => void chipsWith((s) => withMult(s, "memory", floor, 0, v))} />
      </section>
    </>
  );
}

function Unit({ j, v, a }: { j: number; v?: number; a?: number }) {
  return (
    <>
      <span className="num">unit {j + 1}</span>
      <span className="num muted">{a !== undefined ? `activity ${fmt(a)}` : ""}</span>
      <span className="num">{v !== undefined ? `${signed(v)} push` : ""}</span>
    </>
  );
}

// ------------------------------------------------------------------ floor

function FloorPanel({ c, floor }: { c: Chosen | null; floor: number }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const chips = useStore((s) => s.chips);
  const { detail, loading } = useDetail(c);
  const mult = multOf(chips, "floor", floor);
  const g = (k: string) => detail?.get(`f${floor}.${k}`);
  const n = g("probs") ? g("probs")!.length / HEADS : 0;
  const steps: { t: string; f: string; k: string; rows?: number; names?: (r: number, c: number) => string }[] = [
    { t: "The stream entering the floor", f: "x", k: "x" },
    { t: "Normalize the stream", f: "h = x / rms(x) · w_in", k: "h" },
    { t: `Make queries (${HEADS} heads)`, f: "q = W_q h", k: "q_raw", rows: HEADS, names: (r, i) => `head ${r + 1}, ${i + 1}` },
    { t: `Make keys and values (${HEADS / 2} shared)`, f: "k = W_k h, v = W_v h", k: "k_raw", rows: HEADS / 2, names: (r, i) => `key ${r + 1}, ${i + 1}` },
    { t: "Normalize each head's queries and keys", f: "q ← q / rms(q) · w_q", k: "q_n", rows: HEADS, names: (r, i) => `head ${r + 1}, ${i + 1}` },
    { t: "Rotate them by position", f: "q ← q·cos θp + rot(q)·sin θp", k: "q", rows: HEADS, names: (r, i) => `head ${r + 1}, ${i + 1}` },
    { t: "Score each earlier word, divided by √128", f: "s_j = q · k_j / √128", k: "scores", rows: HEADS, names: (r, i) => `head ${r + 1}, position ${i}` },
    { t: "Turn the scores into attention", f: "a_j = softmax(s)_j", k: "probs", rows: HEADS, names: (r, i) => `head ${r + 1}, position ${i}` },
    { t: "Mix the values", f: "o_h = Σ a_j v_j", k: "att", rows: HEADS, names: (r, i) => `head ${r + 1}, ${i + 1}` },
    { t: "Combine the heads (output projection)", f: "o = W_o [o_1 … o_16]", k: "o" },
    { t: "Add the result to the stream", f: "middle = x + o", k: "mid" },
    { t: "Memory block: normalize", f: "h₂ = middle / rms(middle) · w_post", k: "h2" },
    { t: `Project up to the gate (${model.units.toLocaleString("en-US")})`, f: "g = W_gate h₂", k: "gate" },
    { t: `Project up again (${model.units.toLocaleString("en-US")})`, f: "u = W_up h₂", k: "up" },
    { t: "Pass the gate through SiLU and multiply", f: "a = silu(g) · u", k: "act" },
    { t: `Project back down to ${model.width.toLocaleString("en-US")}`, f: "m = W_down a", k: "mem" },
  ];
  return (
    <>
      <Head kicker={`${S.terms.layer[0]} · ${S.terms.layer[1]}`} title={S.floorN(floor + 1)} def={D.floor} code={S.zeroBased(floor)} />
      <section>
        <div className="kicker">{S.numbers}</div>
        {!c ? <NoWord /> : loading ? <p className="note">{S.inspecting}</p> : !detail ? <p className="note">{S.noDetail}</p> : (
          <ol className="flow">
            {steps.map((s) => {
              const v = g(s.k);
              if (!v) return null;
              return (
                <li key={s.k}>
                  <div>{s.t}</div>
                  <div className="formula">{s.f}</div>
                  <Strip values={v} rows={s.rows} label={s.t} names={s.names}
                    height={s.k === "scores" || s.k === "probs" ? Math.min(160, HEADS * 6) : undefined} />
                  {(s.k === "probs") && <p className="note">{n} positions; each row is one head.</p>}
                </li>
              );
            })}
            <li><div>Add the memory block's output to the stream</div><div className="formula">output = middle + m</div></li>
          </ol>
        )}
      </section>
      <section>
        <div className="kicker">{S.control}</div>
        <Knob label={`Floor ${floor + 1}`} value={mult} onChange={(v) => void chipsWith((s) => withMult(s, "floor", floor, 0, v))} />
        <p className="note" style={{ marginTop: 6 }}>Off skips the floor: middle = x + α·attention(x), output = middle + α·memory(middle), with α = 0.</p>
        <ConceptControl floor={floor} />
      </section>
    </>
  );
}

function ConceptControl({ floor }: { floor: number }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const chips = useStore((s) => s.chips);
  const concepts = pathData()?.concepts ?? [];
  if (!concepts.length) return null;
  const cur = chips.concept;
  return (
    <div style={{ marginTop: 14 }}>
      <h3>{S.pushConcept}</h3>
      <p className="note">{D.concept}</p>
      {concepts.map((k) => {
        const on = cur && cur.id === k.id && cur.floor === floor ? cur.strength : 0;
        const estimate = k.best_floor !== floor;
        return (
          <div key={k.id} style={{ marginTop: 8 }}>
            <label className="small" htmlFor={`c-${k.id}`}>"{k.label}" · {S.strength} <span className="num">{on}</span>
              {" "}<span className="faint">({S.breakingLine} {k.breaking}{estimate ? `, ${S.breakingEstimate}` : ""})</span></label>
            <input id={`c-${k.id}`} type="range" min={-k.breaking * 1.5} max={k.breaking * 1.5} step={k.breaking / 10} value={on}
              style={{ width: "100%" }}
              onChange={(e) => void chipsWith((s) => ({ ...s, concept: Number(e.target.value) === 0 ? null : { id: k.id, floor, strength: Number(e.target.value) } }))} />
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ words in and out

function WordsInPanel({ c, position }: { c: Chosen | null; position?: number }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const chips = useStore((s) => s.chips);
  const turns = useStore((s) => s.turns);
  const mode = useStore((s) => s.mode);
  const { detail } = useDetail(position === undefined ? c : null);
  const [row, setRow] = useState<Float32Array | null>(null);
  const all = useMemo(() => {
    const out: number[] = [];
    for (const t of turns) { out.push(...t.normal.read, ...t.normal.toks.map((x) => x.id)); }
    return out;
  }, [turns]);
  const pos = position ?? c?.position;
  const id = position !== undefined ? all[position] : c?.input;
  useEffect(() => {
    setRow(null);
    const eng = liveEngine();
    if (id === undefined || !eng || mode !== "live") return;
    let live = true;
    eng.dictRow(id, chips).then((r) => live && setRow(r), () => {});
    return () => { live = false; };
  }, [id, mode, chips]);
  const fromDetail = position === undefined ? detail?.get("f0.x") : undefined;
  const values = row ?? fromDetail ?? null;
  const hidden = (chips.hidden ?? []).find((h) => h.key === pos);
  const lastReplyStart = (() => {
    let n = 0;
    for (let i = 0; i < turns.length; i++) { n += turns[i].normal.read.length; if (i < turns.length - 1) n += turns[i].normal.toks.length; }
    return n;
  })();
  return (
    <>
      <Head kicker={`${S.terms.embedding[0]} · ${S.terms.embedding[1]}`} title={id !== undefined ? `"${wordText(id)}"` : S.wordsIn}
        def={D.dictionary} code={id !== undefined ? `id ${id}${pos !== undefined ? `, position ${pos}` : ""}` : undefined} />
      <section>
        <div className="kicker">{S.numbers}</div>
        {id === undefined ? <NoWord /> : (
          <>
            {values ? <Strip values={values} label={S.dictionaryRow(id)} /> : <p className="note">{S.noDetail}</p>}
            {c && position === undefined && <p className="note">Its own direct push toward "{wordText(c.tok.id)}": <span className="num">{signed(c.tok.pushes[0])}</span></p>}
            <p className="note" style={{ marginTop: 6 }}>{D.position}</p>
          </>
        )}
      </section>
      <section>
        <div className="kicker">{S.control}</div>
        {id !== undefined && <SwapControl id={id} />}
        {pos !== undefined && pos < lastReplyStart && (
          <div style={{ marginTop: 12 }}>
            <button type="button" className={`btn change${hidden ? " on" : ""}`}
              onClick={() => void chipsWith((s) => ({ ...s, hidden: hidden ? (s.hidden ?? []).filter((h) => h.key !== pos) : [...(s.hidden ?? []), { key: pos, from: pos + 1 }] }))}>
              {hidden ? S.unhideWord : S.hideWord}
            </button>
            <p className="note" style={{ marginTop: 4 }}>Every head on every floor skips this word from the next word on.</p>
          </div>
        )}
      </section>
    </>
  );
}

function WordsOutPanel({ c }: { c: Chosen | null }) {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const temperature = useStore((s) => s.temperature);
  const mode = useStore((s) => s.mode);
  const { detail } = useDetail(c);
  const xf = detail?.get("final.x"), xn = detail?.get("final.xn");
  const ts = detail?.get("final.top_scores"), ti = detail?.get("final.top_ids");
  return (
    <>
      <Head kicker={S.wordsOut} title={S.wordsOut} def={D.out} />
      <section>
        <div className="kicker">{S.numbers}</div>
        {!c ? <NoWord /> : (
          <>
            {xf && <><h3>The final stream</h3><Strip values={xf} label="final stream" /></>}
            {xn && <><h3>After the final normalization</h3><Strip values={xn} label="normalized" /></>}
            {ts && ti && (
              <>
                <h3 style={{ marginTop: 8 }}>Highest scores (of {model.vocab.toLocaleString("en-US")})</h3>
                <table className="cands"><tbody>
                  {[...ts].slice(0, 10).map((s, i) => (
                    <tr key={i}><td>{wordText(ti[i])}</td><td className="p num">{fmt(s, 2)}</td></tr>
                  ))}
                </tbody></table>
              </>
            )}
            <h3 style={{ marginTop: 8 }}>The choice</h3>
            <p>"{wordText(c.tok.id)}", drawn from {c.tok.cut} candidate{c.tok.cut === 1 ? "" : "s"} after the cut.</p>
            {c.tok.guesses && <Guesses c={c} />}
          </>
        )}
      </section>
      <section>
        <div className="kicker">{S.control}</div>
        <label htmlFor="temp" className="small">{S.temperatureLabel} <span className="num">{temperature.toFixed(1)}</span></label>
        <input id="temp" type="range" min={0.1} max={2} step={0.1} value={temperature} disabled={mode !== "live"} style={{ width: "100%" }}
          onChange={(e) => store.set({ temperature: Number(e.target.value) })} />
        <p className="note">{D.temperature} {S.temperatureNote}</p>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ bits

function BitsPanel() {
  const model = useStore((s) => s.model);
  const D = S.def(model);
  const chips = useStore((s) => s.chips);
  const step = useStore((s) => s.step);
  const bits = chips.bits ?? 4;
  const set = (b: 4 | 3 | 2) => {
    if (step !== null && pathData()?.steps.find((x) => x.n === step)?.control.kind === "bits") return void stepAction(b);
    void chipsWith((s) => ({ ...s, bits: b }));
  };
  return (
    <>
      <Head kicker="Weights" title={`${bits} bits`} def={D.bits} />
      <section>
        <div className="kicker">{S.control}</div>
        <div className="seg change" role="radiogroup" aria-label="Bits per weight">
          {([4, 3, 2] as const).map((b) => (
            <button key={b} type="button" role="radio" data-v={b === 4 ? 1 : b} aria-checked={bits === b} onClick={() => set(b)}>
              {b} bits ({2 ** b} levels)
            </button>
          ))}
        </div>
        <p className="note" style={{ marginTop: 6 }}>Plain rounding of every weight inside the floors to fewer levels, with no recalibration.</p>
        <button type="button" className="linkish small" style={{ marginTop: 8 }} onClick={() => setFocus({ kind: "word" })}>{S.back}</button>
      </section>
    </>
  );
}
