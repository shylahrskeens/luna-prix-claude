/** Every menu screen.
 *
 *  Each screen is a function that renders DOM and wires its own handlers
 *  against a small app interface. No framework, no shared mutable view state:
 *  a screen is rebuilt from the profile whenever it is shown, so it can never
 *  display a stale number.
 */
import { el, clear, mount, statBar, kv, chip, confirmDialog } from './dom';
import { formatTime, clamp } from '../core/math';
import { AXIES, CLASS_TRAIT, resolveAxieStats, type AxieDefinition } from '../data/axies';
import { KARTS, STAT_KEYS, STAT_LABEL, STAT_BLURB, type KartDefinition, type StatKey } from '../data/karts';
import { PARTS, SLOTS, RARITY_COLOR, levelCurve, partById, partsForSlot, type PartDefinition } from '../data/parts';
import { TRACKS } from '../data/tracks/index';
import { BONUS_EVENTS, type BonusEventDefinition } from '../data/bonus';
import { MODE_RULES, divisionFor, RULES_VERSION, type Mode } from '../data/rules';
import { resolveLoadout, statTotal, type LoadoutParts } from '../sim/loadout';
import { Hud } from './hud';
import { controlCard, type Device } from './input';
import type { Profile } from '../persist/store';
import { bonusFor, recordFor, DEFAULT_KEYBINDS } from '../persist/store';
import type { RaceResult } from '../sim/race';
import type { BonusScore } from '../game/bonusRun';

export type ScreenName =
  | 'home' | 'axie' | 'garage' | 'shop' | 'trackSelect' | 'results'
  | 'boards' | 'settings' | 'bonusSelect' | 'bonusResults' | 'controls'
  | 'multiplayer';

export interface AppApi {
  profile: Profile;
  save(): void;
  go(screen: ScreenName, params?: Record<string, unknown>): void;
  back(): void;
  startRace(mode: Mode, trackId: string): void;
  startBonus(eventId: string): void;
  /** Multiplayer: connect, join, ready up, and race what the server runs. */
  net: {
    url: string | null;
    setUrl(url: string | null): void;
    status(): string;
    lobby(): import('../net/adapter').LobbyState | null;
    connectAndJoin(trackId: string, mode: Mode): Promise<void>;
    setReady(ready: boolean): void;
    leave(): void;
    onChange(fn: () => void): () => void;
    lastError: string | null;
  };
  device: Device;
  showcase(on: boolean): void;
  sfx(kind: string, value?: number): void;
  applySettings(): void;
  screenHost: HTMLElement;
}

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

/** A real frame of the game as card art (see captureSink in vite.config.ts). */
function art(src: string): HTMLElement {
  return el('div', { class: 'art' }, el('img', { src, alt: '', loading: 'lazy', draggable: false }));
}

/** Prose lives behind a tap. The player who wants it gets it; the one who
 *  wants to race is not made to read past it. */
function more(label: string, ...content: (Node | string | null)[]): HTMLElement {
  return el('details', { class: 'more', onClick: (e: Event) => e.stopPropagation() },
    el('summary', { text: label }),
    el('div', { class: 'more-body' }, ...content),
  );
}

function topbar(app: AppApi, title: string, backTo?: ScreenName): HTMLElement {
  const p = app.profile;
  const div = divisionFor(p.rating);
  return el('div', { class: 'topbar' },
    backTo
      ? el('button', { class: 'ghost', onClick: () => { app.sfx('uiBack'); app.go(backTo); } }, '‹ Back')
      : null,
    el('div', { class: 'brand' },
      el('div', { class: 'mark', text: 'LUNA PRIX' }),
      el('div', { class: 'sub', text: title }),
    ),
    el('div', { class: 'spacer' }),
    chip('Coins', String(p.coins), false, 'topbar-coins'),
    chip(div.name, String(p.rating), true),
  );
}

/** Refresh the live numbers in the topbar without rebuilding the screen —
 *  buying a part has to change the coin count you are looking at. */
function refreshTopbar(app: AppApi): void {
  const node = document.getElementById('topbar-coins');
  if (node) node.textContent = String(app.profile.coins);
}

function statsPanel(
  title: string,
  stats: Record<StatKey, number>,
  preview?: Record<StatKey, number>,
  footer?: HTMLElement | null,
): HTMLElement {
  return el('div', { class: 'panel' },
    el('h3', { text: title }),
    el('div', { style: 'margin-top:10px;display:flex;flex-direction:column;gap:7px' },
      ...STAT_KEYS.map((k) => statBar(STAT_LABEL[k], stats[k], preview?.[k])),
    ),
    footer ?? null,
  );
}

function axieCard(a: AxieDefinition, selected: boolean, onPick: () => void): HTMLElement {
  const s = resolveAxieStats(a);
  const trait = CLASS_TRAIT[a.class];
  return el('div', {
    class: `card${selected ? ' selected' : ''}`,
    onClick: onPick,
    role: 'button',
    tabindex: 0,
    onKeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') onPick(); },
  },
    el('div', { class: 'tag', text: a.class }),
    el('div', { class: 'title', text: a.name }),
    el('div', { class: 'sub', text: a.tagline }),
    el('div', { style: `height:4px;border-radius:2px;margin:4px 0;background:linear-gradient(90deg,${a.palette.body},${a.palette.accent})` }),
    el('div', { class: 'row', style: 'gap:6px' },
      chip('HP', String(s.hp)), chip('SPD', String(s.speed)),
      chip('SKL', String(s.skill)), chip('MOR', String(s.morale)),
    ),
    el('div', { class: 'hint', style: 'margin-top:4px' }, el('strong', { style: 'color:var(--accent-2)', text: trait.name }), ` — ${trait.blurb}`),
  );
}

