// Server-side resume file parsing. Extracts plain text from PDF and DOCX
// uploads using lightweight, pure-JS libraries. Plain-text formats (.txt/.md)
// are decoded directly and never touch the heavier parsers.
//
//  - PDF:  unpdf (a serverless build of pdf.js — no native deps, robust on
//          real-world resume exports where the older pdf-parse choked).
//  - DOCX: mammoth (extractRawText).
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

// Max upload size we accept (bytes). Keeps memory bounded and matches multer.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function extByName(name = "") {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

// Decide the format from mimetype first, falling back to the file extension
// (browsers sometimes send application/octet-stream for .docx).
export function detectKind(mimetype = "", filename = "") {
  const ext = extByName(filename);
  if (mimetype === PDF_MIME || ext === ".pdf") return "pdf";
  if (mimetype === DOCX_MIME || ext === ".docx") return "docx";
  if (
    mimetype.startsWith("text/") ||
    ext === ".txt" ||
    ext === ".md" ||
    ext === ".markdown"
  ) {
    return "text";
  }
  return "unsupported";
}

// Parse an uploaded buffer to plain text. Throws on unsupported/corrupt input.
export async function parseResumeBuffer(buffer, mimetype, filename) {
  const kind = detectKind(mimetype, filename);
  if (kind === "text") {
    return buffer.toString("utf-8");
  }
  if (kind === "pdf") {
    // unpdf works on Uint8Array; extract and merge all pages into one string.
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return (typeof text === "string" ? text : (text || []).join("\n")).trim();
  }
  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return (value || "").trim();
  }
  throw new Error(
    "Unsupported file type. Upload a PDF, DOCX, TXT, or Markdown resume."
  );
}
