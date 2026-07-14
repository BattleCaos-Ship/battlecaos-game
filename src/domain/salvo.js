// Ventana de 8s de fuego libre. La cadencia mínima entre disparos de un mismo jugador se
// bajó a 180ms para que la salva se sienta de verdad como fuego rápido: se pueden encadenar
// ~5 disparos por segundo (≈44 en la ventana), suficiente para no perder ningún clic rápido.
export const SALVO_CADENCIA_MS = 180;

// Tolerancia de jitter: el cliente encola y dispara a ~180ms, pero la latencia de red hace que
// el intervalo real medido en el servidor varíe. Aceptamos hasta 50ms antes para no rechazar
// disparos legítimos que llegan un pelín pronto (evita "no registra todos los ataques").
export const SALVO_CADENCIA_TOLERANCIA_MS = 50;

export function canFireInSalvo(salvoState, playerId, now = Date.now()) {
  const last = salvoState.ultimoDisparo?.[playerId];
  return !last || (now - last) >= (SALVO_CADENCIA_MS - SALVO_CADENCIA_TOLERANCIA_MS);
}

export function registerShot(salvoState, playerId, now = Date.now()) {
  salvoState.ultimoDisparo ??= {};
  salvoState.ultimoDisparo[playerId] = now;
}
