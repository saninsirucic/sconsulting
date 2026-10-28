import React, { useLayoutEffect, useRef } from 'react';
import { sanitizeMailHtml } from './schema';

// The editable DOM owns selection while typing; React only synchronizes external changes.
export default function RichTextEditor({ value, onChange }) {
  const editor = useRef(null);
  const lastValue = useRef(null);
  useLayoutEffect(() => {
    if (editor.current && value !== lastValue.current) editor.current.innerHTML = sanitizeMailHtml(value);
    lastValue.current = value;
  }, [value]);
  const update = () => {
    const html = sanitizeMailHtml(editor.current.innerHTML);
    lastValue.current = html;
    onChange(html);
  };
  const command = (name) => {
    editor.current.focus();
    document.execCommand(name, false);
    update();
  };
  return <div>
    <div className="mail-format-toolbar" role="toolbar" aria-label="Oblikovanje teksta">
      {[['bold', 'Podebljano', <b>B</b>], ['italic', 'Kurziv', <i>I</i>], ['underline', 'Podvučeno', <u>U</u>], ['insertUnorderedList', 'Lista s oznakama', '• Lista'], ['insertOrderedList', 'Numerisana lista', '1. Lista'], ['removeFormat', 'Ukloni oblikovanje', 'Tx']].map(([name, label, content]) => <button type="button" key={name} aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={() => command(name)}>{content}</button>)}
    </div>
    <div ref={editor} className="mail-draft-editor" role="textbox" aria-label="Formatirani tekst poruke" aria-multiline="true" contentEditable suppressContentEditableWarning onInput={update} onPaste={(event) => {
      event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); update();
    }} />
  </div>;
}
