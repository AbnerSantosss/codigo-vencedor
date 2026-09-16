import { Children, cloneElement, forwardRef, isValidElement, useId, useState } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { ChevronDown, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/* ------------------------------------------------------------------ *
 * Campo
 * ------------------------------------------------------------------ */

export interface FieldProps {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Rótulo e campo, pareados de verdade.
 *
 * Um `<label>` sem `for` desenha o texto mas não nomeia campo nenhum: o
 * leitor de tela anuncia "caixa de edição" e o toque no rótulo não foca o
 * campo — que é o alvo grande que o celular precisa. Quando a tela não passa
 * `htmlFor`, o próprio `Field` gera o id e o empresta ao único controle que
 * envolve (o mesmo pareamento que o `SecretInput` já fazia à mão). Se a tela
 * passar `htmlFor`, nada é tocado: ela já cuidou do par.
 */
export function Field({ label, hint, error, htmlFor, className, children }: FieldProps) {
  const idAuto = useId();
  const unico = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const alvo =
    !htmlFor && isValidElement<{ id?: string }>(unico) && unico.props.id === undefined ? unico : null;
  const idDoRotulo = htmlFor ?? (alvo ? idAuto : undefined);

  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <label htmlFor={idDoRotulo} className="text-xs font-semibold text-ink-2">
        {label}
      </label>
      {alvo ? cloneElement(alvo, { id: idAuto }) : children}
      {error ? (
        <small className="text-2xs font-semibold text-danger">{error}</small>
      ) : hint ? (
        <small className="text-2xs text-muted">{hint}</small>
      ) : null}
    </div>
  );
}

/** Grade de campos: 1 coluna no celular, quantas couberem no desktop. */
export function FieldGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]', className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Entradas
 * ------------------------------------------------------------------ */

const inputBase =
  'w-full min-h-12 rounded-sm border border-line-strong bg-bg px-3 py-2 text-ink md:min-h-11 ' +
  'placeholder:text-muted/70 ' +
  'focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft ' +
  'aria-invalid:border-danger aria-invalid:focus:ring-danger-soft ' +
  'disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputBase, className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(inputBase, 'min-h-36 resize-y font-mono text-sm leading-relaxed', className)}
        {...props}
      />
    );
  },
);

/**
 * Select nativo, estilizado.
 *
 * Nativo de propósito: no celular ele abre a roda do sistema, que é sempre
 * mais rápida e acessível do que qualquer lista desenhada em HTML — e o
 * público aqui é celular. O `appearance-none` + a seta desenhada dão a
 * aparência do painel sem perder isso.
 */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(inputBase, 'appearance-none pr-10', className)} {...props}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    );
  },
);

/* ------------------------------------------------------------------ *
 * Interruptor
 * ------------------------------------------------------------------ */

