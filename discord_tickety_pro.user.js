// ==UserScript==
// @name         Discord Tickety Pro
// @namespace    doreso999-crypto/discord_tickety_pro
// @version      1.4.1
// @description  Group Tickety tickets, scan sidebar threads once per session, and remind staff to follow up.
// @match        https://discord.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/doreso999-crypto/discord_tickety_pro/main/discord_tickety_pro.user.js
// @downloadURL  https://raw.githubusercontent.com/doreso999-crypto/discord_tickety_pro/main/discord_tickety_pro.user.js
// @grant        GM_info
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_closeTab
// ==/UserScript==

(() => {
  'use strict';
  const VERSION = typeof GM_info !== 'undefined' && GM_info?.script?.version || '1.4.1';
  const HOUR = 3600000;
  const PREFIX = 'ticketyPro.1.';
  const route = path => /^\/channels\/(\d{15,20})\/(\d{15,20})(?:\/|$)/.exec(path);
  const read = key => JSON.parse(localStorage.getItem(PREFIX + key) || 'null');
  const write = (key, data) => localStorage.setItem(PREFIX + key, JSON.stringify(data));
  const keyFor = (guild, id) => 'ticket.' + guild + '.' + id;
  const created = id => Number(BigInt(id) >> 22n) + 1420070400000;
  
  const standalone = location.hash === '#tickety-board';
  const SCAN_HASH = '#tickety-scan=';
  const scanToken = location.hash.startsWith(SCAN_HASH)
    ? location.hash.slice(SCAN_HASH.length)
    : sessionStorage.getItem(PREFIX + 'scanner.worker');
  const isScanWorker = Boolean(scanToken) && !standalone;
  if (location.hash.startsWith(SCAN_HASH)) sessionStorage.setItem(PREFIX + 'scanner.worker', scanToken);
  const summaries = new Map();
  function isCompletion(text) {
    const sentence = text.toLowerCase().replace(/<@!?\d+>/g,'').trim();
    if (/\?|\b(?:not|never|don't|didn't|cannot|can't|pending|waiting|need|any|will|before|please update|can you|could you|when|if|should|haven't|hasn't)\b/i.test(sentence)) return false;
    return /\b(?:reactivated|updated|please close (?:the |this )?ticket)\b/.test(sentence)
      || /^(?:update|close)(?:[.!✅\s]+|$)$/.test(sentence);
  }
  function inspectTicket(t) {
    const key = historyKey(t.guild,t.id);
    const identity = JSON.stringify([t.owner,t.ownerAlias]);
    let summary = summaries.get(key);
    if (!summary || summary.identity !== identity) {
      const opened = created(t.id);
      const owners = [t.owner,t.ownerAlias].filter(Boolean).map(s=>s.trim().replace(/^@/,'').toLowerCase());
      let latest = opened, signal = null;
      for (const m of Object.values(read(key) || {})) {
        latest = Math.max(latest,m.time);
        if (owners.length && !owners.includes(m.author.trim().replace(/^@/,'').toLowerCase()) &&
            isCompletion(m.text) && (!signal || m.time > signal.time)) signal = m;
      }
      const deadline = new Date(latest);
      deadline.setDate(deadline.getDate()+6);
      summary = {identity,opened,latest,signal,due:deadline.getTime()}; summaries.set(key,summary);
    }
    return {...t,...summary};
  }
  function ageDays(opened,now) {
    const day = n=>{const d=new Date(n);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());};
    return Math.max(0,(day(now)-day(opened))/86400000);
  }
  function rows(guild) {
    return Object.keys(localStorage).filter(k => k.startsWith(PREFIX + 'ticket.' + guild + '.'))
      .map(k => JSON.parse(localStorage.getItem(k))).filter(Boolean).map(inspectTicket);
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
      #version{font-size:11px;color:#d3d6e6;border:1px solid #474b5e;border-radius:5px;padding:3px 6px;white-space:nowrap}
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
      #launch{background:#ffd343;color:#201903;border:2px solid #33290b;border-radius:22px;padding:9px 15px;touch-action:none;user-select:none;cursor:grab}
      #launch:active{cursor:grabbing}#board{border-top:4px solid #ffd343;background:#152029}
      #scanStatus{display:block;padding:7px 18px 9px;border-bottom:1px solid #383d4d;color:#d2dae3}
      #scanStatus:empty{display:none}
      footer button:disabled{opacity:.42;cursor:not-allowed}
      #detach,article>a{color:#a5e9f3;font-weight:650;text-underline-offset:3px}
      #detach{font-size:13px}summary{background:#24343d}.filters button[aria-pressed=true]{background:#ffda62;color:#211b0b;border-color:#ffda62}.filters button[aria-pressed=true] .count{color:#433514}
      .evidence{color:#9be2bb;padding:4px 0}.history>div{padding:0 12px}
      :host([data-full]) #board{inset:0;width:100vw;height:100dvh;max-height:none;max-width:none;border-radius:0;box-shadow:none;padding-inline:max(8px,calc((100vw - 1060px)/2));z-index:2147483647}
      :host([data-full]) #list{flex:1}:host([data-full]) #detach,:host([data-full]) #close{display:none}
    </style>
    <button id="launch" aria-expanded="false" aria-controls="board" hidden>Ticket board v1.4.1</button>
    <section id="board" hidden aria-label="Tickety ticket board">
      <header><h2>Ticket board</h2><span id="version" title="Installed userscript version">v1.4.1</span><a id="detach" target="_blank" rel="noopener">Open in tab ↗</a><button id="close" aria-label="Close ticket board">×</button></header>
      <div class="bar"><input id="search" type="search" aria-label="Search opener or ticket" placeholder="Search opener or ticket"><select id="sort" aria-label="Sort tickets within each opener"><option value="due">Expiring first</option><option value="age">Oldest ticket first</option><option value="latest">Latest activity first</option></select></div>
      <div class="filters" role="group" aria-label="Filter tickets"></div>
      <small class="viewer-help">Session scanner checks visible sidebar threads in one background tab. Only Tickety-confirmed tickets appear below. Scanning may mark threads as read.</small>
      <small role="status" id="scanStatus" aria-live="polite"></small>
      <details id="closedInbox"><summary>Closure notices</summary><div id="receipts" style="max-height:34vh;overflow:auto;padding:0 14px"></div></details>
      <small role="status" id="msg"></small><div id="list"></div>
      <footer><button id="scanNow">Scan all now</button><button id="scanToggle">Pause scan</button><button id="log">Watch this log</button><button id="alerts">Enable alerts</button></footer>
    </section>`;
  const $ = s => root.querySelector(s);
  $('#version').textContent = 'v' + VERSION;
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
      const mentions = thanked && node.querySelectorAll('[id^="message-content-"] [aria-label="Spoiler"] .mention');
      const ownerAlias = mentions?.length === 1 ? mentions[0].textContent.trim().replace(/^@/,'') : old?.ownerAlias;
      save(guild,id,{ownerAlias,owner:old?.owner || owner, name:name || old?.name || (id === channel ? currentTicket(channel).name : 'Ticket ' + id)});
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
        if (changed) {write(key,history); summaries.delete(key);}
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
    if (f === 'Likely complete') return Boolean(t.signal || t.status === 'Resolved');
    if (f === 'Active') return !t.signal && t.status !== 'Resolved';
    if (f === 'Due soon') return Boolean(stage(t,now));
    return t.status === f;
  };
  for (const label of ['Active','Due soon','Likely complete','All']) {
    const tab = button(label,()=>{filter=label;render();});
    tab.dataset.filter = label;
    const count = element('span',''); count.className='count'; tab.append(count);
    $('.filters').append(tab);
  }
  function catchClosures() {
    const dm = /^\/channels\/@me\/(\d+)(?:\/|$)/.exec(location.pathname);
    if (!dm || !document.querySelector('[data-list-id="chat-messages"][aria-label="Messages in Tickety"], main[aria-label="Tickety (Direct Message)" i], [aria-label^="Tickety (direct message)" i][href="/channels/@me/'+dm[1]+'"]')) return;
    for(const embed of document.querySelectorAll('[id^="message-accessories-"] article')) {
      if(embed.querySelector('[class*="embedTitle"]')?.textContent.trim() !== 'Ticket Closed' ||
         !embed.querySelector('[class*="embedFooterText"]')?.textContent.includes('Tickety.top')) continue;
      const row = embed.closest('li[id]');
      const match = row?.id.match(/^chat-messages-(\d+)-(\d+)$/);
      if(!match || match[1]!==dm[1]) continue;
      const desc = embed.querySelector('[class*="embedDescription"]');
      if(!desc) continue;
      const fields = {};
      for(const strong of desc.querySelectorAll('li strong')) {
        const label = strong.textContent.trim();
        fields[label]=strong.parentElement.textContent.slice(strong.textContent.length).replace(/^\s*:\s*/,'').trim();
      }
      const server=desc.querySelector('strong')?.textContent.trim();
      if(!server || !fields['Ticket Name']) continue;
      const key='closure.'+dm[1]+'.'+match[2];
      const notice={server,fields,dm:dm[1],id:match[2]};
      if(JSON.stringify(notice)!==JSON.stringify(read(key))) write(key,notice);
    }
  }
  let receiptView='';
  function renderClosures() {
    const keys=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX+'closure.'));
    const inbox=$('#closedInbox');
    inbox.querySelector('summary').textContent='Closure notices · '+keys.length;
    if(!inbox.open) return;
    const q=$('#search').value.trim().toLowerCase();
    const notices=keys.map(k=>JSON.parse(localStorage.getItem(k))).filter(n=>
      [n.server,...Object.values(n.fields)].join(' ').toLowerCase().includes(q))
      .sort((a,b)=>created(b.id)-created(a.id));
    const view=JSON.stringify(notices);
    if(view===receiptView)return;
    receiptView=view;
    const box=$('#receipts');box.replaceChildren();
    if(!notices.length)box.append(element('small',keys.length?'No matching notices.':'Open your Tickety DM to collect visible closure notices.'));
    for(const n of notices) {
      const f=n.fields,card=element('article',''),link=element('a',f['Ticket Name']);
      link.href='/channels/@me/'+n.dm+'/'+n.id;link.target='_blank';link.rel='noopener';
      card.append(link,element('small',[n.server,f['Panel Name'],f['Close Date']].filter(Boolean).join(' · ')),
        element('small',[f['Closed By'],f['Close Reason']].filter(Boolean).join(' · ')));
      box.append(card);
    }
  }
  $('#closedInbox').ontoggle=renderClosures;
  function render() {
    const m = route(location.pathname);
    $('#launch').hidden = !m || standalone || isScanWorker;
    if (!m) { $('#board').hidden = true; $('#launch').setAttribute('aria-expanded','false'); return; }
    const [,guild,channel] = m;
    renderScanStatus(guild);
    $('#detach').href = '/channels/'+guild+'/'+channel+'#tickety-board';
    const sort = $('#sort').value;
    const all = rows(guild).sort((a,b) => sort === 'age' ? a.opened-b.opened : sort === 'latest' ? b.latest-a.latest : a.due-b.due);
    const now = Date.now(), due = all.filter(t => stage(t,now)).length;
    $('#launch').textContent = 'Ticket board v' + VERSION + ' · ' + all.length + (due ? ' · ' + due + ' due' : '');
    if ($('section').hidden) return;
    renderClosures();
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
    const view = JSON.stringify([guild,new Date(now).toDateString(),shown,shown.map(t=>stage(t,now)),filter,q]);
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
        const date = element('small',('Estimated expiry') + ' · ' + new Date(t.due).toLocaleString() + (warning?' · '+warning:''));
        if (warning) date.className='alert';
        link.target='_blank'; link.rel='noopener';
        const key = historyKey(guild,t.id);
        const history = element('details',''); history.className='history'; history.id=key;
        history.open=openedHistory.has(key);
        history.append(element('summary','Messages'),element('div',''));
        history.ontoggle=()=>{if (!history.isConnected) return; if(history.open){openedHistory.add(key);refreshHistory(key);} else openedHistory.delete(key);};
        const age = ageDays(t.opened,now);
        const activity = element('small','Age · '+age+(age===1?' day':' days')+'   |   Last activity · '+new Date(t.latest).toLocaleString());
        activity.title='Opened '+new Date(t.opened).toLocaleString();
        card.append(link,activity,date);
        if(t.signal) {
          const evidence = element('small','Likely complete · '+t.signal.author+' · “'+t.signal.text.slice(0,160)+'”');
          evidence.className='evidence';card.append(evidence);
        }
        card.append(history); group.append(card);
      }
      list.append(group);
    }
    list.scrollTop = scrollTop;
  }
  function reminders() {
    if (!read('alerts')) return;
    const pending = [];
    for (const key of Object.keys(localStorage).filter(k=>k.startsWith(PREFIX+'ticket.'))) {
      const t = inspectTicket(JSON.parse(localStorage.getItem(key))), label = stage(t,Date.now());
      if (label && t.notified !== t.due+'|'+label) pending.push({t,label});
    }
    if (!pending.length) return;
    const first=pending[0].t;
    GM_notification({title:'Tickety follow-up · '+pending.length+' ticket(s)',text:pending.slice(0,3).map(({t,label})=>(t.owner||'Unknown opener')+' · '+t.name+' · '+label).join('\n'),
      onclick:()=>window.open('https://discord.com/channels/'+first.guild+'/'+first.id,'_blank','noopener')});
    pending.forEach(({t,label})=>save(t.guild,t.id,{notified:t.due+'|'+label}));
  }

  // Browser-session scan: a single background Tampermonkey tab visits the
  // thread entries rendered in the current server's sidebar. It never uses
  // a Discord user token, private endpoints, or bulk network requests.
  const SCAN_IDLE_MS = 30 * 60 * 1000;
  const SCAN_STALE_MS = 2 * 60 * 1000;
  const SCAN_LOAD_MS = 16000;
  const scanJobKey = guild => 'scanner.job.' + guild;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scanId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  function discoverThreads() {
    const found = new Map();
    for (const item of document.querySelectorAll('[data-list-item-id^="channels___"][aria-label*="(thread)"]')) {
      const id = item.getAttribute('data-list-item-id')?.match(/^channels___(\d{15,20})$/)?.[1];
      if (!id) continue;
      const name = item.querySelector('[class*="name_"] [aria-hidden="true"]')?.textContent.trim()
        || item.querySelector('[class*="name_"]')?.textContent.trim()
        || item.getAttribute('aria-label')?.replace(/^(?:\d+ mentions?,\s*)/i,'').replace(/\s*\(thread\).*$/i,'').trim()
        || 'Ticket ' + id;
      found.set(id, {id,name});
    }
    const m = route(location.pathname);
    if (m) {
      const main = [...document.querySelectorAll('main[aria-label]')]
        .find(el => threadTitle(el) && el.querySelector('[id^="chat-messages-' + m[2] + '-"]'));
      if (main && !found.has(m[2])) found.set(m[2], {id:m[2],name:threadTitle(main)});
    }
    return [...found.values()];
  }

  // A resumed browser tab may restore sessionStorage. A shared, recently
  // active localStorage marker is more useful for detecting a fresh session.
  function browserSession() {
    const now = Date.now();
    let session = read('scanner.session');
    if (!session || !session.id || now - session.seen > SCAN_IDLE_MS || session.seen > now + 60000) {
      session = {id:scanId(),seen:now};
      write('scanner.session',session);
    } else if (now - session.seen > 55000) {
      session.seen=now;
      write('scanner.session',session);
    }
    return session.id;
  }

  function makeScanJob(guild,session,queue) {
    return {guild,session,id:scanId(),queue,index:0,results:{},status:'ready',
      heartbeat:0,started:Date.now(),updated:Date.now(),error:''};
  }

  function mergeDiscovered(job,threads) {
    const known = new Set(job.queue.map(t=>t.id));
    let added=0;
    for (const thread of threads) if (!known.has(thread.id)) {
      job.queue.push(thread); known.add(thread.id); added++;
    }
    if (added && job.status==='complete') job.status='ready';
    return added;
  }

  function launchScan(guild,userGesture=false) {
    const key=scanJobKey(guild);
    let job=read(key);
    if (!job || !job.queue.length || job.index>=job.queue.length || !navigator.onLine) return false;
    if (job.status==='paused') return false;
    if (job.status==='running' && Date.now()-job.heartbeat < SCAN_STALE_MS) return true;
    job={...job,status:'running',heartbeat:Date.now(),updated:Date.now(),error:''};
    write(key,job);
    const target=location.origin+'/channels/'+guild+'/'+job.queue[job.index].id+SCAN_HASH+job.id;
    try {
      if (typeof GM_openInTab==='function') {
        const tab=GM_openInTab(target,{active:false,insert:true,setParent:true});
        if (tab) return true;
      }
      if (userGesture && window.open(target,'_blank')) return true;
      throw new Error('Background tab unavailable. Allow Tampermonkey to open tabs and press Resume scan.');
    } catch (error) {
      job={...job,status:'ready',error:error.message || 'Scanner tab could not open.'};
      write(key,job);
      return false;
    }
  }

  function maybeStartSessionScan(guild) {
    if (isScanWorker || !navigator.onLine || document.visibilityState!=='visible') return;
    const discovered=discoverThreads();
    if (!discovered.length) return;
    const session=browserSession();
    const key=scanJobKey(guild);
    let job=read(key);
    if (!job || job.session!==session) {
      job=makeScanJob(guild,session,discovered);
      write(key,job);
      launchScan(guild);
      return;
    }
    const added=mergeDiscovered(job,discovered);
    if (added) {
      job.updated=Date.now();
      write(key,job);
      if (job.status==='ready' && !job.error) launchScan(guild);
    }
    if (job.status==='running' && Date.now()-job.heartbeat > SCAN_STALE_MS) {
      job.status='interrupted';
      job.error='Scanning tab stopped responding. Press Resume scan.';
      write(key,job);
    }
  }

  function renderScanStatus(guild) {
    const job=read(scanJobKey(guild));
    const status=$('#scanStatus'), action=$('#scanToggle'), now=$('#scanNow');
    const total=job?.queue.length || 0;
    const complete=Math.min(total,job?.index || 0);
    const uncertain=Object.values(job?.results || {}).filter(v=>v!=='collected').length;
    const state=job?.status || 'waiting';
    const caption={ready:'Ready',running:'Scanning',paused:'Paused',complete:'Finished',
      interrupted:'Interrupted',waiting:'Waiting for threads'}[state] || state;
    status.textContent='Session scan: '+caption+' · '+complete+'/'+total+' threads'
      +(uncertain ? ' · '+uncertain+' unverified' : '')
      +(job?.error ? ' · '+job.error : '')
      +(total ? ' · only verified Tickety tickets are listed' : '');
    action.textContent=state==='running' ? 'Pause scan' : 'Resume scan';
    action.disabled=!job || state==='complete' || (state==='waiting') || !total;
    now.disabled=state==='running';
    return job;
  }

  function closeWorker() {
    sessionStorage.removeItem(PREFIX+'scanner.worker');
    try { if (typeof GM_closeTab==='function') {GM_closeTab(); return;} } catch {}
    window.close();
  }

  async function waitForThread(id) {
    const until=Date.now()+SCAN_LOAD_MS;
    while (Date.now()<until) {
      const main=[...document.querySelectorAll('main[aria-label]')].find(node=>
        threadTitle(node) && node.querySelector('li[id^="chat-messages-' + id + '-"]'));
      if (main) return main;
      await delay(450);
    }
    return null;
  }

  async function visitThread(guild,item) {
    const main=await waitForThread(item.id);
    if (!main) return 'unverified';
    const scroller=main.querySelector('[class*="scroller_"][role="group"]');
    const until=Date.now()+9000;
    // Visit the beginning to find Tickety's creator embed, including when
    // Discord initially displays only the newest part of a long thread.
    do {
      scan(guild,item.id);
      captureReplies(guild,item.id);
      if (read(keyFor(guild,item.id))?.owner) break;
      if (scroller) scroller.scrollTop=0;
      await delay(550);
    } while (Date.now()<until && navigator.onLine);
    // Return to recent messages to collect the latest available replies.
    if (scroller) {
      scroller.scrollTop=scroller.scrollHeight;
      await delay(650);
    }
    scan(guild,item.id);
    captureReplies(guild,item.id);
    await delay(350); // permit queued navigator.locks writes to finish
    return read(keyFor(guild,item.id))?.owner ? 'collected' : 'unverified';
  }

  async function openWorkerRoute(guild,id) {
    if (route(location.pathname)?.[2]===id && route(location.pathname)?.[1]===guild) return true;
    // Prefer Discord's own SPA navigation when the thread is rendered.
    const sidebar=document.querySelector('[data-list-item-id="channels___'+id+'"][aria-label*="(thread)"]');
    if (sidebar) {
      sidebar.click();
      const until=Date.now()+4500;
      while (Date.now()<until) {
        if (route(location.pathname)?.[1]===guild && route(location.pathname)?.[2]===id) return true;
        await delay(200);
      }
    }
    // Fallback: full navigation, retaining a worker marker across reloads.
    location.replace(location.origin+'/channels/'+guild+'/'+id+SCAN_HASH+scanToken);
    return false;
  }

  let workerBusy=false;
  async function runScanWorker() {
    if (!isScanWorker || workerBusy) return;
    workerBusy=true;
    try {
      while (true) {
        const m=route(location.pathname);
        const guild=m?.[1];
        const key=guild && scanJobKey(guild);
        const job=key && read(key);
        if (!job || job.id!==scanToken || job.status!=='running') {closeWorker();return;}
        if (job.index>=job.queue.length) {
          job.status='complete';job.heartbeat=Date.now();job.updated=Date.now();
          write(key,job);closeWorker();return;
        }
        if (!navigator.onLine) {
          job.heartbeat=Date.now();write(key,job);await delay(1500);continue;
        }
        const item=job.queue[job.index];
        if (!(await openWorkerRoute(guild,item.id))) return;
        job.heartbeat=Date.now();job.updated=Date.now();write(key,job);
        const result=await visitThread(guild,item);
        const current=read(key);
        if (!current || current.id!==job.id || current.status!=='running') {
          closeWorker();return;
        }
        // Another tab may have added tickets while this page was loading.
        if (current.index!==job.index) continue;
        current.results[item.id]=result;
        current.index++;
        current.heartbeat=Date.now();
        current.updated=Date.now();
        write(key,current);
        await delay(500);
      }
    } catch (error) {
      const m=route(location.pathname), key=m && scanJobKey(m[1]);
      const job=key && read(key);
      if (job && job.id===scanToken) {
        job.status='interrupted';
        job.error='Scanner error: '+(error?.message || String(error));
        write(key,job);
      }
      closeWorker();
    } finally {
      workerBusy=false;
    }
  }

  function tick() {
    catchClosures();
    const m = route(location.pathname);
    if (m) {
      if(context!==m[0]) { context=m[0]; seen=new WeakMap(); watchSince.clear(); msg(''); }
      if(boardGuild!==m[1]) {boardGuild=m[1];lastView='';}
      scan(m[1],m[2]); captureReplies(m[1],m[2]);
      if (!isScanWorker) maybeStartSessionScan(m[1]);
    }
    if (!isScanWorker) render();
  }
  function setBoard(open) {
    $('#board').hidden = !open;
    $('#launch').setAttribute('aria-expanded',String(open));
    if(open) {render(); $('#search').focus();}
    else {$('#launch').focus();}
  }
  const launcher = $('#launch');
  launcher.title='Open ticket board · drag to move';
  let drag = null, moved = false;
  function place(x,y) {
    launcher.style.left=Math.max(0,Math.min(x,innerWidth-launcher.offsetWidth))+'px';
    launcher.style.top=Math.max(0,Math.min(y,innerHeight-launcher.offsetHeight))+'px';
    launcher.style.right='auto';launcher.style.bottom='auto';
  }
  function restorePosition() {
    const pos=read('launcherPosition');
    if(pos && !launcher.hidden) place(pos.x,pos.y);
  }
  launcher.onpointerdown=e=>{
    if(e.button!==0)return;
    const rect=launcher.getBoundingClientRect();
    drag={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};moved=false;
    launcher.setPointerCapture(e.pointerId);
  };
  launcher.onpointermove=e=>{
    if(!drag)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!moved && Math.hypot(dx,dy)<5)return;
    moved=true;place(drag.left+dx,drag.top+dy);
  };
  launcher.onpointerup=()=>{
    if(drag && moved)write('launcherPosition',{x:launcher.offsetLeft,y:launcher.offsetTop});
    drag=null;
  };
  launcher.onpointercancel=()=>{drag=null;moved=false;};
  launcher.onclick=e=>{if(!moved || e.detail===0)setBoard($('#board').hidden);moved=false;};
  window.addEventListener('resize',restorePosition);
  if(standalone){host.setAttribute('data-full','');$('#board').hidden=false;}
  if(isScanWorker) {$('#launch').hidden=true;$('#board').hidden=true;}
  
  $('#close').onclick=()=>setBoard(false);
  $('#scanNow').onclick=()=>{
    const m=route(location.pathname);if(!m)return;
    const current=read(scanJobKey(m[1]));
    if(current?.status==='running')return;
    const queue=discoverThreads();
    if(!queue.length){msg('No visible sidebar threads found.');return;}
    const job=makeScanJob(m[1],browserSession(),queue);
    write(scanJobKey(m[1]),job);
    launchScan(m[1],true);render();
  };
  $('#scanToggle').onclick=()=>{
    const m=route(location.pathname);if(!m)return;
    const key=scanJobKey(m[1]), job=read(key);if(!job)return;
    if(job.status==='running') {
      job.status='paused';job.updated=Date.now();write(key,job);
      msg('Scan paused. The scanner will finish its current ticket before stopping.');
    } else if(['paused','ready','interrupted'].includes(job.status)) {
      job.status='ready';job.error='';write(key,job);
      launchScan(m[1],true);
    }
    render();
  };
  root.addEventListener('keydown',e=>{
    if(!standalone && e.key==='Escape' && !$('#board').hidden) {
      e.stopPropagation(); setBoard(false);
    }
  });
  $('#search').oninput=render; $('#sort').onchange=render;
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
    if(isScanWorker || !read('alerts'))return;
    if(navigator.locks) navigator.locks.request(PREFIX+'notify',{ifAvailable:true},lock=>{if(lock)reminders();});
    else reminders();
  }
  window.addEventListener('storage',e=>{if(e.key?.startsWith(PREFIX)){if(e.key.startsWith(PREFIX+'messages.')) {summaries.delete(e.key.slice(PREFIX.length));refreshHistory(e.key.slice(PREFIX.length));render();return;} if(e.key.startsWith(PREFIX+'log.'))seen=new WeakMap();render();}});
  window.addEventListener('focus',()=>{tick();checkReminders();});
  window.addEventListener('online',()=>{tick();if(isScanWorker)runScanWorker();});
  setInterval(tick,4000);setInterval(checkReminders,60000);
  tick();restorePosition();checkReminders();
  if(isScanWorker)runScanWorker();
})();
