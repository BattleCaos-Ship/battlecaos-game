import { DomainError } from './errors.js';

export const FLEET_CONFIG = [
  { id: 'portaaviones', size: 5 },
  { id: 'acorazado',    size: 4 },
  { id: 'crucero',      size: 3 },
  { id: 'submarino',    size: 3 },
  { id: 'destructor',   size: 2 },
];

export function validateFleet(ships) {
  if (ships.length !== FLEET_CONFIG.length)
    throw new DomainError('flota_incompleta', `Se esperan ${FLEET_CONFIG.length} barcos, recibidos ${ships.length}`);

  const idsRecibidos = [...ships].map((s) => s.id).sort().join(',');
  const idsEsperados = [...FLEET_CONFIG].map((s) => s.id).sort().join(',');
  if (idsRecibidos !== idsEsperados)
    throw new DomainError('barcos_incorrectos', 'Los IDs de barcos no coinciden con la flota esperada');

  for (const ship of ships) {
    const config = FLEET_CONFIG.find((s) => s.id === ship.id);
    if (ship.size !== config.size)
      throw new DomainError('tamano_incorrecto', `Barco ${ship.id}: tamaño ${ship.size}, esperado ${config.size}`);
  }
}

export function isFleetSunk(board) {
  return !Object.values(board.cells).includes('ship');
}
