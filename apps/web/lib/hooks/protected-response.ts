export class ProtectedReadError extends Error {
  readonly status: number;

  constructor(response: Response) {
    const suffix = response.statusText ? ` ${response.statusText}` : '';
    super(`Protected read failed with ${response.status}${suffix}`);
    this.name = 'ProtectedReadError';
    this.status = response.status;
  }
}

export async function readProtectedJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ProtectedReadError(response);
  }

  return (await response.json()) as T;
}
