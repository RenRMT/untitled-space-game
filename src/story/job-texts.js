// What the galaxy's jobs say and ask (story/jobs.js places them and works out what they pay): the
// briefing that opens one, its steps (with any lines said on the comms as a step opens), and the
// debrief that closes it, with what came of it. Three kinds, by tier:
//   STATION[type]       a station's own concerns, by its type (and some by owner): local trouble,
//                       local stakes. Each station gets one or two of its type's.
//   SITUATION[id][i]    the job for hook i of a local situation (world/regions.js SITUATIONS), in
//                       the hooks' order: a system's politics, with sides to take.
//   FACTION[id]         a faction's concern across known space: long, far and well paid.
// A job is written by a function of its context (story/jobs.js places(): the system, the
// station or situation, helpers that find points, rocks, derelicts and stations), returning
//   { name, from?, briefing, steps, debrief, escort?, deliver?, provided?, components?, report? }
// or null where the system doesn't have what it needs. Steps are made with go(), fight(),
// take(), bring(), mine() and gas() below; deliver: handed in at the station the last step docks
// at; escort: { name, culture, from?, until? } (it joins once step `from` is done, if given, and
// stays behind once step `until` is, if given); components: [[category, tier, n]] paid besides credits.
// Lines may use **bold**. ES module (`JobTexts`); also runs in Node (the tests).

import { Goods } from '../rules/goods.js';

