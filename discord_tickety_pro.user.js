// ==UserScript==
// @name         Discord Tickety Pro
// @namespace    doreso999-crypto/discord_tickety_pro
// @version      1.0.0
// @description  Group visible Tickety tickets by opener and remind staff to follow up.
// @match        https://discord.com/*
// @run-at       document-idle
// @grant        GM_notification
// ==/UserScript==

(() => {
  'use strict';
  const HOUR = 3600000;
  const PREFIX = 'ticketyPro.1.';
  const route = path => /^\/channels\/(\d{15,20})\/(\d{15,20})(?:\/|$)/.exec(path);
  const read = key => JSON.parse(localStorage.getItem(PREFIX + key) || 'null');
  const write = (key, data) => localStorage.setItem(PREFIX + key, JSON.stringify(data));
  const keyFor = (guild, id) => 'ticket.' + guild + '.' + id;
  const created = id => Number(BigInt(id) >> 22n) + 1420070400000;
  const statuses = ['Open', 'Follow up', 'Resolved'];
  function rows(guild) {
    return Object.keys(localStorage).filter(k => k.startsWith(PREFIX + 'ticket.' + guild + '.'))
      .map(k => JSON.parse(localStorage.getItem(k))).filter(Boolean);
  }
  function save(guild, id, fields) {
    const key = keyFor(guild, id);
    const previous = read(key);
    const record = Object.assign({ guild, id, name: 'Ticket ' + id, owner: '', status: 'Open',
      due: created(id) + 168 * HOUR, exact: false, notified: '' }, previous, fields);
    if (JSON.stringify(previous) !== JSON.stringify(record)) write(key, record);
    return record;
  }
  function stage(t, now) {
    if (t.status === 'Resolved') return '';
    const hours = (t.due - now) / HOUR;
    if (hours <= 0) return 'past due';
    if (hours <= 6) return 'within 6h';
    if (hours <= 24) return 'within 24h';
    return '';
  }
  function opener(text) {
    const match = text.match(/(?:^|\n|\bticket )(?:opened by|created by|ticket creator|opener)[ \t]*:?[ \t]*(?:\n[ \t]*)?(@?[^\n]{1,80})(?=\n|$)/i)
      || text.match(/(?:^|\n)(@?[^\n,]{1,80}),\s*your ticket has been (?:created|opened)/i);
    return match ? match[1].trim().replace(/^@/, '') : '';
  }
  const host = document.createElement('div');
  document.documentElement.append(host);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `
    <style>
      :host{font:14px/1.45 system-ui,sans-serif;color:#f1f3ff}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,select,input{font:inherit;color:inherit;background:#263147;border:1px solid #627087;border-radius:6px;padding:5px 8px}
      button,select,summary{cursor:pointer} a{color:#aecbff}
      #launch,section{position:fixed;z-index:2147483646;right:16px}
      #launch{bottom:16px;background:#344d83}section{bottom:60px;width:min(490px,95vw);max-height:78vh;overflow:auto;background:#182030;padding:15px;border:1px solid #65718a;border-radius:10px}
      header,.controls{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:9px}header{justify-content:space-between}
      article{padding:9px 0;border-top:1px solid #384458}article a,summary{overflow-wrap:anywhere}small{display:block;color:#bdc9dc;margin:4px 0}
      details{margin:9px 0}summary{font-weight:650}.alert{color:#ffcb82}
    </style>
    <button id="launch" hidden>Ticket board</button>
    <section hidden aria-label="Tickety ticket board">
      <header><strong>Tickety · tickets by opener</strong><button id="close">Close</button></header>
      <div class="controls"><input id="search" aria-label="Search tickets" placeholder="Search opener or ticket">
      <select id="filter" aria-label="Filter tickets"><option>Active</option><option>Due soon</option><option>Follow up</option><option>Resolved</option><option>All</option></select></div>
      <div class="controls"><button id="add">Track this ticket</button><button id="log">Watch this log</button><button id="alerts">Enable alerts</button></div>
      <small id="help">Reads loaded Tickety messages. Scroll the watched log to include older entries. Status changes are local.</small>
      <small role="status" id="msg"></small><div id="list"></div>
    </section>`;
  const $ = s => root.querySelector(s);
  const msg = s => { $('#msg').textContent = s; };
  const element = (tag, label) => Object.assign(document.createElement(tag), {textContent:label});
  let context = '', boardGuild = '', seen = new WeakMap();
  function scan(guild, channel) {
    const isLog = read('log.' + guild) === channel;
    for (const node of document.querySelectorAll('[id^="chat-messages-"]')) {
      // Discord can briefly leave the previous channel mounted during navigation.
      if (!node.id.startsWith('chat-messages-' + channel + '-')) continue;
      const body = node.innerText || '';
      if (seen.get(node) === body) continue;
      seen.set(node, body);
      const author = node.querySelector('[id^="message-username-"],[class*="username_"]');
      if (author?.textContent.trim().toLowerCase() !== 'tickety') continue;
      const owner = opener(body);
      if (!owner && !/ticket (?:created|opened)|your ticket has been created/i.test(body)) continue;
      let id = channel, name = document.title.split('|')[0].trim();
      const targets = new Map();
      {
        for (const a of node.querySelectorAll('a[href]')) {
          const m = route(a.pathname);
          if (a.origin === location.origin && m?.[1] === guild && m[2] !== channel) targets.set(m[2], a.textContent.trim());
        }
      }
      if (isLog || targets.size) {
        if (targets.size !== 1) continue;
        [id, name] = targets.entries().next().value;
      } else if (!owner) continue;
      const old = read(keyFor(guild,id));
      if (!old || (!old.owner && owner)) save(guild,id,{name: name || 'Ticket ' + id, owner});
    }
  }
  function editDeadline(t) {
    const d = new Date(t.due);
    const local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    const answer = prompt('Enter the Tickety close time in your local time (YYYY-MM-DDTHH:MM)',local);
    if (answer === null) return;
    const due = new Date(answer).getTime();
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(answer) || !Number.isFinite(due)) return msg('Enter a valid local date and time.');
    save(t.guild,t.id,{due,exact:true,notified:''}); render();
  }
  function assign(t) {
    const owner = prompt('Ticket opener (use the same Discord username or ID for all their tickets)',t.owner);
    if (owner?.trim()) { save(t.guild,t.id,{owner:owner.trim().replace(/^@/,'')}); render(); }
  }
  function button(label, action) {
    const b = element('button',label); b.onclick = action; return b;
  }
  let lastView = '';
  function render() {
    const m = route(location.pathname);
    $('#launch').hidden = !m;
    if (!m) { $('section').hidden = true; return; }
    const [,guild,channel] = m;
    const all = rows(guild).sort((a,b) => a.due-b.due);
    const now = Date.now(), due = all.filter(t => stage(t,now)).length;
    $('#launch').textContent = 'Ticket board · ' + all.length + (due ? ' · ' + due + ' due' : '');
    if ($('section').hidden) return;
    $('#alerts').textContent = read('alerts') ? 'Disable alerts' : 'Enable alerts';
    $('#log').textContent = read('log.'+guild) === channel ? 'Stop watching this log' : 'Watch this log';
    const q = $('#search').value.trim().toLowerCase(), filter = $('#filter').value;
    const shown = all.filter(t => (t.owner+' '+t.name+' '+t.id).toLowerCase().includes(q) &&
      (filter === 'All' || (filter === 'Active' ? t.status !== 'Resolved' : filter === 'Due soon' ? !!stage(t,now) : filter === t.status)));
    const view = JSON.stringify([guild,shown,shown.map(t=>stage(t,now)),filter,q]);
    if (view === lastView) return;
    lastView = view;
    const list = $('#list');
    const collapsed = new Set([...list.children].filter(el=>el.tagName==='DETAILS' && !el.open).map(el=>el.dataset.group));
    list.replaceChildren();
    const groups = new Map();
    for (const t of shown) {
      const k = t.owner.toLowerCase();
      if (!groups.has(k)) groups.set(k,[]);
      groups.get(k).push(t);
    }
    if (!shown.length) list.append(element('small',all.length ? 'No tickets match this filter.' : 'Open a ticket or watch a Tickety log to start tracking.'));
    for (const key of [...groups.keys()].sort((a,b)=>a.localeCompare(b))) {
      const tickets = groups.get(key), group = document.createElement('details');
      group.dataset.group = key; group.open = !collapsed.has(key);
      group.append(element('summary',(tickets[0].owner || 'Unknown opener') + ' (' + tickets.length + ')'));
      for (const t of tickets) {
        const card = document.createElement('article'), link = element('a',t.name);
        link.href = '/channels/'+guild+'/'+t.id;
        const warning = stage(t,now);
        const date = element('small',(t.exact?'Close time':'7-day estimate') + ' · ' + new Date(t.due).toLocaleString() + (warning?' · '+warning:''));
        if (warning) date.className='alert';
        const state = document.createElement('select'); state.setAttribute('aria-label','Ticket status');
        statuses.forEach(s=>state.add(new Option(s,s))); state.value=t.status;
        state.onchange=()=>{save(guild,t.id,{status:state.value,notified:''});render();};
        const actions = element('div',''); actions.className='controls';
        actions.append(state,button('Opener',()=>assign(t)),button('Deadline',()=>editDeadline(t)));
        card.append(link,date,actions); group.append(card);
      }
      list.append(group);
    }
  }
  function reminders() {
    if (!read('alerts')) return;
    const pending = [];
    for (const key of Object.keys(localStorage).filter(k=>k.startsWith(PREFIX+'ticket.'))) {
      const t = JSON.parse(localStorage.getItem(key)), label = stage(t,Date.now());
      if (label && t.notified !== label) pending.push({t,label});
    }
    if (!pending.length) return;
    const first=pending[0].t;
    GM_notification({title:'Tickety follow-up · '+pending.length+' ticket(s)',text:pending.slice(0,3).map(({t,label})=>(t.owner||'Unknown opener')+' · '+t.name+' · '+label).join('\n'),
      onclick:()=>window.open('https://discord.com/channels/'+first.guild+'/'+first.id,'_blank','noopener')});
    pending.forEach(({t,label})=>save(t.guild,t.id,{notified:label}));
  }
  function tick() {
    const m = route(location.pathname);
    if (m) {
      if(context!==m[0]) { context=m[0]; seen=new WeakMap(); msg(''); }
      if(boardGuild!==m[1]) {boardGuild=m[1];lastView='';}
      scan(m[1],m[2]);
    }
    render();
  }
  $('#launch').onclick=()=>{$('section').hidden=!$('section').hidden;render();};
  $('#close').onclick=()=>{$('section').hidden=true;};
  $('#search').oninput=render; $('#filter').onchange=render;
  $('#alerts').onclick=()=>{
    const enabled=!read('alerts');write('alerts',enabled); render();
    msg(enabled?'Alerts enabled at 24 hours, 6 hours and past due. Keep Discord Web running.':'Desktop alerts disabled.');
    if(enabled) checkReminders();
  };
  $('#add').onclick=()=>{
    const m=route(location.pathname); if(!m)return;
    const old=read(keyFor(m[1],m[2]));
    const name=prompt('Who opened this ticket?',old?.owner||'');
    if(!name?.trim())return;
    save(m[1],m[2],{name:old?.name||document.title.split('|')[0].trim(),owner:name.trim().replace(/^@/,'')}); render();
  };
  $('#log').onclick=()=>{
    const m=route(location.pathname); if(!m)return;
    const key='log.'+m[1], active=read(key)===m[2];
    write(key,active?null:m[2]);seen=new WeakMap(); tick();
    msg(active?'Log watch removed.':'Watching this channel for loaded Tickety opening messages with a ticket link.');
  };
  function checkReminders() {
    if(!read('alerts'))return;
    if(navigator.locks) navigator.locks.request(PREFIX+'notify',{ifAvailable:true},lock=>{if(lock)reminders();});
    else reminders();
  }
  window.addEventListener('storage',e=>{if(e.key?.startsWith(PREFIX)){if(e.key.startsWith(PREFIX+'log.'))seen=new WeakMap();render();}});
  window.addEventListener('focus',()=>{tick();checkReminders();});
  setInterval(tick,4000);setInterval(checkReminders,60000);tick();checkReminders();
})();
