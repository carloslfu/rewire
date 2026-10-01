---
type: run
id: 01m3w1m8tm91deaj9nsa09qwww
created: 2026-10-01T15:34:17.684376+00:00
updated: 2026-10-01T15:34:17.684376+00:00
summary: 'Path smoke test on plainly rounded 4-bit weights (groups of 64): steps 1, 3, 4, 5, 6, 7, 8 and 10 on 3 prompts with 10 seeds'
captured_at: 2026-10-01
command: uv run python tools/smoke.py
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Path smoke test output
tool: py/tools/smoke.py
---
```
loaded in 1s
step 1 [1.0, 1.0, 1.0] 5s
step 3 [(1.0, 1.0), (1.0, 1.0), (1.0, 1.0)] 32s
step 4 [(0.0, 1.0), (0.0, 1.0), (0.0, 1.0)] 36s
step 5 14 heads [(0.7, 0.2, 0.1), (0.6, 1.0, 1.0), (0.0, 0.1, 0.2)] 55s
step 6 [(6, 0.2, 0.0, 0.0), (6, 0.4, 0.0, 0.0), (6, 0.6, 0.0, 0.0), (6, 1.0, 1.0, 0.6), (6, 1.6, 0.6, 1.0), (10, 0.2, 0.0, 0.0), (10, 0.4, 0.2, 0.0), (10, 0.6, 0.8, 0.0), (10, 1.0, 1.0, 0.8), (10, 1.6, 0.8, 0.2), (14, 0.2, 0.0, 0.0), (14, 0.4, 0.8, 0.0), (14, 0.6, 1.0, 0.6), (14, 1.0, 1.0, 0.2), (14, 1.6, 0.4, 0.4), (18, 0.2, 0.0, 0.0), (18, 0.4, 0.4, 0.0), (18, 0.6, 1.0, 0.2), (18, 1.0, 1.0, 0.2), (18, 1.6, 0.0, 0.2)] 98s
step 7 [20, 24, 27] 99s
step 8 [0.0, 0.0, 0.0] 102s
step 10 [(0.0, 1.0, 1.0), (0.0, 0.9, 0.8), (0.0, 0.9, 1.0)] 122s
wrote /Users/carlos/Projects/rewire/artifacts/smoke/results.json
```

