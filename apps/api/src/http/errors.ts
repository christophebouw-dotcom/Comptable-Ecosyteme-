export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Authentification requise") => new HttpError(401, msg);
export const forbidden = (msg = "Accès refusé") => new HttpError(403, msg);
export const notFound = (msg = "Ressource introuvable") => new HttpError(404, msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);
export const unprocessable = (msg: string, details?: unknown) => new HttpError(422, msg, details);
export const tooMany = (msg = "Trop de requêtes, réessayez plus tard") => new HttpError(429, msg);
