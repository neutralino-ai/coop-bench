# The Crew environments: exact supported boundaries

Verified and implemented: 2026-09-16. Source code: `src/games/crew.ts`; tests: `test/crew.test.ts`.

## Source gate and accepted scenarios

| Adapter | Accepted scenario IDs | Complete data used |
|---|---|---|
| `crew-deep-sea` | `official-promo-1`, `official-promo-1-three-tricks` | Official 40-card deck, English base rules, Kosmos Promo 1 and its printed follow-up |
| `crew-planet-nine` | `official-mission-1`, `official-mission-2`, `official-mission-3` | Official 40-card playing deck, 36 ordinary-card task deck, English rules, IELLO logbook excerpt |

Both support **3, 4 and 5 players**. Three-player deals contain 14/13/13 cards; the spare card is not played after the thirteenth trick. The two-player virtual crewmate and optional three-player reduced-deck variant are not included.

The publisher's [Planet Nine logbook download](https://iello.fr/wp-content/uploads/2020/05/The-Crew_Log-Book.pdf) is only four pages, not the whole campaign. Page 4 was rendered and inspected: Mission 1 has one task; Mission 2 has two; Mission 3 has two with order tokens 1 and 2. Task selection starts with the trump-4 commander and proceeds clockwise without passing.

The [Deep Sea Promo](https://cms.kosmos.de/Downloads/Die%20Crew/Crew_2_Promo_Cards_DE.pdf) was also rendered and inspected. Promo 1 uses the trump-1 holder as captain; an all-trump captain causes a redeal. The captain must capture exactly two tricks without any 7/8/9. The printed follow-up changes the target to three. It does not need the unavailable 96-card task deck. **It is not main-campaign Mission 1.** Promo 2 and the main campaign remain excluded because the required task-deck data is incomplete.

Rule sources: [Planet Nine English rulebook](https://www.thamesandkosmos.com/manuals/full/691868_Crew_Manual.pdf), [Deep Sea English rulebook](https://www.thamesandkosmos.co.uk/wp-content/uploads/2021/02/691869_Crew_Deep-Sea_Manual.pdf). Rules are independently implemented as numeric mechanics; no third-party engine code or card artwork was incorporated. The publisher PDFs retained under `sources/crew-*` are evidence, not a claim of redistribution or training-data permission.

## Interface and flow

```text
Optional external lobby (no hands exposed)
  → setup / deal
  → select_task (Planet Nine only)
  → distress_vote (unanimous none / left / right)
  → distress_pass (if assistance chosen; sealed simultaneous exchange)
  → between tricks: optional communicate, or leader play
  → play in clockwise order → resolve trick
  → repeat until official objective succeeds or fails
```

| Action | Fields | Who can act | Visibility |
|---|---|---|---|
| `select_task` | `taskId` | Current task selector | Public task ownership |
| `distress_vote` | `direction: none/left/right` | Any player before signaling | Public agreement; votes can be revised |
| `distress_pass` | `cardId` | Each uncommitted player | Private commitment; all cards transfer together |
| `communicate` | `cardId`, `relation: highest/lowest/only` | Any player with an unused token between tricks | Public revealed ordinary card and token relation |
| `play` | `cardId` | Current player | Public played card |

`observe` and `legalActions` are reads. `step` clones its input; illegal actions cannot change the state. Every returned legal-action entry contains examples enumerating its actual legal choices. Rules apply even if an agent submits an action absent from those examples.

The agreement and sealed-commit phases implement table consensus and simultaneous handoff over an API. `left` means the next listed seat; `right` means the previous. These protocol controls do not create an unrestricted post-deal chat channel. The base rules allow discussion of already-public information; this environment exposes that information directly but offers no semantic chat adjudicator. Private-hand discussion remains prohibited.

Signal actors are not fixed into a turn order: any eligible player may signal before the leader opens a trick. `activePlayers` lists the leader first for convenient scheduling, then potential signal actors based on public token state. It deliberately does not inspect others' hidden suit composition to decide that public list. A potential signal actor may have zero legal signals if only trumps remain. A sequential runner can select the leader to progress; a richer runner should allow other players to signal before starting the trick.

## State and information boundaries

- Full hands, pending transfer selections and redeal count exist only in server state.
- A player observes their own hand, public tasks, visible communication cards, the current trick, the most recently completed trick and public trick counts.
- A pending `distress_pass` does not alter any other player's observation or legal actions. No list of submitted players appears in observations. The coordinator's `activePlayers` is a scheduling interface, not a public game observation.
- Never broadcast raw action payloads: `distress_pass.cardId` is secret. Player-facing event streams must contain authorized observations or explicitly filtered public events.
- A fresh observation does not expose all previous captured cards. Agents may remember earlier observations; historical transcript availability should be a separate benchmark policy.
- Terminal observations retain hand privacy. Privileged audit records may access the true state, never as the acting policy's input.
- Signal tokens stay used after the displayed card is played. A token relation is not changed when other cards leave the hand. A singleton is communicated as `only`.

## Verification and training result

Planet Nine ends successfully as soon as all assigned tasks are captured by their owners in the required order. Wrong owners and wrong task order fail immediately. Consecutive ordered tasks in the same trick are accepted by the shared evaluator, though Missions 1–3 normally assign the two tasks to different players.

Deep Sea never declares success simply because the captain has reached two or three tricks: the exact total is settled after the final trick. A forbidden card or excess captured trick fails immediately. The public remaining-trick bound can also establish failure. No hidden-hand feasibility solver causes early termination.

Both return a team binary score. One episode is one attempt; terminal privileged details include distress use and an attempt-logbook cost of 1 or 2. A later campaign runner must preserve an activated distress marker over retries; starting a fresh episode does not itself implement campaign history.

Validation: 12 rule/privacy tests pass, including **180 complete seeded rollouts** spanning all five supported scenario IDs and every supported player count. Rollouts use a simple legal-action policy, not a claim about LLM playing strength. Coverage includes follow-suit obligations, trump resolution, task ownership/order, no early Promo success, redeals, simultaneous exchange, communication limits, state immutability and the three-player leftover card.

Run:

```powershell
node --test test/crew.test.ts
```
