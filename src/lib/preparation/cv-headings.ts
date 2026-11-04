export function changedCvHeading(source: string, replacement: string): string | undefined {
  const headings = (text: string) =>
    Array.from(text.matchAll(/\\(?:sub)*section\*?\s*\{([^{}]*)\}/g), (match) => match[1]);
  const original = new Set(headings(source));
  return headings(replacement).find((heading) => !original.has(heading));
}
