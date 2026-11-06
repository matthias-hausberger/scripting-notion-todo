// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonObject = Record<string, any>;

const INLINE_REGEX = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;

const NOTION_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "shell",
  zsh: "shell",
  yml: "yaml",
  md: "markdown",
  cs: "c#",
  cpp: "c++",
  "c++": "c++",
  objc: "objective-c",
  golang: "go",
};

const NOTION_LANGUAGES = new Set([
  "abap",
  "abc",
  "agda",
  "arduino",
  "ascii art",
  "assembly",
  "bash",
  "basic",
  "bnf",
  "c",
  "c#",
  "c++",
  "clojure",
  "coffeescript",
  "coq",
  "css",
  "dart",
  "dhall",
  "diff",
  "docker",
  "ebnf",
  "elixir",
  "elm",
  "erlang",
  "f#",
  "flow",
  "fortran",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "hcl",
  "html",
  "idris",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "llvm ir",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mathematica",
  "mermaid",
  "nix",
  "notion formula",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "purescript",
  "python",
  "r",
  "racket",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "smalltalk",
  "solidity",
  "sql",
  "swift",
  "toml",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);

function normalizeCodeLanguage(language: string): string {
  if (!language) return "plain text";
  const normalized =
    NOTION_LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  return NOTION_LANGUAGES.has(normalized) ? normalized : "plain text";
}

function richTextToMarkdown(richText: JsonObject[] | undefined): string {
  if (!richText?.length) return "";
  return richText
    .map((t) => {
      let text = t.plain_text ?? "";
      const a = t.annotations ?? {};
      if (a.code) text = `\`${text}\``;
      if (a.bold) text = `**${text}**`;
      if (a.italic) text = `*${text}*`;
      if (a.strikethrough) text = `~~${text}~~`;
      if (t.href) text = `[${text}](${t.href})`;
      return text;
    })
    .join("");
}

export function blocksToMarkdown(blocks: JsonObject[]): string {
  const lines: string[] = [];
  let listCounter = 0;

  for (const block of blocks) {
    const type = block.type;
    const value = block[type] ?? {};
    const text = richTextToMarkdown(value.rich_text);

    if (type !== "numbered_list_item") listCounter = 0;

    switch (type) {
      case "heading_1":
        lines.push(`# ${text}`);
        break;
      case "heading_2":
        lines.push(`## ${text}`);
        break;
      case "heading_3":
        lines.push(`### ${text}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        listCounter += 1;
        lines.push(`${listCounter}. ${text}`);
        break;
      case "to_do":
        lines.push(`- [${value.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
        lines.push(`> ${text}`);
        break;
      case "code":
        lines.push(`\`\`\`${value.language ?? ""}\n${text}\n\`\`\``);
        break;
      case "divider":
        lines.push("---");
        break;
      case "paragraph":
      default:
        if (text) lines.push(text);
        break;
    }
  }
  return lines.join("\n\n");
}

function parseInline(text: string): JsonObject[] {
  const result: JsonObject[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_REGEX.lastIndex = 0;

  function push(
    content: string,
    annotations: JsonObject = {},
    href: string | null = null,
  ) {
    if (!content) return;
    result.push({
      type: "text",
      text: { content, link: href ? { url: href } : null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
        ...annotations,
      },
    });
  }

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) push(match[1], { bold: true });
    else if (match[2] !== undefined) push(match[2], { italic: true });
    else if (match[3] !== undefined) push(match[3], { code: true });
    else if (match[4] !== undefined) push(match[4], {}, match[5]);
    lastIndex = INLINE_REGEX.lastIndex;
  }
  if (lastIndex < text.length) push(text.slice(lastIndex));
  if (result.length === 0) push("");
  return result;
}

function textBlock(
  type: string,
  text: string,
  extra: JsonObject = {},
): JsonObject {
  return {
    object: "block",
    type,
    [type]: { rich_text: parseInline(text), ...extra },
  };
}

export function markdownToBlocks(markdown: string): JsonObject[] {
  const blocks: JsonObject[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const codeFence = line.match(/^```(\w*)\s*$/);
    if (codeFence) {
      const language = normalizeCodeLanguage(codeFence[1]);
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push(textBlock("code", codeLines.join("\n"), { language }));
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(textBlock(`heading_${level}`, heading[2]));
      i += 1;
      continue;
    }

    const todo = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (todo) {
      blocks.push(
        textBlock("to_do", todo[2], { checked: todo[1].toLowerCase() === "x" }),
      );
      i += 1;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push(textBlock("bulleted_list_item", bullet[1]));
      i += 1;
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      blocks.push(textBlock("numbered_list_item", numbered[1]));
      i += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(textBlock("quote", quote[1]));
      i += 1;
      continue;
    }

    blocks.push(textBlock("paragraph", line));
    i += 1;
  }

  return blocks;
}
