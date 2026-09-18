/** Minimal DOM helpers. No framework: the UI is a dozen screens of static
 *  structure with a handful of live numbers, and a virtual DOM would cost more
 *  than it saves in a game loop that already owns the frame. */

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs | null = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'style' && typeof v === 'string') node.setAttribute('style', v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node: HTMLElement): HTMLElement {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(parent: HTMLElement, ...children: Child[]): HTMLElement {
  clear(parent);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return parent;
}

export function show(node: HTMLElement, on: boolean): void {
  node.style.display = on ? '' : 'none';
}

/** A labelled 0-100 stat bar, optionally showing the delta a change would make. */
export function statBar(
  name: string, value: number, preview?: number,
): HTMLElement {
  const v = Math.max(0, Math.min(100, value));
  const p = preview === undefined ? v : Math.max(0, Math.min(100, preview));
  const lo = Math.min(v, p);
  const hi = Math.max(v, p);
  const track = el('div', { class: 'track' },
    el('div', { class: 'fill', style: `width:${lo}%` }),
    hi > lo ? el('div', {
      class: `delta ${p > v ? 'up' : 'down'}`,
      style: `left:${lo}%;width:${hi - lo}%`,
    }) : null,
  );
  return el('div', { class: 'stat' },
    el('div', { class: 'name', text: name }),
    track,
    el('div', { class: 'val', text: preview !== undefined && Math.abs(p - v) > 0.05
      ? `${Math.round(p)}` : `${Math.round(v)}` }),
  );
}

export function kv(k: string, v: string | number, cls = ''): HTMLElement {
  return el('div', { class: 'kv' },
    el('span', { class: 'k', text: k }),
    el('span', { class: `v ${cls}`, text: String(v) }),
  );
}

export function chip(label: string, value?: string, accent = false): HTMLElement {
  return el('div', { class: `chip${accent ? ' accent' : ''}` },
    label,
    value !== undefined ? el('strong', { text: value }) : null,
  );
}

/** Confirm dialog rendered into the current screen. Returns a promise. */
export function confirmDialog(host: HTMLElement, title: string, body: string, confirmLabel = 'Confirm'): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean) => { overlay.remove(); resolve(v); };
    const overlay = el('div', {
      class: 'layer active interactive',
      style: 'display:flex;align-items:center;justify-content:center;background:rgba(6,8,13,0.72);z-index:40;backdrop-filter:blur(3px)',
    },
      el('div', { class: 'panel', style: 'max-width:440px;width:calc(100% - 40px)' },
        el('h2', { text: title }),
        el('p', { text: body, style: 'margin-top:10px' }),
        el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' },
          el('button', { class: 'ghost', onClick: () => close(false) }, 'Cancel'),
          el('button', { class: 'primary', onClick: () => close(true) }, confirmLabel),
        ),
      ),
    );
    host.appendChild(overlay);
  });
}
