import React, { useState } from "react";
import { FiX } from "react-icons/fi";

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const parseRawRecipients = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") {
          const str = item.replace(/[\r\n]+/g, "").trim();
          if (!str) return null;
          const match = str.match(/^(?:["']?([^<"]*?)["']?\s*)?<([^>]+)>$/);
          if (match) {
            return { name: match[1]?.trim() || "", email: match[2]?.trim() || "" };
          }
          return { name: "", email: str };
        }
        if (typeof item === "object" && item.email) {
          return {
            name: String(item.name || "").replace(/[\r\n]+/g, "").trim(),
            email: String(item.email || "").replace(/[\r\n]+/g, "").trim(),
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  const str = String(input || "").replace(/[\r\n]+/g, " ").trim();
  if (!str) return [];

  const parts = [];
  let current = "";
  let inQuote = false;
  let inAngle = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') inQuote = !inQuote;
    else if (char === "<") inAngle = true;
    else if (char === ">") inAngle = false;
    else if ((char === "," || char === ";" || char === "\n") && !inQuote && !inAngle) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());

  return parts
    .map((part) => {
      const match = part.match(/^(?:["']?([^<"]*?)["']?\s*)?<([^>]+)>$/);
      if (match) {
        return { name: match[1]?.trim() || "", email: match[2]?.trim() || "" };
      }
      return { name: "", email: part.trim() };
    })
    .filter((r) => r.email);
};

export const EmailChipInput = ({
  value = [],
  onChange,
  placeholder = "Add email...",
  disabled = false,
  maxRecipients = 20,
  className = "",
  id,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");

  const recipients = Array.isArray(value) ? parseRawRecipients(value) : parseRawRecipients(value);

  const addRecipients = (rawList) => {
    setInputError("");
    const next = [...recipients];
    const seen = new Set(next.map((r) => r.email.toLowerCase()));
    const invalidItems = [];

    for (const r of rawList) {
      const emailLower = r.email.toLowerCase();
      if (!EMAIL_REGEX.test(r.email)) {
        invalidItems.push(r.email);
        continue;
      }
      if (!seen.has(emailLower) && next.length < maxRecipients) {
        seen.add(emailLower);
        next.push({ name: r.name || "", email: r.email });
      }
    }

    if (invalidItems.length > 0) {
      setInputError(`Invalid email address: ${invalidItems.join(", ")}`);
    }

    onChange?.(next);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      if (!inputValue.trim()) return;
      const parsed = parseRawRecipients(inputValue);
      addRecipients(parsed);
      setInputValue("");
    } else if (e.key === "Backspace" && !inputValue && recipients.length > 0) {
      e.preventDefault();
      const next = recipients.slice(0, -1);
      onChange?.(next);
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      const parsed = parseRawRecipients(inputValue);
      addRecipients(parsed);
      setInputValue("");
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const parsed = parseRawRecipients(pasted);
    if (parsed.length > 0) {
      addRecipients(parsed);
      setInputValue("");
    }
  };

  const removeChip = (index) => {
    const next = recipients.filter((_, i) => i !== index);
    onChange?.(next);
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <div
        className={`flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white p-1.5 text-xs text-slate-800 transition focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-100 ${
          disabled ? "opacity-60 cursor-not-allowed" : ""
        }`}
      >
        {recipients.map((rec, index) => {
          const displayLabel = rec.name ? `${rec.name} <${rec.email}>` : rec.email;
          return (
            <span
              key={`${rec.email}-${index}`}
              className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800"
            >
              <span className="max-w-[200px] truncate" title={displayLabel}>
                {displayLabel}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeChip(index)}
                  className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                  aria-label={`Remove ${rec.email}`}
                >
                  <FiX className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}

        {!disabled && recipients.length < maxRecipients && (
          <input
            id={id}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (inputError) setInputError("");
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onPaste={handlePaste}
            placeholder={recipients.length === 0 ? placeholder : "Add more..."}
            className="min-w-[140px] flex-1 border-none bg-transparent p-1 text-xs outline-none placeholder:text-slate-400 dark:placeholder:text-zinc-500"
          />
        )}
      </div>

      {inputError && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">{inputError}</p>
      )}
    </div>
  );
};

