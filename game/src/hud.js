// Every 2D element: HUD readouts, kill feed, centre banners, the buy menu, the plant
// channel bar, damage and flash overlays, the DMR scope, and a live minimap drawn from
// the same collider list the bullets use. The simulation calls these; it never touches
// the DOM itself.
import { WEAPONS, GRENADES, GEAR, SHOP_ORDER } from './weapons.js';
import { SITE } from './map.js';

const $ = (id) => document.getElementById(id);

export function createHud({ state, loadout, colliders, onBuy, onPlay }) {
  const els = {
    hud: $('hud'), healthFill: $('health-fill'), healthNum: $('health-num'), armorTag: $('armor-tag'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), timer: $('timer'), roundLabel: $('round-label'),
    scoreB: $('score-breakers'), scoreW: $('score-wardens'), feed: $('feed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    objective: $('objective'), buy: $('buy'), buyItems: $('buy-items'), buyMoney: $('buy-money'),
    menu: $('menu'), menuTitle: $('menu-title'), menuCopy: $('menu-copy'), play: $('play'),
    vignette: $('vignette'), flashbang: $('flashbang'), scope: $('scope'),
    grenades: $('grenades'), channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), spectate: $('spectate'),
    minimap: $('minimap').getContext('2d'),
  };
  let bannerUntil = 0;
  let hitmarkerUntil = 0;
  let hurtUntil = 0;
  let flashLevel = 0;
  let buyVisible = false;

  els.play.addEventListener('click', () => onPlay());
  els.buyItems.addEventListener('click', (event) => {
    const button = event.target.closest('[data-buy]');
    if (button) onBuy(button.dataset.buy);
  });

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function refreshBuy() {
    els.buyMoney.textContent = `$${state.playerMoney}`;
    els.buyItems.innerHTML = SHOP_ORDER.map((id, i) => {
      let name; let price; let note = ''; let disabled = false;
      if (WEAPONS[id]) {
        name = WEAPONS[id].name; price = WEAPONS[id].price;
        if (loadout.owned.has(id)) { note = 'OWNED'; disabled = true; }
      } else if (GRENADES[id]) {
        name = GRENADES[id].name; price = GRENADES[id].price;
        note = `x${loadout.grenades[id]}`;
        if (loadout.grenades[id] >= GRENADES[id].cap) disabled = true;
      } else {
        name = GEAR[id].name; price = GEAR[id].price;
        const level = id === 'vest' ? 1 : 2;
        if (loadout.armor >= level) { note = 'WORN'; disabled = true; }
      }
      if (state.playerMoney < price) disabled = true;
      return `<button type="button" class="buy-item" data-buy="${id}" ${disabled ? 'disabled' : ''}>
        <span class="buy-key">${i + 1}</span><span class="buy-name">${name}</span>
        <span class="buy-note">${note}</span><span class="buy-price">$${price}</span></button>`;
    }).join('');
  }

  function drawMinimap(playerBody, combatants) {
    const g = els.minimap;
    const S = 184;
    const px = (v) => ((v + 32) / 64) * S;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(20,24,30,0.82)';
    g.fillRect(0, 0, S, S);
    for (const box of colliders) {
      g.fillStyle = box.max.y > 1.5 ? 'rgba(150,160,175,0.55)' : 'rgba(150,160,175,0.28)';
      g.fillRect(px(box.min.x), px(box.min.z), px(box.max.x) - px(box.min.x), px(box.max.z) - px(box.min.z));
    }
    g.strokeStyle = '#ffb45e';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(px(SITE.x), px(SITE.z), (SITE.radius / 64) * S, 0, Math.PI * 2); g.stroke();
    if (state.spike.planted && state.spike.position) {
      const blink = Math.sin(state.time * 10) > 0;
      g.fillStyle = blink ? '#ff5030' : '#ffb45e';
      g.beginPath(); g.arc(px(state.spike.position.x), px(state.spike.position.z), 3.4, 0, Math.PI * 2); g.fill();
    }
    for (const c of combatants) {
      if (!c.alive || c.isPlayer || c.team !== 'breakers') continue;
      g.fillStyle = '#ff8a3c';
      g.beginPath(); g.arc(px(c.position.x), px(c.position.z), 2.6, 0, Math.PI * 2); g.fill();
    }
    // the player as a facing wedge
    const x = px(playerBody.position.x);
    const y = px(playerBody.position.z);
    g.save();
    g.translate(x, y);
    g.rotate(-playerBody.yaw);
    g.fillStyle = '#f2ede3';
    g.beginPath(); g.moveTo(0, -5); g.lineTo(3.6, 4); g.lineTo(-3.6, 4); g.closePath(); g.fill();
    g.restore();
  }

  return {
    get buyVisible() { return buyVisible; },
    showBuy(show) {
      buyVisible = show;
      els.buy.hidden = !show;
      if (show) refreshBuy();
    },
    refreshBuy,
    showMenu(mode, stats) {
      els.menu.hidden = false;
      if (mode === 'start') {
        els.menuTitle.textContent = 'ASHLINE PROTOCOL';
        els.menuCopy.textContent = 'Breakers versus Wardens at Foundry Nine. Plant the Spike at the Crucible, or run the clock down — first to 7 rounds takes the plant.';
        els.play.textContent = 'Deploy';
      } else if (mode === 'paused') {
        els.menuTitle.textContent = 'Paused';
        els.menuCopy.textContent = 'The round is still live out there.';
        els.play.textContent = 'Back in';
      } else if (mode === 'match-end') {
        const won = state.matchWinner === 'breakers';
        els.menuTitle.textContent = won ? 'PLANT SECURED' : 'PLANT LOST';
        els.menuCopy.textContent = `Final score ${state.score.breakers} — ${state.score.wardens}. ` +
          `You: ${stats.kills} kills, ${stats.deaths} deaths, ${stats.hits}/${stats.shots} shots on target` +
          (stats.plants ? `, ${stats.plants} Spike plant${stats.plants > 1 ? 's' : ''}.` : '.');
        els.play.textContent = 'Play again';
      }
    },
    hideMenu() { els.menu.hidden = true; },
    menuVisible() { return !els.menu.hidden; },
    banner(title, sub, seconds = 2.6) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.hidden = false;
      bannerUntil = performance.now() + seconds * 1000;
    },
    feed(text) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = text;
      els.feed.prepend(row);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => { row.classList.add('fade'); }, 3600);
      setTimeout(() => { row.remove(); }, 4600);
    },
    hitmarker(kill) {
      els.hitmarker.classList.toggle('kill', kill);
      els.hitmarker.style.opacity = '1';
      hitmarkerUntil = performance.now() + (kill ? 260 : 120);
    },
    hurt() { hurtUntil = performance.now() + 320; },
    flash(strength) { flashLevel = Math.min(1, Math.max(flashLevel, strength)); },
    setChannel(label, fraction) {
      if (fraction === null) { els.channel.hidden = true; return; }
      els.channel.hidden = false;
      els.channelLabel.textContent = label;
      els.channelFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    setScope(on) { els.scope.hidden = !on; },
    update(playerBody, combatants) {
      const now = performance.now();
      els.healthNum.textContent = Math.max(0, Math.ceil(playerBody.hp));
      els.healthFill.style.width = `${Math.max(0, playerBody.hp)}%`;
      els.healthFill.style.background = playerBody.hp > 35 ? 'var(--teal)' : 'var(--danger)';
      els.armorTag.textContent = loadout.armor === 2 ? 'VEST + HELM' : loadout.armor === 1 ? 'VEST' : '';
      const ammo = loadout.ammoState();
      els.ammoMag.textContent = ammo.mag;
      els.ammoReserve.textContent = `/ ${ammo.reserve}`;
      els.ammoMag.style.color = ammo.mag === 0 ? 'var(--danger)' : '';
      els.weaponName.textContent = loadout.def().name;
      els.money.textContent = `$${state.playerMoney}`;
      els.timer.textContent = state.phase === 'planted' ? fmtTime(state.phaseTime) : fmtTime(state.phaseTime);
      els.timer.style.color = state.phaseTime < 11 && state.phase !== 'buy' ? 'var(--danger)' : '';
      els.roundLabel.textContent = `ROUND ${state.round}`;
      els.scoreB.textContent = state.score.breakers;
      els.scoreW.textContent = state.score.wardens;
      els.objective.textContent =
        state.phase === 'buy' ? 'BUY PHASE — press B' :
        state.spike.planted ? 'SPIKE PLANTED — defend it' :
        state.spike.carrier === 'player' ? 'You carry the Spike — plant at the Crucible [E]' :
        state.spike.carrier ? 'Spike is with your team' : 'Spike is down — recover it';
      els.grenades.innerHTML =
        `<span class="${state.grenadeSel === 'shard' ? 'sel' : ''}">Shard x${loadout.grenades.shard}</span>` +
        `<span class="${state.grenadeSel === 'flare' ? 'sel' : ''}">Flare x${loadout.grenades.flare}</span>` +
        `<span class="${state.grenadeSel === 'veil' ? 'sel' : ''}">Veil x${loadout.grenades.veil}</span>`;
      els.spectate.hidden = playerBody.alive;
      if (now > bannerUntil) els.banner.hidden = true;
      if (now > hitmarkerUntil) els.hitmarker.style.opacity = '0';
      els.vignette.style.opacity = now < hurtUntil ? '1' : (playerBody.hp < 35 && playerBody.alive ? '0.45' : '0');
      flashLevel = Math.max(0, flashLevel - 0.008);
      els.flashbang.style.opacity = String(flashLevel);
      const spreadPx = 6 + loadout.bloom * 500 + Math.min(18, playerBody.velocity.length() * 2.4);
      els.crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
      drawMinimap(playerBody, combatants);
    },
  };
}
