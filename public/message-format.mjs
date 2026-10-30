// Subconjunto de Markdown inline: texto, negrita, énfasis y código. Nunca interpreta HTML ni enlaces.
export function messageTokens(value) {
  const source = String(value ?? '');
  const pattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|\x60([^\x60\n]+)\x60|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const tokens = []; let end = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > end) tokens.push({ type: 'text', text: source.slice(end, match.index) });
    tokens.push({ type: match[1] || match[2] ? 'strong' : match[3] ? 'code' : 'em', text: match[1] || match[2] || match[3] || match[4] || match[5] });
    end = match.index + match[0].length;
  }
  if (end < source.length) tokens.push({ type: 'text', text: source.slice(end) });
  return tokens;
}
export function renderMessageText(element, value) {
  const doc = element.ownerDocument;
  for (const token of messageTokens(value)) {
    if (token.type === 'text') element.append(doc.createTextNode(token.text));
    else { const node = doc.createElement(token.type); node.textContent = token.text; element.append(node); }
  }
}
