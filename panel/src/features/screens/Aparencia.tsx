import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Palette, MousePointer2, Layers, Type, Square, ExternalLink, RotateCcw } from 'lucide-react';
import { useDraft } from '../useDraft';
import type { Theme } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ColorInput, Field, FieldGrid, Input } from '@/components/ui/form';
import { Card, Actions } from '@/components/ui/layout';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ComConfig } from '../SecaoConfig';
import { chaves, useAcao } from '../hooks';

const GRUPOS: { titulo: string; nota?: string; chaves: [string, string][] }[] = [
  {
    titulo: 'Marca e destaques',
    nota: 'A cor principal e suas variações na página de vendas.',
    chaves: [
      ['accent', 'Destaque (amarelo)'],
      ['accent-hover', 'Destaque ao passar o mouse'],
      ['accent-soft', 'Destaque — fundo suave'],
      ['accent-ghost', 'Destaque — fundo muito suave'],
    ],
  },
  {
    titulo: 'Botões e avisos',
    nota: 'Cores das ações de compra, da urgência e das mensagens de erro.',
    chaves: [
      ['cta', 'Botão de compra'],
      ['cta-hover', 'Botão ao passar o mouse'],
      ['cta-ink', 'Texto do botão de compra'],
      ['alert-bg', 'Barra de urgência'],
      ['alert-ink', 'Texto da barra de urgência'],
      ['danger', 'Erro'],
    ],
  },
  {
    titulo: 'Fundos e bordas',
    chaves: [
      ['bg', 'Fundo da página'],
      ['surface', 'Card'],
      ['surface-alt', 'Card alternativo'],
      ['input', 'Campo de formulário'],
      ['icon-bg', 'Fundo de ícone'],
      ['border', 'Borda'],
      ['border-strong', 'Borda forte'],
    ],
  },
  {
    titulo: 'Textos',
    chaves: [
      ['text', 'Texto principal'],
      ['text-2', 'Texto secundário'],
      ['text-3', 'Texto complementar'],
      ['muted', 'Texto de apoio'],
      ['muted-2', 'Apoio — menos destaque'],
      ['muted-3', 'Apoio — mínimo destaque'],
    ],
  },
];

const ICONS = [Palette, MousePointer2, Layers, Type];
const PRINCIPAIS = new Set(['accent', 'cta', 'cta-ink', 'alert-bg', 'bg', 'surface', 'border', 'text', 'text-2']);

export function TelaAparencia() {
  return <ComConfig>{(cfg) => <Formulario inicial={cfg.theme} />}</ComConfig>;
}