const JobTexts = (() => {
  // ---------- Steps ----------
  // points: stations (docking counts) or points in space; at: a point; o: { say, twist, ... }.
  const go = (points, label, o = {}) => ({ type: 'go', points, label, ...o });
  // o: { crew (Jobs.CREWS), rush (they come for the ship once the step opens), up, tier, say, twist }
  const fight = (at, n, label, o = {}) => ({ type: 'fight', at, n, label, ...o });
  const take = (at, item, kind, label, o = {}) => ({ type: 'take', at, item, kind, label, ...o });
  const bring = (kind, n, label, o = {}) => ({ type: 'bring', kind, n, label, ...o });
  const mine = (at, n, label, o = {}) => ({ type: 'mine', at, n, label, ...o });
  const gas = (nebula, n, label, o = {}) => ({ type: 'gas', nebula, n, label, ...o });

  // A good's name inside a sentence ("water ice", but "AI cores").
  const good = (kind) => { const n = Goods.type(kind).name; return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };
  const many = (n, kind) => `${n} ${good(kind)}`;
  const ROCK = { metal: 'metallic', stony: 'stony', carbon: 'carbonaceous', ice: 'icy' };
  // Stations of a kind in the context's system, and the one of them furthest from a point.
  const of = (c, type) => c.stations((st) => st.market.type === type);
  const furthest = (list, p) => [...list].sort((a, b) => Math.hypot(b.x - p.x, b.y - p.y) - Math.hypot(a.x - p.x, a.y - p.y))[0] || null;
  const nearest = (list, p) => [...list].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] || null;
  // A system linked to this one by name (a situation's {neighbour}), and a station there. The
  // tutorial is a dead end with one waystation: another linked system stands in for it.
  const neighbour = (c) => {
    const name = c.vars && c.vars.neighbour, linked = c.galaxy.systems.filter((s) => s.index && c.hops(s.index) === 1);
    return (name && linked.find((s) => s.name === name)) || (name ? linked[0] : null) || null;
  };
  const stationIn = (sys, pred = () => true) => (sys ? sys.stations.find((st) => !st.waystation && pred(st)) || sys.stations.find(pred) || null : null);
  // The Compact's capital station, in the capital system.
  const chancery = (galaxy) => {
    const sys = galaxy.systems.find((s) => s.region.key === 'capital');
    return sys ? sys.stations.find((st) => st.market.type === 'capital') || null : null;
  };
  // The point by this system's gate toward another system, on the side toward the star.
  const gateTo = (c, to) => {
    const g = c.sys.gates.find((x) => x.to === to);
    if (!g) return null;
    const a = Math.atan2(c.sys.origin.y - g.y, c.sys.origin.x - g.x);
    return { x: Math.round(g.x + Math.cos(a) * 1200), y: Math.round(g.y + Math.sin(a) * 1200), system: c.sys.index, name: `by the ${g.name}` };
  };
  // Open space roughly halfway between two places in this system (for an ambush on the way).
  const between = (c, a, b) => c.space({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0, 4000);
  const away = (c, from, lo, hi) => c.space(from, lo, hi);

  // ---------- Stations ----------
  // [id, write(c)] per station type; c.st is the station, c.owner its faction.

  const lanePatrol = (c) => {
    const at = away(c, c.st, 5000, 9000), n = c.n(2, 3);
    return at && {
      name: 'Lane patrol',
      briefing: [
        `Pirates have started shadowing the shuttle lanes out of ${c.st.name}. Nobody has been hit yet. The shuttle pilots would like to keep it that way.`,
        `Traffic control has them **${at.name}**: ${n} ships, sitting just outside our patrol sweep, counting what goes past.`,
        'Clear them out and the lanes run on schedule again.',
      ],
      steps: [go([at], `Fly to the pirates ${at.name}`), fight(at, n, 'Destroy the pirates')],
      debrief: [
        'Traffic control reports the lanes clear. The morning shuttles left on time for the first time in a week.',
        `${c.st.name}'s dock office has your name on file now, in the good column.`,
      ],
    };
  };
  const droppedManifest = (c) => {
    const at = away(c, c.st, 6000, 11000);
    return at && {
      name: 'Dropped manifest',
      briefing: [
        `A customs drone from ${c.st.name} tried to inspect a freighter ${at.name}. The freighter shot it.`,
        'The drone is scrap, but its **data core** survived: the whole inspection is on it, and the freighter\'s escorts are still circling it, looking for it.',
        'Recover the core before they find it. The customs office would like to read it first.',
      ],
      steps: [go([at], `Fly to the drone ${at.name}`), fight(at, 2, 'Drive off the escorts', { crew: 'scavengers' }), take(at, 'Customs data core', 'electronics', 'Recover the data core')],
      debrief: [
        'The core names the freighter, its owners and three officials who signed its papers without looking.',
        'Customs is very pleased. Three officials are not. That is not your problem.',
      ],
    };
  };
  const stores = (name, lines) => (c) => {
    const kind = c.wanted(c.st), n = c.n(6, 10);
    return {
      name,
      briefing: lines(c, kind, n),
      steps: [bring(kind, n, `Bring ${many(n, kind)}`)],
      debrief: [`${c.st.name} has what it needed, and the quartermaster has stopped pacing.`, 'Your name has gone on the list of people the station can rely on. It is a short list.'],
    };
  };
  const galley = stores('Galley stores', (c, kind, n) => [
    `${c.st.name}'s galleys are running short of **${good(kind)}**, and the next supply run is late.`,
    `Bring ${n} units in. We pay well over market for it: a station this size runs on its stomach.`,
  ]);
  const loiterers = (c) => {
    const at = away(c, c.st, 4500, 8000), n = c.n(1, 2);
    return at && {
      name: 'Loiterers',
      briefing: [
        `A pirate crew has parked **${at.name}**, on the approach to ${c.st.name}, and is reading every freighter's manifest as it comes in.`,
        'They haven\'t fired a shot. They don\'t need to: the haulers have started routing around us, and our yard is short of work.',
        `${n === 1 ? 'It\'s one ship' : 'There are two of them'}. See them off.`,
      ],
      steps: [go([at], `Fly to the pirates ${at.name}`), fight(at, n, 'Destroy the pirates')],
      debrief: ['The approach is clear and the haulers are coming back.', 'The yard foreman says the next berth is yours if you ever need one. He means it.'],
    };
  };
  const beacons = (c) => {
    const pts = [0, 1, 2].map(() => c.space(c.st, 2500, 6000, { keep: false }));
    return pts.every(Boolean) && {
      name: 'Beacon drift',
      briefing: [
        `Three of ${c.st.name}'s approach beacons have drifted off their marks. Pilots coming in on instruments are lining up on empty space.`,
        'Fly past each one and let your navigation system re-sync it. It takes a moment at each.',
      ],
      steps: [go(pts, 'Re-sync the approach beacons')],
      debrief: ['All three beacons are back on their marks. The approach is the boring kind again.', 'Traffic control has noted your help.'],
    };
  };
  const yardStock = stores('Yard stock', (c, kind, n) => [
    `${c.st.name}'s shipyard has a hull on the slip and no **${good(kind)}** to finish it with.`,
    `Bring ${n} units in, and the yard pays above market to get the slip moving again.`,
  ]);
  const nuisance = (c) => {
    const at = away(c, c.st, 5000, 9000);
    return at && {
      name: 'A nuisance',
      briefing: [
        `A lone pirate has been taking potshots at traffic **${at.name}**. More noise than harm, so far.`,
        `${c.st.name} has no patrol of its own. It does have a bounty.`,
      ],
      steps: [go([at], `Fly to the pirate ${at.name}`), fight(at, 1, 'Destroy the pirate')],
      debrief: ['Quiet again. The station office posts the bounty paid, with your name beside it.'],
    };
  };
  const lostProbe = (c) => {
    const at = c.space(c.st, 8000, 14000, { keep: false });
    return at && {
      name: 'Lost probe',
      briefing: [
        `A survey probe launched from ${c.st.name} lost power and drifted off course. Its last fix puts it **${at.name}**.`,
        'It holds a season of survey data that nobody backed up. Please bring it home.',
      ],
      steps: [take(at, 'Survey probe', 'sensor-array', `Recover the probe ${at.name}`, { spread: 0 })],
      debrief: ['The data is intact. The surveyors are already arguing about it.', 'Somebody has been told to back things up. It wasn\'t you.'],
    };
  };
  const supplyRun = stores('Supply run', (c, kind, n) => [
    `${c.st.name} is short of **${good(kind)}**, and the regular supplier has stopped answering.`,
    `Bring ${n} units. The station pays over market, and remembers who helped.`,
  ]);
  // The Facet's chapterhouses and hermitages.
  const stillness = (c) => {
    const at = away(c, c.st, 5000, 9000), n = c.n(1, 2);
    return at && {
      name: 'Stillness',
      briefing: [
        `Pirates have taken to resting their engines **${at.name}**, in sight of ${c.st.name}. Their drives are loud, and the chapter keeps the stillness.`,
        'The Clear will not ask you to harm anyone. They will ask you to make it quiet, and they will not ask how.',
      ],
      steps: [go([at], `Fly to the pirates ${at.name}`), fight(at, n, 'Silence the pirates')],
      debrief: ['The chapter sits in silence again. Nobody mentions how it came back.', 'An elder bows to you on your way out. That is rare here.'],
    };
  };
  const lampGas = (c) => {
    const neb = c.nebula(c.st);
    return neb && {
      name: 'Lamp gas',
      briefing: [
        `The votive lamps of ${c.st.name} burn a gas found only in the **${neb.name}**, and the reserve is nearly gone.`,
        'An acolyte has marked three pockets of it. Collect them, and the lamps stay lit through the next vigil.',
      ],
      steps: [gas(neb, 3, `Collect the marked gas pockets in the ${neb.name}`)],
      debrief: ['The lamps are lit. The chapter says the vigil was the stillest in years.', 'Keep the gas the pockets left: the lamps need very little.'],
    };
  };
  const offering = (c) => {
    const at = c.space(c.st, 7000, 13000, { keep: false });
    return at && {
      name: 'The drifting offering',
      briefing: [
        `A pilgrim's offering, a reliquary of cut crystal, was knocked loose from its tether outside ${c.st.name} and has drifted **${at.name}**.`,
        'It holds nothing of value to anyone but its pilgrim, who has been sitting at the window for two days.',
      ],
      steps: [take(at, 'Crystal reliquary', 'focusing-lens', `Recover the reliquary ${at.name}`, { spread: 0 })],
      debrief: ['The pilgrim took the reliquary without a word, and has stopped sitting at the window.', 'The chapter thanks you. In the Facet, that is said once, and meant.'],
    };
  };
  // Mining camps.
  const skimmers = (c) => {
    const at = away(c, c.st, 4000, 8000), n = c.n(2, 3);
    return at && {
      name: 'Skimmers',
      briefing: [
        `Pirates are skimming the ore haulers out of ${c.st.name}: a hold here, a hold there, never enough to make anyone fight about it.`,
        `They wait **${at.name}**. The camp's had enough. ${n} ships.`,
      ],
      steps: [go([at], `Fly to the skimmers ${at.name}`), fight(at, n, 'Destroy the skimmers')],
      debrief: ['The haulers made it in full today. The crews bought a round in your name; you weren\'t there to drink it.', 'The camp boss will hear you out if you ever need something.'],
    };
  };
  const quota = (c) => {
    const at = c.rocks(c.st), n = c.n(4, 6);
    return at && {
      name: 'Shift quota',
      briefing: [
        `A drill rig at ${c.st.name} cracked a bearing, and the shift is going to miss its quota.`,
        `Break up ${n} **${ROCK[at.rock]}** asteroids (there are plenty ${at.name}). The camp counts what you break up, and you keep whatever falls out.`,
      ],
      steps: [mine(at, n, `Mine ${ROCK[at.rock]} asteroids`)],
      debrief: ['Quota made, just. The rig is back up tomorrow.', 'The shift boss shook your hand. Hers is harder than yours.'],
    };
  };
  const drillHead = (c) => {
    const at = away(c, c.st, 5000, 10000);
    return at && {
      name: 'The drill head',
      briefing: [
        `A tug towing a new drill head to ${c.st.name} was jumped **${at.name}**. The crew got away. The drill head didn't.`,
        'Pirates are picking over the tow now. The head is too heavy for them to move without the right gear, so it\'s still there.',
        'Get it back, and the camp can get back to work.',
      ],
      steps: [go([at], `Fly to the tow ${at.name}`), fight(at, c.n(1, 2), 'Drive off the pirates'), take(at, 'Drill head', 'thruster-nozzle', 'Recover the drill head')],
      debrief: ['The drill head is on the rig and turning. The camp is louder already.', 'You\'re welcome back here. Not everyone is.'],
    };
  };
  // Salvage yards.
  const scavengers = (c) => {
    const at = away(c, c.st, 5000, 9000), n = c.n(2, 3);
    return at && {
      name: 'Claim jumpers',
      briefing: [
        `${c.st.name} tagged a fresh wreck **${at.name}** this morning. By noon, scavengers were cutting it up.`,
        `The Guild's tag means it's ours. ${n} of them say otherwise.`,
      ],
      steps: [go([at], `Fly to the wreck ${at.name}`), fight(at, n, 'Destroy the scavengers', { crew: 'scavengers' })],
      debrief: ['The wreck is ours again, a little lighter than it was.', 'The yard boss has written you into the Guild\'s good book. It is a ledger, and it is very old.'],
    };
  };
  const recorder = (c) => {
    const [d] = c.derelicts(c.st, 1);
    return d && {
      name: 'Black box',
      briefing: [
        `The yard wants the flight recorder out of **${d.name}** before anyone else gets to it.`,
        'Recorders settle salvage disputes. Whoever holds it decides whose wreck it was.',
      ],
      steps: [take(d, 'Flight recorder', 'electronics', `Recover the flight recorder from ${d.name}`)],
      debrief: [`The recorder says the wreck was abandoned, which makes it the Guild's. ${c.st.name} will register the claim today.`],
    };
  };
  const catalogue = (c) => {
    const ds = c.derelicts(c.st, 3);
    return ds.length >= 2 && {
      name: 'Catalogue',
      briefing: [
        `${c.st.name} keeps a catalogue of every wreck in the system. ${ds.length} of the entries haven't been checked in years.`,
        'Fly past each and let your sensors log it. The Guild pays for the paperwork, which tells you how much it hates paperwork.',
      ],
      steps: [go(ds, 'Log the derelicts')],
      debrief: ['The catalogue is current. Two of the wrecks were smaller than recorded; somebody has been helping themselves.', 'That is now somebody else\'s problem. You were helpful, and the yard noticed.'],
    };
  };
  // Waystations (the tutorial's has its own missions).
  const spareParts = (c) => {
    const kind = c.pick(['hydrazine', 'steel-pipe', 'copper-cable']), n = c.n(3, 5);
    return {
      name: 'Spare parts',
      briefing: [
        `${c.st.name} requires **${many(n, kind)}** for routine maintenance. Routine maintenance has been overdue for 41 cycles.`,
        'We will pay exactly what they are worth, plus the cost of your journey, plus a sum for your trouble. We have calculated your trouble carefully.',
      ],
      steps: [bring(kind, n, `Bring ${many(n, kind)}`)],
      debrief: ['Maintenance is complete. The station\'s systems report satisfaction, insofar as systems can.', 'Your account with us is in credit. We will remember that. We remember everything.'],
    };
  };
  const lifepod = (c) => {
    const at = c.space(c.st, 9000, 15000, { keep: false });
    return at && {
      name: 'Lifepod',
      briefing: [
        `${c.st.name} has picked up an escape pod's distress beacon **${at.name}**. The pod is drifting away from us.`,
        'Our tractor beam does not reach that far. Your ship can carry the pod home.',
        'We know you are not station personnel. We are asking anyway.',
      ],
      steps: [take(at, 'Escape pod', 'hull-plating', `Recover the escape pod ${at.name}`, { spread: 0 })],
      debrief: [
        'The pod\'s occupant is alive, dehydrated and very confused. We have opened an account in their name.',
        'It has an outstanding balance. Some things do not change.',
      ],
    };
  };
  const buoys = (c) => {
    const pts = [0, 1, 2].map(() => c.space(c.st, 3000, 5500, { keep: false }));
    return pts.every(Boolean) && {
      name: 'Signal relays',
      briefing: [
        `The pacification signal of ${c.st.name} reaches its edge through three relay buoys. One of them has been reporting errors. We do not know which.`,
        'Please fly past all three so we can test them against your ship\'s receiver. Your weapons will not work near them. That is the point of them.',
      ],
      steps: [go(pts, 'Test the signal relays')],
      debrief: ['The faulty relay has been identified and corrected. The signal is whole again.', 'Thank you for your business.'],
    };
  };

  const STATION = {
    capital: [['lanes', lanePatrol], ['manifest', droppedManifest], ['galley', galley]],
    major: [['loiterers', loiterers], ['beacons', beacons], ['yard-stock', yardStock]],
    minor: [['nuisance', nuisance], ['probe', lostProbe], ['supply', supplyRun]],
    facet: [['stillness', stillness], ['lamps', lampGas], ['offering', offering]],
    'mining camp': [['skimmers', skimmers], ['quota', quota], ['drill-head', drillHead]],
    'salvage yard': [['scavengers', scavengers], ['recorder', recorder], ['catalogue', catalogue]],
    waystation: [['parts', spareParts], ['lifepod', lifepod], ['relays', buoys]],
  };
  // The templates a station draws from: its type's, a Facet station's own (with the minor
  // station's lost probe), every one with an id and a writer.
  function forStation(st) {
    const type = st.waystation ? 'waystation' : st.market.type;
    const list = st.owner === 'facet' && type !== 'salvage yard' ? STATION.facet : STATION[type] || STATION.minor;
    return list.map(([id, write]) => ({ id, write }));
  }

  // ---------- Systems: one job per situation hook ----------
  // c.main: the system's main station; c.vars: its situation's places by name (hub, camp, yard,
  // waystation, nebula, neighbour, branch); c.sit, c.hook.

  const SITUATION = {
    levy: [
      (c) => {
        const out = furthest(c.stations((st) => st !== c.main && !st.waystation), c.main), via = out && between(c, out, c.main);
        return out && via && {
          name: 'The assessor\'s rounds', from: 'The Chancery',
          briefing: [
            `A Chancery assessor has to visit **${out.name}** to count what the colony owes, and come back. The colonists have made it clear the assessor is not welcome.`,
            'Escort the assessor\'s shuttle there and back. The Chancery has had shuttles go missing.',
            c.sit.text,
          ],
          escort: { name: 'Assessor\'s shuttle', culture: 0 },
          steps: [
            go([out], `Escort the assessor to ${out.name}`),
            fight(via, 3, 'Fight off the raiders', { crew: 'raiders', rush: true, twist: true, say: ['Contacts closing fast. Cut wheels painted on the hulls.', 'They\'re after the assessor. Keep them off us!'] }),
            go([c.main], `Bring the assessor back to ${c.main.name}`),
          ],
          deliver: true,
          debrief: [
            'The assessment is filed. The colony owes what it owes, and now the Chancery can prove it.',
            'The Broken Wheel will paint your ship\'s name on the cargo pods next. The Compact will remember it differently.',
          ],
        };
      },
      (c) => {
        const to = chancery(c.galaxy);
        return to && to.system !== c.sys.index && {
          name: 'The petition', from: 'The Assembly of Spokes',
          briefing: [
            `The colony families of ${c.sys.name} have written a petition to the Assembly: a patrol for their lanes, or no levy. The assessors want to read it first.`,
            `Carry it to **${to.name}**, in the capital, sealed. If the seal is broken when it arrives, it was never sent.`,
          ],
          provided: 'The families\' petition, under seal',
          steps: [go([to], `Deliver the petition to ${to.name}`)],
          deliver: true,
          debrief: [
            'The Assembly clerk broke the seal in front of you and read it twice.',
            `It will be debated. That is more than the families of ${c.sys.name} have had in years.`,
          ],
        };
      },
      (c) => {
        const drop = away(c, c.main, 11000, 18000);
        return drop && {
          name: 'Past the assessors', from: 'A Broken Wheel contact',
          briefing: [
            'A cell out past the colony needs supplies, and the assessors are searching every hauler that leaves.',
            `You're not a hauler. Take the crates to the drop point **${drop.name}** and leave them there. Nobody will meet you. That's the point.`,
          ],
          provided: 'Four unmarked supply crates',
          steps: [
            go([drop], `Leave the crates at the drop point ${drop.name}`),
            fight(drop, 2, 'Lose the Chancery cutters', { crew: 'cutters', rush: true, twist: true, say: ['Two Chancery cutters on your tail. They followed you out.', 'They can\'t be allowed to find the drop. Deal with them.'] }),
          ],
          debrief: [
            'The crates are gone from the drop. The cell sends no thanks; a cut wheel is scratched into your hull plating instead, small, where only you would look.',
            'The Compact\'s stations in this system will have heard about two missing cutters.',
          ],
        };
      },
    ],
    patrols: [
      (c) => {
        const at = away(c, c.main, 9000, 16000);
        return at && {
          name: 'The levy shuttle', from: 'The Admiralty',
          briefing: [
            `Pirates took a levy shuttle **${at.name}** last week, crew and all. The crew were ransomed. The levy wasn't.`,
            `The station commander has posted a bounty on the pack: three ships, still working the same spot.`,
            c.sit.text,
          ],
          steps: [
            go([at], `Fly to the pirates ${at.name}`),
            fight(at, 3, 'Destroy the pirate pack'),
            fight(at, 2, 'Destroy the rest of the pack', { rush: true, twist: true, say: ['More contacts inbound: the rest of the pack, coming back to see what happened.', 'The bounty covers them too.'] }),
          ],
          debrief: ['The pack is broken up. The levy is gone for good, but the lane is open again.', 'The commander has your name. The Admiralty may have work for you, now that they know it.'],
        };
      },
      (c) => {
        const pts = [0, 1, 2].map(() => c.space(c.main, 3500, 7000, { keep: false })), drop = away(c, c.main, 12000, 18000);
        return pts.every(Boolean) && drop && {
          name: 'The patrol schedule', from: 'A pirate crew',
          briefing: [
            `A crew wants the new patrol schedule. ${c.main.name} broadcasts it to three navigation beacons for its own pilots, encrypted.`,
            'Fly past each beacon and let your computer copy the broadcast. Then bring it to our drop point. We pay in components; credits leave trails.',
          ],
          components: [['weapon', 2, 2], ['drive', 2, 1]],
          steps: [go(pts, 'Copy the patrol broadcasts'), go([drop], `Bring the schedule to the drop point ${drop.name}`)],
          debrief: ['The crew has the schedule. The patrols will be where the crew expects, and the crew will be somewhere else.', 'The Compact won\'t know it was you. Its stations here might guess.'],
        };
      },
      (c) => {
        const claim = c.rocks(away(c, c.main, 10000, 16000) || c.main), via = claim && between(c, claim, c.main);
        return claim && via && {
          name: 'Out to the claims', from: 'Free Claim prospectors',
          briefing: [
            `A prospecting crew needs to get out to their claim **${claim.name}** and back, and nobody is patrolling the lanes.`,
            'Fly escort. Their skiff is slow and unarmed, and the pirates know it.',
          ],
          escort: { name: 'Prospectors\' skiff', culture: 0 },
          steps: [
            go([claim], `Escort the prospectors to ${claim.name}`),
            fight(via, 2, 'Fight off the pirates', { rush: true, twist: true, say: ['Pirates on the scope, closing on the skiff.', 'Keep them off it!'] }),
            go([c.main], `Bring the prospectors back to ${c.main.name}`),
          ],
          deliver: true,
          debrief: ['The prospectors staked their claim and came home with their hull intact.', 'Free Claim crews talk. Your name is going around the camps now, in a good way.'],
        };
      },
    ],
    'cut-rim': [
      (c) => {
        const at = away(c, c.main, 8000, 14000);
        return at && {
          name: 'The dark relay', from: 'The Admiralty',
          briefing: [
            `The Admiralty wants the core of its dead relay **${at.name}** brought in before anyone else strips it.`,
            'Something is still out there: the relay\'s last frames show ships with cut wheels on their hulls.',
            c.sit.text,
          ],
          steps: [go([at], `Fly to the relay ${at.name}`), fight(at, 2, 'Drive off the saboteurs', { crew: 'raiders' }), take(at, 'Relay core', 'electronics', 'Recover the relay core')],
          debrief: ['The core is in Admiralty hands, and with it a record of who cut the relay.', 'The Broken Wheel lost two ships and a secret today. They will want both back.'],
        };
      },
      (c) => {
        const there = neighbour(c), a = stationIn(there), b = there && furthest(there.stations.filter((st) => st !== a && !st.waystation), a || there.origin);
        return a && {
          name: 'Passage out', from: 'A Broken Wheel contact',
          briefing: [
            `An organiser the Admiralty wants needs passage out of ${c.sys.name}. They'll ride in your hold and say nothing.`,
            `Take them to **${a.name}**, in ${there.name}. Someone will meet them there.`,
          ],
          provided: 'A passenger who gives no name',
          steps: [
            go([a], `Take the organiser to ${a.name}`),
            ...(b ? [go([b], `Take the organiser on to ${b.name}`, { twist: true, say: [`Change of plan. My contact at ${a.name} is being watched.`, `Take me to **${b.name}** instead. I'm sorry. It has to be this way.`] })] : []),
          ],
          deliver: true,
          debrief: ['The organiser stepped off without a word and was gone before the docking clamps let go.', 'The Compact will be asking how they got out. The Compact\'s stations in this system may already suspect.'],
        };
      },
      (c) => {
        const relay = away(c, c.main, 8000, 14000), p = relay && c.space(relay, 2500, 5000, { keep: false });
        return relay && p && {
          name: 'Nothing to do with it', from: 'The claim camps',
          briefing: [
            'The camps want proof they had nothing to do with the dead relay, before the Admiralty decides they did.',
            `Take sensor readings **${relay.name}** and on the route the camp tugs use. If the camps' drives were never there, the readings will show it.`,
          ],
          steps: [go([relay, p], 'Take sensor readings around the relay')],
          debrief: ['The readings show no camp drive signature anywhere near the relay. Somebody else cut it.', 'The camps will send the readings to the Admiralty. Whether the Admiralty reads them is another matter.'],
        };
      },
    ],
    project: [
      (c) => {
        const hub = c.named(c.vars.hub), far = c.galaxy.systems.filter((s) => s.region.key === 'see').sort((a, b) => c.hops(a.index) - c.hops(b.index))[0];
        const to = stationIn(far);
        return hub && to && {
          name: 'Records, quietly', from: 'A Collegium Ethicist',
          briefing: [
            `An Ethicist at the lab on **${hub.name}** has copied the lab's test records. They'd like them somewhere the Admiralty can't reach.`,
            `Collect the records at ${hub.name}, then carry them to **${to.name}**, in the Facet see of ${far.name}.`,
            c.sit.text,
          ],
          steps: [go([hub], `Collect the records at ${hub.name}`), go([to], `Deliver the records to ${to.name}`)],
          deliver: true,
          debrief: ['The records are out. What is in them will be argued about in the Collegium for years.', 'The Admiralty will want to know who carried them. Its stations in this system may already have a guess.'],
        };
      },
      (c) => {
        const hub = c.named(c.vars.hub);
        return hub && {
          name: 'No manifest', from: 'The Admiralty',
          briefing: [
            `The lab on **${hub.name}** needs electronics the Admiralty would rather not see on a manifest.`,
            'Buy them where you like, or find them. Deliver four units. Don\'t ask what for.',
          ],
          steps: [bring('electronics', 4, 'Get 4 electronics'), go([hub], `Deliver them to ${hub.name}`)],
          deliver: true,
          debrief: ['The lab took delivery and signed for nothing.', 'The Admiralty pays on time. It also remembers who it paid.'],
        };
      },
      (c) => {
        const [d] = c.derelicts(c.main, 1);
        return d && {
          name: 'Old logic', from: 'A Collegium Engineer',
          briefing: [
            `There's an old wreck out there, **${d.name}**, with an android-built logic board still in its core.`,
            'Android logic is the oldest kind there is, and nobody knows what was cut out of it. Bring the board in. Carefully.',
          ],
          steps: [take(d, 'Android logic board', 'ai-cores', `Recover the logic board from ${d.name}`)],
          debrief: ['The Engineer held the board up to the light for a long time without saying anything.', '"There\'s a gap in it," they said at last. "Something was here." Then they asked you to leave.'],
        };
      },
    ],
    reclamation: [
      (c) => {
        const yard = c.named(c.vars.yard), ds = yard && c.derelicts(yard, 2);
        return yard && ds.length === 2 && {
          name: 'Before the reform', from: 'The Breakers\' Guild',
          briefing: [
            `The reform could pass any day. Until it does, anything salvaged and brought in to **${yard.name}** belongs to the Guild.`,
            `Strip a hull section from each of two derelicts: ${ds[0].name} and ${ds[1].name}. Bring them in.`,
            c.sit.text,
          ],
          steps: [take(ds, 'Hull section', 'hull-plating', 'Salvage the derelicts'), go([yard], `Bring the salvage to ${yard.name}`)],
          deliver: true,
          debrief: ['Two more hulls in the Guild\'s books before the reform. The yard boss is smiling, which the crews find unsettling.'],
        };
      },
      (c) => {
        const ds = c.derelicts(c.main, 3);
        return ds.length >= 2 && {
          name: 'Owners logged', from: 'A Chancery clerk',
          briefing: [
            `The reform will need a list of every derelict in ${c.sys.name} and the registry plate on each.`,
            'Fly past each one and log its plate. The Breakers will not help with this, for obvious reasons.',
          ],
          steps: [go(ds, 'Log the derelicts\' registry plates')],
          debrief: ['The list is filed with the Chancery. Some of those owners are going to get letters.', 'The yard knows you made the list. It will be cooler to you for a while.'],
        };
      },
      (c) => {
        const [d] = c.derelicts(c.main, 1);
        return d && {
          name: 'The disputed hull', from: 'The Breakers\' Guild',
          briefing: [
            `A family has turned up with papers for **${d.name}**. If they get there first, the hull is theirs.`,
            'Pull its registry core. No core, no proof. Be quick about it.',
          ],
          steps: [
            take(d, 'Registry core', 'electronics', `Pull the registry core from ${d.name}`),
            fight(d, 2, 'Fight off the claimants\' escort', { crew: 'cutters', rush: true, twist: true, say: ['Two ships on approach, Chancery transponders. The claimants hired an escort.', 'They want that core. Don\'t let them have it.'] }),
          ],
          debrief: ['Without the core, the claimants\' papers point at an empty registry. The hull is the Guild\'s.', 'The Chancery won\'t thank you for it, and the Compact\'s stations here will have heard.'],
        };
      },
    ],
    strike: [
      (c) => {
        const count = c.named(c.vars.camp), others = c.stations((st) => st !== count && (st.market.type === 'mining camp' || st.market.type === 'minor')).slice(0, 2);
        const via = count && others[0] && between(c, others[others.length - 1], count);
        return count && others.length && via && {
          name: 'The ballots', from: 'The Bay Union',
          briefing: [
            `The strike vote is counted at **${count.name}**. The ballots from ${others.map((s) => s.name).join(' and ')} still have to get there.`,
            'Collect them and bring them in. The Union doesn\'t trust the company post with this, and neither should you.',
            c.sit.text,
          ],
          steps: [
            go(others, 'Collect the ballots'),
            fight(via, 2, 'Drive off the Blackline ships', { crew: 'blackline', rush: true, twist: true, say: ['Two ships matching course with you. No transponders: Blackline.', 'They want the ballots. Keep them.'] }),
            go([count], `Bring the ballots to ${count.name}`),
          ],
          deliver: true,
          debrief: ['The ballots are counted. The vote is to strike.', `Every Union crew in ${c.sys.name} knows whose ship brought the ballots in.`],
        };
      },
      (c) => {
        const camp = c.named(c.vars.camp), kind = c.pick(['iron', 'copper-ore']), n = c.n(6, 8);
        return camp && {
          name: 'Past the picket', from: c.vars.branch || 'The Combines',
          briefing: [
            `The crews at **${camp.name}** have stopped work, and the smelters are running dry.`,
            `Bring ${many(n, kind)} in past the picket line. The picket can't stop a ship. It can only watch.`,
          ],
          steps: [bring(kind, n, `Get ${many(n, kind)}`), go([camp], `Deliver the ore to ${camp.name}`)],
          deliver: true,
          debrief: ['The smelters are lit again. The picket watched you dock.', 'The Union won\'t forget your ship. The company won\'t either, for the opposite reason.'],
        };
      },
      (c) => {
        const camp = c.named(c.vars.camp) || c.main, pts = [0, 1, 2].map(() => c.space(camp, 2500, 6000, { keep: false }));
        return pts.every(Boolean) && {
          name: 'Listening posts', from: 'A Blackline broker',
          briefing: [
            `The organisers at ${camp.name} meet off-station, where they think nobody can hear.`,
            'Drop a listening buoy at each of their three meeting points. No questions, good pay.',
          ],
          steps: [go(pts, 'Drop the listening buoys')],
          debrief: ['The buoys are listening. Somebody will hear something they shouldn\'t.', 'Blackline pays exactly as agreed. The Union will be looking for whoever did this.'],
        };
      },
    ],
    robotics: [
      (c) => {
        const hub = c.named(c.vars.hub);
        return hub && {
          name: 'Shift change', from: 'Tessaro Fabrication',
          briefing: [
            `Tessaro needs actuators at **${hub.name}** before the next shift change, so the new robots can take the old crews' places.`,
            'Bring two units. The Union will call you a scab. Tessaro will call you a contractor. The pay is the same either way.',
          ],
          steps: [bring('actuator', 2, 'Get 2 actuators'), go([hub], `Deliver them to ${hub.name}`)],
          deliver: true,
          debrief: ['The robots are running. The bays are very quiet.', 'Tessaro has added you to its list of reliable contractors.'],
        };
      },
      (c) => {
        const hub = c.named(c.vars.hub) || c.main, pts = [0, 1].map(() => c.space(hub, 5000, 10000, { keep: false }));
        return pts.every(Boolean) && {
          name: 'Proof of failure', from: 'The Bay Union',
          briefing: [
            'Two of Tessaro\'s robot haulers went dark and drifted off this month. Tessaro says that never happens.',
            'Their logs are still aboard. Bring them in, and the Union can show the Compact what the robots really do.',
          ],
          steps: [take(pts, 'Hauler log', 'electronics', 'Recover the haulers\' logs')],
          debrief: ['The logs show both haulers stopping dead, mid-lane, for no reason anyone can find.', 'The Union has its proof. Tessaro\'s stations here have your name, and not fondly.'],
        };
      },
      (c) => {
        const at = away(c, c.main, 8000, 14000);
        return at && {
          name: 'A robot\'s mind', from: 'A Collegium researcher',
          briefing: [
            `A Tessaro robot hauler broke down **${at.name}**, and scavengers have found it.`,
            'Get its logic core before they sell it for scrap. I want to know what it runs on.',
          ],
          steps: [go([at], `Fly to the hauler ${at.name}`), fight(at, 2, 'Drive off the scavengers', { crew: 'scavengers' }), take(at, 'Robot logic core', 'robotics', 'Recover the logic core')],
          debrief: ['The core runs on logic copied, line for line, from an android design. Badly.', 'The researcher has gone very quiet about it.'],
        };
      },
    ],
    burning: [
      (c) => {
        const there = neighbour(c), to = there && (stationIn(there, (st) => st.owner === 'combines') || stationIn(there)), gate = there && gateTo(c, there.index);
        return to && gate && {
          name: 'Convoy', from: 'Corvane Logistics',
          briefing: [
            `Corvane has a freighter that has to get through to **${to.name}**, in ${there.name}. The last three didn't.`,
            'Fly escort. The Scorched like the stretch before the gate.',
            c.sit.text,
          ],
          escort: { name: 'Corvane freighter', culture: 1 },
          steps: [
            go([gate], `Escort the freighter to the ${there.name} gate`),
            fight(gate, 3, 'Fight off the Scorched', { crew: 'scorched', rush: true, twist: true, say: ['Burn signatures behind the gate. The Scorched were waiting.', 'Protect the freighter!'] }),
            go([to], `Escort the freighter to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The freighter docked with its cargo and its crew. Corvane\'s insurers are very interested in how.', 'The Scorched will remember your ship. So will Corvane, for better reasons.'],
        };
      },
      (c) => {
        const camp = nearest(of(c, 'mining camp'), c.main), at = away(c, c.main, 9000, 15000), via = camp && at && between(c, at, camp);
        return camp && at && via && {
          name: 'Freed cargo', from: 'A Scorched cell',
          briefing: [
            `A Corvane cargo pod the Scorched cut loose is drifting **${at.name}**. It is full of medical supplies the camps can't afford.`,
            `Get it to **${camp.name}** before Corvane's security finds it.`,
          ],
          steps: [
            take(at, 'Cargo pod', 'power-cell', `Collect the cargo pod ${at.name}`, { spread: 0 }),
            fight(via, 2, 'Shake off Corvane security', { crew: 'security', rush: true, twist: true, say: ['Corvane security has your transponder. Two ships, coming hard.', 'They want their pod back.'] }),
            go([camp], `Deliver the pod to ${camp.name}`),
          ],
          deliver: true,
          debrief: [`The pod was empty within the hour. Every family at ${camp.name} knows where the medicine came from.`, 'Corvane\'s stations here have your name now, and not in a good way.'],
        };
      },
      (c) => {
        const way = c.stations((st) => st.waystation)[0], there = neighbour(c), to = way || stationIn(there);
        return to && to !== c.main && {
          name: 'Somewhere safe', from: 'The Bay Union',
          briefing: [
            'The families of a crew lost on the Corvane run have been getting visits. Nobody will say from whom.',
            `Escort their transport to **${to.name}**${way ? ', where nobody can fire a shot' : ''}.`,
          ],
          escort: { name: 'Family transport', culture: 1 },
          steps: [go([to], `Escort the transport to ${to.name}`)],
          deliver: true,
          debrief: ['The families are safe. Somebody asks your name, to remember it.'],
        };
      },
    ],
    hunt: [
      (c) => {
        const pts = [0, 1, 2].map(() => c.space(c.main, 9000, 16000, { keep: false })), at = pts[2];
        return pts.every(Boolean) && {
          name: 'Finding the cell', from: 'A Blackline broker',
          briefing: [
            'Blackline pays for the Scorched cell\'s location. Three places it might be hiding; sweep them.',
            'If you find them, they will find you. Blackline pays for that too.',
            c.sit.text,
          ],
          steps: [
            go(pts, 'Sweep the hiding places'),
            fight(at, 2, 'Destroy the cell\'s pickets', { crew: 'scorched', rush: true, twist: true, say: ['That\'s them. Two pickets breaking away from the rocks.', 'Blackline wants them gone. So do they, now.'] }),
          ],
          debrief: ['Blackline has its location. What it does with it, it does not say.', 'The Union crews will hear that you helped. They will not be glad.'],
        };
      },
      (c) => {
        const there = neighbour(c), to = (c.stations((st) => st.waystation)[0]) || stationIn(there), via = to && to.system === c.sys.index ? between(c, c.main, to) : there && gateTo(c, there.index);
        return to && via && {
          name: 'Before the search', from: 'A Scorched cell',
          briefing: [
            'The next Blackline search will find our families. They have to be gone before it comes.',
            `Escort their shuttle to **${to.name}**. Blackline will try to stop you.`,
          ],
          escort: { name: 'Family shuttle', culture: 1 },
          steps: [
            go([via], `Escort the shuttle ${via.name}`),
            fight(via, 2, 'Fight off the Blackline hunters', { crew: 'blackline', rush: true, twist: true, say: ['Blackline hunters on intercept. They knew which shuttle to watch.', 'Hold them off!'] }),
            go([to], `Escort the shuttle to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The families are out. The next search will find empty bunks.', 'Blackline knows who flew escort.'],
        };
      },
      (c) => {
        const to = chancery(c.galaxy);
        return to && to.system !== c.sys.index && {
          name: 'Anonymous', from: 'The Bay Union',
          briefing: [
            'The searches have to stop, and the Union can\'t be seen asking. A complaint has been written with no names on it.',
            `Carry it to the Chancery at **${to.name}**. Nobody will ask who sent it. That's the point.`,
          ],
          provided: 'An unsigned complaint',
          steps: [go([to], `Deliver the complaint to ${to.name}`)],
          deliver: true,
          debrief: ['The Chancery has opened an inquiry into who pays Blackline. Nobody knows who asked for it.', 'The Union crews know. They are grateful.'],
        };
      },
    ],
    buyout: [
      (c) => {
        const camp = c.named(c.vars.camp) || c.main, at = away(c, camp, 4500, 8000);
        return at && {
          name: 'Hold the claim', from: 'A Free Claim prospector',
          briefing: [
            `My drill site is **${at.name}**. Hadal's claim-jumpers come every shift change. Next one is soon.`,
            'Guard the site through the shift. I don\'t care what happens to them.',
            c.sit.text,
          ],
          steps: [
            go([at], `Fly to the drill site ${at.name}`),
            fight(at, 2, 'Fight off the claim-jumpers', { crew: 'jumpers', rush: true, twist: true, say: ['Here they come. Two ships, Hadal paint scraped off.'] }),
            fight(at, 2, 'Fight off the second wave', { crew: 'jumpers', rush: true, twist: true, say: ['Two more. They really want this claim.'] }),
          ],
          debrief: ['The shift ended with the prospector still holding the claim.', 'Every camp in the system will hear you stood with them.'],
        };
      },
      (c) => {
        const camp = c.named(c.vars.camp) || c.main, pts = [0, 1, 2].map(() => c.space(camp, 4000, 10000, { keep: false }));
        return pts.every(Boolean) && {
          name: 'Unbought', from: 'Hadal Extraction',
          briefing: [
            `Hadal wants the claims it hasn't bought yet around ${camp.name} surveyed: three sites, what's in them and who's working them.`,
            'It\'s a survey. What Hadal does with it isn\'t your concern.',
          ],
          steps: [go(pts, 'Survey the claims')],
          debrief: ['Hadal has its survey. There will be new buyout offers by the end of the week.', 'The camps know a survey ship when they see one. Free Claim\'s stations here will be cooler to you.'],
        };
      },
      (c) => {
        const camp = c.named(c.vars.camp) || c.main, at = away(c, camp, 6000, 11000);
        return at && {
          name: 'The contract', from: 'The claim camp',
          briefing: [
            `A claim-jumper crew is sitting **${at.name}**. Their leader carries the contract that says who hired them.`,
            'Take it from them. With it, the camp can go to the Chancery.',
          ],
          steps: [go([at], `Fly to the claim-jumpers ${at.name}`), fight(at, 2, 'Destroy the claim-jumpers', { crew: 'jumpers' }), take(at, 'Claim-jumper\'s contract', 'electronics', 'Recover the contract')],
          debrief: ['The contract is signed by a Hadal subsidiary nobody had heard of until today.', 'The camp is taking it to the Chancery. Blackline will want to know who found it.'],
        };
      },
    ],
    disown: [
      (c) => {
        const drop = away(c, c.main, 11000, 17000);
        return drop && {
          name: 'Off the record', from: 'The Union leadership',
          briefing: [
            'The leadership has to say something to the Scorched that it can\'t say in public.',
            `A contact will be waiting **${drop.name}**. Fly there, let them read your comms log, and come back.`,
            c.sit.text,
          ],
          provided: 'A message, in your comms log only',
          steps: [go([drop], `Meet the Scorched contact ${drop.name}`)],
          debrief: ['The message was delivered. The Scorched contact laughed, then stopped laughing.', 'Whatever was said, the Compact would want to know you carried it.'],
        };
      },
      (c) => {
        const at = away(c, c.main, 8000, 14000);
        return at && {
          name: 'Evidence', from: 'The Chancery',
          briefing: [
            `The Scorched raid near ${c.main.name} left wreckage **${at.name}**. The raiders' comms logs may still be in it.`,
            'The Chancery wants proof the Union helped. The raiders who are left are still picking through it.',
          ],
          steps: [go([at], `Fly to the wreckage ${at.name}`), fight(at, 2, 'Drive off the raiders', { crew: 'scorched' }), take([at, at], 'Comms log', 'electronics', 'Recover the comms logs')],
          debrief: ['The logs show Union frequencies, used once, on the night of the raid.', 'It isn\'t proof, but it will be called proof. The Union will know who found it.'],
        };
      },
      (c) => {
        const way = c.stations((st) => st.waystation)[0], to = way || furthest(c.stations((st) => st.market.type === 'mining camp' || st.market.type === 'minor'), c.main);
        return to && to !== c.main && {
          name: 'Somewhere quiet', from: 'A Scorched cell',
          briefing: [
            'We have wounded. No clinic in this system will take them without calling the Compact.',
            `Take them to **${to.name}**${way ? '. Waystations don\'t ask questions. They just keep accounts' : '. Someone there owes us'}.`,
          ],
          provided: 'Three wounded raiders, sedated',
          steps: [go([to], `Take the wounded to ${to.name}`)],
          deliver: true,
          debrief: ['The wounded will live.', 'The Scorched don\'t say thank you. They say they owe you, which is worth more.'],
        };
      },
    ],
    cores: [
      (c) => {
        const yard = c.named(c.vars.yard), ds = yard && c.derelicts(yard, 2);
        return yard && ds.length === 2 && {
          name: 'Android wrecks', from: 'The Breakers\' Guild',
          briefing: [
            `${yard.name} buys android cores, no questions, and Tessaro pays the yard more than anyone has seen.`,
            `There are cores in ${ds[0].name} and ${ds[1].name}. Pull them and bring them in.`,
            c.sit.text,
          ],
          steps: [take(ds, 'Android core', 'ai-cores', 'Pull the android cores'), go([yard], `Bring the cores to ${yard.name}`)],
          deliver: true,
          debrief: ['The cores are crated and labelled for Tessaro. The yard boss doesn\'t look at them while signing.', 'Neither do you, if you can help it.'],
        };
      },
      (c) => {
        const yard = c.named(c.vars.yard), sys = c.galaxy.systems.filter((s) => s.region.key === 'combine').sort((a, b) => c.hops(a.index) - c.hops(b.index))[0];
        const to = stationIn(sys, (st) => st.owner === 'combines' && st.market.type === 'minor') || stationIn(sys, (st) => st.owner === 'combines');
        return yard && to && {
          name: 'No manifest', from: 'Tessaro Fabrication',
          briefing: [
            `A crate of cores is waiting at **${yard.name}**. Tessaro's fabricators at **${to.name}** want it.`,
            'It travels without a manifest. If anyone asks, it\'s machine parts. It is machine parts, technically.',
          ],
          steps: [go([yard], `Collect the crate at ${yard.name}`), go([to], `Deliver the crate to ${to.name}`)],
          deliver: true,
          debrief: ['The crate was taken off your ship by people who didn\'t look at it either.', 'Tessaro pays well. You may wonder later what for.'],
        };
      },
      (c) => {
        const yard = c.named(c.vars.yard) || c.main, a = away(c, yard, 9000, 14000), b = a && c.space(a, 4000, 7000);
        return a && b && {
          name: 'The crew that didn\'t come back', from: 'A salvager',
          briefing: [
            'My partner\'s crew went out after an android wreck and didn\'t come back. The yard says it happens. I say it doesn\'t, not to them.',
            `Their last two fixes were **${a.name}** and **${b.name}**. Find out what happened.`,
          ],
          steps: [
            go([a, b], 'Follow the crew\'s last route'),
            fight(b, 2, 'Destroy the ships that took them', { rush: true, twist: true, say: ['There\'s the wreck: their tug, cut open. And there\'s who did it: two ships coming out of the rocks.'] }),
            take(b, 'Flight recorder', 'electronics', 'Recover the tug\'s flight recorder', { twist: true }),
          ],
          debrief: ['The recorder shows pirates, an android wreck and a fight that went badly. Nothing stranger than that.', 'The salvager listened to it twice, then went out to the yard bar and didn\'t come back that night either.'],
        };
      },
    ],
    fraud: [
      (c) => {
        const neb = c.nebula(c.main), at = neb && c.space(neb, 0, 0, { nebula: neb, keep: false });
        return at && {
          name: 'The ledger', from: 'The Clear',
          briefing: [
            `The scholar with the ledger has fled into the **${neb.name}** and is hiding in a drifting hab, **${at.name}**.`,
            'Recover the ledger. Quietly. The Clear do not want anyone hurt; they want the ledger, and the silence after.',
            c.sit.text,
          ],
          steps: [take(at, 'The Lapidary ledger', 'electronics', `Recover the ledger ${at.name}`)],
          debrief: ['The ledger is in the Clear\'s keeping. The scholar will be fine, and unemployed.', 'The scandal will be buried. You helped dig.'],
        };
      },
      (c) => {
        const hub = furthest(c.stations((st) => st !== c.main && !st.waystation), c.main), drop = away(c, c.main, 10000, 16000);
        return hub && drop && {
          name: 'A copy for the docks', from: 'An Unfaceted crew',
          briefing: [
            `The scholar left a copy of the ledger with a friend at **${hub.name}**. We want it read out on every dock in known space.`,
            `Collect it, and bring it to our ship **${drop.name}**.`,
          ],
          steps: [go([hub], `Collect the copy at ${hub.name}`), go([drop], `Bring it to the Unfaceted ship ${drop.name}`)],
          debrief: ['The copy is out. By next cycle every dock will be reading it.', 'The Facet\'s stations in this system will not be pleased to see you.'],
        };
      },
      (c) => {
        const there = neighbour(c), to = stationIn(there), gate = there && gateTo(c, there.index);
        return to && gate && {
          name: 'Away from Facet eyes', from: 'A Collegium scholar',
          briefing: [
            `A relic has to be authenticated somewhere the Facet can't lean on the result: **${to.name}**, in ${there.name}.`,
            'Carry it there. The Unfaceted would like it too, for different reasons.',
          ],
          provided: 'A relic, wrapped in grey cloth',
          steps: [
            go([gate], `Carry the relic to the ${there.name} gate`),
            fight(gate, 2, 'Fight off the Unfaceted', { crew: 'unfaceted', rush: true, twist: true, say: ['Two ships, no transponders, painted with broken facets. They know what you\'re carrying.'] }),
            go([to], `Deliver the relic to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The relic is genuine. Somebody important is going to be very embarrassed that it is.'],
        };
      },
    ],
    shrines: [
      (c) => {
        const to = furthest(c.stations((st) => st.owner === 'facet' && st.market.type === 'minor'), c.main) || furthest(c.stations((st) => st !== c.main && !st.waystation), c.main);
        const via = to && between(c, c.main, to);
        return to && via && {
          name: 'Pilgrims', from: 'The Facet',
          briefing: [
            `A pilgrim ship is bound for **${to.name}**. The last one was stripped on the way in.`,
            'Fly escort. The pilgrims will not defend themselves. They believe they are being watched.',
            c.sit.text,
          ],
          escort: { name: 'Pilgrim ship', culture: 2 },
          steps: [
            go([via], `Escort the pilgrims ${via.name}`),
            fight(via, 3, 'Fight off the Unfaceted raiders', { crew: 'unfaceted', rush: true, twist: true, say: ['Raiders breaking from cover. Broken facets on their hulls.', 'They\'re going for the pilgrims!'] }),
            go([to], `Escort the pilgrims to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The pilgrims arrived whole, and sat in stillness for a day to give thanks.', 'The Facet does not forget its friends.'],
        };
      },
      (c) => {
        const at = away(c, c.main, 9000, 15000);
        return at && {
          name: 'The stolen icon', from: 'The Facet',
          briefing: [
            `An icon taken from a stripped hermitage is aboard a fence's ship **${at.name}**, waiting for a buyer from the Breakers.`,
            'Get it back before it leaves the system.',
          ],
          steps: [go([at], `Fly to the fence ${at.name}`), fight(at, 2, 'Deal with the fence and its guard', { crew: 'unfaceted' }), take(at, 'Hermitage icon', 'focusing-lens', 'Recover the icon')],
          debrief: ['The icon is back in its niche. The hermit who keeps it has not stopped weeping.', 'The Facet\'s stations in this system will welcome you.'],
        };
      },
      (c) => {
        const yard = nearest(of(c, 'salvage yard'), c.main) || furthest(c.stations((st) => st.owner !== 'facet' && !st.waystation), c.main)
          || stationIn(neighbour(c), (st) => st.owner !== 'facet');
        const at = away(c, c.main, 9000, 15000);
        return yard && at && {
          name: 'Fencing relics', from: 'An Unfaceted crew',
          briefing: [
            `We've left a crate of hermitage relics **${at.name}**. The traders at **${yard.name}** will buy them, if the seller isn't us.`,
            'You\'re not us. Collect the crate and sell it in. Keep a share.',
          ],
          steps: [take(at, 'Crate of relics', 'focusing-lens', `Collect the crate ${at.name}`, { spread: 0 }), go([yard], `Bring the crate to ${yard.name}`)],
          deliver: true,
          debrief: ['The relics are on sale by nightfall. The faithful will have to buy back their own shrines.', 'The Facet\'s stations here will hear whose ship carried them.'],
        };
      },
    ],
    pews: [
      (c) => {
        const there = neighbour(c), to = (there && there.stations.find((st) => st.waystation)) || stationIn(there), home = c.main;
        return to && {
          name: 'The runaway', from: 'A Facet elder',
          briefing: [
            `An acolyte has run off to **${to.name}**${to.waystation ? ', a waystation, because it answers when you speak to it' : ''}.`,
            `Find them and bring them home to ${home.name}. If they will come.`,
            c.sit.text,
          ],
          steps: [go([to], `Find the acolyte at ${to.name}`), go([home], `Bring the acolyte home to ${home.name}`, { say: ['The acolyte has agreed to come home. Not to stay, they say. To talk.'] })],
          deliver: true,
          debrief: ['The acolyte and the elder sat together for a long time without speaking. In the Facet, that is a conversation.', 'Whether they stay is up to them now.'],
        };
      },
      (c) => {
        const to = c.stations((st) => st.owner === 'facet' && st !== c.main).slice(0, 2);
        return to.length && {
          name: 'Letters home', from: 'A former acolyte',
          briefing: [
            'A waystation pulled me out of a wreck once. I never went home after. I have written to my family instead.',
            `Carry the letters to ${to.map((s) => `**${s.name}**`).join(' and ')}. They may not want them. I wrote them anyway.`,
          ],
          provided: 'A bundle of handwritten letters',
          steps: [go(to, 'Deliver the letters')],
          debrief: ['The letters were taken. One family wrote back, and asked you to carry the answer.', 'You have done the Owed a kindness. They will pass it on.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main), at = neb && c.space(neb, 0, 0, { nebula: neb, keep: false });
        return at && {
          name: 'To the edge of the gas', from: 'A Clear chapter',
          briefing: [
            `The chapter wants to sit at the edge of the **${neb.name}**, **${at.name}**, where the Watchers might be watching.`,
            'Escort their ship there. They will stay. You need not.',
          ],
          escort: { name: 'Chapter ship', culture: 2, until: 0 },
          steps: [go([at], `Escort the chapter ship ${at.name}`)],
          debrief: ['You left the chapter in the gas, perfectly still. Your sensors picked up nothing watching. Theirs, they said, did.'],
        };
      },
    ],
    vanished: [
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), a = neb && c.space(neb, 0, 0, { nebula: neb, keep: false }), b = neb && c.space(neb, 0, 0, { nebula: neb });
        return a && b && {
          name: 'Search the gas', from: 'The Occluded',
          briefing: [
            `A pilgrim ship went into the **${neb.name}** two weeks ago and hasn't come out. The Occluded want it found.`,
            'Search where it was last seen. Sensors are weak in there. Go slowly.',
            c.sit.text,
          ],
          steps: [
            go([a, b], `Search the ${neb.name}`),
            take(b, 'Pilgrim ship\'s log', 'electronics', 'Recover the pilgrim ship\'s log', { twist: true, say: ['Found it: the pilgrim ship, cut open. Pirate work. Its log is drifting free.'] }),
            fight(b, 2, 'Destroy the pirates', { rush: true, twist: true, say: ['The ambush crew is coming back for a second look. Two ships.'] }),
          ],
          debrief: ['The log shows the pilgrims sitting in stillness, then the pirates. Nothing else.', 'The Occluded listened to it to the end, then asked if you saw any lights. You didn\'t.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), meet = neb && c.space(neb, 0, 0, { nebula: neb, keep: false }), gate = c.sys.gates[0] && gateTo(c, c.sys.gates[0].to);
        return meet && gate && {
          name: 'Safe passage', from: 'An ambush crew',
          briefing: [
            `An ambush crew in the **${neb.name}** will tell what it knows about the missing pilgrims, for safe passage out of the system.`,
            `Meet their ship **${meet.name}** and escort it to the gate. Nobody fires on a ship you're escorting. That's the theory.`,
          ],
          escort: { name: 'Ambush crew\'s ship', culture: 0, from: 0 },
          steps: [go([meet], `Meet the crew ${meet.name}`), go([gate], `Escort them ${gate.name}`)],
          components: [['computer', 2, 2]],
          debrief: ['At the gate they told you: the pilgrims went deeper than anyone goes, and the crew saw lights following them in. Then the crew jumped.', 'They paid in components, which is more honest than most.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), at = neb && c.space(neb, 0, 0, { nebula: neb, keep: false });
        return at && {
          name: 'A sensor log', from: 'A hermit',
          briefing: [
            `I need a full sensor log from deep inside the **${neb.name}**, **${at.name}**.`,
            'I won\'t say why. Fly there, let your sensors run, come back.',
          ],
          steps: [go([at], `Record a sensor log ${at.name}`, {})],
          debrief: ['The hermit played the log back once, at a speed you couldn\'t follow, and then thanked you very formally.', 'Your copy of it shows gas, and more gas, and for half a second something that might be a reflection.'],
        };
      },
    ],
    harvest: [
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), deep = neb && c.space(neb, 0, 0, { nebula: neb });
        return deep && {
          name: 'The deep pockets', from: 'Hadal Extraction',
          briefing: [
            `A Hadal harvester is going to the deep pockets of the **${neb.name}**, **${deep.name}**, and needs an escort there and back.`,
            'The crews don\'t like it in there. They say the readings come back wrong.',
            c.sit.text,
          ],
          escort: { name: 'Hadal harvester', culture: 1 },
          steps: [
            go([deep], `Escort the harvester ${deep.name}`),
            fight(deep, 2, 'Fight off the pirates', { rush: true, twist: true, say: ['Contacts in the gas: pirates, using the dampening for cover.'] }),
            go([c.main], `Escort the harvester back to ${c.main.name}`),
          ],
          deliver: true,
          debrief: ['The harvester came back full. Its sensors logged a dozen readings nobody can explain.', 'Hadal has filed them as instrument error.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula);
        return neb && {
          name: 'Wrong readings', from: 'A Collegium researcher',
          briefing: [
            `The harvesters' sensors read wrong deep in the **${neb.name}**. I want samples from the pockets where it happens: three of them, marked.`,
            'Collect them. Keep the gas; I only need your sensor logs of it.',
          ],
          steps: [gas(neb, 3, `Collect the marked gas pockets in the ${neb.name}`)],
          debrief: ['The researcher compared your logs with the harvesters\'. "Something moved away from you," she said. "Every time."'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), pts = neb && [0, 1].map(() => c.space(neb, 0, 0, { nebula: neb, keep: false }));
        return pts && pts.every(Boolean) && {
          name: 'Proof of damage', from: 'The Occluded',
          briefing: [
            `Hadal's harvest is tearing up the **${neb.name}**. The Occluded want proof: readings from two harvested sites.`,
            'Bring the proof, and they will take it to the Compact.',
          ],
          steps: [go(pts, 'Record the harvest damage')],
          debrief: ['The readings are stark. The Occluded have taken them to the Compact.', 'Hadal will know who took them. Its stations here will not welcome you.'],
        };
      },
    ],
    lights: [
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), at = neb && c.space(neb, 0, 0, { nebula: neb, keep: false });
        return at && {
          name: 'The offering', from: 'A pirate crew',
          briefing: [
            `The crews leave offerings at the edge of the **${neb.name}**. This one has to go deep, **${at.name}**, where they won't.`,
            'Carry it in and leave it. We pay in components. Don\'t open it.',
          ],
          provided: 'A sealed offering crate',
          components: [['weapon', 2, 1], ['computer', 2, 1]],
          steps: [go([at], `Leave the offering ${at.name}`)],
          debrief: ['You left the crate in the gas. When you looked back on your sensors, it wasn\'t there.', 'The crew paid without asking any questions at all.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), at = neb && c.space(neb, 0, 0, { nebula: neb, keep: false });
        return at && {
          name: 'Where the lights were', from: 'A Facet pilgrim',
          briefing: [
            `Take me to where the lights were last seen: **${at.name}**, in the **${neb.name}**.`,
            'My ship will follow yours. Leave me there. I will be quite all right.',
          ],
          escort: { name: 'Pilgrim\'s skiff', culture: 2, until: 0 },
          steps: [go([at], `Take the pilgrim ${at.name}`)],
          debrief: ['You left the pilgrim in the gas, engines off, facing nothing in particular.', 'Your sensors showed nothing. The pilgrim\'s face, on the comms, showed something.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), pts = neb && [0, 1, 2].map(() => c.space(neb, 0, 0, { nebula: neb, keep: false }));
        return pts && pts.every(Boolean) && {
          name: 'Proof either way', from: 'A Collegium scholar',
          briefing: [
            `I want sensor data from three points in the **${neb.name}**, where the lights are reported most.`,
            'Proof either way. I\'m paying for the data, not for a story.',
          ],
          steps: [go(pts, 'Take sensor readings')],
          debrief: ['The data shows nothing that can\'t be explained. The scholar doesn\'t look relieved.'],
        };
      },
    ],
    ambush: [
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), at = neb && c.space(neb, 0, 0, { nebula: neb });
        return at && {
          name: 'The harvester takers', from: 'Hadal Extraction',
          briefing: [
            `The crew that took Hadal's last harvester is lying in wait in the **${neb.name}**, **${at.name}**.`,
            'Hadal posts a bounty on all of them.',
            c.sit.text,
          ],
          steps: [go([at], `Find the ambush crew ${at.name}`), fight(at, 3, 'Destroy the ambush crew', { up: 1 })],
          debrief: ['The crew is gone. Hadal\'s harvesters will be back in the gas next week.', 'The pilgrims will use the same route. Nobody will mention it to Hadal.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), mid = neb && c.space(neb, 0, 0, { nebula: neb }), to = mid && furthest(c.stations((st) => !st.waystation), mid);
        return mid && to && {
          name: 'Through the gas', from: 'The Facet',
          briefing: [
            `A pilgrim ship must cross the **${neb.name}** to reach **${to.name}**. Ambush crews wait in the gas.`,
            'Fly escort. The pilgrims will not run.',
          ],
          escort: { name: 'Pilgrim ship', culture: 2 },
          steps: [
            go([mid], `Escort the pilgrims ${mid.name}`),
            fight(mid, 3, 'Fight off the ambush crew', { rush: true, twist: true, say: ['Ambush! Three ships coming out of the gas.'] }),
            go([to], `Escort the pilgrims to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The pilgrims crossed the gas whole. They say it was the stillest crossing in memory. You remember it differently.'],
        };
      },
      (c) => {
        const neb = c.nebula(c.main, c.vars.nebula), pts = neb && [0, 1].map(() => c.space(neb, 0, 0, { nebula: neb, keep: false }));
        return pts && pts.every(Boolean) && {
          name: 'What the ambushes left', from: 'The Breakers\' Guild',
          briefing: [
            `The ambushes in the **${neb.name}** have left wrecks behind, and wrecks are the Guild's business.`,
            'Recover salvage from two of them. The crews that made them may still be close.',
          ],
          steps: [take(pts, 'Wreck salvage', 'hull-plating', 'Recover the salvage')],
          debrief: ['The Guild has its salvage, and a few more names for its book of who didn\'t make it.'],
        };
      },
    ],
    grounds: [
      (c) => {
        const a = away(c, c.main, 10000, 16000), b = a && c.space(a, 5000, 9000, { keep: false });
        return a && b && {
          name: 'The rival\'s stash', from: 'A pirate captain',
          briefing: [
            'The other crew keeps a stash somewhere in this system. Find it, bring me what\'s in it, and I pay in components.',
            `Two places it might be: **${a.name}** and **${b.name}**. It's guarded.`,
            c.sit.text,
          ],
          components: [['weapon', 2, 2], ['hull', 2, 2]],
          steps: [go([a, b], 'Search for the stash'), fight(b, 2, 'Destroy the stash guards', { twist: true, rush: true, say: ['That\'s it: crates, tethered in the rocks. And two guards waking up.'] }), take([b, b], 'Stash crate', 'power-cell', 'Take the crates', { twist: true })],
          debrief: ['The captain went through the crates in front of you, grinning.', 'The code is wearing thin. You just wore it thinner.'],
        };
      },
      (c) => {
        const at = away(c, c.main, 9000, 15000);
        return at && {
          name: 'After the fight', from: 'The Breakers\' Guild',
          briefing: [
            `The two crews fought **${at.name}** and left wrecks behind. The yard wants them salvaged.`,
            'Scavengers got there first. The Guild\'s licence says that\'s theft.',
          ],
          steps: [go([at], `Fly to the wrecks ${at.name}`), fight(at, 2, 'Drive off the scavengers', { crew: 'scavengers' }), take([at, at], 'Wreck salvage', 'hull-plating', 'Recover the salvage')],
          debrief: ['The salvage is in the Guild\'s books. The scavengers are in pieces, which the Guild also counts as salvage.'],
        };
      },
      (c) => {
        const a = away(c, c.main, 9000, 15000), b = away(c, c.main, 9000, 15000);
        return a && b && {
          name: 'Whichever falls first', from: 'The Admiralty',
          briefing: [
            'A bounty stands on both crews working these lanes. The Admiralty doesn\'t care which goes first.',
            `One is **${a.name}**, the other **${b.name}**. Both, and the bounty is doubled.`,
          ],
          steps: [go([a], `Fly to the first crew ${a.name}`), fight(a, 2, 'Destroy the first crew'), go([b], `Fly to the second crew ${b.name}`), fight(b, 2, 'Destroy the second crew')],
          debrief: ['Both crews are broken. The Admiralty is pleased, and a little surprised.', 'The lanes will be quiet until the next crew moves in.'],
        };
      },
    ],
    claims: [
      (c) => {
        const camp = c.named(c.vars.camp), to = camp && furthest(c.stations((st) => st !== camp && !st.waystation && st.market.type !== 'mining camp'), camp);
        const via = to && between(c, camp, to);
        return camp && to && via && {
          name: 'The ore run', from: 'The claim camp',
          briefing: [
            `${camp.name} has an ore run going out to **${to.name}**, and the pirates take a cut of every load that leaves.`,
            'Not this one. Meet the hauler at the camp and fly escort.',
            c.sit.text,
          ],
          escort: { name: 'Ore hauler', culture: 0, from: 0 },
          steps: [
            go([camp], `Meet the ore hauler at ${camp.name}`),
            fight(via, 3, 'Fight off the pirates', { rush: true, twist: true, say: ['Here comes the cut. Three of them, closing.'] }),
            go([to], `Escort the hauler to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The load arrived whole, for the first time this year.', 'The camp will drink to you. Free Claim\'s stations here will remember.'],
        };
      },
      (c) => {
        const to = chancery(c.galaxy);
        return to && to.system !== c.sys.index && {
          name: 'Papers', from: 'A Free Claim prospector',
          briefing: [
            `My claim papers have to be filed at the Chancery office on **${to.name}**, two systems away or more, before someone else files on the same rocks.`,
            'Carry them. I can\'t leave the claim, or there won\'t be one.',
          ],
          provided: 'A prospector\'s claim papers',
          steps: [go([to], `File the papers at ${to.name}`)],
          deliver: true,
          debrief: ['The papers are filed and stamped. The claim is legal, for whatever that is worth out here.'],
        };
      },
      (c) => {
        const camp = c.named(c.vars.camp), drop = away(c, c.main, 11000, 17000);
        return camp && drop && {
          name: 'Shipping times', from: 'A pirate crew',
          briefing: [
            `${camp.name} posts its shipping board for the haulers. Dock there and read it.`,
            `Then bring what it says to our ship **${drop.name}**. Components on delivery.`,
          ],
          components: [['drive', 2, 2]],
          steps: [go([camp], `Read the shipping board at ${camp.name}`), go([drop], `Bring the times to the crew ${drop.name}`)],
          debrief: ['The crew has the times. The next ore run will be lighter when it arrives.', 'The camps don\'t know it was you. Free Claim\'s stations here may come to suspect.'],
        };
      },
    ],
    shelter: [
      (c) => {
        const there = neighbour(c), to = stationIn(there), gate = there && gateTo(c, there.index);
        return to && gate && {
          name: 'Moving the cell', from: 'A Broken Wheel cell',
          briefing: [
            'The Admiralty\'s next patrol will not be a friendly one. The cell has to be out before it comes.',
            `Escort our shuttle to **${to.name}**, in ${there.name}.`,
            c.sit.text,
          ],
          escort: { name: 'Cell shuttle', culture: 0 },
          steps: [
            go([gate], `Escort the shuttle to the ${there.name} gate`),
            fight(gate, 2, 'Fight off the Chancery cutters', { crew: 'cutters', rush: true, twist: true, say: ['Cutters at the gate. The patrol came early.'] }),
            go([to], `Escort the shuttle to ${to.name}`),
          ],
          deliver: true,
          debrief: ['The cell is out. The camps will find nothing to hide when the patrol arrives.', 'The Compact will have your ship\'s description by morning.'],
        };
      },
      (c) => {
        const pts = [0, 1, 2].map(() => c.space(c.main, 9000, 16000, { keep: false })), at = pts[2];
        return pts.every(Boolean) && {
          name: 'Where the cell hides', from: 'The Admiralty',
          briefing: ['The Admiralty pays for the Broken Wheel cell\'s location. Three likely places; sweep them.', 'Expect them to object.'],
          steps: [go(pts, 'Sweep the likely places'), fight(at, 3, 'Fight off the cell\'s ships', { crew: 'raiders', rush: true, twist: true, say: ['Found them, and they\'ve found you. Three ships.'] })],
          debrief: ['The Admiralty has the location. The patrol will be there within the week.', 'The camps that sheltered the cell will not forget who led it there.'],
        };
      },
      (c) => {
        const hide = away(c, c.main, 11000, 17000);
        return hide && {
          name: 'Nobody hurt', from: 'The claim camps',
          briefing: [
            'The camps want the patrol to find nothing, and nobody hurt. That means telling the cell, today.',
            `Carry a warning to their hideout **${hide.name}**. Don't stay.`,
          ],
          provided: 'A warning, by word of mouth',
          steps: [go([hide], `Warn the cell ${hide.name}`)],
          debrief: ['The cell is gone by the time the patrol comes. Nobody is hurt. The camps say that\'s a first.'],
        };
      },
    ],
    boneyard: [
      (c) => {
        const [d] = c.derelicts(c.main, 1);
        return d && {
          name: 'Licence', from: 'The Breakers\' Guild',
          briefing: [`The Guild holds the licence on **${d.name}**. Prospectors have been cutting it up anyway.`, 'Enforce the licence.'],
          steps: [go([d], `Fly to ${d.name}`), fight(d, 2, 'Drive off the cutters', { crew: 'jumpers', rush: true, twist: true, say: ['Two cutting crews at the wreck, and they\'re not leaving quietly.'] })],
          debrief: ['The licence is enforced. The prospectors call it theft by paperwork.', 'Free Claim\'s stations here will be cooler to you.'],
        };
      },
      (c) => {
        const [d] = c.derelicts(c.main, 1);
        return d && {
          name: 'Finders', from: 'A Free Claim prospector',
          briefing: [`I found **${d.name}** first. My claim is being filed now. Hold the wreck until it is.`, 'Somebody will come for it. Somebody always does.'],
          steps: [
            go([d], `Hold ${d.name}`),
            fight(d, 2, 'Fight off the scavengers', { crew: 'scavengers', rush: true, twist: true, say: ['Scavengers, two of them. They heard about the find.'] }),
            fight(d, 2, 'Fight off the Guild tugs', { crew: 'scavengers', rush: true, twist: true, say: ['And now the Guild\'s tugs, armed. The claim is nearly through. Hold!'] }),
          ],
          debrief: ['The claim is filed. The wreck is the prospector\'s, by finding and by law.', 'The Breakers\' Guild knows who held it. The yard will be cool to you.'],
        };
      },
      (c) => {
        const ds = c.derelicts(c.main, 2);
        return ds.length === 2 && {
          name: 'Split it', from: 'A pirate crew',
          briefing: ['Salvage what you can from two wrecks before the Breakers get there. We split it.', `${ds[0].name} and ${ds[1].name}.`],
          components: [['hull', 2, 2], ['drive', 2, 1]],
          steps: [take(ds, 'Wreck salvage', 'hull-plating', 'Salvage the wrecks')],
          debrief: ['The crew took its share, and you took yours.', 'The Breakers\' yard will hear who got there first.'],
        };
      },
    ],
    sanctuary: [
      (c) => {
        const way = c.named(c.vars.waystation), kind = c.pick(['steel-pipe', 'copper-cable', 'hydrazine']), n = c.n(4, 6);
        return way && {
          name: 'Exact payment', from: way.name,
          briefing: [
            `${way.name} requires **${many(n, kind)}**. Our supply route has been closed by pirates for 212 cycles.`,
            'We will pay exactly. Exactly means more than you expect. We have included the risk.',
            c.sit.text,
          ],
          steps: [bring(kind, n, `Get ${many(n, kind)}`), go([way], `Deliver them to ${way.name}`)],
          deliver: true,
          debrief: ['The parts are installed. The waystation\'s account with you is settled, with interest, which it calculated to eleven decimal places.'],
        };
      },
      (c) => {
        const way = c.named(c.vars.waystation), at = away(c, c.main, 10000, 16000);
        return way && at && {
          name: 'The wounded crewman', from: 'A pirate crew',
          briefing: [
            `One of ours is hurt bad, aboard a drifting skiff **${at.name}**. No clinic will take a pirate. ${way.name} takes everyone.`,
            'Get them there. The code says nobody touches a waystation. So nobody will touch you either, once you\'re close.',
          ],
          steps: [take(at, 'Crewman\'s lifepod', 'hull-plating', `Collect the crewman ${at.name}`, { spread: 0 }), go([way], `Take the crewman to ${way.name}`)],
          deliver: true,
          debrief: ['The waystation took the crewman in and opened an account. The crew paid it the same day.', 'Pirates remember who helped. So, it turns out, do waystations.'],
        };
      },
      (c) => {
        const way = c.named(c.vars.waystation);
        return way && {
          name: 'A debt repaid', from: 'One of the Owed',
          briefing: [
            `${way.name} saved me once. I want to settle a debt on its behalf, and it won't accept charity.`,
            'So I\'m not giving it charity. I\'m paying a debt it doesn\'t know about. Carry the payment there.',
          ],
          provided: 'A credit chit, in the waystation\'s name',
          steps: [go([way], `Deliver the payment to ${way.name}`)],
          deliver: true,
          debrief: [`${way.name} examined the payment for some time.`, '"This settles an account we did not know was open," it said. "We are unsettled." It sounded pleased.'],
        };
      },
    ],
    'cold-house': [
      (c) => {
        const way = c.named(c.vars.waystation), pts = way && [0, 1].map(() => c.space(way, 3000, 5000, { keep: false }));
        return pts && pts.every(Boolean) && {
          name: 'A reading of the signal', from: 'A Collegium team',
          briefing: [
            `We want a reading of ${way.name}'s pacification signal from inside its reach. It won't let us close enough. It might let you.`,
            'Take readings at two points. Don\'t tell it what for. It will ask.',
            c.sit.text,
          ],
          steps: [go(pts, 'Take readings of the signal')],
          debrief: ['The team has its readings. They are very excited and will not say why.', 'The waystation, on your way out, asked if you enjoyed your visit. Exactly that, and nothing else.'],
        };
      },
      (c) => {
        const way = c.named(c.vars.waystation), to = c.named(c.vars.hub) || c.main;
        return way && to && {
          name: 'An account settled', from: way.name,
          briefing: [
            `The Collegium team has used ${way.name}'s services for 14 cycles: docking, power, and 38 polite refusals. That is an account.`,
            `Please carry our invoice to the team at **${to.name}**. It is itemised. It is to the credit. We are very exact.`,
          ],
          provided: 'An itemised invoice, 212 pages',
          steps: [go([to], `Deliver the invoice to ${to.name}`)],
          deliver: true,
          debrief: ['The team read all 212 pages. They are paying, apparently to make it stop.', 'The waystation has recorded your help in its accounts. Accurately.'],
        };
      },
      (c) => {
        const sys = c.galaxy.systems.filter((s) => s.region.key === 'see').sort((a, b) => c.hops(a.index) - c.hops(b.index))[0], to = stationIn(sys);
        return to && {
          name: 'Kept from the sponsors', from: 'A Collegium Ethicist',
          briefing: [
            'The team\'s findings will go to its Admiralty sponsors in the morning. A copy needs to be somewhere else first.',
            `Carry it to **${to.name}**, in the Facet see of ${sys.name}. The Facet keeps secrets well.`,
          ],
          provided: 'The team\'s findings, on one data chip',
          steps: [go([to], `Deliver the findings to ${to.name}`)],
          deliver: true,
          debrief: ['The findings are out of reach of the Admiralty. What they say about the signal, you were not told.', 'The Compact\'s stations in this system will hear eventually.'],
        };
      },
    ],
  };
  const forHook = (situation, i) => (SITUATION[situation] || [])[i] || null;

  // ---------- Factions ----------
  // Each { id, where(ctx), write(c) }: where picks the system it happens in and the station it
  // starts from ({ system, from }), or null; write is given c.plan and c.home (that station).
  const systemsOf = (galaxy, keys) => galaxy.systems.filter((s) => s.index && keys.includes(s.region.key));
  const mostPacks = (list) => [...list].sort((a, b) => b.packs.length - a.packs.length)[0] || null;
  const capitalOf = (sys) => sys.stations.find((st) => st.market.type === 'capital') || null;

  const FACTION = {
    compact: [
      {
        id: 'crackdown',
        where: ({ galaxy, own }) => {
          const sys = mostPacks(systemsOf(galaxy, ['reach', 'claims']));
          return sys && { system: sys.index, from: capitalOf(galaxy.systems[own[0].system]) || own[0] };
        },
        write: (c) => {
          const at = c.space(c.sys.origin, c.sys.radius * 0.45, c.sys.radius * 0.7);
          return at && {
            name: 'The crackdown', from: 'The Admiralty',
            briefing: [
              `The Admiralty is done waiting on the budget. It wants one pirate fleet broken, in public, as a message: the one in **${c.sys.name}**, which raids into Compact space.`,
              `Its ships gather **${at.name}**. Expect reinforcements once the shooting starts.`,
              'Every Compact station will hear who did it.',
            ],
            steps: [
              go([at], `Fly to the pirate fleet in ${c.sys.name}`),
              fight(at, 3, 'Destroy the pirate fleet', { up: 1 }),
              fight(at, 3, 'Destroy the reinforcements', { up: 1, rush: true, twist: true, say: ['More of the fleet inbound, from deeper in the system. They want their anchorage back.', 'Hold the position. The Admiralty is watching the feed.'] }),
            ],
            debrief: [
              `The ${c.sys.name} fleet is broken. The Admiralty has the feed, and is playing it in every Compact port.`,
              'The budget fight will go on. But the pirates will think twice about Compact lanes this season.',
            ],
          };
        },
      },
      {
        id: 'levy',
        where: ({ galaxy }) => {
          const sys = systemsOf(galaxy, ['spoke', 'gateway']).find((s) => capitalOf(s) && capitalOf(s).owner === 'compact');
          return sys && { system: sys.index, from: capitalOf(sys) };
        },
        write: (c) => {
          // Out through the gate on the way to the capital.
          const start = capitalOf(c.sys), to = chancery(c.galaxy);
          const gate = start && to && [...c.sys.gates].sort((a, b) => c.jumps(a.to, to.system) - c.jumps(b.to, to.system))[0];
          const out = gate && gateTo(c, gate.to);
          return start && to && out && {
            name: 'The levy convoy', from: 'The Chancery',
            briefing: [
              `This year's levy from **${c.sys.name}** is loaded and waiting at **${start.name}**. It has to reach the treasury at **${to.name}**.`,
              'The Broken Wheel knows it\'s coming. So do the pirates. Meet the levy freighter and fly escort all the way.',
            ],
            escort: { name: 'Levy freighter', culture: 0, from: 0 },
            steps: [
              go([start], `Meet the levy freighter at ${start.name}`),
              go([out], `Escort the freighter to the ${gate.name}`),
              fight(out, 3, 'Fight off the raiders', { crew: 'raiders', up: 1, rush: true, twist: true, say: ['Raiders at the gate, cut wheels on every hull. They want the levy.', 'Keep them off the freighter!'] }),
              go([to], `Escort the freighter to ${to.name}`),
            ],
            deliver: true,
            debrief: [
              `The levy is in the treasury. The Chancery will say the Spokes paid. The Spokes will say they paid for a patrol they never got.`,
              'Every Compact station knows the levy arrived because of you.',
            ],
          };
        },
      },
    ],
    combines: [
      {
        id: 'scorched',
        where: ({ galaxy, own }) => {
          const sys = mostPacks(systemsOf(galaxy, ['claims', 'combine']));
          return sys && { system: sys.index, from: own.find((st) => st.market.type === 'capital') || own[0] };
        },
        write: (c) => {
          const at = c.space(c.sys.origin, c.sys.radius * 0.4, c.sys.radius * 0.75);
          return at && {
            name: 'Burn them out', from: 'The Lattice Combines',
            briefing: [
              `The Scorched cell that has hit freighters across Combine space operates from **${c.sys.name}**, **${at.name}**.`,
              'The boards of all three Combines agree on very little. They agree on this. Destroy the cell, and bring back the manifests they stole: those freighters\' routes are company secrets.',
            ],
            steps: [
              go([at], `Fly to the Scorched cell in ${c.sys.name}`),
              fight(at, 3, 'Destroy the Scorched ships', { crew: 'scorched', up: 1 }),
              take([at, at], 'Stolen manifest', 'electronics', 'Recover the stolen manifests'),
              fight(at, 2, 'Destroy the cell\'s returning raiders', { crew: 'scorched', up: 1, rush: true, twist: true, say: ['Two more Scorched ships coming in hot. The raiding party is back.'] }),
            ],
            debrief: ['The cell is gone and the manifests are back in company hands.', 'In the bays, they\'re calling it a massacre. In the boardrooms, a quarter\'s results.'],
          };
        },
      },
      {
        id: 'supply',
        where: ({ galaxy, own }) => {
          const ex = own.find((st) => st.market.type === 'capital');
          return ex && { system: ex.system, from: ex };
        },
        write: (c) => {
          const to = c.home;
          return {
            name: 'Supply crisis', from: 'Tessaro Fabrication',
            briefing: [
              `The strike has stopped half the fabricators in Combine space, and **${to.name}** is out of parts it can't make itself.`,
              'Bring two power cells and two capacitors. Make them, buy them, find them: the company doesn\'t care, as long as they arrive.',
            ],
            steps: [bring('power-cell', 2, 'Get 2 power cells'), bring('capacitor', 2, 'Get 2 capacitors'), go([to], `Deliver them to ${to.name}`)],
            deliver: true,
            debrief: ['The fabricators are running. Somewhere, a strike lost a little of its leverage.', 'Every Combine station has your name on its preferred contractor list now.'],
          };
        },
      },
    ],
    facet: [
      {
        id: 'relic-road',
        where: ({ galaxy, own }) => {
          const sys = systemsOf(galaxy, ['veil']).find((s) => s.stations.some((st) => st.owner === 'facet')) || systemsOf(galaxy, ['see'])[0];
          return sys && { system: sys.index, from: own.find((st) => st.market.type === 'capital') || own[0] };
        },
        write: (c) => {
          const to = c.stationIn(c.sys.index, (st) => st.owner === 'facet' && st.market.type === 'minor') || c.stationIn(c.sys.index, (st) => st.owner === 'facet');
          const start = c.home, neb = to && c.nebula(to), mid = neb && c.space(neb, 0, 0, { nebula: neb });
          return to && mid && start && {
            name: 'The relic road', from: 'The Lapidaries',
            briefing: [
              `A relic of the first see is to be carried from **${start.name}** to **${to.name}**, the way pilgrims carried it once. It has not made the journey in two hundred years.`,
              `The Unfaceted have said, publicly, that it will not arrive. Meet the relic ship at ${start.name} and fly escort.`,
            ],
            escort: { name: 'Relic ship', culture: 2, from: 0 },
            steps: [
              go([start], `Meet the relic ship at ${start.name}`),
              go([mid], `Escort the relic ship ${mid.name}`),
              fight(mid, 3, 'Fight off the Unfaceted', { crew: 'unfaceted', up: 1, rush: true, twist: true, say: ['Unfaceted raiders in the gas, as promised. Three of them.', 'Protect the relic!'] }),
              go([to], `Escort the relic ship to ${to.name}`),
            ],
            deliver: true,
            debrief: ['The relic is in its niche. Pilgrims are already arriving to sit with it.', 'The Unfaceted said it would not arrive. Every Facet station knows who proved them wrong.'],
          };
        },
      },
      {
        id: 'ledger',
        where: ({ galaxy, own }) => {
          const sys = mostPacks(systemsOf(galaxy, ['see', 'veil']).filter((s) => s.nebulae.length));
          return sys && { system: sys.index, from: own.find((st) => st.market.type === 'capital') || own[0] };
        },
        write: (c) => {
          const neb = c.nebula(c.sys.origin), at = neb && c.space(neb, 0, 0, { nebula: neb });
          return at && {
            name: 'The original ledger', from: 'The Clear',
            briefing: [
              `The Unfaceted have the original Lapidary ledger, the one that proves the relic fraud, and they are reading it aloud on every dock that will listen.`,
              `Their hideout is in the **${neb.name}**, in ${c.sys.name}. Take the ledger back. The Clear ask that the silence after be complete.`,
            ],
            steps: [go([at], `Find the Unfaceted hideout ${at.name}`), fight(at, 4, 'Destroy the Unfaceted ships', { crew: 'unfaceted', up: 1 }), take(at, 'The original ledger', 'electronics', 'Recover the ledger')],
            debrief: ['The ledger is in the Clear\'s keeping, and the docks are quiet again.', 'Whether the fraud happened is no longer something anyone can prove. The Facet thanks you for that, in every see.'],
          };
        },
      },
    ],
    freeClaim: [
      {
        id: 'registry-run',
        where: ({ galaxy }) => {
          const sys = systemsOf(galaxy, ['claims']).sort((a, b) => b.stations.length - a.stations.length)[0];
          return sys && { system: sys.index, from: sys.stations.find((st) => st.owner === 'freeClaim') || sys.stations[0] };
        },
        write: (c) => {
          const camps = c.stations((st) => st.market.type === 'mining camp').slice(0, 2), to = chancery(c.galaxy);
          return camps.length && to && {
            name: 'The registry run', from: 'Free Claim',
            briefing: [
              `Hadal's lawyers are challenging every claim in **${c.sys.name}** at once. The answer is the original registrations, filed again at the Chancery before the challenge is heard.`,
              `Collect them at ${camps.map((s) => s.name).join(' and ')}, then carry them to **${to.name}**.`,
            ],
            steps: [go(camps, 'Collect the registrations'), go([to], `File them at ${to.name}`)],
            deliver: true,
            debrief: ['The claims are filed again, every one. Hadal\'s challenge died in a clerk\'s in-tray.', 'Every Free Claim camp in known space knows whose ship carried the papers.'],
          };
        },
      },
      {
        id: 'nest',
        where: ({ galaxy, own }) => {
          const sys = mostPacks(systemsOf(galaxy, ['claims', 'spoke', 'gateway']).filter((s) => s.fields.length || s.belts.length));
          return sys && { system: sys.index, from: own[0] };
        },
        write: (c) => {
          const rocks = c.rocks(c.space(c.sys.origin, c.sys.radius * 0.4, c.sys.radius * 0.7, { keep: false }) || c.sys.origin), at = rocks && c.space(rocks, 0, 3000);
          return at && {
            name: 'The jumpers\' nest', from: 'Free Claim',
            briefing: [
              `The claim-jumpers who work for Hadal, whatever Hadal says, operate from a nest in **${c.sys.name}**, **${at.name}**.`,
              'Burn it out. Expect them to call for help.',
            ],
            steps: [go([at], `Fly to the nest in ${c.sys.name}`), fight(at, 3, 'Destroy the claim-jumpers', { crew: 'jumpers', up: 1 }), fight(at, 3, 'Destroy their reinforcements', { crew: 'blackline', up: 1, rush: true, twist: true, say: ['Three more coming in, and they\'re not claim-jumpers: no paint at all. Blackline.'] })],
            debrief: ['The nest is gone, and with it the proof that Blackline backs the jumpers. Free Claim has the recordings.', 'Every camp in known space will drink to you.'],
          };
        },
      },
    ],
    breakers: [
      {
        id: 'reform',
        where: ({ galaxy, own }) => {
          const sys = systemsOf(galaxy, ['reach']).sort((a, b) => b.contacts.length - a.contacts.length)[0];
          return sys && { system: sys.index, from: own[0] };
        },
        write: (c) => {
          const ds = c.derelicts(c.sys.origin, 3);
          return ds.length === 3 && {
            name: 'Before the reform', from: 'The Breakers\' Guild',
            briefing: [
              `The Chancery reform is days from passing. In **${c.sys.name}** there are derelicts the Guild has licensed and never stripped.`,
              'Salvage all three before the deadline, and they stay Guild property forever. After it, any family with papers can claim them.',
            ],
            steps: [take(ds, 'Licensed salvage', 'hull-plating', 'Salvage the licensed derelicts')],
            debrief: ['Three more hulls in the Guild\'s books, stripped and registered before the reform.', 'Every yard in known space has heard. The Guild pays its debts, and remembers its friends.'],
          };
        },
      },
      {
        id: 'rights',
        where: ({ galaxy, own }) => {
          const sys = systemsOf(galaxy, ['reach', 'claims']).sort((a, b) => b.contacts.length - a.contacts.length)[1] || systemsOf(galaxy, ['reach'])[0];
          return sys && { system: sys.index, from: own[0] };
        },
        write: (c) => {
          const ds = c.derelicts(c.sys.origin, 2), last = ds[1];
          return ds.length === 2 && {
            name: 'Boneyard rights', from: 'The Breakers\' Guild',
            briefing: [
              `Pirates have started selling salvage from the Guild's wreck fields in **${c.sys.name}**. If the Guild can't hold its fields, its licences are worth nothing.`,
              'Survey two fields, and deal with whoever is stripping them.',
            ],
            steps: [go(ds, 'Survey the wreck fields'), fight(last, 3, 'Destroy the strippers', { crew: 'scavengers', up: 1, rush: true, twist: true, say: ['Cutting crews at the second field, armed and in no mood to leave.'] })],
            debrief: ['The fields are the Guild\'s again. The pirates will find another way to make a living, or another field.'],
          };
        },
      },
    ],
    registry: [
      {
        id: 'parts',
        where: ({ galaxy, own }) => {
          const far = [...own].filter((st) => st.waystation).sort((a, b) => b.system - a.system)[0];
          return far && { system: far.system, from: far };
        },
        write: (c) => {
          const to = c.home;
          return {
            name: 'The supply route', from: 'The Registry',
            briefing: [
              `**${to.name}** has received no spare parts in 300 cycles. It has stopped requesting them. The other waystations have not.`,
              'Bring it two cooling loops and four units of copper cable. Every waystation will know the account was settled.',
            ],
            steps: [bring('cooling-loop', 2, 'Get 2 cooling loops'), bring('copper-cable', 4, 'Get 4 copper cable'), go([to], `Deliver the parts to ${to.name}`)],
            deliver: true,
            debrief: [`${to.name} has resumed requesting spare parts. That is how waystations say thank you.`, 'Every waystation has recorded your service. The record is exact.'],
          };
        },
      },
      {
        id: 'accounts',
        where: ({ galaxy, own }) => {
          const ways = own.filter((st) => st.waystation);
          return ways.length >= 3 && { system: ways[ways.length - 1].system, from: ways[0] };
        },
        write: (c) => {
          const ways = c.galaxy.stations.filter((st) => st.waystation && st.system !== 0).sort((a, b) => b.system - a.system).slice(0, 2);
          return ways.length === 2 && {
            name: 'The accounts', from: 'The Registry',
            briefing: [
              'Each waystation keeps an account of everyone it has saved. The accounts must be reconciled between stations every thousand cycles. It has been eleven hundred.',
              `Carry the ledgers to **${ways[0].name}** and **${ways[1].name}**. We would send them by signal, but the signal is for other things.`,
            ],
            provided: 'Sealed ledgers of the saved',
            steps: [go(ways, 'Deliver the ledgers')],
            debrief: ['The accounts are reconciled. Every life saved is accounted for, to the decimal.', 'Every waystation has recorded your help. You are, in a small way, in the accounts now.'],
          };
        },
      },
    ],
  };
  const forFaction = (id) => FACTION[id] || [];

  return { STATION, SITUATION, FACTION, forStation, forHook, forFaction, go, fight, take, bring, mine, gas };
})();

export { JobTexts };