function kartCard(k: KartDefinition, selected: boolean, onPick: () => void): HTMLElement {
  return el('div', { class: `card${selected ? ' selected' : ''}`, onClick: onPick, role: 'button', tabindex: 0 },
    el('div', { class: 'tag', text: k.archetype }),
    el('div', { class: 'title', text: k.name }),
    el('div', { class: 'sub', text: k.tagline }),
    el('div', { style: `height:4px;border-radius:2px;margin:4px 0;background:linear-gradient(90deg,${k.palette.body},${k.palette.trim})` }),
    more('About', el('div', { class: 'hint', text: k.bio })),
  );
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------

export function homeScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const div = divisionFor(p.rating);
  const axie = AXIES.find((a) => a.id === p.axieId)!;
  const kart = KARTS.find((k) => k.id === p.kartId)!;

  // A mode is a picture of the thing you are about to do, with its name.
  const tile = (label: string, sub: string, img: string, fn: () => void) =>
    el('button', { class: 'tile', title: sub, onClick: () => { app.sfx('uiSelect'); fn(); } },
      art(img),
      el('span', { class: 'tile-label', text: label }),
    );
  const ghost = (label: string, screen: ScreenName) =>
    el('button', { class: 'ghost', onClick: () => { app.sfx('uiSelect'); app.go(screen); } }, label);

  return el('div', { class: 'screen showcase' },
    topbar(app, 'Axie kart racing'),
    el('div', { class: 'body' },
      el('div', { class: 'col scroll', style: 'width:min(420px,100%);flex:0 0 auto' },
        el('button', {
          class: 'primary big race-cta',
          onClick: () => { app.sfx('uiSelect'); app.go('trackSelect', { mode: 'quickRace' }); },
        }, el('span', { text: 'Race' }), el('span', { class: 'hint', text: 'three laps · seven rivals' })),
        el('div', { class: 'grid c2 tiles' },
          tile('Ranked', 'Normalised loadouts. Rating moves.', 'img/track-ruin.jpg', () => app.go('trackSelect', { mode: 'ranked' })),
          tile('Time Trial', 'Alone against the clock', 'img/track-cloudforge.jpg', () => app.go('trackSelect', { mode: 'timeTrial' })),
          tile('Bonus Events', 'Mega Ramp, Luna Launch, Gator Gauntlet', 'img/event-megaramp.jpg', () => app.go('bonusSelect')),
          // Multiplayer stays reachable from Settings until a race server is
          // hosted; a tile that leads to "Offline" is not a mode.
          tile('Garage', 'Kart, parts and paint', 'img/garage.jpg', () => app.go('garage')),
        ),
        el('div', { class: 'row' }, ghost('Records', 'boards'), ghost('Settings', 'settings')),
      ),
      el('div', { class: 'stage-gap' }, el('div', { class: 'caption', text: 'drag to turn' })),
      el('div', { class: 'col scroll', style: 'width:min(300px,100%);flex:0 0 auto' },
        el('div', { class: 'panel' },
          el('h3', { text: 'Your entry' }),
          el('div', { style: 'margin-top:8px' },
            kv('Driver', `${axie.name} · ${axie.class}`),
            kv('Kart', kart.name),
            kv('Division', `${div.name} · ${p.rating}`),
            kv('Record', `${p.wins} wins · ${p.podiums} podiums · ${p.races} races`),
          ),
          el('div', { class: 'row', style: 'margin-top:12px' },
            el('button', { onClick: () => { app.sfx('uiSelect'); app.go('axie'); } }, 'Change Axie'),
            el('button', { onClick: () => { app.sfx('uiSelect'); app.go('garage'); } }, 'Change kart'),
          ),
        ),
        el('div', { class: 'panel tight' }, more('Controls', Hud.controlCardPanel(app.device, p.settings.keybinds))),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// axie select
// ---------------------------------------------------------------------------

export function axieScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const list = el('div', { class: 'grid', style: 'grid-template-columns:1fr' });
  const detail = el('div', { class: 'col grow' });

  const render = () => {
    clear(list);
    for (const a of AXIES) {
      list.appendChild(axieCard(a, a.id === p.axieId, () => {
        p.axieId = a.id;
        app.sfx('uiSelect');
        app.save();
        app.showcase(true);
        render();
      }));
    }
    const a = AXIES.find((x) => x.id === p.axieId)!;
    const kart = KARTS.find((k) => k.id === p.kartId)!;
    const lo = resolveLoadout(a, kart, p.parts as LoadoutParts, {
      playerId: p.playerId, budget: MODE_RULES.quickRace.statBudget,
    });
    const s = resolveAxieStats(a);
    mount(detail,
      el('div', { class: 'panel' },
        el('h2', { text: a.name }),
        el('div', { class: 'row', style: 'margin-top:8px' },
          chip('Class', a.class, true),
          chip('Parts', `${a.parts.length}`),
          chip('Stat total', String(s.hp + s.speed + s.skill + s.morale)),
        ),
        more(`About ${a.name}`, el('p', { text: a.bio })),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Body parts' }),
        el('div', { style: 'margin-top:8px' },
          ...a.parts.map((part) => el('div', { class: 'kv' },
            el('span', { class: 'k', text: part.type.toUpperCase() }),
            el('span', { class: 'v' },
              part.name,
              el('span', { class: 'hint', style: 'margin-left:8px', text: part.class }),
            ),
          )),
        ),
        more('How parts work', el('div', { class: 'hint' },
          'Each part adds +3 to the stat its own class governs, exactly as an Axie does. Stats are recomputed from these parts, not stored.')),
      ),
      statsPanel('In the ' + kart.name, lo.stats),
    );
  };
  render();

  return el('div', { class: 'screen showcase' },
    topbar(app, 'Choose your Axie', 'home'),
    el('div', { class: 'body' },
      el('div', { class: 'col scroll', style: 'width:min(360px,100%);flex:0 0 auto' }, list),
      el('div', { class: 'stage-gap' }, el('div', { class: 'caption', text: 'drag to turn' })),
      el('div', { class: 'col scroll', style: 'width:min(380px,100%);flex:0 0 auto' }, detail),
    ),
    el('div', { class: 'row' },
      el('button', { class: 'primary big', onClick: () => { app.sfx('uiSelect'); app.go('garage'); } }, 'To the garage ›'),
    ),
  );
}

// ---------------------------------------------------------------------------
// garage
// ---------------------------------------------------------------------------

export function garageScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const host = el('div', { class: 'body' });

  const render = () => {
    const axie = AXIES.find((a) => a.id === p.axieId)!;
    const kart = KARTS.find((k) => k.id === p.kartId)!;
    const parts = p.parts as LoadoutParts;
    const lo = resolveLoadout(axie, kart, parts, {
      playerId: p.playerId, budget: MODE_RULES.quickRace.statBudget,
    });
    const ranked = resolveLoadout(axie, kart, parts, {
      playerId: p.playerId, budget: MODE_RULES.ranked.statBudget, normalize: true,
    });

    // --- kart column ---
    const kartCol = el('div', { class: 'col scroll', style: 'width:min(320px,100%);flex:0 0 auto' },
      el('h3', { text: 'Chassis' }),
      ...KARTS.map((k) => kartCard(k, k.id === p.kartId, () => {
        p.kartId = k.id;
        app.sfx('uiSelect');
        app.save();
        app.showcase(true);
        render();
      })),
    );

    // --- slots column ---
    // `flex:0 0 auto` so these keep their natural height inside the scrolling
    // parent. Without it the shared `.col { min-height: 0 }` lets them collapse
    // into each other.
    const slotCol = el('div', { class: 'col', style: 'flex:0 0 auto' });
    slotCol.appendChild(el('div', { class: 'row', style: 'justify-content:space-between;align-items:baseline' },
      el('h3', { text: 'Parts' }),
      el('span', { class: 'hint', text: 'Tap to fit · hover for numbers' }),
    ));
    for (const slot of SLOTS) {
      const fitted = parts[slot.id];
      const def = partById(fitted.partId);
      const candidates = partsForSlot(slot.id);

      //  Every part for the slot is shown, owned or not, with what it does and
      //  what it costs. Listing only what you already own makes a fresh garage
      //  look like a page of read-only labels — there is nothing that reads as
      //  buyable, and the shop is a button at the bottom of a scrolling column.
      const chips = candidates.map((cand) => {
        const ownedLvl = p.owned[cand.id] ?? 0;
        const isFitted = cand.id === fitted.partId;
        const affordable = p.coins >= cand.price;
        const mods = (Object.keys(cand.mods) as StatKey[])
          .map((key) => `${cand.mods[key]! > 0 ? '+' : ''}${(cand.mods[key]! * levelCurve(1)).toFixed(1)} ${STAT_LABEL[key]}`);

        const action = isFitted ? 'FITTED'
          : ownedLvl > 0 ? 'Fit'
          : `${cand.price}c`;

        return el('button', {
          class: `pill${isFitted ? ' primary' : ownedLvl > 0 ? '' : ' ghost'}`,
          title: mods.length ? mods.join(' · ') : 'Cosmetic only',
          style: ownedLvl === 0 && !affordable ? 'opacity:0.45' : undefined,
          disabled: ownedLvl === 0 && !affordable,
          onMouseenter: () => preview(cand, Math.max(1, ownedLvl)),
          onMouseleave: () => preview(null, 1),
          onClick: async () => {
            if (isFitted) { app.sfx('uiMove'); return; }
            if (ownedLvl === 0) {
              if (!affordable) { app.sfx('uiDenied'); return; }
              const ok = await confirmDialog(app.screenHost, `Buy ${cand.name}?`,
                `${cand.price} coins. It is fitted straight away, and swapping back to what you had is free.`,
                'Buy and fit');
              if (!ok) return;
              p.coins -= cand.price;
              p.owned[cand.id] = 1;
              app.sfx('uiBuy');
            } else {
              app.sfx('uiSelect');
            }
            parts[slot.id] = { partId: cand.id, level: Math.max(1, p.owned[cand.id] ?? 1) };
            app.save();
            app.showcase(true);
            render();
            refreshTopbar(app);
          },
        },
          // On the filled "fitted" background the rarity colour has no contrast,
          // so the name switches to the dark ink the primary button is built for.
          el('span', {
            style: `font-weight:700;color:${isFitted ? '#150d24' : RARITY_COLOR[cand.rarity]}`,
            text: cand.name,
          }),
          el('span', {
            class: 'pill-action',
            style: isFitted ? 'color:#120c1f' : ownedLvl > 0 ? 'color:var(--accent-2)' : 'color:var(--warm)',
            text: action,
          }),
        );
      });

      const canUpgrade = def.maxLevel > 1 && fitted.level < def.maxLevel;
      const row = el('div', { class: 'slot-row', title: slot.blurb },
        el('div', { class: 'slot-head' },
          el('span', { style: 'font-weight:700', text: slot.label }),
          el('span', { class: 'hint', text: def.maxLevel > 1 ? `L${fitted.level}/${def.maxLevel}` : '' }),
        ),
        el('div', { class: 'row', style: 'gap:6px' }, ...chips,
          canUpgrade
            ? el('button', {
                class: 'pill upgrade',
                title: `Upgrade ${def.name} to level ${fitted.level + 1}`,
                disabled: p.coins < def.upgradeCost,
                onClick: () => {
                  if (p.coins < def.upgradeCost) { app.sfx('uiDenied'); return; }
                  p.coins -= def.upgradeCost;
                  const lvl = Math.min(def.maxLevel, (p.owned[def.id] ?? 1) + 1);
                  p.owned[def.id] = lvl;
                  parts[slot.id] = { partId: def.id, level: lvl };
                  app.sfx('uiBuy');
                  app.save();
                  render();
                  refreshTopbar(app);
                },
              }, `▲ L${fitted.level + 1} · ${def.upgradeCost}c`)
            : null,
        ),
      );
      slotCol.appendChild(row);
    }
    slotCol.appendChild(el('div', { class: 'row', style: 'margin-top:4px' },
      el('button', { class: 'ghost', onClick: () => { app.sfx('uiSelect'); app.go('shop'); } }, 'Browse every part'),
    ));

    // --- stats column ---
    const statCol = el('div', { class: 'col', style: 'flex:0 0 auto' });
    const statHost = el('div');
    statCol.appendChild(statHost);

    const previewParts = (cand: PartDefinition | null, level: number): LoadoutParts => {
      if (!cand) return parts;
      const copy = { ...parts } as LoadoutParts;
      copy[cand.slot] = { partId: cand.id, level };
      return copy;
    };
    function preview(cand: PartDefinition | null, level: number): void {
      const next = cand
        ? resolveLoadout(axie, kart, previewParts(cand, level), {
            playerId: p.playerId, budget: MODE_RULES.quickRace.statBudget,
          })
        : null;
      mount(statHost,
        statsPanel('Open rules', lo.stats, next?.stats,
          el('div', { class: 'hint', style: 'margin-top:10px' },
            `Budget ${lo.budgetUsed.toFixed(1)} of ${lo.budgetMax}. `,
            lo.problems.length ? el('span', { style: 'color:var(--warm)', text: lo.problems[0] }) : 'Legal.',
          ),
        ),
        statsPanel('Ranked (normalised)', ranked.stats, undefined,
          el('div', { class: 'hint', style: 'margin-top:10px', text: `Ranked pulls every stat 30% back toward the ${kart.name} baseline and caps the budget at ${MODE_RULES.ranked.statBudget}. A build changes shape, never size.` }),
        ),
        el('div', { class: 'panel' },
          el('h3', { text: 'Driver' }),
          el('div', { style: 'margin-top:8px' },
            kv('Axie', `${axie.name} · ${axie.class}`),
            kv('Passive', CLASS_TRAIT[axie.class].name),
            kv('Total', statTotal(lo.stats).toFixed(0)),
            kv('Rules', RULES_VERSION),
          ),
          el('div', { class: 'hint', style: 'margin-top:8px', text: CLASS_TRAIT[axie.class].blurb }),
        ),
      );
    }
    preview(null, 1);

    mount(host,
      kartCol,
      el('div', { class: 'stage-gap' }, el('div', { class: 'caption', text: 'drag to turn' })),
      el('div', { class: 'col scroll', style: 'width:min(430px,100%);flex:0 0 auto' },
        slotCol,
        el('div', { class: 'panel tight' }, more('Stats and rules', statCol)),
      ),
    );
  };
  render();

  return el('div', { class: 'screen showcase' },
    topbar(app, 'Garage', 'home'),
    host,
    el('div', { class: 'row' },
      el('button', { class: 'ghost', onClick: () => { app.sfx('uiBack'); app.go('axie'); } }, '‹ Axie'),
      el('button', { class: 'primary big', onClick: () => { app.sfx('uiSelect'); app.go('trackSelect', { mode: 'quickRace' }); } }, 'Race ›'),
    ),
  );
}

// ---------------------------------------------------------------------------
// shop
// ---------------------------------------------------------------------------

export function shopScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const host = el('div', { class: 'body' });

  const render = () => {
    const grid = el('div', { class: 'grid c3' });
    for (const part of PARTS) {
      const owned = (p.owned[part.id] ?? 0) > 0;
      const afford = p.coins >= part.price;
      const mods = (Object.keys(part.mods) as StatKey[])
        .map((k) => `${part.mods[k]! > 0 ? '+' : ''}${(part.mods[k]! * levelCurve(1)).toFixed(1)} ${STAT_LABEL[k]}`);
      grid.appendChild(el('div', { class: `card${owned ? ' selected' : ''}` },
        el('div', { class: 'tag', text: SLOTS.find((s) => s.id === part.slot)!.label }),
        el('div', { class: 'title', style: `color:${RARITY_COLOR[part.rarity]}`, text: part.name }),
        el('div', { class: 'hint', text: part.blurb }),
        mods.length
          ? el('div', { class: 'row', style: 'gap:5px;margin-top:4px' }, ...mods.map((m) => chip(m)))
          : el('div', { class: 'hint', style: 'margin-top:4px', text: 'Cosmetic only — no stat effect.' }),
        el('div', { class: 'row', style: 'margin-top:8px;justify-content:space-between' },
          el('span', { class: 'mono', style: 'font-weight:700', text: owned ? 'OWNED' : `${part.price} coins` }),
          owned ? null : el('button', {
            disabled: !afford,
            style: 'padding:7px 12px;min-height:36px',
            onClick: async () => {
              if (p.coins < part.price) { app.sfx('uiDenied'); return; }
              const ok = await confirmDialog(app.screenHost, `Buy ${part.name}?`,
                `${part.price} coins. It will be fitted straight away, and you can swap back to what you had for free.`, 'Buy and fit');
              if (!ok) return;
              p.coins -= part.price;
              p.owned[part.id] = 1;
              (p.parts as LoadoutParts)[part.slot] = { partId: part.id, level: 1 };
              app.sfx('uiBuy');
              app.save();
              app.showcase(true);
              app.go('shop');
            },
          }, 'Buy'),
        ),
      ));
    }
    mount(host, el('div', { class: 'col grow scroll' }, grid));
  };
  render();

  return el('div', { class: 'screen' },
    topbar(app, 'Shop', 'garage'),
    el('div', { class: 'panel tight' },
      el('div', { class: 'hint', text: 'Purchases fit immediately and can be swapped back at no cost. Ranked normalises every loadout, so nothing here buys a win.' }),
    ),
    host,
  );
}

// ---------------------------------------------------------------------------
// track select
// ---------------------------------------------------------------------------

export function trackSelectScreen(app: AppApi, params: Record<string, unknown>): HTMLElement {
  const p = app.profile;
  let mode = (params.mode as Mode) ?? 'quickRace';
  const host = el('div', { class: 'body' });

  const unlocked = (t: typeof TRACKS[number]): { ok: boolean; why: string } => {
    if (!t.unlock) return { ok: true, why: '' };
    if (p.unlockedTracks.includes(t.id)) return { ok: true, why: '' };
    if (t.unlock.kind === 'podium') return { ok: false, why: 'Finish on the podium once' };
    return { ok: false, why: `Reach ${t.unlock.value} rating` };
  };

  const render = () => {
    const modes: Mode[] = ['quickRace', 'ranked', 'timeTrial'];
    const modeRow = el('div', { class: 'row' },
      ...modes.map((m) => el('button', {
        class: m === mode ? 'primary' : 'ghost',
        onClick: () => { mode = m; app.sfx('uiMove'); render(); },
      }, MODE_RULES[m].label)),
    );

    const grid = el('div', { class: 'grid c3' });
    for (const t of TRACKS) {
      const u = unlocked(t);
      const rec = recordFor(p, t.id);
      grid.appendChild(el('div', {
        class: `card${u.ok ? '' : ' locked'}`,
        onClick: () => {
          if (!u.ok) { app.sfx('uiDenied'); return; }
          app.sfx('uiSelect');
          app.startRace(mode, t.id);
        },
      },
        art(`img/track-${t.id}.jpg`),
        el('div', { class: 'tag', text: '★'.repeat(t.difficulty) }),
        el('div', { class: 'title', text: t.name }),
        el('div', { class: 'sub', text: t.subtitle }),
        el('div', { class: 'row', style: 'gap:6px' },
          chip('Best lap', rec && isFinite(rec.bestLap) ? formatTime(rec.bestLap) : '—'),
          chip('Laps', String(MODE_RULES[mode].laps)),
        ),
        more('Details',
          el('div', { class: 'hint', text: t.setPiece }),
          kv('Best race', rec && isFinite(rec.bestTotal) ? formatTime(rec.bestTotal) : '—'),
          t.branches.length ? kv('Alternate line', t.branches[0].name) : null,
        ),
        u.ok ? null : el('div', { class: 'hint', style: 'color:var(--warm);margin-top:6px', text: `Locked — ${u.why}` }),
      ));
    }

    const rules = MODE_RULES[mode];
    mount(host,
      el('div', { class: 'col grow scroll' },
        modeRow,
        el('div', { class: 'panel tight' },
          el('div', { class: 'row' },
            chip('Laps', String(rules.laps)),
            chip('Loadout budget', String(rules.statBudget)),
            chip('Rivals', mode === 'timeTrial' ? 'None' : '7'),
            chip('Catch-up', rules.catchUp > 0 ? `${Math.round(rules.catchUp * 100)}%` : 'Off'),
            chip('Assists', rules.assistsAllowed ? 'Allowed' : 'Disabled'),
            chip('Rating', rules.ranked ? 'At stake' : 'Unaffected', rules.ranked),
          ),
          mode === 'ranked'
            ? more('What ranked changes', el('div', { class: 'hint', text: 'Ranked locks the rules version, normalises loadouts, turns off catch-up and disables assists. A result with an integrity flag is held back from the board rather than published.' }))
            : null,
        ),
        grid,
      ),
    );
  };
  render();

  return el('div', { class: 'screen' }, topbar(app, 'Choose a circuit', 'home'), host);
}

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

export interface ResultsParams {
  result: RaceResult;
  ratingDelta: number;
  coins: number;
  improved: { lap: boolean; total: boolean };
  unlocked: string[];
  promoted: string | null;
}

export function resultsScreen(app: AppApi, params: Record<string, unknown>): HTMLElement {
  const r = params as unknown as ResultsParams;
  const p = app.profile;
  const me = r.result.entries.find((e) => e.isPlayer)!;
  const solo = r.result.entries.length <= 1;   // a time trial is a field of one: not a podium
  const podium = !solo && me.finish <= 3;

  const rows = r.result.entries.map((e) => el('tr', { class: e.isPlayer ? 'me' : '' },
    el('td', { text: String(e.finish) }),
    el('td', null,
      e.name,
      e.dnf ? el('span', { class: 'dnf', text: '  DNF' }) : null,
      e.integrity.length ? el('span', { class: 'flagged', text: '  ⚑ held' }) : null,
    ),
    el('td', { class: 'num mono', text: e.dnf ? '—' : formatTime(e.totalTime) }),
    el('td', { class: 'num mono', text: e.bestLap ? formatTime(e.bestLap) : '—' }),
    el('td', { class: 'num mono', text: `${Math.round(e.topSpeed * 3.6)}` }),
  ));

  return el('div', { class: 'screen' },
    topbar(app, 'Results'),
    el('div', { class: 'body' },
      el('div', { class: 'col grow scroll' },
        el('div', { class: 'panel' },
          el('h1', { text: solo ? 'Lap done' : podium ? `P${me.finish}` : `Finished ${me.finish}th` }),
          el('p', { style: 'margin-top:6px', text: solo ? 'Alone against the clock — see if it stuck as a record.'
            : podium ? 'On the podium.' : 'Back to the garage, then.' }),
          el('div', { class: 'row', style: 'margin-top:10px' },
            chip('Time', formatTime(me.totalTime)),
            chip('Best lap', me.bestLap ? formatTime(me.bestLap) : '—'),
            chip('Top speed', `${Math.round(me.topSpeed * 3.6)} km/h`),
            chip('Drifting', `${me.driftSeconds.toFixed(1)} s`),
            chip('Boosts', String(me.boosts)),
            me.tricks ? chip('Tricks', String(me.tricks)) : null,
          ),
          r.improved.lap || r.improved.total
            ? el('div', { class: 'hint', style: 'margin-top:8px;color:var(--good)', text: `Personal best${r.improved.lap && r.improved.total ? ' lap and race' : r.improved.lap ? ' lap' : ' race'}.` })
            : null,
          me.integrity.length
            ? el('div', { class: 'hint', style: 'margin-top:8px;color:var(--warm)', text: `Result held for review: ${me.integrity[0]}` })
            : null,
        ),
        el('div', { class: 'panel' },
          el('h3', { text: 'Finishing order' }),
          el('table', { class: 'results', style: 'margin-top:8px' },
            el('thead', null, el('tr', null,
              el('th', { text: '#' }), el('th', { text: 'Driver' }),
              el('th', { class: 'num', text: 'Total' }), el('th', { class: 'num', text: 'Best lap' }),
              el('th', { class: 'num', text: 'km/h' }),
            )),
            el('tbody', null, ...rows),
          ),
        ),
        me.lapTimes.length
          ? el('div', { class: 'panel' },
              el('h3', { text: 'Your laps' }),
              el('div', { style: 'margin-top:8px' },
                ...me.lapTimes.map((t, i) => kv(`Lap ${i + 1}`, formatTime(t), t === me.bestLap ? 'mono' : 'mono')),
              ),
            )
          : null,
      ),
      el('div', { class: 'col', style: 'width:min(320px,100%)' },
        el('div', { class: 'panel' },
          el('h3', { text: 'Rewards' }),
          el('div', { style: 'margin-top:8px' },
            kv('Coins', `+${r.coins}`),
            r.result.mode === 'ranked'
              ? kv('Rating', `${r.ratingDelta >= 0 ? '+' : ''}${r.ratingDelta} → ${p.rating}`)
              : kv('Rating', 'Unaffected in this mode'),
            kv('Division', divisionFor(p.rating).name),
          ),
          r.promoted ? el('div', { class: 'hint', style: 'margin-top:8px;color:var(--good)', text: `Promoted to ${r.promoted}.` }) : null,
          r.unlocked.length
            ? el('div', { class: 'hint', style: 'margin-top:8px;color:var(--accent-2)', text: `Unlocked: ${r.unlocked.join(', ')}` })
            : null,
        ),
        el('div', { class: 'col' },
          el('button', { class: 'primary big', onClick: () => { app.sfx('uiSelect'); app.startRace(r.result.mode, r.result.trackId); } }, 'Rematch'),
          el('button', { onClick: () => { app.sfx('uiSelect'); app.go('trackSelect', { mode: r.result.mode }); } }, 'Different circuit'),
          el('button', { onClick: () => { app.sfx('uiSelect'); app.go('garage'); } }, 'Garage'),
          el('button', { class: 'ghost', onClick: () => { app.sfx('uiBack'); app.go('home'); } }, 'Home'),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// bonus events
// ---------------------------------------------------------------------------

function bonusUnlocked(p: Profile, e: BonusEventDefinition): { ok: boolean; why: string } {
  if (!e.unlock) return { ok: true, why: '' };
  if (e.unlock.kind === 'races' && p.races >= e.unlock.value) return { ok: true, why: '' };
  return { ok: false, why: `Finish ${e.unlock.value} race${e.unlock.value === 1 ? '' : 's'} first` };
}

export function bonusSelectScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const grid = el('div', { class: 'grid c2' });
  for (const e of BONUS_EVENTS) {
    const u = bonusUnlocked(p, e);
    const rec = bonusFor(p, e.id);
    grid.appendChild(el('div', {
      class: `card${u.ok ? '' : ' locked'}`,
      onClick: () => { if (!u.ok) { app.sfx('uiDenied'); return; } app.sfx('uiSelect'); app.startBonus(e.id); },
    },
      art(`img/event-${e.id}.jpg`),
      rec && rec.medal !== 'none' ? el('div', { class: `tag badge ${rec.medal}`, text: rec.medal }) : null,
      el('div', { class: 'title', text: e.name }),
      el('div', { class: 'sub', text: e.tagline }),
      el('div', { class: 'row', style: 'gap:6px' },
        chip('Your best', rec && isFinite(rec.best) ? `${rec.best.toFixed(1)} ${e.unit}` : '—'),
        chip('Gold', `${e.medals.gold} ${e.unit}`, true),
      ),
      more('Details',
        el('p', { style: 'font-size:13px', text: e.brief }),
        kv('Attempts', rec ? String(rec.attempts) : '0'),
        kv('Bronze', `${e.medals.bronze} ${e.unit}`),
        kv('Silver', `${e.medals.silver} ${e.unit}`),
      ),
      u.ok ? null : el('div', { class: 'hint', style: 'color:var(--warm);margin-top:6px', text: `Locked — ${u.why}` }),
    ));
  }
  return el('div', { class: 'screen' },
    topbar(app, 'Bonus events', 'home'),
    el('div', { class: 'body' }, el('div', { class: 'col grow scroll' }, grid)),
  );
}

export interface BonusResultParams {
  eventId: string;
  score: BonusScore;
  isBest: boolean;
  coins: number;
}

export function bonusResultsScreen(app: AppApi, params: Record<string, unknown>): HTMLElement {
  const r = params as unknown as BonusResultParams;
  const def = BONUS_EVENTS.find((e) => e.id === r.eventId)!;
  const rec = bonusFor(app.profile, def.id);
  return el('div', { class: 'screen' },
    topbar(app, def.name, 'bonusSelect'),
    el('div', { class: 'body' },
      el('div', { class: 'col grow' },
        el('div', { class: 'panel' },
          r.score.valid
            ? el('h1', { text: `${r.score.score.toFixed(1)} ${def.unit}` })
            : el('h1', { style: 'color:var(--bad)', text: 'No score' }),
          r.score.reason ? el('p', { style: 'margin-top:6px', text: r.score.reason }) : null,
          r.score.medal !== 'none'
            ? el('div', { class: `badge ${r.score.medal}`, style: 'margin-top:8px', text: `${r.score.medal} medal` })
            : null,
          r.isBest ? el('div', { class: 'hint', style: 'margin-top:8px;color:var(--good)', text: 'New personal best.' }) : null,
          el('div', { style: 'margin-top:12px' },
            ...r.score.lines.map((l) => kv(l.label, l.value, l.good ? '' : '')),
          ),
          el('div', { class: 'divider' }),
          kv('Personal best', rec && isFinite(rec.best) ? `${rec.best.toFixed(1)} ${def.unit}` : '—'),
          kv('Coins earned', `+${r.coins}`),
        ),
      ),
      el('div', { class: 'col', style: 'width:min(300px,100%)' },
        el('div', { class: 'panel' },
          el('h3', { text: 'Medals' }),
          el('div', { style: 'margin-top:8px' },
            kv('Gold', `${def.medals.gold} ${def.unit}`),
            kv('Silver', `${def.medals.silver} ${def.unit}`),
            kv('Bronze', `${def.medals.bronze} ${def.unit}`),
          ),
        ),
        el('button', { class: 'primary big', onClick: () => { app.sfx('uiSelect'); app.startBonus(def.id); } }, 'Again'),
        el('button', { onClick: () => { app.sfx('uiSelect'); app.go('bonusSelect'); } }, 'Other events'),
        el('button', { class: 'ghost', onClick: () => { app.sfx('uiBack'); app.go('home'); } }, 'Home'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// multiplayer
// ---------------------------------------------------------------------------

export function multiplayerScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const host = el('div', { class: 'body' });
  let trackId = p.unlockedTracks[p.unlockedTracks.length - 1] ?? 'canopy';
  let mode: Mode = 'quickRace';
  let off: (() => void) | null = null;

  const render = () => {
    const lobby = app.net.lobby();
    const connected = app.net.url !== null;

    const urlRow = el('div', { class: 'panel' },
      el('h3', { text: 'Server' }),
      el('div', { class: 'hint', style: 'margin:6px 0 10px' },
        'Luna Prix races offline by default. Point it at a race server and the ',
        'server runs the race: it owns lap counting, checkpoints, loadout ',
        'validation and the published result. Nothing about that changes how ',
        'the game plays — it changes where the truth lives.'),
      el('input', {
        type: 'text',
        value: app.net.url ?? '',
        placeholder: 'ws://localhost:8787',
        onChange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          app.net.setUrl(v || null);
          app.go('multiplayer');
        },
      }),
      el('div', { class: 'row', style: 'margin-top:10px' },
        chip('Status', app.net.status(), connected),
        lobby ? chip('Room', lobby.roomId) : null,
      ),
      app.net.lastError
        ? el('div', { class: 'hint', style: 'margin-top:8px;color:var(--warm)', text: app.net.lastError })
        : null,
      !connected
        ? el('div', { class: 'hint', style: 'margin-top:10px' },
            'No server configured, so everything here is offline practice against ',
            'bots on this device — and it is labelled that way wherever it appears. ',
            'Run ', el('span', { class: 'mono', text: 'npm run server' }), ' and paste the address above.')
        : null,
    );

    const setup = el('div', { class: 'panel' },
      el('h3', { text: 'Race' }),
      el('div', { class: 'row', style: 'margin-top:10px' },
        ...TRACKS.filter((t) => p.unlockedTracks.includes(t.id) || !t.unlock).map((t) =>
          el('button', {
            class: t.id === trackId ? 'primary' : 'ghost',
            style: 'padding:8px 12px;min-height:38px;font-size:13px',
            onClick: () => { trackId = t.id; app.sfx('uiMove'); render(); },
          }, t.name)),
      ),
      el('div', { class: 'row', style: 'margin-top:8px' },
        ...(['quickRace', 'ranked'] as Mode[]).map((m) =>
          el('button', {
            class: m === mode ? 'primary' : 'ghost',
            style: 'padding:8px 12px;min-height:38px;font-size:13px',
            onClick: () => { mode = m; app.sfx('uiMove'); render(); },
          }, MODE_RULES[m].label)),
      ),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', {
          class: 'primary big',
          disabled: !connected,
          onClick: async () => {
            app.sfx('uiSelect');
            await app.net.connectAndJoin(trackId, mode);
            render();
          },
        }, lobby ? 'Rejoin' : 'Join a room'),
        lobby ? el('button', {
          onClick: () => {
            const me = lobby.members.find((x) => x.isLocal);
            app.net.setReady(!me?.ready);
            app.sfx('uiSelect');
          },
        }, lobby.members.find((x) => x.isLocal)?.ready ? 'Not ready' : 'Ready') : null,
        lobby ? el('button', { class: 'ghost', onClick: () => { app.net.leave(); app.go('multiplayer'); } }, 'Leave') : null,
      ),
    );

    const lobbyPanel = lobby
      ? el('div', { class: 'panel' },
          el('h3', { text: lobby.countdown !== null ? `Starting in ${lobby.countdown}s` : 'Waiting for the room' }),
          el('table', { class: 'results', style: 'margin-top:8px' },
            el('thead', null, el('tr', null,
              el('th', { text: 'Racer' }), el('th', { text: 'Axie' }),
              el('th', { text: 'Kart' }), el('th', { class: 'num', text: 'Ping' }),
              el('th', { text: 'Ready' }),
            )),
            el('tbody', null, ...lobby.members.map((m) => el('tr', { class: m.isLocal ? 'me' : '' },
              el('td', null, m.name, m.isBot ? el('span', { class: 'dnf', text: '  bot' }) : null),
              el('td', { text: AXIES.find((a) => a.id === m.axieId)?.name ?? '—' }),
              el('td', { text: KARTS.find((k) => k.id === m.kartId)?.name ?? '—' }),
              el('td', { class: 'num mono', text: m.ping === null ? '—' : `${m.ping}` }),
              el('td', { text: m.ready ? 'yes' : '—' }),
            ))),
          ),
          el('div', { class: 'hint', style: 'margin-top:10px', text: `${lobby.members.length}/${lobby.capacity} in the room. Empty grid slots are filled with bots, and bots are labelled.` }),
        )
      : null;

    mount(host,
      el('div', { class: 'col grow scroll' }, urlRow, setup, lobbyPanel),
      el('div', { class: 'col', style: 'width:min(320px,100%)' },
        el('div', { class: 'panel' },
          el('h3', { text: 'What the server owns' }),
          el('div', { style: 'margin-top:8px' },
            kv('Race clock', 'server'),
            kv('Checkpoints and laps', 'server'),
            kv('Respawn validity', 'server'),
            kv('Loadout validation', 'server'),
            kv('Finish order', 'server'),
            kv('Published result', 'server'),
            kv('Your steering', 'predicted here'),
          ),
          el('div', { class: 'hint', style: 'margin-top:10px', text: 'Your stat block is a claim. The server recomputes it from part ids against its own rules version, and clamps every input on arrival.' }),
        ),
      ),
    );
  };

  off = app.net.onChange(render);
  render();
  const node = el('div', { class: 'screen' }, topbar(app, 'Multiplayer', 'home'), host);
  // Stop listening when the screen is replaced.
  const observer = new MutationObserver(() => {
    if (!node.isConnected) { off?.(); observer.disconnect(); }
  });
  queueMicrotask(() => {
    if (node.parentElement) observer.observe(node.parentElement, { childList: true });
  });
  return node;
}

// ---------------------------------------------------------------------------
// boards
// ---------------------------------------------------------------------------

export function boardsScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const div = divisionFor(p.rating);
  const trackRows = TRACKS.map((t) => {
    const rec = recordFor(p, t.id);
    return el('tr', null,
      el('td', { text: t.name }),
      el('td', { class: 'num mono', text: rec && isFinite(rec.bestLap) ? formatTime(rec.bestLap) : '—' }),
      el('td', { class: 'num mono', text: rec && isFinite(rec.bestTotal) ? formatTime(rec.bestTotal) : '—' }),
      el('td', { text: rec ? (AXIES.find((a) => a.id === rec.axieId)?.name ?? '—') : '—' }),
      el('td', { text: rec ? (KARTS.find((k) => k.id === rec.kartId)?.name ?? '—') : '—' }),
    );
  });
  const bonusRows = BONUS_EVENTS.map((e) => {
    const rec = bonusFor(p, e.id);
    return el('tr', null,
      el('td', { text: e.name }),
      el('td', { class: 'num mono', text: rec && isFinite(rec.best) ? `${rec.best.toFixed(1)} ${e.unit}` : '—' }),
      el('td', null, rec && rec.medal !== 'none' ? el('span', { class: `badge ${rec.medal}`, text: rec.medal }) : '—'),
      el('td', { class: 'num', text: rec ? String(rec.attempts) : '0' }),
    );
  });

  return el('div', { class: 'screen' },
    topbar(app, 'Records', 'home'),
    el('div', { class: 'body' },
      el('div', { class: 'col grow scroll' },
        el('div', { class: 'panel' },
          el('h3', { text: `Time trial — rules ${RULES_VERSION}` }),
          el('table', { class: 'results', style: 'margin-top:8px' },
            el('thead', null, el('tr', null,
              el('th', { text: 'Circuit' }), el('th', { class: 'num', text: 'Best lap' }),
              el('th', { class: 'num', text: 'Best race' }), el('th', { text: 'Axie' }), el('th', { text: 'Kart' }),
            )),
            el('tbody', null, ...trackRows),
          ),
          el('div', { class: 'hint', style: 'margin-top:10px', text: 'Records are kept per rules version. A balance change retires the old board rather than mixing two sets of physics into one table.' }),
        ),
        el('div', { class: 'panel' },
          el('h3', { text: 'Bonus events' }),
          el('table', { class: 'results', style: 'margin-top:8px' },
            el('thead', null, el('tr', null,
              el('th', { text: 'Event' }), el('th', { class: 'num', text: 'Best' }),
              el('th', { text: 'Medal' }), el('th', { class: 'num', text: 'Attempts' }),
            )),
            el('tbody', null, ...bonusRows),
          ),
        ),
      ),
      el('div', { class: 'col', style: 'width:min(300px,100%)' },
        el('div', { class: 'panel' },
          el('h3', { text: 'Ranked' }),
          el('div', { style: 'margin-top:8px' },
            kv('Division', div.name),
            kv('Rating', String(p.rating)),
            kv('Races', String(p.races)),
            kv('Wins', String(p.wins)),
            kv('Podiums', String(p.podiums)),
            kv('Win rate', p.races ? `${Math.round((p.wins / p.races) * 100)}%` : '—'),
          ),
          el('div', { class: 'hint', style: 'margin-top:10px', text: 'This build keeps boards locally and labels them honestly. The network adapter behind them already speaks the same result format a server would sign.' }),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export function settingsScreen(app: AppApi): HTMLElement {
  const p = app.profile;
  const s = p.settings;
  const host = el('div', { class: 'body' });

  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => {
    const out = el('span', { class: 'v mono', text: value.toFixed(2) });
    return el('div', { style: 'margin-bottom:10px' },
      el('div', { class: 'kv' }, el('span', { class: 'k', text: label }), out),
      el('input', {
        type: 'range', min, max, step, value,
        onInput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          out.textContent = v.toFixed(2);
          set(v);
          app.save();
          app.applySettings();
        },
      }),
    );
  };
  const toggle = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) =>
    el('div', null,
      el('label', { class: 'toggle' },
        el('input', {
          type: 'checkbox', checked: value,
          onChange: (e: Event) => {
            set((e.target as HTMLInputElement).checked);
            app.save();
            app.applySettings();
            app.sfx('uiMove');
          },
        }),
        label,
      ),
      hint ? el('div', { class: 'hint', style: 'margin:-4px 0 6px 30px', text: hint }) : null,
    );

  // Key rebinding: click a row, then press a key.
  const bindRows = el('div');
  const renderBinds = () => {
    clear(bindRows);
    for (const action of Object.keys(DEFAULT_KEYBINDS)) {
      const btn = el('button', {
        style: 'padding:6px 10px;min-height:34px;font-size:13px;min-width:86px;text-align:center',
        onClick: () => {
          btn.textContent = 'press a key…';
          const handler = (ev: KeyboardEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            s.keybinds[action] = ev.code;
            window.removeEventListener('keydown', handler, true);
            app.save();
            app.applySettings();
            app.sfx('uiSelect');
            renderBinds();
          };
          window.addEventListener('keydown', handler, true);
        },
      }, s.keybinds[action].replace(/^Key/, ''));
      bindRows.appendChild(el('div', { class: 'kv' },
        el('span', { class: 'k', text: action.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) }),
        btn,
      ));
    }
  };
  renderBinds();

  mount(host,
    el('div', { class: 'col grow scroll' },
      el('div', { class: 'panel' },
        el('h3', { text: 'Audio' }),
        slider('Master', s.mix.master, 0, 1, 0.05, (v) => { s.mix.master = v; }),
        slider('Music', s.mix.music, 0, 1, 0.05, (v) => { s.mix.music = v; }),
        slider('Effects', s.mix.sfx, 0, 1, 0.05, (v) => { s.mix.sfx = v; }),
        slider('Engine', s.mix.engine, 0, 1, 0.05, (v) => { s.mix.engine = v; }),
        slider('Ambience', s.mix.ambience, 0, 1, 0.05, (v) => { s.mix.ambience = v; }),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Comfort and accessibility' }),
        toggle('Reduced motion', s.comfort, (v) => { s.comfort = v; },
          'Cuts camera shake, the field-of-view swell, drift framing and speed lines.'),
        toggle('High contrast cues', s.highContrast, (v) => { s.highContrast = v; },
          'Hazard and route cues stop relying on hue alone.'),
        slider('HUD size', s.hudScale, 0.75, 1.4, 0.05, (v) => { s.hudScale = v; }),
        toggle('Show teaching prompts', s.showTutorialPrompts, (v) => { s.showTutorialPrompts = v; },
          'Short contextual lines during the first races. They stop on their own once you have used the mechanic.'),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Driving' }),
        toggle('Invert steering', s.invertSteering, (v) => { s.invertSteering = v; },
          'Swaps left and right. Try it if the steering reads the wrong way round to you.'),
        toggle('Drift as a toggle', s.driftToggle, (v) => { s.driftToggle = v; },
          'Tap to start and stop a drift instead of holding the button.'),
        slider('Steering sensitivity', s.steerSensitivity, 0.5, 1.6, 0.05, (v) => { s.steerSensitivity = v; }),
        slider('Stick dead zone', s.deadzone, 0, 0.35, 0.01, (v) => { s.deadzone = v; }),
        el('div', { class: 'divider' }),
        el('h3', { text: 'Assists' }),
        el('div', { class: 'hint', style: 'margin:6px 0 4px', text: 'Assists are disabled automatically in ranked, and the mode screen says so.' }),
        toggle('Auto accelerate', s.assists.autoAccel, (v) => { s.assists.autoAccel = v; }),
        toggle('Steering assist', s.assists.steerAssist, (v) => { s.assists.steerAssist = v; }),
        toggle('Recovery assist', s.assists.recoveryAssist, (v) => { s.assists.recoveryAssist = v; }),
      ),
    ),
    el('div', { class: 'col scroll', style: 'width:min(330px,100%)' },
      el('div', { class: 'panel' },
        el('h3', { text: 'Graphics' }),
        el('div', { class: 'row', style: 'margin-top:8px' },
          ...(['auto', 'low', 'medium', 'high'] as const).map((q) => el('button', {
            class: s.quality === q ? 'primary' : 'ghost',
            style: 'padding:7px 12px;min-height:36px;font-size:13px',
            onClick: () => { s.quality = q; app.save(); app.applySettings(); app.sfx('uiSelect'); app.go('settings'); },
          }, q)),
        ),
        el('div', { class: 'hint', style: 'margin-top:8px', text: 'Auto picks a tier from the device and steps down if the frame time will not hold.' }),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Controls' }),
        el('div', { class: 'hint', style: 'margin:6px 0 8px', text: `Detected: ${app.device}. Click a binding, then press the key you want.` }),
        bindRows,
        el('button', {
          class: 'ghost', style: 'margin-top:8px',
          onClick: () => { s.keybinds = { ...DEFAULT_KEYBINDS }; app.save(); app.applySettings(); renderBinds(); },
        }, 'Reset bindings'),
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Profile' }),
        el('div', { style: 'margin-top:8px' },
          el('label', { class: 'hint', text: 'Display name' }),
          el('input', {
            type: 'text', value: p.alias, maxlength: 18,
            onChange: (e: Event) => { p.alias = (e.target as HTMLInputElement).value.slice(0, 18) || 'Rookie'; app.save(); },
          }),
        ),
        el('div', { style: 'margin-top:10px' },
          kv('Profile id', p.playerId.slice(0, 14)),
          kv('Rules version', RULES_VERSION),
          kv('Schema', String(p.schemaVersion)),
        ),
        el('button', {
          class: 'danger', style: 'margin-top:10px',
          onClick: async () => {
            const ok = await confirmDialog(app.screenHost, 'Erase everything?',
              'Coins, parts, rating and every record are deleted. This cannot be undone.', 'Erase');
            if (!ok) return;
            localStorage.removeItem('lunaprix.profile.v3');
            location.reload();
          },
        }, 'Erase profile'),
      ),
    ),
  );

  return el('div', { class: 'screen' }, topbar(app, 'Settings', 'home'), host);
}

// ---------------------------------------------------------------------------
// pause overlay
// ---------------------------------------------------------------------------

export function pauseOverlay(app: AppApi, onResume: () => void, onRestart: () => void, onQuit: () => void): HTMLElement {
  return el('div', {
    class: 'layer active interactive',
    style: 'display:flex;align-items:center;justify-content:center;background:rgba(6,8,13,0.74);z-index:30;backdrop-filter:blur(4px)',
  },
    el('div', { class: 'panel', style: 'width:min(420px,calc(100% - 40px))' },
      el('h2', { text: 'Paused' }),
      el('div', { style: 'margin-top:14px;display:flex;flex-direction:column;gap:8px' },
        el('button', { class: 'primary big', onClick: () => { app.sfx('uiSelect'); onResume(); } }, 'Resume'),
        el('button', { onClick: () => { app.sfx('uiSelect'); onRestart(); } }, 'Restart'),
        el('button', { class: 'ghost', onClick: () => { app.sfx('uiBack'); onQuit(); } }, 'Quit to menu'),
      ),
      el('div', { class: 'divider' }),
      el('div', { class: 'hint' },
        ...controlCard(app.device, app.profile.settings.keybinds).map((c) =>
          el('div', null, el('strong', { style: 'color:var(--accent-2)', text: c.key }), ` — ${c.label}`)),
      ),
    ),
  );
}

export { clamp, STAT_BLURB };