function Formulario({ inicial }: { inicial: Theme }) {
  const draft = useDraft(inicial);
  const { value: tema, setValue: setTema, dirty } = draft;
  const [aberto, setAberto] = useState(false);
  const salvar = useAcao(async (submitted: Theme) => {
    const res = await api<{ config: { theme: Theme } }>('/config', { method: 'PUT', body: { theme: submitted } });
    draft.accept(submitted, res.config.theme);
    return res;
  }, { sucesso: 'Aparência salva. A landing page já usa os novos valores.', invalidar: [chaves.config] });
  const restaurar = useAcao(() => api<{ theme: Theme }>('/config/theme/reset', { method: 'POST' }), {
    sucesso: 'Aparência original restaurada.', invalidar: [chaves.config],
    onSuccess: (res) => { setTema(res.theme); draft.accept(res.theme, res.theme); setAberto(false); },
  });
  const setCor = (chave: string, valor: string) => setTema((t) => ({ ...t, [chave]: valor }));
  const erro = (chave: string) => salvar.error instanceof ApiError ? salvar.error.data.issues?.find((i) => i.campo === `theme.${chave}`)?.erro : undefined;
  const campo = ([chave, label]: [string, string]) => <Field key={chave} label={label} htmlFor={`theme-${chave}`} error={erro(chave)}>
    <div className="settings-color-field"><span className="settings-color-swatch" aria-hidden="true"><i style={{ backgroundColor: tema[chave] }} /></span>
      <ColorInput id={`theme-${chave}`} value={tema[chave] ?? ''} onChange={(v) => setCor(chave, v)} />
    </div>
  </Field>;

  return <div className="settings-workspace settings-appearance">
    <header className="settings-heading"><div><span className="settings-eyebrow"><Palette aria-hidden="true" /> IDENTIDADE VISUAL</span>
      <h2>Aparência da landing page</h2><p>Personalize as cores e os cantos do site de vendas.</p></div>
      <span className={dirty ? 'settings-status is-dirty' : 'settings-status'} role="status">{dirty ? 'Alterações não salvas' : 'Aparência salva'}</span>
    </header>
    <form onSubmit={(e) => { e.preventDefault(); salvar.mutate(tema); }}>
    <fieldset disabled={salvar.isPending || restaurar.isPending} className="settings-fieldset">
    <div className="settings-columns">
      <aside className="settings-summary"><Palette aria-hidden="true" /><h3>Sua paleta</h3><p>Estas amostras acompanham a edição. As mudanças só chegam ao site ao salvar.</p>
        <div className="settings-palette">{([['accent','Marca'],['cta','Compra'],['bg','Fundo'],['text','Texto']] as const).map(([key,label]) => <div key={key}><span style={{ backgroundColor: tema[key] }} /><small>{label}</small></div>)}</div>
        <p>{GRUPOS.reduce((n,g) => n + g.chaves.length,0)} cores e o formato dos cantos.</p>
        <a href="/" target="_blank" rel="noopener noreferrer" className="settings-site-link"><ExternalLink aria-hidden="true" /> Abrir landing page</a>
        <div className="settings-reset"><p>Para voltar à identidade original:</p><Button variant="ghost" onClick={() => setAberto(true)}><RotateCcw /> Restaurar padrão</Button></div>
      </aside>
      <div className="settings-main">
        {GRUPOS.map((grupo, index) => {
          const Icon = ICONS[index]!;
          return <Card wide key={grupo.titulo} className="settings-theme-group">
            <details open><summary><span className="settings-group-icon"><Icon aria-hidden="true" /></span><span><strong>{grupo.titulo}</strong><small>{grupo.nota ?? (index === 2 ? 'Superfícies que organizam o conteúdo.' : 'Hierarquia de leitura e textos de apoio.')}</small></span></summary>
              <FieldGrid>{grupo.chaves.filter(([key]) => PRINCIPAIS.has(key)).map(campo)}</FieldGrid>
              <details className="settings-advanced"><summary>Ajustes avançados <span>{grupo.chaves.filter(([key]) => !PRINCIPAIS.has(key)).length} opções</span></summary><FieldGrid>{grupo.chaves.filter(([key]) => !PRINCIPAIS.has(key)).map(campo)}</FieldGrid></details>
            </details>
          </Card>;
        })}
        <Card wide className="settings-theme-group"><div className="settings-radius-heading"><span className="settings-group-icon"><Square aria-hidden="true" /></span><h3>Cantos dos elementos</h3></div>
          <div className="settings-radius"><Field label="Arredondamento" hint="Use um valor CSS, por exemplo: 12px." htmlFor="radius"><Input id="radius" value={tema.radius ?? ''} placeholder="12px" onChange={(e) => setCor('radius', e.target.value)} /></Field><div className="settings-radius-sample" style={{ borderRadius: tema.radius }}>Amostra do canto</div></div>
        </Card>
        <div className="settings-save"><p>{dirty ? 'Sua edição está pronta para ser salva.' : 'Edite as opções acima para personalizar a página.'}</p><Actions><Button type="submit" loading={salvar.isPending}>Salvar aparência</Button></Actions></div>
        <div className="settings-mobile-reset"><p>Deseja voltar à identidade original?</p><Button variant="ghost" onClick={() => setAberto(true)}><RotateCcw /> Restaurar padrão</Button></div>
      </div>
    </div>
    </fieldset></form>
    <Dialog open={aberto} onOpenChange={setAberto}><DialogContent title="Restaurar a aparência original?" description="Todas as cores e os cantos voltarão ao padrão aprovado. Os ajustes atuais serão substituídos.">
      <p className="text-sm text-ink-2">Esta ação grava imediatamente na landing page. Não é necessário salvar depois e não há desfazer.</p>
      <DialogFooter><Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button><Button variant="danger" loading={restaurar.isPending} onClick={() => restaurar.mutate()}>Restaurar aparência original</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
