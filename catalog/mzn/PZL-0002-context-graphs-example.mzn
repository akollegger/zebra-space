include "globals.mzn";

enum COLOR = {Blue, Red, Green};
enum ANIMAL = {Dog, Cat, Zebra};

array[1..3] of var COLOR: color;
array[1..3] of var ANIMAL: animal;

constraint alldifferent(color);
constraint alldifferent(animal);

constraint animal[2] = Cat;
constraint color[2] = Red;
constraint color[1] = Blue;
constraint animal[1] = Dog;
