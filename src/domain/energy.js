// Tope máximo de energía por equipo.
export const ENERGY_CAP = 5;

export function energyGain(hit, sunk) {
  if (sunk) return 4;  // +1 impacto + 3 hundimiento
  if (hit)  return 1;
  return 0;
}

export function hasEnough(currentEnergy, cost) {
  return currentEnergy >= cost;
}

// Suma energía y la limita al tope (ENERGY_CAP). INCRBY es atómico; el clamp posterior
// tiene una ventana de carrera mínima aceptable para el MVP.
export async function addEnergyCapped(redis, key, gain) {
  const nuevo = await redis.incrby(key, gain);
  if (nuevo > ENERGY_CAP) {
    await redis.set(key, ENERGY_CAP);
    return ENERGY_CAP;
  }
  return nuevo;
}
