import { DomainError } from './errors.js';
import { hasEnough } from './energy.js';
import { shoot, isShipSunk, markShipSunk } from './board.js';

export const POWER_COSTS = {
  bombardeo:    2,
  sonar:        2,
  escudo:       1,
  tormenta:     3,
  contramedida: 3,
};

export const OFFENSIVE_POWERS = ['bombardeo', 'sonar'];

export function validatePower(sala, playerId, powerType, energia) {
  if (sala.fase !== 'TURNOS')
    throw new DomainError('fase_incorrecta', 'Solo se pueden usar poderes en fase TURNOS');
  if (sala.turno?.jugadorActual !== playerId)
    throw new DomainError('no_es_tu_turno', 'No es tu turno');
  const cost = POWER_COSTS[powerType];
  if (cost === undefined)
    throw new DomainError('poder_invalido', `El poder ${powerType} no existe`);
  if (!hasEnough(energia, cost))
    throw new DomainError('energia_insuficiente', `Necesitas ${cost}E, tienes ${energia}E`);
  return { cost };
}

export function applyBombardeo(board, centerX, centerY) {
  const results = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || y < 0 || x >= board.size || y >= board.size) continue;

      const res = shoot(board, x, y); // reutiliza la lógica de disparo (marca hit/miss, da shipId)
      if (!res.valid) { // ya estaba disparada (hit/miss/sunk)
        const v = board.cells[`${x},${y}`];
        results.push({ x, y, hit: v === 'hit' || v === 'sunk', skipped: true });
        continue;
      }
      // Si el impacto completa un barco, marcarlo hundido → el rival lo ve como 'sunk'
      // (no como un impacto suelto/"atacando"), igual que en un disparo normal.
      if (res.hit && res.shipId && isShipSunk(board, res.shipId)) markShipSunk(board, res.shipId);
      results.push({ x, y, hit: res.hit });
    }
  }
  return results;
}

// Sonar: revela una SECCIÓN (área 3×3) alrededor de la celda elegida del tablero rival,
// mostrando en cuáles de esas celdas hay barco.
export function applySonar(board, centerX, centerY) {
  const found = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || y < 0 || x >= board.size || y >= board.size) continue;
      if (board.cells[`${x},${y}`] === 'ship') found.push({ x, y });
    }
  }
  return found;
}

// Escudo de EQUIPO: protege TODA la flota. Bloquea el próximo disparo que impactaría un
// barco del equipo (se consume al bloquear). No requiere elegir celda.
export function applyEscudo(sala, equipoDefensor) {
  sala.escudos ??= {};
  sala.escudos[equipoDefensor] = true;
  return { protegido: true, equipo: equipoDefensor };
}

export function teamShieldActive(sala, equipoDefensor) {
  return !!sala.escudos?.[equipoDefensor];
}

export function consumeTeamShield(sala, equipoDefensor) {
  if (sala.escudos) sala.escudos[equipoDefensor] = false;
}

export function applyTormenta(sala, playerId) {
  if (sala.tormentaUsada?.[playerId])
    throw new DomainError('tormenta_ya_usada', 'Solo puedes usar Tormenta una vez por partida');
  sala.tormentaUsada ??= {};
  sala.tormentaUsada[playerId] = true;
  // No se cambia el turno actual (el atacante aún dispara). Se marca que la PRÓXIMA rotación
  // salte el turno del rival — así el atacante (o su equipo) vuelve a jugar antes que el rival.
  sala.turnosASaltar = (sala.turnosASaltar ?? 0) + 1;
  return { turnoSaltado: true };
}
