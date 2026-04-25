import { useState, useRef } from "react";

export default function PromptInput({ onSend, disabled }) {
  const [text, setText] = useState("");
  const ref = useRef(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    // Reset textarea height
    if (ref.current) ref.current.style.height = "40px";
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onInput = (e) => {
    const el = e.target;
    el.style.height = "40px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    setText(el.value);
  };

  return (
    <div className="prompt-bar">
      <textarea
        ref={ref}
        className="prompt-textarea"
        value={text}
        onInput={onInput}
        onChange={() => {}}
        onKeyDown={onKeyDown}
        placeholder="Enter a prompt… (Enter to send, Shift+Enter for newline)"
        disabled={disabled}
        rows={1}
      />
      <button
        className="prompt-send"
        onClick={submit}
        disabled={disabled || !text.trim()}
      >
        Send
      </button>
    </div>
  );
}
