export async function browserRequest<T = unknown>(action: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/browser/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Browser operation failed.");
  return data;
}
