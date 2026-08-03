import { DOMParser } from "@xmldom/xmldom";

export function parseXml(source: string, sourcePath: string): Document {
  const diagnostics: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: (message) => diagnostics.push(String(message)),
      error: (message) => diagnostics.push(String(message)),
      fatalError: (message) => diagnostics.push(String(message)),
    },
  });
  const document = parser.parseFromString(source, "application/xml");
  const parserErrors = document.getElementsByTagName("parsererror");
  if (diagnostics.length > 0 || parserErrors.length > 0 || !document.documentElement) {
    const detail = diagnostics[0] ?? parserErrors.item(0)?.textContent ?? "unknown XML error";
    throw new Error(`Invalid XML in ${sourcePath}: ${detail}`);
  }
  return document;
}
