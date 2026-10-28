import React, { useState } from 'react';
import { Checkbox, Menu, MenuButton, MenuList, MenuItem, MenuDivider, Spinner } from '@chakra-ui/react';
import { FiMenu, FiSearch, FiEdit, FiTrash2, FiArchive, FiShield, FiFolder, FiMail, FiCornerUpLeft, FiChevronsLeft, FiCornerUpRight, FiFlag, FiTag, FiPrinter, FiRefreshCw, FiChevronDown, FiChevronRight, FiInbox, FiSend, FiFileText, FiStar, FiCheck, FiSettings, FiPaperclip, FiX, FiArrowUp, FiArrowDown, FiAlertCircle } from 'react-icons/fi';
import { formatMailDate, sanitizeMailHtml } from './schema';
import './workspace.css';

const icons = { inbox: FiInbox, sentitems: FiSend, drafts: FiFileText, archive: FiArchive, junkemail: FiShield, deleteditems: FiTrash2 };
export const MAIL_CATEGORIES = ['Klijent', 'Ponuda', 'Važno', 'Za odgovor'];

function Action({ label, icon: Icon, onClick, disabled, className = '', children }) {
  return <button type="button" className={`mail-action ${className}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}><Icon />{children && <span>{children}</span>}</button>;
}

export function MailHeader({ status, search, onSearch, preferences, onPreference, sidebarOpen, onSidebar }) {
  return <>
    <header className="mail-header">
      <div className="mail-brand"><FiMail /><span>Outlook <span className="mail-brand-light">Mail</span></span></div>
      <div className="mail-search"><FiSearch /><input aria-label="Pretraga poruka" placeholder="Pretraži poštu" value={search} onChange={(event) => onSearch(event.target.value)} />{search && <Action label="Očisti pretragu" icon={FiX} onClick={() => onSearch('')} />}</div>
      <span className="mail-account" title={status.mailbox}><i />{status.mailbox}</span>
      <Menu><MenuButton as="button" className="mail-action" aria-label="Postavke prikaza"><FiSettings /></MenuButton><MenuList><MenuItem onClick={() => onPreference('compact', !preferences.compact)}>{preferences.compact ? 'Udoban prikaz' : 'Kompaktan prikaz'}</MenuItem><MenuItem onClick={() => onPreference('reading', !preferences.reading)}>{preferences.reading ? 'Sakrij pregled poruke' : 'Prikaži pregled poruke'}</MenuItem></MenuList></Menu>
    </header>
    <div className="mail-tabs"><Action label={sidebarOpen ? 'Sakrij mape' : 'Prikaži mape'} icon={FiMenu} onClick={onSidebar} /><span className="mail-tab-active">Početna</span><Menu><MenuButton as="button" className="mail-tab">Prikaz</MenuButton><MenuList><MenuItem onClick={() => onPreference('compact', !preferences.compact)}>{preferences.compact ? 'Udoban prikaz' : 'Kompaktan prikaz'}</MenuItem><MenuItem onClick={() => onPreference('reading', !preferences.reading)}>{preferences.reading ? 'Sakrij pregled poruke' : 'Prikaži pregled poruke'}</MenuItem></MenuList></Menu><span className="mail-connection">{status.displayName || 'Pošta'} · {status.writeEnabled ? 'Povezano' : 'Samo za čitanje'}</span></div>
  </>;
}

export function MailToolbar({ writeEnabled, message, selectedCount, busy, folders, onCompose, onAction, onRefresh, onPrint }) {
  const disabled = !writeEnabled || busy || (!message && !selectedCount);
  const singleDisabled = disabled || selectedCount > 0 || message?.isDraft;
  return <div className="mail-toolbar" role="toolbar" aria-label="Radnje s poštom">
    <Action label="Nova poruka" icon={FiEdit} className="mail-new" disabled={!writeEnabled || busy} onClick={() => onCompose('compose')}>Nova poruka</Action>
    <span className="mail-separator" />
    <Action label="Obriši poruku" icon={FiTrash2} disabled={disabled} onClick={() => onAction('delete')} />
    <Action label="Arhiviraj poruku" icon={FiArchive} disabled={disabled} onClick={() => onAction('archive')} />
    <Action label="Neželjena pošta" icon={FiShield} disabled={disabled} onClick={() => onAction('move', 'junkemail')} />
    <Menu><MenuButton as="button" className="mail-action" aria-label="Premjesti u mapu" disabled={disabled}><FiFolder /><FiChevronDown className="mail-small-icon" /></MenuButton><MenuList>{folders.filter((folder) => folder.key !== 'drafts').map((folder) => <MenuItem key={folder.key} onClick={() => onAction('move', folder.key)}>{folder.label}</MenuItem>)}</MenuList></Menu>
    <span className="mail-separator" />
    <Action label="Odgovori" icon={FiCornerUpLeft} disabled={singleDisabled} onClick={() => onCompose('reply')} />
    <Action label="Odgovori svima" icon={FiChevronsLeft} disabled={singleDisabled} onClick={() => onCompose('reply-all')} />
    <Action label="Proslijedi" icon={FiCornerUpRight} disabled={singleDisabled} onClick={() => onCompose('forward')} />
    <span className="mail-separator" />
    <Menu><MenuButton as="button" className="mail-action mail-labeled" aria-label="Pročitano / nepročitano" disabled={disabled}><FiMail /><span>Pročitano / nepročitano</span><FiChevronDown className="mail-small-icon" /></MenuButton><MenuList><MenuItem onClick={() => onAction('read')}>Označi kao pročitano</MenuItem><MenuItem onClick={() => onAction('unread')}>Označi kao nepročitano</MenuItem></MenuList></Menu>
    <Menu><MenuButton as="button" className="mail-action" aria-label="Praćenje poruke" disabled={disabled}><FiFlag color="#c4314b" /><FiChevronDown className="mail-small-icon" /></MenuButton><MenuList><MenuItem onClick={() => onAction('flag')}>Označi za praćenje</MenuItem><MenuItem onClick={() => onAction('complete')}>Označi kao završeno</MenuItem><MenuItem onClick={() => onAction('unflag')}>Ukloni zastavicu</MenuItem></MenuList></Menu>
    <Menu><MenuButton as="button" className="mail-action" aria-label="Kategorije" disabled={disabled}><FiTag /><FiChevronDown className="mail-small-icon" /></MenuButton><MenuList>{MAIL_CATEGORIES.map((category) => <MenuItem key={category} onClick={() => onAction('category', category)}>{category}</MenuItem>)}<MenuDivider /><MenuItem onClick={() => onAction('category', '')}>Ukloni kategorije</MenuItem></MenuList></Menu>
    <Action label={message?.importance === 'high' ? 'Ukloni visoku važnost' : 'Visoka važnost'} icon={FiAlertCircle} disabled={disabled} onClick={() => onAction('importance', message?.importance === 'high' ? 'normal' : 'high')} />
    <span className="mail-separator" />
    <Action label="Ispis poruke" icon={FiPrinter} disabled={!message || !!selectedCount || busy} onClick={onPrint} />
    <Action label="Osvježi poruke" icon={FiRefreshCw} disabled={busy} onClick={onRefresh} />
    {selectedCount > 0 && <span className="mail-selection-count">Odabrano: {selectedCount}</span>}
  </div>;
}

export function FolderNavigation({ folders, activeFolder, onChange, status }) {
  const [favorites, setFavorites] = useState(true);
  const [accountOpen, setAccountOpen] = useState(true);
  const row = (folder, favorite = false) => {
    const Icon = icons[folder.key] || FiFolder;
    return <button key={folder.key} type="button" className={`mail-folder ${activeFolder === folder.key ? 'is-active' : ''}`} aria-label={favorite ? 'Omiljena ulazna pošta' : folder.label} aria-current={activeFolder === folder.key ? 'page' : undefined} onClick={() => onChange(folder.key)}><Icon /><span>{favorite ? 'Ulazna pošta' : folder.label}</span>{(folder.unreadCount || 0) > 0 && <b>{folder.unreadCount}</b>}</button>;
  };
  return <nav className="mail-folders" aria-label="Mape pošte">
    <button type="button" className="mail-folder-heading" aria-expanded={favorites} onClick={() => setFavorites(!favorites)}>{favorites ? <FiChevronDown /> : <FiChevronRight />}<span>Omiljeno</span><FiStar /></button>
    {favorites && folders.filter((folder) => folder.key === 'inbox').map((folder) => row(folder, true))}
    <div className="mail-folder-rule" />
    <button type="button" className="mail-folder-heading" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}>{accountOpen ? <FiChevronDown /> : <FiChevronRight />}<span>{status.displayName || 'Poslovna pošta'}</span></button>
    {accountOpen && <><p className="mail-folder-address">{status.mailbox}</p>{folders.map((folder) => row(folder))}</>}
    <div className="mail-folder-footer"><FiShield /><span>Microsoft 365<br /><small>Sinhronizirano s Outlookom</small></span></div>
  </nav>;
}

export function dateGroup(value, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Bez datuma';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const week = new Date(today); week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const lastWeek = new Date(week); lastWeek.setDate(week.getDate() - 7);
  if (date >= today) return 'Danas';
  if (date >= yesterday) return 'Jučer';
  if (date >= week) return 'Ove sedmice';
  if (date >= lastWeek) return 'Prošle sedmice';
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return 'Ovaj mjesec';
  return `${['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni', 'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'][date.getMonth()]} ${date.getFullYear()}`;
}

export function MessageList({ messages, selectedId, loading, onSelect, folderLabel, nextCursor, onLoadMore, checkedIds, onCheck, onCheckAll, filter, onFilter, sort, onSort, sortDisabled, onFlag, writeEnabled, busy, compact }) {
  const [collapsed, setCollapsed] = useState({});
  const groups = messages.reduce((result, message) => {
    const group = dateGroup(message.receivedAt);
    const previous = result[result.length - 1];
    if (previous?.label === group) previous.items.push(message);
    else result.push({ label: group, items: [message] });
    return result;
  }, []);
  return <section className={`mail-message-list ${compact ? 'is-compact' : ''}`} aria-label="Lista poruka">
    <div className="mail-list-header"><Checkbox aria-label="Odaberi sve učitane poruke" isChecked={messages.length > 0 && checkedIds.length === messages.length} isIndeterminate={checkedIds.length > 0 && checkedIds.length < messages.length} onChange={onCheckAll} isDisabled={!messages.length || busy} /><strong>{folderLabel}</strong><Menu><MenuButton as="button" className="mail-action" aria-label="Filtriraj poruke"><FiChevronDown /></MenuButton><MenuList>{[['all', 'Sve poruke'], ['unread', 'Nepročitano'], ['flagged', 'Za praćenje'], ['attachments', 'S prilozima']].map(([value, label]) => <MenuItem key={value} onClick={() => onFilter(value)} icon={filter === value ? <FiCheck /> : undefined}>{label}</MenuItem>)}</MenuList></Menu><button type="button" className="mail-action" aria-label={sort === 'desc' ? 'Najstarije prvo' : 'Najnovije prvo'} title={sort === 'desc' ? 'Najstarije prvo' : 'Najnovije prvo'} onClick={onSort} disabled={busy || sortDisabled}>{sort === 'desc' ? <FiArrowDown /> : <FiArrowUp />}</button>{loading && <Spinner size="xs" />}</div>
    {filter !== 'all' && <button type="button" className="mail-filter-chip" onClick={() => onFilter('all')}>{({ unread: 'Nepročitano', flagged: 'Za praćenje', attachments: 'S prilozima' })[filter]} <FiX /></button>}
    <div className="mail-list-scroll">
      {!messages.length && <div className="mail-empty"><FiInbox /><strong>{loading ? 'Učitavanje poruka...' : 'Nema poruka'}</strong><span>{loading ? 'Povezivanje sa sandučićem' : 'Nema poruka koje odgovaraju odabranom prikazu.'}</span></div>}
      {groups.map((group, index) => <React.Fragment key={`${group.label}-${index}`}><button type="button" className="mail-date-group" aria-expanded={!collapsed[group.label]} onClick={() => setCollapsed((current) => ({ ...current, [group.label]: !current[group.label] }))}>{collapsed[group.label] ? <FiChevronRight /> : <FiChevronDown />}{group.label}</button>{!collapsed[group.label] && group.items.map((message) => <div key={message.id} className={`mail-message-row ${selectedId === message.id ? 'is-selected' : ''} ${!message.isRead ? 'is-unread' : ''} ${message.flagStatus === 'flagged' ? 'is-flagged' : ''}`}>
        <div className="mail-row-check"><Checkbox aria-label={`Odaberi ${message.subject}`} isChecked={checkedIds.includes(message.id)} onChange={() => onCheck(message.id)} isDisabled={busy} /></div>
        <button type="button" className="mail-message-open" onClick={() => onSelect(message)} aria-label={`${message.from?.name || message.from?.address || 'Poruka'}: ${message.subject}`} aria-current={selectedId === message.id ? 'true' : undefined}>
          <span className="mail-row-top"><span>{message.isDraft ? 'Nacrt' : message.from?.name || message.from?.address || 'Nepoznat pošiljalac'}</span><span className="mail-row-indicators">{message.hasAttachments && <FiPaperclip />}{message.importance === 'high' && <FiAlertCircle color="#c4314b" />}{message.flagStatus === 'complete' && <FiCheck />}</span></span>
          <span className="mail-row-middle"><span>{message.subject}</span><time>{formatMailDate(message.receivedAt, true)}</time></span>
          <span className="mail-preview">{message.preview || 'Bez pregleda sadržaja.'}</span>
          {message.categories?.length > 0 && <span className="mail-categories">{message.categories.map((category) => <span key={category}>{category}</span>)}</span>}
        </button>
        <button type="button" className={`mail-row-flag ${message.flagStatus === 'flagged' ? 'is-on' : ''}`} aria-label={message.flagStatus === 'flagged' ? `Ukloni zastavicu: ${message.subject}` : `Označi za praćenje: ${message.subject}`} disabled={!writeEnabled || busy} onClick={() => onFlag(message)}><FiFlag /></button>
      </div>)}</React.Fragment>)}
      {nextCursor && <button type="button" className="mail-load-more" disabled={loading} onClick={onLoadMore}>{loading ? 'Učitavanje...' : 'Učitaj još'}</button>}
    </div>
    <div className="mail-list-footer">{messages.length} poruka u prikazu{nextCursor ? ' · dostupno još poruka' : ''}</div>
  </section>;
}

export function printMessage(message) {
  if (!message) return;
  const frame = document.createElement('iframe');
  frame.title = 'Ispis poruke';
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const title = doc.createElement('h2'); title.textContent = message.subject;
  const sender = doc.createElement('p'); sender.textContent = `${message.from?.name || ''} <${message.from?.address || ''}> · ${formatMailDate(message.receivedAt)}`;
  const recipients = doc.createElement('p'); recipients.textContent = `Za: ${(message.to || []).map((entry) => entry.address).join('; ')}`;
  const body = doc.createElement('div');
  if (message.bodyHtml) body.innerHTML = sanitizeMailHtml(message.bodyHtml);
  else { body.textContent = message.bodyText || message.preview; body.style.whiteSpace = 'pre-wrap'; }
  doc.title = message.subject;
  doc.body.style.cssText = 'font-family:Segoe UI,Arial,sans-serif;padding:24px;overflow-wrap:anywhere;';
  doc.body.append(title, sender, recipients, doc.createElement('hr'), body);
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  frame.contentWindow.focus(); frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
}
