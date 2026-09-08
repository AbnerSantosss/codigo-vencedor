/* ------------------------------------------------------------------ *
 * Kit de UI do painel
 *
 * Tudo que mais de uma tela usa: os construtores de DOM, os componentes
 * de formulário, os dois cartões-formulário, os formatadores e os
 * indicadores.
 * ------------------------------------------------------------------ */

import { api, describeError, state } from './api.js';
import { nav } from './nav.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

export const app = $('#app');

export function toast(message, isError = false) {
  document.querySelector('.ad-toast')?.remove();
  const node = el('div', { className: `ad-toast${isError ? ' ad-toast--err' : ''}`, role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

/* ------------------------------------------------------------------ *
 * Componentes de formulário
 * ------------------------------------------------------------------ */

export function field(label, input, hint) {
  return el('label', { className: 'ad-field' }, el('span', {}, label), input, hint && el('small', {}, hint));
}

export function textInput(value, props = {}) {
  return el('input', { className: 'ad-input', type: 'text', value: value ?? '', ...props });
}

export function numberInput(value, props = {}) {
  return el('input', { className: 'ad-input', type: 'number', value: String(value ?? 0), ...props });
}

export function select(value, options) {
  const node = el('select', { className: 'ad-select' });
  for (const [val, text] of options) node.append(el('option', { value: val, selected: val === value }, text));
  return node;
}

export function toggle(label, checked, hint) {
  const input = el('input', { type: 'checkbox', checked });
  const wrap = el(
    'label',
    { className: 'ad-toggle' },
    input,
    el('span', { className: 'ad-toggle-text' }, el('b', {}, label), hint && el('small', {}, hint)),
  );
  wrap.input = input;
  return wrap;
}

/**
 * Campo de cor com dois controles ligados: o seletor visual e o texto.
 * O texto existe porque metade da paleta é `rgba(...)`, que o
 * `<input type="color">` não representa.
 */
export function colorField(label, value) {
  const text = el('input', { className: 'ad-input', type: 'text', value });
  const isHex = /^#[0-9a-f]{6}$/i.test(value);
  const picker = el('input', { type: 'color', value: isHex ? value : '#000000', disabled: !isHex });

  picker.addEventListener('input', () => {
    text.value = picker.value;
    text.dispatchEvent(new Event('input', { bubbles: true }));
  });
  text.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) {
      picker.value = text.value;
      picker.disabled = false;
    } else {
      picker.disabled = true;
    }
  });

  const wrap = field(label, el('div', { className: 'ad-color' }, picker, text));
  wrap.input = text;
  return wrap;
}

/**
 * Campo de credencial.
 *
 * Um segredo já salvo nunca volta do servidor: o campo aparece vazio com a
 * marca "configurado". Deixar em branco preserva o valor atual; digitar algo
 * substitui; a lixeira apaga. É o que evita que abrir a tela e salvar sem
 * mexer em nada zere todas as chaves.
 */
export function secretField(label, key, isSet, hint) {
  const input = el('input', {
    className: 'ad-input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: isSet ? '•••••••• configurado' : 'não configurado',
  });
  const clear = el('button', { className: 'ad-btn ad-btn--ghost', type: 'button' }, 'Apagar');
  let cleared = false;

  clear.addEventListener('click', () => {
    cleared = true;
    input.value = '';
    input.placeholder = 'será apagado ao salvar';
    clear.disabled = true;
  });
  clear.disabled = !isSet;

  const row = el('div', { className: 'ad-color' }, input, clear);
  const wrap = field(label, row, hint);
  wrap.readValue = () => (cleared ? '' : input.value.trim() || undefined);
  wrap.secretKey = key;
  return wrap;
}

export const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');

/**
 * Cartão de indicador.
 *
 * `delta` positivo é verde e negativo é vermelho — exceto quando `invert`
 * está ligado (estornos: subir é ruim). Sem isso, um aumento de estorno
 * apareceria como boa notícia.
 */
export function kpi(label, value, delta) {
  const card = el('div', { className: 'ad-kpi' }, el('div', { className: 'ad-kpi-label' }, label), el('div', { className: 'ad-kpi-value' }, value));

  if (delta && delta.text) {
    const up = delta.direction === 'up';
    const neutral = delta.direction === 'neutral';
    const arrow = neutral
      ? null
      : el('span', { className: 'ad-kpi-arrow', innerHTML: up ? '&#9650;' : '&#9660;' });
    card.append(
      el(
        'div',
        { className: `ad-kpi-delta ${neutral ? '' : up ? 'is-up' : 'is-down'}`.trim() },
        arrow,
        el('span', {}, delta.text),
        delta.note && el('span', { className: 'ad-kpi-note' }, delta.note),
      ),
    );
  }
  return card;
}

/** Converte um número de variação nas propriedades visuais do cartão. */
export function deltaOf(value, suffix, { invert = false, note = 'vs. período anterior' } = {}) {
  if (value === null || value === undefined) return { text: 'sem base de comparação', direction: 'neutral' };
  if (value === 0) return { text: 'estável', direction: 'neutral', note };
  const good = invert ? value < 0 : value > 0;
  const abs = Math.abs(value).toLocaleString('pt-BR');
  return { text: `${abs}${suffix}`, direction: good ? 'up' : 'down', note };
}

/** Casca comum: título, dica, campos e o botão de salvar. */
export function card(title, hint, children, collect) {
  const save = el('button', { className: 'ad-btn', type: 'submit' }, 'Salvar');
  const form = el(
    'form',
    { className: 'ad-card' },
    el('h2', {}, title),
    el('p', { className: 'ad-hint' }, hint),
    ...children.flat().filter(Boolean),
    el('div', { className: 'ad-actions' }, save),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    save.disabled = true;
    try {
      const patch = collect();
      const res = await api('/config', { method: 'PUT', body: JSON.stringify(patch) });
      state.config = { ...state.config, ...res.config };
      toast('Salvo. A página já está usando os novos valores.');
    } catch (err) {
      toast(describeError(err), true);
    } finally {
      save.disabled = false;
    }
  });

  return form;
}

/* ------------------------------------------------------------------ *
 * Recuperação, e-mail, usuários e conta
 * ------------------------------------------------------------------ */

export const fmtWhen = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtFull = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtPhone = (d) => (d && d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : d || '—');

/** Cartão-formulário com salvar próprio — as telas de /config usam `card()`. */
export function formCard(title, hint, children, onSave, extraActions = []) {
  const save = el('button', { className: 'ad-btn', type: 'submit' }, 'Salvar');
  const form = el(
    'form',
    { className: 'ad-card' },
    el('h2', {}, title),
    hint && el('p', { className: 'ad-hint' }, hint),
    ...children.flat().filter(Boolean),
    el('div', { className: 'ad-actions' }, save, ...extraActions),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    save.disabled = true;
    try {
      await onSave();
    } catch (err) {
      toast(describeError(err), true);
    } finally {
      save.disabled = false;
    }
  });
  form.saveButton = save;
  return form;
}

export async function reloadAndPaint(key, path, screen) {
  state[key] = await api(path);
  nav.paintShell(screen);
}
