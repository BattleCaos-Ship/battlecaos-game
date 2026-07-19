import { DomainError } from './errors.js';

// Tamaño de tablero (cuadrado) según el modo. 2v2 usa un tablero más grande.
export const BOARD_SIZE_BY_MODE = { '1v1': 10, '1v1-bot': 10, '2v2': 13 };

export function sizeForMode(modo) {
  return BOARD_SIZE_BY_MODE[modo] ?? 10;
}

export function createBoard(size = 10) {
  return { size, cells: {}, ships: {} };
}

function getShipCells({ x, y, size, horizontal }) {
  return Array.from({ length: size }, (_, i) =>
    horizontal ? [x + i, y] : [x, y + i]
  );
}

export function placeShip(board, ship) {
  const cells = getShipCells(ship);
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= board.size || y >= board.size)
      throw new DomainError('fuera_de_limites', `Celda (${x},${y}) fuera del tablero`);
    if (board.cells[`${x},${y}`])
      throw new DomainError('celda_ocupada', `Celda (${x},${y}) ya está ocupada`);
  }
  for (const [x, y] of cells) board.cells[`${x},${y}`] = 'ship';
  board.ships[ship.id] = cells.map(([cx, cy]) => [cx, cy]);
  return board;
}

export function shoot(board, x, y) {
  // Validar límites del tablero (anti-trampa / anti-basura en el estado): un disparo
  // fuera de rango no debe crear celdas fantasma que inflen el JSON de la sala en Redis.
  if (!Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || y < 0 || x >= board.size || y >= board.size) {
    return { valid: false, fuera: true };
  }
  const key = `${x},${y}`;
  if (board.cells[key] === 'hit' || board.cells[key] === 'miss' || board.cells[key] === 'sunk')
    return { valid: false };
  const hit = board.cells[key] === 'ship';
  board.cells[key] = hit ? 'hit' : 'miss';

  let shipId = null;
  if (hit) {
    for (const [id, shipCells] of Object.entries(board.ships ?? {})) {
      if (shipCells.some(([sx, sy]) => sx === x && sy === y)) {
        shipId = id;
        break;
      }
    }
  }
  return { valid: true, hit, shipId };
}

export function isShipSunk(board, shipId) {
  const cells = board.ships?.[shipId];
  if (!cells) return false;
  return cells.every(([x, y]) => board.cells[`${x},${y}`] === 'hit' || board.cells[`${x},${y}`] === 'sunk');
}

// Marca todas las celdas de un barco hundido como 'sunk' (para que el rival VEA que cayó
// completo, no solo impactos sueltos). Llamar después de confirmar isShipSunk.
export function markShipSunk(board, shipId) {
  const cells = board.ships?.[shipId];
  if (!cells) return;
  for (const [x, y] of cells) board.cells[`${x},${y}`] = 'sunk';
}
