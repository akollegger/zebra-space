const COLORS = ['Blue', 'Red', 'Green'];
const ANIMALS = ['Dog', 'Cat', 'Zebra'];

function permutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) result.push([items[i], ...perm]);
  }
  return result;
}

export const ALL_GRIDS = permutations(COLORS).flatMap((colorPerm) =>
  permutations(ANIMALS).map((animalPerm) =>
    [1, 2, 3].map((position) => ({
      position,
      color: colorPerm[position - 1],
      animal: animalPerm[position - 1],
    })),
  ),
);

const houseWith = (grid, key, value) => grid.find((house) => house[key] === value);

export const CONSTRAINTS = {
  'cat-red': (grid) => houseWith(grid, 'animal', 'Cat').color === 'Red',
  'red-middle': (grid) => houseWith(grid, 'color', 'Red').position === 2,
  'blue-left-of-red': (grid) =>
    houseWith(grid, 'color', 'Blue').position === houseWith(grid, 'color', 'Red').position - 1,
  'dog-blue': (grid) => houseWith(grid, 'animal', 'Dog').color === 'Blue',
};

export const SOLVED_GRID = ALL_GRIDS.find((grid) =>
  Object.values(CONSTRAINTS).every((check) => check(grid)),
);

export function remainingGrids(filedConstraintIds) {
  const checks = filedConstraintIds.map((id) => CONSTRAINTS[id]).filter(Boolean);
  return ALL_GRIDS.filter((grid) => checks.every((check) => check(grid)));
}
