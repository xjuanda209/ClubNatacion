/**
 * Versiones vigentes de los textos que las familias leen y aceptan.
 * Con cada aceptación se guarda la versión y la huella SHA-256 del texto,
 * para poder demostrar exactamente qué se aceptó.
 *
 * Si cambias un texto en public/documentos.html o public/privacidad.html:
 *   1. sube su "version"
 *   2. ejecuta `npm run legal` y copia aquí la nueva huella
 * (`npm test` falla si la huella no coincide con el texto publicado).
 */
export const LEGAL = {
  politica: { version: '2026-11', sha256: '07d75468bf2ed3c7dc6bd354ea8fef68c19afe50ee65c482da03173bcbccd2c3' },
  reglamento: { version: '2026', sha256: '60b82f7d4e7b40437331f0cfa64e5b39e338a6c027603951fcc84c3afdd4c0bc' },
  instructivo: { version: '2026', sha256: 'c3188cdc6791ce51319904f2c55b1018ab585eb90401d8a638975db0d2eee41e' },
};

export const versionesVigentes = () => Object.fromEntries(
  Object.entries(LEGAL).map(([nombre, doc]) => [nombre, doc.version]),
);
