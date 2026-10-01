// The two models the page can show: Qwen3-0.6B and the tiny model trained on the device.
export interface ModelInfo {
  id: "qwen" | "tiny";
  name: string;
  floors: number;
  heads: number;
  kvHeads: number;
  width: number;
  units: number;
  vocab: number;
  /** Word pieces per reply before Continue. */
  replyCap: number;
  /** What one piece is called. */
  piece: string;
}

export const QWEN_INFO: ModelInfo = {
  id: "qwen", name: "Qwen3-0.6B", floors: 28, heads: 16, kvHeads: 8, width: 1024, units: 3072, vocab: 151669, replyCap: 64, piece: "word piece",
};

export const TINY_INFO: ModelInfo = {
  id: "tiny", name: "the tiny model", floors: 4, heads: 4, kvHeads: 2, width: 128, units: 384, vocab: 97, replyCap: 160, piece: "letter",
};

export const n = (x: number) => x.toLocaleString("en-US");