export interface ToggleRowProps {
  label: string;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Interruptor cujo alvo é a linha inteira, não o quadradinho.
 *
 * Ligado = barra de acento à esquerda, e não fundo amarelo: o acento da marca
 * e o amarelo de aviso são o mesmo tom, então preencher o interruptor fazia
 * uma configuração normal parecer um alerta — em Escassez davam sete blocos
 * âmbar na mesma tela e os avisos de verdade sumiam no meio.
 */
export function ToggleRow({ label, hint, checked, onChange, disabled, className }: ToggleRowProps) {
  const id = useId();
  return (
    <div
      className={cn(
        'flex min-h-12 items-center gap-3 rounded-sm border bg-bg py-2 pr-3 transition-colors',
        checked
          ? 'border-line-strong border-l-[3px] border-l-accent bg-surface-2 pl-[calc(0.75rem-2px)]'
          : 'border-line pl-3 hover:border-line-strong hover:bg-surface-2',
        disabled && 'opacity-60',
        className,
      )}
    >
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className={cn(
          'relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3',
          'disabled:cursor-not-allowed',
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'block size-4.5 rounded-full bg-bg transition-transform',
            'translate-x-[3px] data-[state=checked]:translate-x-[1.4rem]',
            checked && 'bg-accent-ink',
          )}
        />
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="grid min-w-0 cursor-pointer gap-px">
        <span className="text-md font-semibold">{label}</span>
        {hint ? <small className="text-2xs text-muted">{hint}</small> : null}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cor
 * ------------------------------------------------------------------ */

/**
 * Cor com dois controles ligados: o seletor visual e o texto.
 *
 * O texto existe porque metade da paleta da LP é `rgba(...)`, que o
 * `<input type="color">` não sabe representar — quando o valor não é hexa, o
 * seletor fica desabilitado em vez de mentir sobre a cor.
 */
export function ColorInput({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const isHex = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Seletor de cor"
        value={isHex ? value : '#000000'}
        disabled={!isHex}
        onChange={(e) => onChange(e.target.value)}
        className="size-11 shrink-0 cursor-pointer rounded-sm border border-line-strong bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-40"
      />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="font-mono text-xs"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Credencial
 * ------------------------------------------------------------------ */

export type SecretState = { value: string; clear: boolean };

export interface SecretInputProps {
  label: string;
  hint?: React.ReactNode;
  /** O servidor só diz se existe — nunca manda o valor. */
  isSet: boolean;
  state: SecretState;
  onChange: (s: SecretState) => void;
}

/**
 * Campo de credencial.
 *
 * Um segredo salvo **nunca** volta do servidor (`secretsStatus` devolve
 * booleano). Então: o campo aparece vazio com a marca "configurado", deixar
 * em branco preserva o que está gravado, digitar substitui, e a lixeira
 * marca para apagar. É o que evita que abrir a tela e salvar sem mexer em
 * nada zere todas as chaves — o que já aconteceu no painel antigo antes
 * deste desenho.
 */
export function SecretInput({ label, hint, isSet, state, onChange }: SecretInputProps) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);

  const marca = state.clear
    ? 'será apagado ao salvar'
    : state.value
      ? 'será substituído ao salvar'
      : isSet
        ? '•••••••• configurado'
        : 'não configurado';

  return (
    <Field
      label={label}
      hint={hint}
      htmlFor={id}
      className={cn(state.clear && 'opacity-90')}
    >
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            id={id}
            type={visivel ? 'text' : 'password'}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={marca}
            value={state.value}
            disabled={state.clear}
            onChange={(e) => onChange({ value: e.target.value, clear: false })}
            className="pr-11 pl-9 font-mono text-sm"
          />
          {state.value ? (
            <button
              type="button"
              onClick={() => setVisivel((v) => !v)}
              aria-label={visivel ? 'Esconder' : 'Mostrar o que acabei de digitar'}
              className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink"
            >
              {visivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          ) : null}
        </div>
        <Button
          variant={state.clear ? 'ghost' : 'danger'}
          size="icon"
          title={state.clear ? 'Cancelar a remoção' : 'Apagar esta credencial'}
          aria-label={state.clear ? 'Cancelar a remoção' : 'Apagar esta credencial'}
          disabled={!isSet && !state.clear}
          onClick={() => onChange({ value: '', clear: !state.clear })}
        >
          <Trash2 />
        </Button>
      </div>
    </Field>
  );
}

/** Estado inicial de um campo de credencial. */
export const secretVazio: SecretState = { value: '', clear: false };

/**
 * Monta o objeto `secrets` do PUT.
 *
 * Chave ausente = mantém o valor atual. String vazia = apaga. É o contrato
 * das rotas de gateway, rastreamento e e-mail (`src/routes/admin/*`).
 */
export function coletarSecrets(mapa: Record<string, SecretState>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [chave, estado] of Object.entries(mapa)) {
    if (estado.clear) out[chave] = '';
    else if (estado.value.trim()) out[chave] = estado.value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}
