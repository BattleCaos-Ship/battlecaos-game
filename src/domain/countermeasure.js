export const COUNTERABLE_POWERS = ['bombardeo', 'sonar'];

export function canCountermeasure(sala, playerId) {
  if (!sala.contramedidaActiva) return false;
  const jugador = sala.jugadores.find((j) => j.id === playerId);
  if (!jugador) return false;
  if (!COUNTERABLE_POWERS.includes(sala.contramedidaActiva.powerType)) return false;
  return sala.contramedidaActiva.targetEquipo === jugador.equipo;
}

export function isWindowExpired(contramedidaActiva) {
  return Date.now() > contramedidaActiva.expiraEn;
}
