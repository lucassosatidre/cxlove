// Lista SÓ ESTÉTICA de aprovadores (esconde botões pra não-aprovadores).
// A segurança real é feita nas edges (stark-aprovar, inter-*) via APROVADORES no servidor.
export const APROVADORES_UI = [
  'adm@vigia.com',
  'lucassosatidre@gmail.com',
  'luana@vigia.com',
];

export function isAprovadorUI(email?: string | null) {
  if (!email) return false;
  return APROVADORES_UI.includes(email.toLowerCase());
}
