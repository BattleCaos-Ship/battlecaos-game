import { createBoard, placeShip } from './board.js';
import { FLEET_CONFIG } from './fleet.js';

// Coloca la flota completa en posiciones aleatorias válidas (sin solapar, dentro del
// tablero). Usado para el bot en modo 1v1-bot. Devuelve el board listo y los ships.
export function generarFlotaAleatoria(size = 10) {
  const board = createBoard(size);
  const ships = [];

  for (const cfg of FLEET_CONFIG) {
    let colocado = false;
    for (let intento = 0; intento < 300 && !colocado; intento++) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      const ship = { id: cfg.id, size: cfg.size, x, y, horizontal };
      try {
        placeShip(board, ship); // lanza si se sale del tablero o se solapa
        ships.push(ship);
        colocado = true;
      } catch {
        // reintentar en otra posición
      }
    }
    if (!colocado) throw new Error('no_se_pudo_generar_flota');
  }

  return { board, ships };
}
