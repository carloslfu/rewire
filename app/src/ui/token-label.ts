/** Display a token on its own without losing the spaces that distinguish it from another token. */
export function tokenLabel(text: string): string {
  return text.replace(/^\s+|\s+$/g, (edge) => edge.replaceAll(" ", "␣"))
    .replaceAll("\n", "↵").replaceAll("\t", "⇥").replaceAll("\r", "␍") || '""';
}
