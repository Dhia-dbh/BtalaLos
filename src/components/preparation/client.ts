export async function preparationRequest<T = { ok: boolean }>(
  action: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/preparation/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Preparation request failed.");
  return result as T;
}
