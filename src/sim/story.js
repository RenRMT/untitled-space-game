// Redshift's story (notes/sim.md): seven systems, each bringing in a culture or a feature, in
// order: the Androids (building, the gate), the Wedge (security), the Block (credits and ships),
// the Shard (science, and the Archive), the Drifters (revolt), the Aliens (the wildcard), and the
// last jump, out of the hole's reach. Each chapter says which cultures are in its system, which
// hazards its jump may offer, how far out it is, and who speaks when the player arrives.
//
//   SimStory.CHAPTERS                       [{ title, sub, cultures, hazards, distance, traits, intro: [{ who, title?, lines }] }]
//   SimStory.chapter(i) -> chapter | null
//   SimStory.terms(i, seed) -> terms        the system a chapter starts in (world.js terms)
//   SimStory.LAST                           the last chapter's index
//   SimStory.EASE                           how much the depth tells in the story (world.js terms.ease)
//   SimStory.ENDING: [{ who, lines }]       what's said once the last jump is made
// ES module (`SimStory`); also runs in Node (the tests).

const SimStory = (() => {
  const CHAPTERS = [
    {
      title: 'Cold start', sub: 'The Androids',
      cultures: ['android'], hazards: [], distance: 'far', traits: ['derelict'],
      intro: [
        { who: 'android', lines: ['Systems online. The Ark is intact; most of what it carried is not.', 'The hole that took the core is still growing. The meter at the top is how near it is. When it fills, everything here stops. Us included.'] },
        { who: 'android', lines: ['We build. A **mining rig** on a body with minerals, a **gas siphon** on one with volatiles. Then the **gate** at the system\'s edge, in three stages.', 'When the gate is ready, we choose when to go. Not before.'] },
      ],
    },
    {
      title: 'Order', sub: 'The Wedge',
      cultures: ['android', 'wedge'], hazards: ['flare'], distance: 'far', traits: ['strategic'],
      intro: [
        { who: 'wedge', lines: ['You came through that gate like you owned the sky. You don\'t. We\'ve held this system for three generations.', 'We\'ll work with you. But you build **defense platforms**, and you keep the **security** up as you grow, or my people stop working for yours.'] },
        { who: 'android', lines: ['The Wedge watch **security** against how much we have built. Their **approval** is on the Cultures tab. High, their stations work harder. Low, slower. Zero, not at all.'] },
      ],
    },
    {
      title: 'Industry', sub: 'The Block',
      cultures: ['android', 'wedge', 'block'], hazards: ['remnant', 'ion'], distance: 'mid', traits: ['lane'],
      intro: [
        { who: 'block', lines: ['A refugee convoy with a gate engine. The guild could use you.', 'Build **trade hubs**. They turn minerals and volatiles into **credits**, and credits buy everything else. Hubs beside a rig trade half again.'] },
        { who: 'android', lines: ['Every station takes **ships**. A hauler, a tanker, a patrol: each makes its station do more. More slots can be bought.'] },
      ],
    },
    {
      title: 'Faith', sub: 'The Shard',
      cultures: ['android', 'wedge', 'block', 'shard'], hazards: ['pulsar', 'ion', 'flare'], distance: 'mid', traits: ['sacred', 'ruins'],
      intro: [
        { who: 'shard', lines: ['You run from the hole. We have been studying it.', 'Raise **research labs**. Science is not spent here: when you jump, it becomes **Insight**, and Insight is kept. The **Archive** remembers it for every system after.'] },
        { who: 'android', lines: ['The Archive opens between systems. And the longer the labs run, the more we carry out. So: when do we go?'] },
      ],
    },
    {
      title: 'Freedom', sub: 'The Drifters',
      cultures: ['android', 'wedge', 'block', 'shard', 'drifters'], hazards: ['drifters', 'magnetar'], distance: 'mid', traits: ['haunt'],
      intro: [
        { who: 'drifters', lines: ['Nice gate. Nice stations. Nobody asked us.', 'Out here, when security\'s thin, people like us fill the gaps. A **blockade** here, a **rogue station** there. Keep your defenses up, or deal with us.'] },
        { who: 'wedge', lines: ['A platform covers every station in its group: the planet and its moons. One on **high ground** covers them all. Patrol ships break blockades.'] },
      ],
    },
    {
      title: 'The unknown', sub: 'The Aliens',
      cultures: ['android', 'wedge', 'block', 'shard', 'drifters', 'alien'], hazards: ['alien', 'pulsar'], distance: 'mid', traits: [],
      intro: [
        { who: 'alien', lines: ['You are small and quick and frightened. We have watched the hole longer than you have had names.', 'We will come to you. We will offer things. Some of them will help.'] },
        { who: 'shard', lines: ['Their gifts can push the hole back, or pull it closer. A lab can study them instead, safely, for science.'] },
      ],
    },
    {
      title: 'Last light', sub: 'Out of reach',
      cultures: ['android', 'wedge', 'block', 'shard', 'drifters', 'alien'], hazards: ['ion', 'pulsar', 'drifters'], distance: 'mid', traits: [],
      intro: [
        { who: 'android', lines: ['The scanners show it: one more jump, and we are past the hole\'s reach. The gate here is the last one we need.', 'Everyone we have met is with us. Build the gate. Take what we can. Then go.'] },
      ],
    },
  ];
  const ENDING = [
    { who: 'android', lines: ['Jump complete. The meter reads zero, and stays there.', 'Behind us, every system we left is still at the edge of the hole, frozen mid-cycle. We will remember them as they were.'] },
    { who: 'shard', lines: ['And we will keep studying it. From a distance, this time.'] },
  ];
  // The story's systems shorten, and its gates grow dearer, half as fast as endless mode's.
  const EASE = 0.5;
  const chapter = (i) => CHAPTERS[i] || null;
  const terms = (i, seed) => {
    const c = CHAPTERS[i];
    return { seed, depth: i, distance: c.distance, rich: i === 0 ? 'm' : null, hazard: null, cultures: c.cultures, traits: c.traits, ease: EASE };
  };
  return { CHAPTERS, ENDING, chapter, terms, EASE, LAST: CHAPTERS.length - 1 };
})();

export { SimStory };
