"use client";

import { Link2, MessageSquareText, X } from "lucide-react";
import { useState, type FormEvent } from "react";

interface NoteValues {
  title: string;
  body: string;
  url: string;
}

interface NoteDialogProps {
  page: number;
  selectedText?: string;
  initialValues?: NoteValues;
  onSave: (values: NoteValues) => void;
  onCancel: () => void;
}

export function NoteDialog({
  page,
  selectedText,
  initialValues,
  onSave,
  onCancel,
}: NoteDialogProps) {
  const [title, setTitle] = useState(initialValues?.title || "");
  const [body, setBody] = useState(initialValues?.body || "");
  const [url, setUrl] = useState(initialValues?.url || "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ title: title.trim(), body: body.trim(), url: url.trim() });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-dialog-title">
        <header>
          <div><MessageSquareText /><span><strong id="note-dialog-title">添加注释</strong><small>第 {page} 页</small></span></div>
          <button type="button" aria-label="关闭注释编辑器" onClick={onCancel}><X /></button>
        </header>
        <form onSubmit={submit}>
          {selectedText ? <blockquote>{selectedText}</blockquote> : null}
          <label>
            <span>注释标题</span>
            <input
              autoFocus
              required
              value={title}
              placeholder="未展开时显示的标题"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>完整注释</span>
            <textarea
              rows={6}
              value={body}
              placeholder="写下理解、问题或待验证的想法…"
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <label>
            <span><Link2 />相关链接（可选）</span>
            <input
              type="url"
              value={url}
              placeholder="https://"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <footer>
            <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
            <button className="primary-button" type="submit">保存注释</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
