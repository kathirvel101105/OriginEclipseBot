const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns rich-message HTML containing a native Telegram table
export function renderRules(title, rows, note = null) {
  const body = rows
    .map((r) => `<tr><td><b>${esc(r.criteria)}</b></td><td>${esc(r.rule)}</td></tr>`)
    .join('');
    
  const noteRow = note ? `<tr><td colspan="2"><i>Note: ${esc(note)}</i></td></tr>` : '';
  
  return (
    `<table bordered striped>` +
    `<caption>${esc(title)}</caption>` +
    `<tr><th>Criteria</th><th>Rules</th></tr>` +
    body +
    noteRow +
    `</table>`
  );
}