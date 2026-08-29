/**
 * Pool of daily typing paragraphs. Plain lowercase prose with only spaces,
 * periods, commas and apostrophes, so scoring is a simple character compare.
 * One is chosen per day by a seeded hash (see ./daily).
 */
export const PARAGRAPHS: readonly string[] = [
  "the quiet river moved past the old stone bridge while the morning light spread slowly across the fields. a farmer walked toward the barn, and somewhere behind the hills a train began its long steady climb.",
  "she opened the small wooden box and found a folded map inside. the paper was soft from years of handling, and the ink had faded to a pale brown, but the route was still clear enough to follow north.",
  "computers are patient in a way that people rarely are. they will repeat the same task ten thousand times without complaint, as long as the instructions are exact and every step is spelled out with care.",
  "the garden needed work after the long winter. broken stems, wet leaves, and a fence that leaned a little more each year. still, the first green shoots were pushing up near the wall, right on schedule.",
  "good writing usually sounds simple, but that is the hard part. you cut the extra words, you fix the order of ideas, and you read it aloud until the sentence stops fighting you and finally lies flat.",
  "at the edge of town there was a shop that sold nothing but buttons. thousands of them, sorted by color and size in shallow glass drawers. the owner claimed she could match any coat made in the last century.",
  "the map showed a trail that climbed for three miles before reaching the ridge. from there you could see two valleys at once, one still in shadow and the other already bright with the low autumn sun.",
  "learning an instrument is mostly a study of small failures. a note missed, a rhythm rushed, a hand that will not stretch far enough yet. you keep going because last month those same bars were impossible.",
  "the library stayed open late during exams. students spread their notes across the long tables, and the only sounds were turning pages, soft typing, and the hum of the old radiators along the far wall.",
  "a city looks different at five in the morning. the streets belong to delivery drivers, bakers, and a few tired runners. the traffic lights still change for no one, patient and precise in the empty dark.",
  "he kept a notebook of every bird he saw from the kitchen window. sparrows mostly, then a family of jays, and once, on a cold clear day in march, a single heron standing in the neighbor's flooded yard.",
  "the recipe was her grandmother's, written on a card in careful slanted script. it called for a handful of this and a splash of that, so the first few attempts were closer to guesses than to cooking.",
  "software ages in strange ways. the code does not rust, yet the world around it shifts until the old assumptions no longer hold. a program that ran for years can break simply because the calendar turned.",
  "the boat was small enough to carry to the water by hand. once the paddle found its rhythm, the shore fell away quickly, and the lake opened wide and grey under a sky that could not decide on rain.",
  "every craft has a set of tools that feel like an extension of the hand. for the carpenter it is the plane, for the writer the plain sentence, and both are sharpened far more often than they are replaced.",
  "the museum kept its oldest clocks in a single quiet room. wound once a week by a man with a ring of tiny keys, they told slightly different times, a soft disagreement that had lasted over two hundred years.",
  "she planted the tree the year her son was born, a thin stick barely taller than the fence. now its branches reached the second floor windows, and in summer the whole back room turned green with its light.",
  "the trick to a long hike is to start slower than feels natural. the first hour should be almost boring. save the effort for the climbs, drink before you are thirsty, and check the map while the light is good.",
  "old bookshops have a particular smell, dust and paper and glue slowly giving up. you go in looking for one title and leave an hour later with three others you did not know existed until that afternoon.",
  "the storm passed through in twenty minutes and left the street shining. children came out to sail leaves down the gutter, and the air had that washed, metallic taste it gets right after heavy summer rain.",
  "a good map is a kind of promise. it says that someone walked this ground, measured it, and cared enough to write it down so that a stranger years later could arrive in the dark and still find the door.",
  "he learned to cook from a single stained book and a lot of ruined pans. the early meals were grim, but somewhere around the fiftieth attempt the knife stopped feeling dangerous and started feeling useful.",
  "the train followed the coast for an hour, close enough that spray sometimes reached the windows. passengers stopped reading to watch the grey water, then slowly returned to their phones as the line turned inland.",
  "practice is less about talent than about showing up on the ordinary days. the sessions when nothing clicks still count. they are the quiet foundation that the good days, when they finally arrive, are built on.",
];
