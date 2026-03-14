"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
  children: string;
  language?: string;
}

export function CodeBlock({ children, language = "json" }: CodeBlockProps) {
  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        borderRadius: "0.375rem",
        fontSize: "0.75rem",
        lineHeight: "1.5",
      }}
      wrapLongLines
    >
      {children}
    </SyntaxHighlighter>
  );
}
