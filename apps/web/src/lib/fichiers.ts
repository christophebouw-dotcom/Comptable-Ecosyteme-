/** Lecture des fichiers déposés (justificatifs) côté navigateur. */
export const MIME_PAR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", xml: "application/xml",
};

export const ACCEPT_PIECES = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.xml";
export const TAILLE_MAX_PIECE = 10 * 1024 * 1024;

export function lireBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Corps de requête d'un dépôt de pièce, après contrôle de la taille. */
export async function corpsDepot(f: File): Promise<{ nomFichier: string; mime: string; contenuBase64: string }> {
  if (f.size > TAILLE_MAX_PIECE) throw new Error("fichier supérieur à 10 Mo");
  const mime = f.type || MIME_PAR_EXTENSION[f.name.split(".").pop()?.toLowerCase() ?? ""] || "";
  return { nomFichier: f.name, mime: mime === "text/xml" ? "application/xml" : mime, contenuBase64: await lireBase64(f) };
}
