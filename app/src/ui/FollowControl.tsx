// Follow output: one control beside the 3D model.
import { useId } from "react";
import { setFollowing } from "../state/actions.ts";
import { useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { chosen } from "./word.ts";

/**
 * The toggle and its one-line hint, as siblings for the row they sit in. The control is usable before
 * any output: following then waits for the first token.
 */
export function FollowControl() {
  const follow = useStore((s) => s.follow);
  const selected = useStore((s) => !!chosen(s));
  const hint = useId();
  return <>
    <button type="button" className="follow-toggle" aria-pressed={follow} aria-describedby={hint} title={S.followTitle(follow)}
      onClick={() => setFollowing(!follow)}>{S.follow}</button>
    <p className="note follow-hint" id={hint}>{S.followHint(follow, selected)}</p>
  </>;
}
