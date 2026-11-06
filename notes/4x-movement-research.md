# 4X: research on moving units on a portrait phone

Nov 6, 2026

Research behind the movement prototypes on the 4X page (`/4x/`, `src/4x/movement.js`): how mobile
strategy games, and touch interfaces generally, let the player send a unit somewhere, held up against
the 4X map. The aim is a few of the patterns that the sources back, each built as plainly as it can be
and still played, to compare on a phone before one is chosen. Several primary sources (the Hypemasters
article on Medium, an iPad RTS study on core.ac.uk) couldn't be opened from the session that wrote
this; their findings are taken from search summaries and should be read again first-hand.

## The play area, as it bears on movement
- **One map from flight to galaxy.** At the system zoom, ships are 6 px darts and planets and moons
  dots of 3 to 7 px; a ship parked round a station folds into its planet. Destinations are often off
  screen at the flight zoom.
- **Things move.** Planets, moons and stations are on orbits, so a ship sent to one chases where it
  is now.
- **Portrait.** The header across the top, the picked thing's card along the bottom (the thumb's
  reach), and the canvas already taking one-finger drags (pan), pinches (zoom), taps (pick) and long
  presses (order).
- **Where a ship can go** (decided with these prototypes): to a station, planet or moon, where it
  parks in orbit, or to any point in space, where it holds position (`hold` in `4x/orbits.js`).

## Findings
1. **Single touch first; one-finger drag on empty space is the camera's.** An iPad RTS redesign ranked
   single-touch simplicity first, kept gestures to two fingers, and gave orders a clear cancel. A web
   RTS's mobile controls separate a tap from a drag by about 10 px and take a long press at about
   500 ms. General touch guidance: forgive jitter in a tap, update a drag every frame, judge a gesture
   on release.
2. **Tap the unit, then tap the target**, is the baseline on phones (Polytopia, Auralux: "select a
   planet and then select a destination"). The Total War mobile port names mis-selection and
   accidental orders as the main risk, so a target tap should show the order before it's given, and a
   second, deliberate touch should give it.
3. **Drag from the unit to the target.** Galcon ("tap or drag from one of your planets to a target")
   and Galactic Strategist ("tap your planet, swipe to the target"). One gesture, quick; the finger
   covers the target, so what it's over is shown beside or above it, and the drag snaps to things.
4. **Hold and draw a path.** Feral's Empire on mobile ("tap and hold to draw a movement path for your
   units to follow"); draw-to-move prototypes drop a waypoint every so many px of the stroke.
5. **Units are small on a phone.** Hypemasters found their units too small to tap and couldn't zoom
   in; they gave units callsigns, and players used single selection almost exclusively (box and button
   group selection went unused). Larger hit areas, snapping, and names over the units help.
6. **The thumb zone.** Frequent actions in the lower third of the screen (A Planet of Mine plays
   one-handed in portrait); sheets suit short tasks over a map that stays in view. Radial menus are
   disputed on phones, and are left out.

## The prototypes (`?move=`, or the header's Move button to cycle)
| Scheme | How an order is given | From |
| --- | --- | --- |
| `button` | Move on the card, then a place or a point (the first version, kept to compare against) | 2 |
| `tap` | with a ship picked, the places it can go are ringed; a tap on a place (snapping 24 px) or a point shows the route and ETA, and Send (or the same tap again) gives it; Cancel, Done drops the pick | 1, 2, 5, 6 |
| `drag` | press a ship and drag: a line to the finger, snapping to a place within 40 px, its name and ETA written above the finger; let go to send, or back on the ship to cancel; a drag from anywhere else pans | 1, 3, 5 |
| `path` | press a ship and hold 300 ms (a ring fills), then draw: a stop every 48 px (at most 12), the end snapping to a place; let go to send it along; a quick drag pans | 1, 3, 4 |

In every scheme a right-click or a long press (500 ms) on a place or a point sends the picked ship
there, the drag threshold is 10 px, the player's ships are always drawn and can be picked (28 px
across at least), and `?testbed` gives the whole start system with three ships to try them on.

## What to watch for in play
- Orders given by mistake, and orders given to the wrong place (at the system zoom, a moon close by
  its planet).
- The time from picking a ship to the order given, at the flight zoom and the system zoom.
- Whether it's comfortable one-handed: where the thumb has to go, and what the finger covers.
- Panning and zooming while a ship is picked: does the scheme get in the way of the camera?
- Off-screen destinations: zooming out mid-order, or giving up and using another scheme.
- Paths: whether anyone wants more than one stop, and whether the stroke is accurate enough.

## Sources
- Hypemasters, mobile RTS interface: https://medium.com/hypemasters/mobile-rts-interface-the-story-of-how-hypemasters-rediscovered-the-genre-dc7fbaa5b05c
- Touch controls, input patterns and feedback: https://cursa.app/en/page/touch-controls-for-mobile-games-input-patterns-and-feedback
- A web RTS's mobile controls: https://fog-of-war-c771d20fa90e.herokuapp.com/controls
- Feral, Empire on mobile: https://feralinteractive.com/de/games/empiremobile/android-ios/building-an-empire
- Galactic Strategist: https://playgama.com/game/galactic-strategist
- Galcon review: https://www.tapsmart.com/games/review-galcon/
- Auralux: https://androidcentral.com/auralux-hits-tegra-zone-and-google-play-today-its-rts-style
- Construct RTS devlog, input and gestures: https://www.construct.net/en/blogs/ashleys-blog-2/rts-devlog-input-gestures-1602
- A Planet of Mine: https://toucharcade.com/2017/07/14/toucharcade-game-of-the-week-a-planet-of-mine/
- The thumb zone: https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users
- Gesture-based radial menus: https://lmjabreu.com/post/gesture-based-radial-menus
- Total War on mobile, touch controls: https://r2enc.totalwar.com/en/manual/single-player/0005_enc_page_help_keyboard_shortcuts
