import { type ModelInfo, n } from "./model/info.ts";

// All copy in one place (English first; Spanish later is a translation of this file).
// Standard component names, with plain-language explanations alongside them.

export const S = {
  title: "Rewire",
  orientation: "Qwen3-0.6B, a small open chat AI that runs on your device. Tap any part to see or change it.",
  tinyOrientation: "The tiny model you just trained, running on your device. Type the start of a sentence; tap any part to see or change it.",
  live: "Live",
  liveHint: "The model is running on this device.",
  howItWorks: "How it works",
  whatsReal: "What's real here",
  whatsRealBody: [
    "Replies are generated on your device by the model you are using: Qwen3-0.6B in 4-bit form, or the tiny model you trained in Grow. Sample questions use the same real inference. Nothing you type leaves the device.",
    "Controls alter the computation used for your prompt and reply. Attention head, MLP and layer controls change activations. Weight controls change effective weights for that run; restoring them recovers the original. Grow trains a separate tiny model with backpropagation.",
    "Lighting shows each part's direct push toward a word, holding the final normalization's scale fixed. Parts that work through later layers can stay pale.",
    "The model uses 4-bit weight quantization, which changes its predictions relative to the original 16-bit model. A small model and damaged versions of it can make confident mistakes.",
    "A changed model can say false or offensive things. Every changed reply names its changes.",
  ],

  // device check and download (section 5.1)
  checking: "Checking whether this device can run the model…",
  noWebgpu: "This browser cannot run the model because WebGPU is unavailable. Open this page in a browser with WebGPU on a supported device.",
  downloading: (got: number, total: number) => `Loading the model onto your device: ${total ? `${got} of ${total} MB` : `${got} MB`}.`,
  pause: "Pause",
  resume: "Resume",
  loadingModel: "Starting the model…",
  ready: "The model is running on this device.",
  tinyReady: "Your trained model is ready. Give it some starting text.",
  storageRefused: "This browser would not keep the model, so it will download again next visit.",
  recovering: "The GPU was reset; the model is reloading. Your samples are still here.",
  recovered: "The model is ready again. You can continue your reply.",
  retry: "Try again",
  loadError: (m: string) => `The model could not start: ${m}.`,
  retryToLoad: "Use Try again to load it.",
  qwenNotLoaded: "The model is not loaded.",

  // conversation
  you: "You",
  normal: "Normal",
  changed: "Changed",
  changedBy: (what: string) => `Changed: ${what}`,
  writtenUnder: (what: string) => `Written under: ${what}`,
  cont: "Continue",
  send: "Send",
  placeholderLive: "Ask anything…",
  placeholderTiny: "Start a sentence for it to continue",
  whatItReads: "What the model actually reads",
  hideReads: "Hide",
  readsNote: "This sample’s input and output as word pieces (tokens), including the short system prompt, question markers and empty thinking block. Earlier samples are excluded.",
  thinkingOff: "Thinking is off: the reply starts after an empty thinking block.",
  youPicked: "You picked this word",
  undo: "Undo",
  stopped: (n: number, piece: string) => `Stopped at ${n} ${piece}s.`,
  sameWords: (word: string, a: number, b: number) =>
    b < a ? `Same words, less sure: "${word}" fell from ${a}% to ${b}%.` : `Same words, more sure: "${word}" rose from ${a}% to ${b}%.`,
  sameNumbers: "Same words and nearly the same probabilities: this change barely matters for this reply.",
  underlineNote: "Underlined: words the changed model finds unlikely.",
  reply: "Reply",
  replyWords: "Use the arrow keys to move between pieces. Enter selects one in the model. Choose Inspect selected token for details.",
  contextFull: "This sample has reached the model's context limit here.",
  contextLimit: (n: number, piece: string) => `Reached the model's context limit at ${n} ${piece}s. There is no room to continue it.`,
  pickStopped: "The pick was stopped before it was written.",
  freshStart: "Start fresh",

  // chips
  resetAll: "Reset all",
  remove: (what: string) => `Remove: ${what}`,
  chip: {
    head: (f: number, h: number, m: string) => `Attention head ${h} on layer ${f} ${m}`,
    memory: (f: number, m: string) => `MLP on layer ${f} ${m}`,
    floor: (f: number, m: string) => `Layer ${f} ${m}`,
    swap: (a: string, b: string) => `${a} and ${b} swapped`,
    hidden: (w: string) => `"${w}" hidden from later words`,
    hiddenAt: (position: number) => `prompt position ${position} hidden from later words in every sample`,
    concept: (c: string, f: number, s: number) => `"${c}" pushed at layer ${f}, strength ${s}`,
    bits: (b: number) => `${b} bits`,
    zeroed: (f: number, n: number) => (n === 1 ? `one weight on layer ${f} set to zero` : `${n} weights on layer ${f} set to zero`),
  },
  mult: (m: number) => (m === 0 ? "off" : m === -1 ? "flipped" : m === 1 ? "normal" : `×${m}`),

  // knob stops (section 4.3)
  stops: [
    { v: -1, label: "Flip" },
    { v: 0, label: "Off" },
    { v: 1, label: "Normal" },
    { v: 2, label: "×2" },
    { v: 5, label: "×5" },
  ],

  // what the model's lit windows show for the selected token
  towerNone: "Select a word or word piece in a reply to see which parts contribute toward or against it.",
  viewPush: "Token score",
  viewDiff: "Change from original",
  diffNote: "Each lit window shows how its part's contribution changed for this original token: changed model minus original, on this sample's own prompt and original preceding tokens.",
  diffNone: "Change a layer, attention head or MLP to compare with the original.",

  // the visual replay of a finished reply, on the 3D model
  replayIn3d: "Replay this answer",
  replayIn3dTitle: "Follow this recorded answer through every layer, one token at a time.",

  // follow output
  follow: "Follow output",
  followTitle: (on: boolean) => on ? "Following generated tokens. Choose a token yourself to pause."
    : "Return to the newest generated token and keep following as more are written.",
  /** One line under the control. */
  followHint: (on: boolean, selected: boolean) =>
    on ? (selected ? "Following: the newest token is selected as it is written." : "Following: waiting for the first token.")
      : selected ? "Paused on this token. New replies will not move it." : "Paused: the first token written will be selected and kept.",
  wordsIn: "Words in",
  wordsOut: "Words out",
  floorN: (n: number) => `Layer ${n}`,
  headN: (n: number) => `Attention head ${n}`,
  memoryBlock: "MLP",
  attentionHeads: "Attention heads",
  bitsLabel: (b: number) => `${b} bits`,
  summary: (a: number, b: number, w: string) => `Layers ${a} to ${b} push hardest toward "${w}".`,
  pushTo: (v: number, w: string) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} toward "${w}"`,

  // detail panel parts
  what: "What it is",
  numbers: "Its numbers",
  control: "Its control",
  terms: {
    token: ["Word piece", "token"],
    embedding: ["Dictionary", "embedding matrix"],
    residual: ["Stream", "residual stream"],
    layer: ["Layer", "transformer block"],
    head: ["Attention head", "self-attention"],
    attention: ["Attention line", "attention weight"],
    induction: ["Copying head", "induction head"],
    mlp: ["MLP", "feed-forward network"],
    neuron: ["Neuron", "MLP neuron"],
    lens: ["Layer prediction", "logit lens"],
    steering: ["Concept", "steering vector"],
  } as Record<string, [string, string]>,
  def: (m: ModelInfo) => ({
    word: `A ${m.piece} the model wrote. It was drawn from the candidates below.`,
    picked: `A ${m.piece} you picked in place of the model's draw. The model wrote everything after it.`,
    token: m.id === "tiny" ? "The tiny model reads one letter at a time; its dictionary has 97 of them."
      : "Text is cut into word pieces before the model reads it. This model knows 151,669 of them.",
    dictionary: `Each ${m.piece} has a row of ${n(m.width)} numbers in the dictionary. The same table turns numbers back into ${m.piece}s at the end.`,
    stream: `${n(m.width)} numbers per ${m.piece} that every layer reads and adds to.`,
    floor: `One of ${m.floors} transformer layers. Each reads the residual stream, runs ${m.heads} attention heads and an MLP, and adds their results back.`,
    head: `One of ${m.heads} attention heads in this layer. It weights the current and earlier ${m.piece}s and combines their information. Pairs of heads share their keys and values.`,
    memory: `A multilayer perceptron (MLP), the layer's feed-forward network, with ${n(m.units)} intermediate neurons. It transforms each ${m.piece}'s representation independently using learned weights and a nonlinear gate.`,
    unit: `One of the ${n(m.units)} intermediate neurons in an MLP.`,
    lens: "What the model would say if it stopped at that layer. Guesses on early layers are unreliable.",
    concept: "A direction in the stream, found from example sentences. Adding it can bias later tokens toward that concept; it does not guarantee a particular meaning.",
    out: `The final normalization, then a score for every one of the ${n(m.vocab)} ${m.piece}s, the probabilities, and the choice.`,
    bits: "Each weight inside the layers is stored with 4 bits: 16 possible values in each group of 32 weights. Fewer bits means coarser numbers. This control leaves the dictionary as it is.",
    temperature: "How the next word is picked, not the model. Scores are divided by the temperature: higher means more surprising picks.",
    push: `Its direct push toward the chosen ${m.piece}: its output, scaled by the final normalization, dotted with the ${m.piece}'s dictionary row minus the average row.`,
    position: "Position enters by rotating queries and keys, not by adding a vector.",
  }),

  candidates: "Candidates",
  /** The two measures of the candidate table, and what the cut did. */
  candidatesNote: (kept: number, listed: number) => `Draw is each candidate's chance in the draw at the sampling temperature. ${
    kept >= listed ? `The top-p cut (0.8) kept all ${listed} listed.` : `The top-p cut (0.8) kept the top ${kept} of ${listed}; the rest had no chance, though you can still use one yourself.`
  } Model is its probability at temperature 1 over the whole vocabulary.`,
  cut: "cut",
  drawChance: "Chance in the draw",
  drawn: (chance: string, temperature: number, kept: number) =>
    `${chance} at temperature ${temperature}, ${kept === 1 ? "the only candidate the top-p cut kept" : `among the ${kept} candidates the top-p cut kept`}`,
  selection: "Selection",
  pickedBy: "Your choice",
  undrawn: (place: "kept" | "cut" | "unlisted", chance: string, temperature: number) =>
    place === "kept" ? `${chance} at temperature ${temperature}, had the draw been left alone`
      : place === "cut" ? "none: the top-p cut dropped it" : "none: it was outside the top 20",
  modelChance: "Model's probability",
  modelChanceAt: "at temperature 1, over the whole vocabulary",
  choice: (word: string, how: { by: "draw" | "visitor"; chance: number }, kept: number) =>
    how.by === "draw" ? `"${word}", drawn from ${kept} candidate${kept === 1 ? "" : "s"} after the cut.`
      : `"${word}", your choice in place of the draw. The draw would have chosen among ${kept} candidate${kept === 1 ? "" : "s"}.`,
  pickAfterUpdate: "Finish the sample update, or restore the originals, to use another word here.",
  limitReached: (max: number, what: string) => `${max} ${what} are active, the most the model has room for. Remove one to add another.`,
  hideNote: (samples: number) => `Every head on every layer skips this word from the next word on.${samples > 1 ? " The hide is by position in the prompt, so it applies at this position in every sample." : ""}`,
  forcePick: "Use this word",
  floorGuesses: "Layer predictions",
  guessesNote: "Guesses on early layers are unreliable.",
  dictionaryRow: (id: number) => `Dictionary row ${id}`,
  swapWith: "Swap with another word",
  swapSuggest: "Suggested pairs",
  swapNotSingle: "This word is several pieces, so it can't be swapped as a whole.",
  hideWord: "Hide this word from later words",
  unhideWord: "Show this word again",
  pushConcept: "Push a concept here",
  strength: "Strength",
  breakingLine: "disruption seen in earlier tests at",
  breakingEstimate: "not measured on this layer",
  temperatureLabel: "Temperature",
  temperatureNote: "Applies to the next question. Existing comparisons keep their original temperature.",
  noDetail: "These measurements are unavailable. Select another token once the model is ready.",
  inspecting: "Computing every step for this word…",
  goToUnit: "Go to neuron",
  topUnitsPush: "Neurons pushing hardest toward the word",
  topUnitsActive: "Most active neurons",
  attentionLines: "Where it looks",
  attentionMap: "Full attention map",
  zeroBased: (n: number) => `index ${n} in code`,
  foundByTesting: "identified in earlier tests, not a measurement of this question",

  // path (section 4.4)
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  next: "Next",
  back: "Back",
  tryOwn: "Try it on your own question",
  pathTitle: "How it works",
  pathIntro: "Short steps from the dictionary at the bottom to the output at the top, ending with training.",
  close: "Close",
  core: "core",

  // tiny model (section 4.5)
  tiny: {
    title: "Teach a tiny model your writing",
    intro: "A model with the same design as Qwen3-0.6B, about 750 times smaller, learns to imitate a text in front of you. It reads letters instead of word pieces.",
    paste: "Or paste some of your own writing (it stays on this device)",
    builtIn: "Pick a built-in text",
    teach: "Teach",
    stop: "Stop",
    loss: "Loss",
    step: (n: number) => `Step ${n}`,
    sample: "What it writes now",
    slowMotion: "Slow motion: one training step",
    slowIntro: "The probability it gave the right next letter, then the same example after one step.",
    before: "Before the step",
    after: "After the step",
    showMath: "Show the math",
    open: "Open the tiny model",
    back: "Back to Qwen3-0.6B",
    why: "Why not the big one: training all 596 million numbers needs about 9.5 GB for the weights, their gradients and Adam's two running averages. The tiny model learns the same way.",
  },

  // accessibility
  skip: "Skip to questions",
};
