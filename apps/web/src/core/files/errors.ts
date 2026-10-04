export class FileApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