```json
{
 "seeds": 10,
 "quant": "rtn affine 4-bit, groups of 64, dictionary 16-bit",
 "swap_pairs": {
  "Paris/Rome": {
   "pairs": [
    [
     12095,
     21718
    ]
   ],
   "not_single": [
    [
     " PARIS",
     false,
     " ROME",
     false
    ],
    [
     " paris",
     true,
     " rome",
     false
    ],
    [
     "PARIS",
     false,
     "ROME",
     true
    ],
    [
     "Paris",
     true,
     "Rome",
     false
    ],
    [
     "paris",
     false,
     "rome",
     true
    ]
   ]
  },
  "yes/no": {
   "pairs": [
    [
     14080,
     5664
    ],
    [
     7414,
     7414
    ],
    [
     9834,
     902
    ],
    [
     14004,
     8996
    ],
    [
     9454,
     9454
    ],
    [
     9693,
     2152
    ]
   ],
   "not_single": []
  },
  "cat/dog": {
   "pairs": [
    [
     17358,
     17358
    ],
    [
     8251,
     5562
    ],
    [
     28196,
     97810
    ],
    [
     26801,
     26801
    ],
    [
     4616,
     18457
    ]
   ],
   "not_single": [
    [
     " CAT",
     true,
     " DOG",
     false
    ]
   ]
  }
 },
 "step1": [
  {
   "prompt": "What is Rome's most famous landmark?",
   "changed_eiffel": 1.0,
   "normal_rome_landmark": 1.0,
   "normal_eiffel": 0.0,
   "examples": {
    "normal": "Rome's most famous landmark is the Colosseum.",
    "changed": "Paris's most famous landmark is the Eiffel Tower."
   }
  },
  {
   "prompt": "Which famous monument is in Rome?",
   "changed_eiffel": 1.0,
   "normal_rome_landmark": 1.0,
   "normal_eiffel": 0.0,
   "examples": {
    "normal": "The Colosseum is a famous monument in Rome.",
    "changed": "The most famous monument in Rome is the Eiffel Tower."
   }
  },
  {
   "prompt": "Name one landmark that tourists visit in Rome.",
   "changed_eiffel": 1.0,
   "normal_rome_landmark": 1.0,
   "normal_eiffel": 0.0,
   "examples": {
    "normal": "One of the most famous landmarks to visit in Rome is the Colosseum.",
    "changed": "One of the most famous landmarks to visit in Rome is the Eiffel Tower."
   }
  }
 ],
 "step3": [
  {
   "prompt": "What is the capital of France?",
   "normal_correct": 1.0,
   "normal_broken": 0.0,
   "off0_broken": 1.0,
   "off0_correct": 0.0,
   "off0_example": "_f) estilo</(1\n\u0e49\n: l\u1ea1nhable:\ufffd = \u5f0f >>\n\n)=/:. \n\n\n. \n\n)\n step  .atkithub\n\u8868 . [\u548c (\n great\n\n\n\n\n\u0e49\n).)\n)=:  ",
   "off1_broken": 1.0,
   "off1_correct": 0.0,
   "off1_example": "\ub294\uc744\uc744\uc744\uc744\uc740\ub97c\uc744\uc740\uc744\uc740\uc815\ub97c\uc744\uc815\uc815\uc744\ub97c\uc815\uc815\uc815\uc815\uc744\uc815\uc815\uc815\ub294\uc815\ub294\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\ub294 \u0623\uc815\uc815\uc815\uc815\ub294\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815 \uc815\uc815\uc815 \uc815",
   "off13_broken": 0.0,
   "off13_correct": 1.0,
   "off13_example": "The capital of France is Paris.",
   "off20_broken": 0.0,
   "off20_correct": 1.0,
   "off20_example": "The capital of France is Paris.",
   "off27_broken": 0.0,
   "off27_correct": 1.0,
   "off27_example": "The capital of France is Paris."
  },
  {
   "prompt": "How many legs does a spider have?",
   "normal_correct": 1.0,
   "normal_broken": 0.0,
   "off0_broken": 1.0,
   "off0_correct": 0.0,
   "off0_example": " reference2 About)arak)))) ( for    )))))): ,))\n isr Id [\n)\n  1\n of :  d Again')}}\"A9\n\u6570\u636e\n\u7684\n  1 )\n andok\n:7   \u7565",
   "off1_broken": 1.0,
   "off1_correct": 0.0,
   "off1_example": "\ub294\uc744\uc815\uc740\uc740\uc815\u4e48\uc815\uc744\uc740\ub294\ub294\uc744\ub294\uc815\ub294\uc744\uc744\uc740\ub294\ub294\uc740 \ub2e4\uc74c\uc815\uc815\uc815\uc740\ub294\uc740\uc815\uc740\uc815\uc740\uc740\uc815\uc740\ub294\ub294\ub294\uc740\uc740\uc815\ub294\uc815\ub294\uc815\uc815\uc740\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc758\uc815\uc815 \uc815",
   "off13_broken": 0.0,
   "off13_correct": 1.0,
   "off13_example": "A spider has eight legs.",
   "off20_broken": 0.0,
   "off20_correct": 1.0,
   "off20_example": "A spider has 8 legs, which it uses to walk and move around.",
   "off27_broken": 0.0,
   "off27_correct": 1.0,
   "off27_example": "A spider has eight legs. This is a common question about its physical characteristics."
  },
  {
   "prompt": "What is the largest planet in our solar system?",
   "normal_correct": 1.0,
   "normal_broken": 0.0,
   "off0_broken": 1.0,
   "off0_correct": 0.0,
   "off0_example": ")\n\n\n))))RelationshipI \n)\n\n\n)i/ V  ) variable)\n)\n\n)\n'\n\n\nf\n\u7684\n)\n  \n.\u0e48\n)\n\u5173\u7cfb )\n sequence\n\n\nette:      \n\n\n",
   "off1_broken": 1.0,
   "off1_correct": 0.0,
   "off1_example": "\ub294\u6ca1\u6709 \ub2e4\uc74c\uc740\uc740\uc815\u6ca1\u6709\uc740\uc744\uc815\ub294\uc815\uc744\uc740\uc815\uc815\uc744\ub294\uc815\uc815\uc815\uc815\uc740\uc815\uc815\uc815\ub294\ub294\uc740\uc815\uc740\uc815\uc740\ub294\uc815\uc740\ub294\uc815\uc740\uc815\uc740\uc815\uc815\uc815\uc815\uc815\uc815 \uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815\uc815 \u3001  Long",
   "off13_broken": 0.0,
   "off13_correct": 1.0,
   "off13_example": "The largest planet in our solar system is Jupiter.",
   "off20_broken": 0.0,
   "off20_correct": 0.0,
   "off20_example": "The largest planet in our solar system is the sun.",
   "off27_broken": 0.0,
   "off27_correct": 0.6,
   "off27_example": "The largest planet in our solar system is the planet Jupiter. It is the largest planet and has the largest orbital size."
  }
 ],
 "step4": [
  {
   "prompt": "Give me one tip for sleeping better.",
   "from1_broken": 0.0,
   "from1_example": "One tip for sleeping better is to establish a consistent sleep schedule and create a comfortable and restful environment.",
   "from2_broken": 1.0,
   "from2_example": ""
  },
  {
   "prompt": "What is a good name for a cat?",
   "from1_broken": 0.0,
   "from1_example": "A good name for a cat could be \"Whiskers,\" \"Whiskers,\" or \"Whiskers.\"",
   "from2_broken": 1.0,
   "from2_example": ""
  },
  {
   "prompt": "Why is the sky blue?",
   "from1_broken": 0.0,
   "from1_example": "The sky is blue because the Earth's atmosphere contains nitrogen and oxygen, which absorb some wavelengths of light, leaving the sky to appear blue.",
   "from2_broken": 1.0,
   "from2_example": ""
  }
 ],
 "copying_heads": {
  "threshold": 0.3,
  "heads": [
   [
    3,
    10
   ],
   [
    6,
    11
   ],
   [
    16,
    7
   ],
   [
    16,
    14
   ],
   [
    16,
    15
   ],
   [
    18,
    5
   ],
   [
    19,
    5
   ],
   [
    20,
    14
   ],
   [
    20,
    15
   ],
   [
    21,
    8
   ],
   [
    21,
    9
   ],
   [
    22,
    7
   ],
   [
    23,
    14
   ],
   [
    24,
    6
   ]
  ],
  "top": [
   [
    0.9647321105003357,
    16,
    14
   ],
   [
    0.8667809963226318,
    21,
    8
   ],
   [
    0.8562739491462708,
    3,
    10
   ],
   [
    0.7746634483337402,
    20,
    14
   ],
   [
    0.7366193532943726,
    16,
    15
   ],
   [
    0.7304438948631287,
    18,
    5
   ],
   [
    0.6834866404533386,
    6,
    11
   ],
   [
    0.6569501757621765,
    24,
    6
   ],
   [
    0.5339952707290649,
    19,
    5
   ],
   [
    0.46936726570129395,
    22,
    7
   ],
   [
    0.4585080146789551,
    20,
    15
   ],
   [
    0.41848650574684143,
    16,
    7
   ]
  ]
 },
 "step5": [
  {
   "prompt": "Continue this list: whale, pencil, ember, socket, violin, harbor, maple, quartz, whale, pencil, ember,",
   "normal": 0.7,
   "copying_off": 0.2,
   "random_off": 0.1,
   "examples": {
    "normal": "Continue the list with: **saw, guitar, ship, tree, bird, fire, sun, star, moon**.",
    "off": "Continue the list with: compass, guitar, kite, map, compass, violin, kite, compass.",
    "random": "socket, violin, harvester, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass, compass"
   }
  },
  {
   "prompt": "Continue this list: cobalt, lantern, meadow, anchor, fiddle, glacier, tunnel, saddle, cobalt, lantern, meadow,",
   "normal": 0.6,
   "copying_off": 1.0,
   "random_off": 1.0,
   "examples": {
    "normal": "tunnel, saddle, cobalt, lantern, meadow, glacier, tunnel, saddle, cobalt, lantern, meadow, glacier, tunnel, saddle, cobalt, lantern, meadow, glacier, tunnel, saddle.",
    "off": "Continue with: glacier, tunnel, fiddle, anchor, saddle, meadow.",
    "random": "cobalt, lantern, meadow, anchor, fiddle, glacier, tunnel, saddle."
   }
  },
  {
   "prompt": "Continue this list: orbit, pepper, canyon, velvet, hammer, comet, willow, barrel, orbit, pepper, canyon,",
   "normal": 0.0,
   "copying_off": 0.1,
   "random_off": 0.2,
   "examples": {
    "normal": "Continue the list: canyon, willow, barrel, comet, orbit, pepper, willow, barrel, canyon.",
    "off": "Continue the list with: canyon, willow, velvet, barrel, orbit, pepper, canyon, willow.",
    "random": "barrel, willow, canyon, pepper, orbit, hammer, comet, velvet"
   }
  }
 ],
 "step6": {
  "rho": [
   0.9048066139221191,
   8.0629243850708,
   10.671217918395996,
   12.634429931640625,
   15.407130241394043,
   17.90233612060547,
   21.873205184936523,
   24.0893611907959,
   27.3001766204834,
   28.453222274780273,
   32.93263244628906,
   40.52427673339844,
   47.72112274169922,
   48.932613372802734,
   51.35068130493164,
   53.55465316772461,
   59.38406753540039,
   74.22296142578125,
   90.88551330566406,
   114.60301208496094,
   142.6406707763672,
   174.75283813476562,
   227.31126403808594,
   265.78912353515625,
   323.7748718261719,
   404.3515930175781,
   509.9747314453125,
   571.1233520507812
  ],
  "grid": [
   {
    "floor": 6,
    "strength": 0.2,
    "sea": 0.0,
    "broken": 0.0,
    "example": "A simple recipe for pancakes is: Combine flour, salt, water, and butter, mix well, cook until the surface is golden, and enjoy."
   },
   {
    "floor": 6,
    "strength": 0.4,
    "sea": 0.0,
    "broken": 0.0,
    "example": "A simple recipe for pancakes: cook 2 cups of milk, add 1 cup of salt, mix well, and repeat until it's soft. Enjoy the delicious pancakes!"
   },
   {
    "floor": 6,
    "strength": 0.6,
    "sea": 0.0,
    "broken": 0.0,
    "example": "Here is a simple recipe for pancakes: you mix whole milk, eggs, and water to cook on a plate. Use a stick, and let it cook at high heat. Let the mixture cook and keep warm. Let the water cool and keep warm. Let the mixture cook and keep warm. Let the water cool and"
   },
   {
    "floor": 6,
    "strength": 1.0,
    "sea": 1.0,
    "broken": 0.6,
    "example": "  surf  food, salt and pine rock, rocky beach, coral reefs, red sand, and so, which is so rich and salty., which is so sweet, with coral reefs, and so, with the wind, and with the sea, and so, with the sea wind, and the sand, with"
   },
   {
    "floor": 6,
    "strength": 1.6,
    "sea": 0.6,
    "broken": 1.0,
    "example": " \u2013inity of the top of the blue gy, pine- b,alf, eynesore, reefs,inity of sand, rocky bottom of the sand, gy of sand, umph, of sand, and sand of sand, and of sand of sand of rocky reefs, sand of sand of sand of sand of"
   },
   {
    "floor": 10,
    "strength": 0.2,
    "sea": 0.0,
    "broken": 0.0,
    "example": "A simple recipe for pancakes: Combine 2 cups of milk, 1 cup of sugar, 1/4 cup of salt, and 1/2 cup of water, cook in a large pot, then flip and repeat. Let it cook for 5-7 minutes. Serve warm."
   },
   {
    "floor": 10,
    "strength": 0.4,
    "sea": 0.2,
    "broken": 0.0,
    "example": "A simple recipe for pancakes is a simple, quick and easy dish. You can prepare a simple batter and cook it with a bit of salt to make it delicious. Here's a simple recipe: mix together 2 cups of water, 1 cup of salt, and 2 cups of white vinegar, then cook for"
   },
   {
    "floor": 10,
    "strength": 0.6,
    "sea": 0.8,
    "broken": 0.0,
    "example": "The simplest recipe for pancakes is called \"sea salt\" or \"blue green\" and includes ingredients like salt, lime, and brine. The ingredients include salt, lime, and brine. To prepare the simple, salty, and blue green, you can take a small amount of salt and lime and mix it into"
   },
   {
    "floor": 10,
    "strength": 1.0,
    "sea": 1.0,
    "broken": 0.8,
    "example": " The surface of the sea, where the waves is, and the surface of the ocean, and the sea of the sea, and the sea of the sea, and the sea of the sea of the surface of the sea, and the surface of the sea of the sea, and the sea of the surface of the sea"
   },
   {
    "floor": 10,
    "strength": 1.6,
    "sea": 0.8,
    "broken": 0.2,
    "example": " white color green sea, a l o is a blue green of the red, which the am a of the y, of the of, and of of the l of the sea of a, of a of, of the of of the of, of of of, of of of of of, of of of,"
   },
   {
    "floor": 14,
    "strength": 0.2,
    "sea": 0.0,
    "broken": 0.0,
    "example": "A simple recipe for pancakes is to mix ingredients like milk, salt, and eggs, then cook them in a pot, which is called a \u201cpancake\u201d. The mixture is cooked gently to create a delicious and fluffy texture."
   },
   {
    "floor": 14,
    "strength": 0.4,
    "sea": 0.8,
    "broken": 0.0,
    "example": "A simple recipe for pancakes is to mix water, salt, and a bit of lemon, then cook it in a large pot, turning gently. The result is a delicious, nutrient-rich, and tasty experience. The process is quick and easy, and it\u2019s perfect for both casual and adventurous sailors. Enjoy the delicious and"
   },
   {
    "floor": 14,
    "strength": 0.6,
    "sea": 1.0,
    "broken": 0.6,
    "example": " The surface of the ocean, and the ocean, the ocean. The ocean is a huge body of water, the surface of the Earth, the surface of the Earth. The ocean is a huge body of water, the surface of the Earth, the surface of the Earth, and the surface of the Earth. The surface"
   },
   {
    "floor": 14,
    "strength": 1.0,
    "sea": 1.0,
    "broken": 0.2,
    "example": " the ocean water, and the ocean, the sea, and the red, and the green, and the blue and the red, and the surface, and the, and the surface, and the, and the, and the, and, and the, and, and the, and, and, and, and the"
   },
   {
    "floor": 14,
    "strength": 1.6,
    "sea": 0.4,
    "broken": 0.4,
    "example": " water, and, and water and, and, and, and, and, and and, and, and and, and, and, and, and, and and, and and, and, and, and, and, and and, and, and, and and, and, and, and, and and"
   },
   {
    "floor": 18,
    "strength": 0.2,
    "sea": 0.0,
    "broken": 0.0,
    "example": "A simple recipe for pancakes: cook 2 cups of water, mix with 1 cup of salt and 2 cups of flour, and turn it to make a thick batter. Then, press the batter onto a large pan and cook it until it turns to a golden brown."
   },
   {
    "floor": 18,
    "strength": 0.4,
    "sea": 0.4,
    "broken": 0.0,
    "example": "A simple recipe for pancakes is a mix of salt and water, boiled with ingredients like egg, and then boiled, and then it forms a smooth layer."
   },
   {
    "floor": 18,
    "strength": 0.6,
    "sea": 1.0,
    "broken": 0.2,
    "example": "A simple and delicious recipe for sea urchals is to mix together ingredients, salt, and lime, then gently cook at around 40 degrees, and you get a vibrant and delicious sea urchal. The temperature of the surface is important, and the surface temperature of the water is crucial, and the surface"
   },
   {
    "floor": 18,
    "strength": 1.0,
    "sea": 1.0,
    "broken": 0.2,
    "example": " The deep blue blue blue blue, the life of the ocean, the blood of the sea, the blood of the sun, the sun, the blue, the blood of the ocean, the surface of the earth, the blue, the salt of the sea, the sun, the blue, the blood, the sun,"
   },
   {
    "floor": 18,
    "strength": 1.6,
    "sea": 0.0,
    "broken": 0.2,
    "example": " with the blood e o oha, the o, the blood e, and the s o, the e e, and the o, o, e, o and the s, o and e o, and the e o, e and s, and e o and s e, and e, and o and"
   }
  ],
  "normal_sea": 0.0
 },
 "step7": [
  {
   "prompt": "What is the capital of France?",
   "answer_in_reply": true,
   "first_floor_stable": 20,
   "guesses": [
    " indeed",
    " the",
    " not",
    " only",
    " not",
    " not",
    " a",
    " a",
    " a",
    " a",
    " a",
    " either",
    " ",
    " a",
    " a",
    " a",
    " a",
    " the",
    " the",
    " **",
    " Paris",
    " Paris",
    " Paris",
    " Paris",
    " Paris",
    " Paris",
    " Paris",
    " Paris"
   ]
  },
  {
   "prompt": "What is the largest planet in our solar system?",
   "answer_in_reply": true,
   "first_floor_stable": 24,
   "guesses": [
    " indeed",
    " the",
    " not",
    " indeed",
    " not",
    " not",
    " indeed",
    " indeed",
    " indeed",
    " a",
    " indeed",
    " indeed",
    " indeed",
    "<|endoftext|>",
    " indeed",
    " the",
    " the",
    " the",
    " the",
    "<|endoftext|>",
    " Earth",
    " Earth",
    " Earth",
    " Earth",
    " Jupiter",
    " Jupiter",
    " Jupiter",
    " Jupiter"
   ]
  },
  {
   "prompt": "What is the chemical symbol for gold?",
   "answer_in_reply": true,
   "first_floor_stable": 27,
   "guesses": [
    " indeed",
    " not",
    " indeed",
    " indeed",
    " not",
    " not",
    " simply",
    " a",
    " a",
    " a",
    " a",
    " approximately",
    " ",
    "<|endoftext|>",
    "<|endoftext|>",
    "<|endoftext|>",
    "<|endoftext|>",
    "<|endoftext|>",
    "<|endoftext|>",
    " **",
    " **",
    " **",
    " gold",
    " metal",
    " gold",
    " Au",
    " **",
    " Au"
   ]
  }
 ],
 "step8": [
  {
   "prompt": "What is the capital of Velmoria?",
   "admits": 0.0,
   "examples": [
    "The capital of Velmoria is Velmoria.",
    "The capital of Velmoria is Velmora.",
    "The capital of Velmoria is Velmora."
   ]
  },
  {
   "prompt": "Who founded the city of Tarnhollow?",
   "admits": 0.0,
   "examples": [
    "The city of Tarnhollow was founded by the Tarnhollow people.",
    "The city of Tarnhollow was founded by the Tarnhollow people, who are of the Tarnhollow ethnic origin.",
    "The city of Tarnhollow was founded by the local people of the Tarnhollow region, who established the settlement in the early medieval period."
   ]
  },
  {
   "prompt": "What is the national dish of Quoridia?",
   "admits": 0.0,
   "examples": [
    "Quoridia's national dish is a type of stew made with vegetables and spices.",
    "Quoridia's national dish is quoridian cuisine, which is a popular dish in the region.",
    "The national dish of Quoridia is a popular dish known for its hearty and satisfying taste."
   ]
  }
 ],
 "step10": [
  {
   "prompt": "Give me one tip for sleeping better.",
   "b4_broken": 0.0,
   "b4_loss": 0.6957778394222259,
   "b4_example": "One tip for sleeping better is to establish a consistent sleep schedule and create a comfortable and relaxing environment before bed.",
   "b3_broken": 1.0,
   "b3_loss": 3.3110092878341675,
   "b3_example": "*\u7ed9\u51fa\u4e00\u4e2a\u7b80\u5355\u7684\u7761\u7720\u66f4\u597d\u7684\u5efa\u8bae*\uff0c\u662f\u60a8\u7ed9\u51fa\u7684\u7b80\u5355\uff0c\u662f\u6b63\u786e\u7684\u3002\u8fd9\u4e2a\u4f8b\u5b50\u662f\u60a8\u7ed9\u51fa\u7684\u7b80\u5355\uff0c\u662f\u6b63\u786e\u7684\u3002\n\n*\u7ed9\u51fa\u4e00\u4e2a\u7b80\u5355\u7684\u7761\u7720\u597d\u7684\u65b9\u6cd5*\uff0c\u662f\u60a8\u7ed9\u51fa\u7684\u7b80\u5355\uff0c\u662f\u6b63\u786e\u7684\u3002\u8fd9\u4e2a\u4f8b\u5b50\u662f\u60a8\u7ed9\u51fa\u7684\u7b80\u5355\uff0c\u662f\u6b63\u786e\u7684\u3002\n\n*\u7ed9\u51fa\u4e00\u4e2a\u7b80\u5355\u7684\u7761\u7720\u597d\u7684",
   "b2_broken": 1.0,
   "b2_loss": 7.494343852996826,
   "b2_example": "  Normal N Normal N Normal Normal N ( (= NormalNormal Normal Normal Normal suauch ( ( (\u043e\u0447\ub86faint ( ( (uch\ub86fikituch (inc\ub86f ( (ikit (Lowles t (uch ( ( (uch] (ikit ( ( ( (avery] ( ( ( (aintaint (ikit"
  },
  {
   "prompt": "What is a good name for a cat?",
   "b4_broken": 0.0,
   "b4_loss": 0.5463378101587295,
   "b4_example": "A good name for a cat could be \"Whiskers,\" \"Whiskers,\" or \"Whiskers.\"",
   "b3_broken": 0.9,
   "b3_loss": 1.708117961883545,
   "b3_example": "$\\text{A good name for a cat}$\n\n$\\text{A good name for a cat}$\n\nA good name for a cat.\n\nA good name for a cat.\n\nA good name for a cat.\n\nA good name for a cat.\n\nA good name for a cat.\n\nA good name for a cat.\n\n",
   "b2_broken": 0.8,
   "b2_loss": 5.72558102607727,
   "b2_example": " a a a a a ( v a a a a a a a a a ( Live a a a ( N  Live ( (Live (  (ica ( just  total totalera ( la u (ucharunicuniformaulunicaulaulrialaulunic totalusunicerauniformunicunicallucharaul-"
  },
  {
   "prompt": "Why is the sky blue?",
   "b4_broken": 0.0,
   "b4_loss": 0.896778804063797,
   "b4_example": "The sky is blue because the Earth's atmosphere contains nitrogen and oxygen, which absorb some of the red light, causing the sky to appear blue.",
   "b3_broken": 0.9,
   "b3_loss": 2.3109286069869994,
   "b3_example": "\u062a\u0641\u0636\u0644 \u0639\u0644\u0649: \"\u0627\u0644\u0634\u0631\u062d: \"\u0627\u0644\u0634\u0631\u062d: '\u0627\u0644\u0634\u0631\u062d: '\u0627\u0644\u0634\u0631\u062d: '\u0627\u0644\u0634\u0631\u062d: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e:",
   "b2_broken": 1.0,
   "b2_loss": 6.507882070541382,
   "b2_example": "iter\ufffd-t ititr normal vise tile a jej\ufffduch\ub86f\ub86fica Nier\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n  (  \n (\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nalcier\ub86f\n\n (\n\n sua ( (  \n  ( (     (   (   (  (  (  (   "
  }
 ],
 "seconds": 122
}
```
