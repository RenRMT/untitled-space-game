# 4X: research on building on a portrait phone

Nov 6, 2026

Research behind the building prototypes on the 4X page (`/4x/`, `src/4x/building.js`): how mobile
strategy games, and builders generally, let the player put a structure down and take it away, held up
against the 4X map. As with the movement prototypes (`notes/4x-movement-research.md`), the aim is a few
of the patterns, each built plainly, to compare on a phone before one is chosen. The searches turned up
no design write-up on building for touch in a 4X; the findings below come from reviews, forum threads
and builders' notes, and should be read as practice rather than tested results.

## The play area, as it bears on building
- **Where a station goes is fixed by the orbit rules.** A station goes round a planet or a moon, at most
  one round each (`src/4x/orbits.js`), so placing one is choosing a body, not a free point: the body is
  the slot.
- **Bodies are small and move.** At the system zoom a moon is a 2 px dot beside its planet, and every
  body is on an orbit; a station on its orbit folds into its body until the view is close in.
- **Two kinds for now**: an Outpost (`station-minor` art) and a Starbase (`station-major` art), the same
  rules for both (`World4X.STATIONS`).

## Findings
1. **Slots, not free placement.** Mobile 4X builders put buildings in fixed plots: A Planet of Mine's
   planet is a wheel of segments played with one thumb in portrait, and running out of them pushes the
   player outward; Starbase Orion gives each planet a number of plots by its size. Here a body is the
   slot, and a drag or a tap snaps to it.
2. **Place, then pick what** (a menu or card on the place) is the plainest pattern: tap the tile or
   planet, choose from what it can take (Polytopia, Starbase Orion's planet screen).
3. **Pick what, then place a ghost, then confirm.** City builders and base builders show a translucent
   preview, coloured for valid (green) or not (red), committed with an explicit confirm, with Cancel as
   an on-screen button because touch has no keys. Separate the preview from the commit; keep the kind
   chosen after placing, for repeats (OpenFrontIO keeps its ghost up after a build for this).
4. **Drag from the shop onto the map**: one gesture, the ghost under (or above) the finger, snapping;
   let go to build.
5. **Show why not before the commit, in colour.** Tooltips don't exist on touch; colour-code what's
   possible (a 4X player on touch asking for green/red requirements).
6. **Taking away is destructive**: a confirm, or an Undo straight after. Undo is quicker when mistakes are
   rare; confirm is safer when the thing is costly.
7. **Feedback while it's built**, and build controls in the thumb zone (the tray and the card along the
   bottom).

## The prototypes (`?build=`, or the header's Build button, then the scheme button to cycle)
| Scheme | How a station is built, and taken away | From |
| --- | --- | --- |
| `menu` | tap a planet or moon: the card offers Build Outpost / Build Starbase, done at once, Undo on the card for 4 s; tap a station (or a body with one): Dismantle, at once, with Undo | 1, 2, 6 |
| `ghost` | pick Outpost or Starbase in the tray: the bodies it can go round ringed green, the taken ones red; tap one: a ghost on its orbit, then Build or Cancel on the card (a taken one says which station is there); the kind stays picked. Remove in the tray: tap a station, then Dismantle | 1, 3, 5, 6 |
| `drag` | drag a kind out of the tray: the ghost follows the finger and snaps to a planet or moon within 40 px, green if it can go there, its name and the body's above the finger; let go to build, on the tray to put it back. Press a station and drag it more than 60 px off (or onto the tray's bin), let go to dismantle; back on it, it stays | 1, 4, 5 |

In every scheme a new station takes 2 s to finish (a ring fills round it), ships parked round a
dismantled station park round its body, and ships on their way to it go to its body instead. In build
mode a long press gives no move order. `?testbed` has planets and moons with no station yet; in the
default start the one planet already has its station, to dismantle first.

## What to watch for in play
- Building on the wrong body: a moon close by its planet at the system zoom, and whether snapping helps.
- Undo against confirm: which feels safer, and whether Undo is noticed in time.
- Whether the tray earns its space over the card, one-handed.
- Dragging a station off to remove it: found without being told? Done by accident while panning?
- Building on several bodies in a row: which scheme is quickest.

## Sources
- A Planet of Mine: https://toucharcade.com/2017/07/14/toucharcade-game-of-the-week-a-planet-of-mine/
- Starbase Orion review: https://toucharcade.com/2011/10/14/starbase-orion-review
- 4X on touch tablets (colour-coded requirements): https://www.gog.com/forum/general/to_4x_turn_based_strategy_fans_who_are_also_android_tablet_owners/page5
- OpenFrontIO, keeping the ghost up on mobile: https://github.com/openfrontio/OpenFrontIO/pull/2914
- Builder UX (preview, command, history; valid / invalid colours): https://www.skills.lc/Bbeierle12/Skill-MCP-Claude/bbeierle12-skill-mcp-claude-skills-builder-ux-skill-md
- Build controls on mobile (on-screen Cancel, place then confirm): https://devforum.roblox.com/t/how-should-i-make-build-controls-for-mobile-and-console-devices/3301082
- A confirm button for placing a base: https://forums.frontier.co.uk/threads/add-a-confirm-button-when-placing-a-ground-base.634892
- Hypemasters, mobile RTS interface: https://medium.com/hypemasters/mobile-rts-interface-the-story-of-how-hypemasters-rediscovered-the-genre-dc7fbaa5b05c
