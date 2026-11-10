// ==UserScript==
// @name         Discord Tickety Pro
// @namespace    doreso999-crypto/discord_tickety_pro
// @version      1.2.0
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
      :host{all:initial;color-scheme:dark;font:14px/1.45 system-ui,"Segoe UI",sans-serif;color:#eff1f8}
      *{box-sizing:border-box}[hidden]{display:none!important}
      button,input,select{font:inherit;color:inherit}button,select,summary{cursor:pointer}
      button,select,input{background:#232735;border:1px solid #414657;border-radius:7px;padding:7px 10px}
      button:hover,select:hover{background:#323748} :focus-visible{outline:2px solid #abaaff;outline-offset:2px}
      #launch,#board{position:fixed;right:16px;z-index:2147483646}
      #launch{bottom:16px;background:#343555;font-weight:650;box-shadow:0 4px 18px #0005}
      #board{bottom:64px;width:min(580px,calc(100vw - 32px));max-height:min(800px,calc(100dvh - 86px));display:flex;flex-direction:column;background:#191c25;border:1px solid #474b5e;border-radius:15px;box-shadow:0 12px 52px #0007;overflow:hidden}
      header,footer,.bar,.fields,.filters,.topline,summary{display:flex;align-items:center;gap:8px}
      header{padding:16px 18px 10px}h2{font-size:19px;letter-spacing:-.03em;margin:0;flex:1}
      #close{font-size:20px;padding:0;width:32px;height:32px}
      .bar{padding:0 18px 12px}.bar input{min-width:0;flex:1;background:#10131b}
      .filters{padding:0 18px 12px;gap:5px;flex-wrap:wrap;border-bottom:1px solid #383d4d}
      .filters button{border:1px solid transparent;background:transparent;padding:4px 8px;font-size:13px;color:#c2c6d3}
      .filters button[aria-pressed=true]{background:#363558;color:white;border-color:#66638f}
      .count{font-variant-numeric:tabular-nums;margin-left:5px;color:#c7c5ec}
      #list{overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:6px 12px 12px;min-height:0}
      #list details{margin:6px 0;border:1px solid #363c4d;border-radius:9px;overflow:hidden}
      summary{background:#252936;padding:10px 12px;list-style:none;font-weight:650}
      summary::-webkit-details-marker{display:none}summary:before{content:'›';color:#adafc4;font-size:17px}details[open]>summary:before{transform:rotate(90deg)}
      .user{flex:1;overflow-wrap:anywhere}.meta,small{color:#b8bdcc;font-size:12px}
      article{padding:10px 12px;border-top:1px solid #343949}.topline a{flex:1;color:#dadbff;font-weight:600;text-decoration:none;overflow-wrap:anywhere}.topline a:hover{text-decoration:underline}
      article small{display:block;margin-top:4px}article button,article select{font-size:12px;padding:5px 7px}.alert{color:#ffce84}
      footer{padding:9px 16px;border-top:1px solid #383d4d;flex-wrap:wrap}footer button{font-size:12px}#alerts[aria-pressed=true]{color:#9de1bd}
      #msg:not(:empty){padding:5px 18px;color:#c6c7ff}#editor{padding:12px 18px;border-bottom:1px solid #49496c;background:#252737}
      #editor strong{display:block;margin-bottom:8px}.fields{align-items:end;flex-wrap:wrap}.fields label{flex:1;min-width:125px;font-size:12px;color:#c8cbd9}.fields input{display:block;width:100%;margin-top:4px}.primary{background:#535294;color:white}.empty{display:block;padding:18px 8px}
      @media(max-width:480px){#launch,#board{right:8px}#board{width:calc(100vw - 16px)}header,.bar,.filters,#editor,footer{padding-left:10px;padding-right:10px}.topline{flex-wrap:wrap}.topline a{min-width:45%}}
      @media(max-height:520px){#board{top:6px;bottom:6px;max-height:none}#editor{overflow:auto;max-height:40dvh}}
      .viewer-help{padding:8px 18px}.history{white-space:pre-wrap;overflow-wrap:anywhere}.history p{margin:6px 0 12px}.history summary{font-size:12px}
    </style>
    <button id="launch" aria-expanded="false" aria-controls="board" hidden>Ticket board</button>
    <section id="board" hidden aria-label="Tickety ticket board">
      <header><h2>Ticket board</h2><button id="close" aria-label="Close ticket board">×</button></header>
      <div class="bar"><input id="search" type="search" aria-label="Search opener or ticket" placeholder="Search opener or ticket"></div>
      <div class="filters" role="group" aria-label="Filter tickets"></div>
      <small class="viewer-help">Open a ticket to collect its visible messages. Keep it open in a separate tab for reply alerts while you work elsewhere.</small>
      <small role="status" id="msg"></small><div id="list"></div>
      <footer><button id="log">Watch this log</button><button id="alerts">Enable alerts</button></footer>
    </section>`;
  const $ = s => root.querySelector(s);
  const msg = s => { $('#msg').textContent = s; };
  const element = (tag, label) => Object.assign(document.createElement(tag), {textContent:label});
  let context = '', boardGuild = '', seen = new WeakMap();
  function threadTitle(main) {
    const label = main?.getAttribute('aria-label') || '';
    return label.match(/^(.+) \(thread\)$/i)?.[1].trim() || '';
  }
  function currentTicket(channel) {
    for (const main of document.querySelectorAll('main[aria-label]')) {
      const row = main.querySelector('[id^="chat-messages-' + channel + '-"]');
      if (row && threadTitle(main)) return {id:channel, name:threadTitle(main)};
    }
    const label = document.title.split('|')[0].trim();
    return {id:channel, name:label && !/^(?:\(\d+\)\s*)?Discord$/i.test(label) ? label : 'Ticket ' + channel};
  }
  function scan(guild, channel) {
    for (const node of document.querySelectorAll('[id^="chat-messages-"]')) {
      const row = /^chat-messages-(\d{15,20})-\d{15,20}$/.exec(node.id);
      if (!row) continue;
      const source = row[1];
      const main = node.closest('main[aria-label]');
      const title = threadTitle(main);
      if (source !== channel && !title) continue;
      const author = node.querySelector('[id^="message-username-"] [data-text], [id^="message-username-"] [class*="username_"]')
        || node.querySelector('[id^="message-username-"]');
      if (author?.textContent.trim().toLowerCase() !== 'tickety') continue;
      const body = node.innerText || '';
      const signature = title + '\n' + body;
      if (seen.get(node) === signature) continue;
      seen.set(node,signature);
      const embed = [...node.querySelectorAll('[id^="message-accessories-"] article')]
        .find(el => /^ticket created$/i.test(el.querySelector('[class*="embedTitle"]')?.textContent.trim() || ''));
      const description = embed?.querySelector('[class*="embedDescription"]')?.textContent.trim() || '';
      const thanked = /^thanks\s+@?([^\n]{1,80}?)\s+for creating a (?:task|ticket)\b/i.exec(description);
      const owner = thanked?.[1].trim() || opener(body);
      if (!owner && !/ticket (?:created|opened)|your ticket has been created/i.test(body)) continue;
      let id = source, name = title;
      if (!(title && thanked)) {
        const targets = new Map();
        for (const a of node.querySelectorAll('a[href]')) {
          const m = route(a.pathname);
          if (a.origin === location.origin && m?.[1] === guild && m[2] !== source) targets.set(m[2], a.textContent.trim());
        }
        if (read('log.' + guild) === source || targets.size) {
          if (targets.size !== 1) continue;
          [id,name] = targets.entries().next().value;
        } else if (!owner) continue;
      }
      const old = read(keyFor(guild,id));
      save(guild,id,{owner:old?.owner || owner, name:name || old?.name || (id === channel ? currentTicket(channel).name : 'Ticket ' + id)});
    }
  }
  const historyKey = (guild,id) => 'messages.' + guild + '.' + id;
  const observedRows = new WeakMap();
  const openedHistory = new Set();
  const watchSince = new Map();
  function readReply(node, id) {
    const content = node.querySelector('[id="message-content-' + id + '"]');
    const timestamp = node.querySelector('[id="message-timestamp-' + id + '"]');
    if (!content || !timestamp) return null;
    const article = node.querySelector('[aria-labelledby*="message-username-"]');
    const reference = article?.getAttribute('aria-labelledby').match(/\bmessage-username-\d+\b/);
    const header = reference && document.getElementById(reference[0]);
    if (!header || header.querySelector('[aria-label$="App" i]')) return null;
    const author = (header.querySelector('[data-text]') || header).textContent.trim();
    if (!author || author.toLowerCase() === 'tickety') return null;
    const copy = content.cloneNode(true);
    copy.querySelectorAll('[class*="timestamp_"]').forEach(el=>el.remove());
    const text = copy.textContent.trim();
    const attachments = [...node.querySelectorAll('a[data-role="img"],a[class*="attachmentName"]')]
      .map(a=>a.textContent.trim() || 'Image attachment');
    const time = Date.parse(timestamp.dateTime);
    if (!Number.isFinite(time) || (!text && !attachments.length)) return null;
    return {id,author,time,text:[text,...attachments].filter(Boolean).join('\n')};
  }
  function captureReplies(guild,channel) {
    const batches = new Map();
    for (const node of document.querySelectorAll('li[id^="chat-messages-"]')) {
      const match = /^chat-messages-(\d+)-(\d+)$/.exec(node.id);
      if (!match) continue;
      const [,thread,id] = match;
      if (thread !== channel && !threadTitle(node.closest('main[aria-label]'))) continue;
      const ticket = read(keyFor(guild,thread));
      if (!ticket) continue;
      const key = historyKey(guild,thread);
      if (!watchSince.has(key)) watchSince.set(key,Date.now());
      const signature = node.id + '\n' + node.textContent;
      if (observedRows.get(node) === signature) continue;
      const reply = readReply(node,id);
      if (!reply) continue;
      if (!batches.has(key)) batches.set(key,{ticket,items:[],since:watchSince.get(key)});
      batches.get(key).items.push({node,signature,reply});
    }
    for (const [key,{ticket,items,since}] of batches) {
      const commit = () => {
        const history = read(key) || {};
        const fresh = [];
        let changed = false;
        for (const {node,reply} of items) {
          const old = history[reply.id];
          if (!old && reply.time >= since && !node.querySelector('[role="button"][aria-label="Edit"]')) fresh.push(reply);
          if (!old || old.text !== reply.text || old.author !== reply.author) {
            history[reply.id] = reply; changed = true;
          }
        }
        if (changed) write(key,history);
        items.forEach(({node,signature})=>observedRows.set(node,signature));
        if (changed) refreshHistory(key);
        if (fresh.length && read('alerts')) {
          const latest = fresh[fresh.length-1];
          GM_notification({title:ticket.name,text:latest.author+' · '+latest.text.slice(0,160),
            onclick:()=>window.open('/channels/'+guild+'/'+ticket.id+'/'+latest.id,'_blank','noopener')});
        }
      };
      const failed = ()=>msg('Could not save ticket messages in this browser.');
      if (navigator.locks) navigator.locks.request(PREFIX+key,commit).catch(failed);
      else {try {commit();} catch {failed();}}
    }
  }
  function refreshHistory(key) {
    const panel = root.getElementById(key);
    if (!panel?.open) return;
    const body = panel.lastElementChild;
    body.replaceChildren();
    const messages = Object.values(read(key) || {}).sort((a,b)=>a.time-b.time || a.id.localeCompare(b.id));
    if (!messages.length) body.append(element('small','Open this ticket to collect visible replies.'));
    for (const m of messages) body.append(element('small',m.author+' · '+new Date(m.time).toLocaleString()),element('p',m.text));
  }
  function button(label, action) {
    const b = element('button',label); b.onclick = action; return b;
  }
  let lastView = '', filter = 'Active';
  const expanded = new Map();
  const matchesFilter = (t, f, now) => {
    if (f === 'All') return true;
    if (f === 'Active') return t.status !== 'Resolved';
    if (f === 'Due soon') return Boolean(stage(t,now));
    return t.status === f;
  };
  for (const label of ['Active','Due soon','All']) {
    const tab = button(label,()=>{filter=label;render();});
    tab.dataset.filter = label;
    const count = element('span',''); count.className='count'; tab.append(count);
    $('.filters').append(tab);
  }
  function render() {
    const m = route(location.pathname);
    $('#launch').hidden = !m;
    if (!m) { $('#board').hidden = true; $('#launch').setAttribute('aria-expanded','false'); return; }
    const [,guild,channel] = m;
    const all = rows(guild).sort((a,b) => a.due-b.due);
    const now = Date.now(), due = all.filter(t => stage(t,now)).length;
    $('#launch').textContent = 'Ticket board · ' + all.length + (due ? ' · ' + due + ' due' : '');
    if ($('section').hidden) return;
    $('#alerts').textContent = read('alerts') ? 'Disable alerts' : 'Enable alerts';
    $('#log').textContent = read('log.'+guild) === channel ? 'Stop watching this log' : 'Watch this log';
    $('#alerts').setAttribute('aria-pressed',String(Boolean(read('alerts'))));
    for (const tab of $('.filters').children) {
      tab.setAttribute('aria-pressed',String(tab.dataset.filter === filter));
      tab.lastChild.textContent = all.filter(t => matchesFilter(t,tab.dataset.filter,now)).length;
    }
    const q = $('#search').value.trim().toLowerCase();
    const shown = all.filter(t => (t.owner+' '+t.name+' '+t.id).toLowerCase().includes(q) &&
      matchesFilter(t,filter,now));
    const view = JSON.stringify([guild,shown,shown.map(t=>stage(t,now)),filter,q]);
    if (view === lastView) return;
    lastView = view;
    const list = $('#list');
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    const groups = new Map();
    for (const t of shown) {
      const k = t.owner.toLowerCase();
      if (!groups.has(k)) groups.set(k,[]);
      groups.get(k).push(t);
    }
    if (!shown.length) {
      const empty = element('small',all.length ? 'No tickets match this view.' : 'Open a Tickety ticket, or select Watch this log in your ticket log channel.');
      empty.className='empty'; list.append(empty);
    }
    for (const key of [...groups.keys()].sort((a,b)=>a.localeCompare(b))) {
      const tickets = groups.get(key), group = document.createElement('details');
      const groupKey = guild + '/' + key;
      group.open = expanded.get(groupKey) ?? (groups.size===1 || Boolean(q));
      group.ontoggle = ()=>{if(group.isConnected) expanded.set(groupKey,group.open);};
      const summary = element('summary','');
      const user = element('span',tickets[0].owner || 'Unknown opener'); user.className='user';
      const count = element('span',tickets.length === 1 ? '1 ticket' : tickets.length+' tickets'); count.className='meta';
      const urgent = tickets.filter(t=>stage(t,now)).length;
      if (urgent) { const flag=element('small',urgent+' due'); flag.className='alert'; summary.append(user,flag,count); }
      else summary.append(user,count);
      group.append(summary);
      for (const t of tickets) {
        const card = document.createElement('article'), link = element('a',t.name);
        link.href = '/channels/'+guild+'/'+t.id;
        const warning = stage(t,now);
        const date = element('small',(t.exact?'Close time':'7-day estimate') + ' · ' + new Date(t.due).toLocaleString() + (warning?' · '+warning:''));
        if (warning) date.className='alert';
        link.target='_blank'; link.rel='noopener';
        const key = historyKey(guild,t.id);
        const history = element('details',''); history.className='history'; history.id=key;
        history.open=openedHistory.has(key);
        history.append(element('summary','Messages'),element('div',''));
        history.ontoggle=()=>{if (!history.isConnected) return; if(history.open){openedHistory.add(key);refreshHistory(key);} else openedHistory.delete(key);};
        card.append(link,date,history); group.append(card);
      }
      list.append(group);
    }
    list.scrollTop = scrollTop;
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
      if(context!==m[0]) { context=m[0]; seen=new WeakMap(); watchSince.clear(); msg(''); }
      if(boardGuild!==m[1]) {boardGuild=m[1];lastView='';}
      scan(m[1],m[2]); captureReplies(m[1],m[2]);
    }
    render();
  }
  function setBoard(open) {
    $('#board').hidden = !open;
    $('#launch').setAttribute('aria-expanded',String(open));
    if(open) {render(); $('#search').focus();}
    else {$('#launch').focus();}
  }
  $('#launch').onclick=()=>setBoard($('#board').hidden);
  $('#close').onclick=()=>setBoard(false);
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !$('#board').hidden) {
      e.stopPropagation(); setBoard(false);
    }
  });
  $('#search').oninput=render;
  $('#alerts').onclick=()=>{
    const enabled=!read('alerts');write('alerts',enabled); render();
    msg(enabled?'Reply alerts enabled for open ticket tabs. Deadline alerts run at 24 hours, 6 hours and past due.':'Desktop alerts disabled.');
    if(enabled) checkReminders();
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
  window.addEventListener('storage',e=>{if(e.key?.startsWith(PREFIX)){if(e.key.startsWith(PREFIX+'messages.')) {refreshHistory(e.key.slice(PREFIX.length));return;} if(e.key.startsWith(PREFIX+'log.'))seen=new WeakMap();render();}});
  window.addEventListener('focus',()=>{tick();checkReminders();});
  setInterval(tick,4000);setInterval(checkReminders,60000);tick();checkReminders();
})();
