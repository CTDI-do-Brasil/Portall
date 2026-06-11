import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api, getStoredUser, saveSession, clearSession } from './api';
import type {
  UserProfile, Company, EmpresaTerceiro, TipoTreinamento,
  TipoAtividade, Pessoa, PresencaLog, TreinamentoPessoa, StatusAcesso, NotificationEmail, SystemLog,
  Patrimonio, PatrimonioLog
} from './types';
import {
  LogOut, Users, Building2, ShieldCheck, ClipboardList, Settings,
  Plus, Trash2, Pencil, Eye, EyeOff, Search, ChevronLeft, ChevronRight,
  Menu, X, AlertTriangle, CheckCircle2, XCircle, Clock, Camera,
  Upload, ArrowRightCircle, ArrowLeftCircle, RefreshCw, BookOpen,
  Briefcase, UserCog, Bell, Home, Mail, LayoutGrid, List,
  UserX, UserPlus, Power, ExternalLink, Copy, FileText, Package,
  ArrowRight, Lock, FileDown, Download, History
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import SignatureCanvas from 'react-signature-canvas';

// Custom CSS for Modal scrollbar
const modalStyles = `
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try {
    const parsed = parseISO(d);
    return isValid(parsed) ? format(parsed, 'dd/MM/yyyy', { locale: ptBR }) : '—';
  } catch { return '—'; }
}

function statusLabel(s?: StatusAcesso) {
  if (s === 'liberado') return 'Acesso Liberado';
  if (s === 'a_vencer') return 'A Vencer';
  if (s === 'bloqueado') return 'Acesso Bloqueado';
  return '—';
}

function maskLGPD(doc: string) {
  if (!doc) return '—';
  const digits = doc.replace(/\D/g, '');
  const digitCount = digits.length;
  let currentDigit = 0;
  return doc.split('').map(char => {
    if (/\d/.test(char)) {
      currentDigit++;
      if (currentDigit <= digitCount - 3) return '*';
    }
    return char;
  }).join('');
}

function getBlockingReasons(p: Pessoa) {
  const reasons: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Se não estiver aprovado pela segurança (para prestadores)
  if (p.tipoAcesso === 'prestador' && p.isApproved === false) {
    reasons.push('Aguardando aprovação da Segurança do Trabalho (workflow obrigatório)');
  }

  const parseSafe = (dStr: string | null | undefined) => {
    if (!dStr) return null;
    const clean = dStr.split(' ')[0].split('T')[0];
    const date = new Date(clean + 'T12:00:00');
    return isNaN(date.getTime()) ? null : date;
  };

  const libDate = parseSafe(p.liberadoAte);
  if (libDate && libDate < today) {
    reasons.push(`O prazo de validade do cadastro expirou em ${fmtDate(p.liberadoAte)}`);
  }

  if (p.tipoAcesso === 'prestador') {
    const asoBase = parseSafe(p.asoDataRealizacao);
    if (asoBase) {
      const asoVenc = new Date(asoBase);
      asoVenc.setFullYear(asoVenc.getFullYear() + 1);
      if (asoVenc < today) {
        reasons.push(`ASO Vencido em ${fmtDate(asoVenc.toISOString())} (Exame realizado há mais de 1 ano)`);
      }
    } else {
      reasons.push('Falta realizar ou registrar a data do ASO');
    }

    p.treinamentos?.forEach(t => {
      if (t.statusTreinamento === 'Vencido') {
        reasons.push(`Treinamento Vencido: ${t.treinamentoNome} (Venceu em ${fmtDate(t.dataVencimento)})`);
      } else if (t.statusTreinamento === 'A Vencer') {
        reasons.push(`Treinamento a vencer em breve: ${t.treinamentoNome} (Vence em ${fmtDate(t.dataVencimento)})`);
      }
    });
  }

  // Fallback se o status é bloqueado mas não achamos o motivo via data (segurança extra)
  if (reasons.length === 0 && p.statusAcesso === 'bloqueado') {
    reasons.push('Acesso bloqueado por expiração de documentos ou pendência administrativa.');
  }

  return reasons;
}

// ─── Modal de Histórico de Termos ───────────────────────────────────────────
function PersonTermsModal({ pessoa, onClose }: { pessoa: Pessoa, onClose: () => void }) {
  const [terms, setTerms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/pessoas/${pessoa.id}/termos`)
      .then(res => setTerms(res as any[]))
      .catch(() => setTerms([]))
      .finally(() => setLoading(false));
  }, [pessoa.id]);

  return (
    <Modal title={`Termos de Segurança — ${pessoa.nomeCompleto}`} onClose={onClose} size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Abaixo estão listados todos os termos de segurança assinados digitalmente por este colaborador.
        </p>

        {loading ? (
          <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-600" /></div>
        ) : terms.length === 0 ? (
          <EmptyState icon={FileText} title="Nenhum termo encontrado" subtitle="Esta pessoa ainda não possui termos registrados no servidor de arquivos." />
        ) : (
          <div className="space-y-3">
            {terms.map((t, i) => (
              <div key={t.name} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-blue-200 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                    <FileText className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Termo Assinado #{terms.length - i}</p>
                    <p className="text-[10px] text-slate-400 font-mono font-bold">{new Date(t.lastModified).toLocaleString('pt-BR')}</p>
                  </div>
                </div>
                <a 
                  href={`${api.baseUrl}/pessoas/${pessoa.id}/termos/${t.name.split('/').pop()}/download`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 shadow-md shadow-blue-100 transition-all"
                  title="Download PDF"
                >
                  <Download size={18} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Componente Público: Assinatura de Termo ──────────────────────────────
function PublicTermSigner({ pessoaId }: { pessoaId: string }) {
  const [pessoa, setPessoa] = useState<{ nome_completo: string, company_name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const sigCanvas = useRef<SignatureCanvas>(null);

  useEffect(() => {
    api.get(`/pessoas/public/termo/${pessoaId}`)
      .then(res => setPessoa(res as any))
      .catch(() => setPessoa(null))
      .finally(() => setLoading(false));
  }, [pessoaId]);

  const handleSave = async () => {
    if (sigCanvas.current?.isEmpty()) {
      alert('Por favor, assine na tela antes de confirmar.');
      return;
    }
    setSigning(true);
    try {
      const signatureB64 = sigCanvas.current?.getTrimmedCanvas().toDataURL('image/png');
      await api.post(`/pessoas/public/termo/${pessoaId}/assinar`, { assinatura: signatureB64 });
      setSigned(true);
    } catch (err: any) {
      alert(err.error || 'Erro ao salvar assinatura.');
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><RefreshCw className="animate-spin text-blue-600" /></div>;
  if (!pessoa) return <div className="p-10 text-center">Cadastro não encontrado ou token inválido.</div>;
  if (signed) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center space-y-4">
      <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
        <CheckCircle2 size={40} />
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Termo Assinado!</h1>
      <p className="text-slate-500">Obrigado, {pessoa.nome_completo.split(' ')[0]}. Sua entrada está sendo liberada na portaria.</p>
      <p className="text-xs text-slate-400">Pode fechar esta janela agora.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 flex flex-col">
      <div className="max-w-xl mx-auto w-full bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col flex-1 border border-slate-200">
        <div className="p-6 bg-[#001A33] text-white">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck className="text-blue-400" size={24} />
            <h1 className="text-lg font-bold">Termo de Segurança</h1>
          </div>
          <p className="text-blue-200 text-xs">Unidade: {pessoa.company_name}</p>
        </div>

        <div className="p-6 overflow-y-auto flex-1 text-sm text-slate-700 leading-relaxed space-y-4">
          <p>Eu, <strong>{pessoa.nome_completo}</strong>, declaro para os devidos fins que:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Fui devidamente informado sobre as <strong>regras de segurança</strong> vigentes nesta unidade.</li>
            <li>Comprometo-me a cumprir todas as normas de segurança do trabalho e diretrizes da <strong>{pessoa.company_name}</strong>.</li>
            <li>Estou ciente da <strong>obrigatoriedade do uso de todos os EPIs</strong> (Equipamentos de Proteção Individual) necessários para a minha atividade conforme orientações recebidas.</li>
            <li>Portarei os EPIs do início ao fim da execução das atividades, respeitando a sinalização e zonas de risco.</li>
          </ul>
          <p className="font-semibold text-red-600">⚠️ O não cumprimento de qualquer norma de segurança poderá resultar na suspensão imediata do acesso e das atividades.</p>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase mb-2">Assine aqui:</p>
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl overflow-hidden h-48 relative">
            <SignatureCanvas 
              ref={sigCanvas}
              penColor="#001A33"
              canvasProps={{ className: 'w-full h-full cursor-crosshair' }}
            />
            <button 
              onClick={() => sigCanvas.current?.clear()}
              className="absolute bottom-2 right-2 p-2 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-bold hover:bg-slate-200"
            >Limpar</button>
          </div>
          <Button 
            variant="success" 
            className="w-full mt-4 h-14 text-base shadow-xl"
            disabled={signing}
            onClick={handleSave}
          >
            {signing ? 'Enviando...' : 'Confirmar e Assinar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OnSitePulse() {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200/50 shadow-sm">
      <div className="relative">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75" />
      </div>
      <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Na Operação</span>
    </div>
  );
}

function TimeCounter({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const update = () => {
      const start = new Date(startTime).getTime();
      const now = new Date().getTime();
      const diff = Math.max(0, Math.floor((now - start) / 1000));
      
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      
      setElapsed(`${h.toString().padStart(2,'0')}h ${m.toString().padStart(2,'0')}m ${s.toString().padStart(2,'0')}s`);
    };
    
    update();
    const itv = setInterval(update, 1000);
    return () => clearInterval(itv);
  }, [startTime]);

  return (
    <div className="flex items-center gap-2 text-blue-700 bg-blue-50/50 px-3 py-2 rounded-xl border border-blue-200/30">
      <Clock size={14} className="text-blue-500" />
      <div className="flex flex-col">
        <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest leading-none mb-0.5">Tempo de Permanência</span>
        <span className="text-sm font-black font-mono tracking-wider leading-none">{elapsed}</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: StatusAcesso }) {
  const cfg = {
    liberado: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Liberado' },
    a_vencer: { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'A Vencer' },
    bloqueado:{ bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500',      label: 'Bloqueado' },
  }[status ?? 'liberado'] ?? { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', label: '—' };

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold', cfg.bg, cfg.text)}>
      <span className={cn('w-2 h-2 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── UI Primitives ───────────────────────────────────────────────────────────

function Button({ children, onClick, variant = 'primary', className, disabled, type = 'button', size = 'md', title }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  className?: string; disabled?: boolean; type?: 'button' | 'submit' | 'reset'; size?: 'sm' | 'md';
  title?: string;
}) {
  const v = {
    primary:   'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
    secondary: 'bg-slate-700 text-white hover:bg-slate-800 shadow-sm',
    danger:    'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    success:   'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
    ghost:     'bg-transparent text-slate-600 hover:bg-slate-100',
  }[variant];
  const s = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={cn('rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed', v, s, className)}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder, required, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const inputType = type === 'password' ? (show ? 'text' : 'password') : type;
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="relative">
        <input type={inputType} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-400" />
        {type === 'password' && (
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Select({ label, value, onChange, children, required }: {
  label: string; value: string; onChange: (v: string) => void;
  children: React.ReactNode; required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <select value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
        {children}
      </select>
    </div>
  );
}

function SearchableSelect({ value, onChange, options, placeholder, required, allowCustom }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string; required?: boolean;
  allowCustom?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
      if (e.key === 'Enter' && isOpen) {
        if (filtered.length > 0) {
          onChange(filtered[0].value);
          setIsOpen(false);
        } else if (allowCustom && search.trim() !== '') {
          onChange(search.trim());
          setIsOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, search, onChange, allowCustom]);

  const safeOptions = options || [];
  const selectedLabel = safeOptions.find(o => o.value === value)?.label || value || '';
  const filtered = safeOptions.filter(o => (o.label || '').toLowerCase().includes(search.toLowerCase()));
  const showAddCustom = allowCustom && search.trim() !== '' && !safeOptions.some(o => o.label.toLowerCase() === search.toLowerCase().trim());

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 flex" />
        <input 
          placeholder={selectedLabel || placeholder}
          value={isOpen ? search : selectedLabel}
          onFocus={() => { setIsOpen(true); setSearch(''); }}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 truncate"
          readOnly={!isOpen && !!selectedLabel}
        />
        {required && !value && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">*</span>}
        <input type="text" className="sr-only" required={required} value={value} onChange={() => {}} tabIndex={-1} />
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-[100] w-full mt-1 bg-white rounded-xl border border-slate-200 shadow-xl max-h-48 overflow-y-auto no-scrollbar"
          >
            {filtered.length === 0 && !showAddCustom ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">Nenhum resultado</div>
            ) : (
              <>
                {filtered.map(o => (
                  <button 
                    key={o.value} 
                    type="button"
                    onClick={() => { onChange(o.value); setIsOpen(false); setSearch(''); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors hover:bg-blue-50",
                      value && o.value === value ? "text-blue-600 font-bold bg-blue-50/50" : "text-slate-700"
                    )}
                  >
                    {o.label || 'Sem nome'}
                  </button>
                ))}
                {showAddCustom && (
                  <button
                    type="button"
                    onClick={() => { onChange(search.trim()); setIsOpen(false); setSearch(''); }}
                    className="w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-emerald-50 text-emerald-600 font-semibold border-t border-slate-100 flex items-center gap-1.5"
                  >
                    <Plus size={14} /> Cadastrar: "{search.trim()}"
                  </button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <div onClick={() => onChange(!checked)} className={cn('relative w-10 h-6 rounded-full transition-colors', checked ? 'bg-blue-600' : 'bg-slate-200')}>
        <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all', checked ? 'left-5' : 'left-1')} />
      </div>
    </label>
  );
}

function Modal({ title, onClose, children, size = 'md' }: {
  title: string; onClose: () => void; children: React.ReactNode; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}) {
  const widths = { xs: 'max-w-xs', sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  
  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" 
      onMouseDown={(e) => {
        // Only close if clicking directly on the backdrop (not dragging from inside)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }}
        onMouseDown={e => e.stopPropagation()}
        className={cn('bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto no-scrollbar', widths[size])}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </motion.div>
    </div>,
    document.body
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string; key?: React.Key }) {
  return <div className={cn('bg-white rounded-2xl border border-slate-100 shadow-sm', className)}>{children}</div>;
}

function ConfirmModal({ title, message, onConfirm, onCancel, loading }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel} size="md">
      <div className="space-y-6">
        <div className="flex items-center gap-4 p-4 bg-red-50 rounded-2xl border border-red-100 text-left">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="text-red-600" size={24} />
          </div>
          <div>
            <p className="text-sm font-bold text-red-900">Ação Irreversível</p>
            <p className="text-xs text-red-600 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button variant="danger" className="flex-1" onClick={onConfirm} disabled={loading}>
            {loading ? 'Excluindo...' : 'Confirmar Exclusão'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SafetyApproveModal({ nome, onConfirm, onCancel, loading }: {
  nome: string; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  const [docsOk, setDocsOk] = useState(false);
  const [aptoOk, setAptoOk] = useState(false);

  return (
    <Modal title="Aprovação da Segurança do Trabalho" onClose={onCancel} size="md">
      <div className="space-y-6">
        <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-100 text-left">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="text-amber-700" size={24} />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-900">Confirmação de Segurança</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Você está prestes a aprovar o cadastro do colaborador <strong>{nome}</strong>. Por favor, confirme as seguintes declarações para continuar.
            </p>
          </div>
        </div>

        <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input 
              type="checkbox" 
              checked={docsOk} 
              onChange={(e) => setDocsOk(e.target.checked)}
              className="mt-1 w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
            />
            <div>
              <p className="text-sm font-bold text-slate-800">Documentos em Dia (Válidos)</p>
              <p className="text-xs text-slate-500">Confirmo que todos os documentos obrigatórios (ASO, treinamentos, etc.) estão válidos e vigentes.</p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer select-none pt-3 border-t border-slate-200/60">
            <input 
              type="checkbox" 
              checked={aptoOk} 
              onChange={(e) => setAptoOk(e.target.checked)}
              className="mt-1 w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
            />
            <div>
              <p className="text-sm font-bold text-slate-800">Colaborador Apto</p>
              <p className="text-xs text-slate-500">Confirmo que o colaborador terceiro está apto para realizar a atividade descrita.</p>
            </div>
          </label>
        </div>

        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button 
            variant="success" 
            className="flex-1 font-bold uppercase tracking-wider text-xs" 
            onClick={onConfirm} 
            disabled={loading || !docsOk || !aptoOk}
          >
            {loading ? 'Aprovando...' : 'Confirmar Aprovação'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
        <Icon size={24} className="text-slate-400" />
      </div>
      <p className="font-semibold text-slate-600 mb-1">{title}</p>
      {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
    </div>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (user: UserProfile) => void }) {
  const [view, setView] = useState<'login' | 'romaneio'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Romaneio público
  const [romSenha, setRomSenha] = useState('');
  const [romSenhaOk, setRomSenhaOk] = useState(false);
  const [romSenhaError, setRomSenhaError] = useState('');
  const [romEmpresa, setRomEmpresa] = useState('CTDI do brasil ltda.');
  const [romMotivo, setRomMotivo] = useState('');
  const [romSolicitante, setRomSolicitante] = useState('');
  const [romItens, setRomItens] = useState([{ descricao: '', quantidade: '' }]);
  const [romSaving, setRomSaving] = useState(false);
  const [romSuccess, setRomSuccess] = useState(false);

  const resetRomaneio = () => {
    setView('login'); setRomSenhaOk(false); setRomSenha(''); setRomSenhaError('');
    setRomEmpresa('CTDI do brasil ltda.'); setRomMotivo(''); setRomSolicitante('');
    setRomItens([{ descricao: '', quantidade: '' }]); setRomSaving(false); setRomSuccess(false);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<{ token: string; user: UserProfile }>('/auth/login', { email, password });
      saveSession(data.token, data.user);
      onLogin(data.user);
    } catch (err: any) {
      setError(err.error || 'E-mail ou senha incorretos.');
    } finally { setLoading(false); }
  };

  const handleRomaneioSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = romItens.filter(i => i.descricao.trim() && i.quantidade);
    if (!romSolicitante.trim() || validItems.length === 0) return;
    setRomSaving(true);
    try {
      await api.post('/romaneios/public', {
        senha: romSenha, empresa: romEmpresa,
        motivo: romMotivo, solicitante_nome: romSolicitante, itens: validItems
      });
      setRomSuccess(true);
    } catch (err: any) {
      setRomSenhaError(err?.error || 'Erro ao enviar. Verifique a senha.');
      setRomSenhaOk(false);
    } finally { setRomSaving(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-[#001A33]">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#000d1a] via-[#001A33] to-[#000a14]" />
      <div className="absolute inset-0 bg-grid-tech opacity-20" />
      
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 10, repeat: Infinity }}
        className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] bg-blue-500/20 pointer-events-none" 
      />

      <div className="w-full max-w-4xl relative z-10">
        <AnimatePresence mode="wait">
          {view === 'login' && (
            <motion.div key="login" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-md mx-auto w-full">
              <div className="bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl p-10 border border-white relative overflow-hidden">
                <div className="text-center mb-6">
                  <img src="/LogoCompleto.png" alt="PortALL" className="h-20 mx-auto" />
                </div>

                <form onSubmit={handleLoginSubmit} className="space-y-5">
                  <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="usuario@empresa.com" required />
                  <div className="space-y-2">
                    <Input label="Senha" type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
                    <button type="button" onClick={() => setShowForgot(true)} className="w-full text-right text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest">
                      Esqueci minha senha
                    </button>
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 flex gap-2 items-center">
                      <AlertTriangle size={14} /> {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-700 transition-all disabled:opacity-60 shadow-xl shadow-blue-500/20">
                    {loading ? 'Autenticando...' : 'Entrar no Sistema'}
                  </button>

                  <div className="pt-6 border-t border-slate-100 mt-2 text-center">
                    <button type="button" onClick={() => setView('romaneio')} 
                      className="text-[10px] font-black text-slate-400 hover:text-blue-600 uppercase tracking-widest transition-colors flex items-center justify-center gap-2 mx-auto">
                      <Package size={14} /> Solicitar Romaneio de Materiais
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}

          {view === 'romaneio' && (
            <motion.div key="romaneio" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full relative">
              {/* Back button outside the card */}
              <button onClick={resetRomaneio} 
                className="fixed top-8 left-8 p-3 bg-white/20 backdrop-blur-md text-white hover:bg-white/40 rounded-2xl transition-all shadow-xl z-50 group border border-white/20">
                <ChevronLeft size={24} className="group-hover:-translate-x-1 transition-transform" />
              </button>

              <div className={cn("mx-auto transition-all duration-500", !romSenhaOk ? "max-w-sm" : "max-w-lg")}>
                <div className="bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white p-8 md:p-10 relative overflow-hidden">
                  <div className="text-center mb-6">
                    <h2 className="text-2xl font-black text-slate-900 leading-tight">Novo Romaneio</h2>
                    {!romSenhaOk && <p className="text-slate-400 text-xs font-bold mt-1">insira a senha para prosseguir</p>}
                  </div>

                  {!romSenhaOk ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="space-y-4 text-left">
                        <Input label="Senha de Acesso" value={romSenha} onChange={setRomSenha} placeholder="••••••••" type="password" />
                        {romSenhaError && (
                          <div className="flex items-center gap-2 text-red-500 text-[10px] font-black uppercase tracking-widest bg-red-50 p-2 rounded-lg">
                            <AlertTriangle size={12} /> {romSenhaError}
                          </div>
                        )}
                        <button onClick={async () => { 
                            if(!romSenha.trim()){ setRomSenhaError('Digite a senha.'); return; } 
                            try {
                              const resp: any = await api.post('/romaneios/verify-password', { senha: romSenha });
                              if (resp.success) {
                                setRomSenhaOk(true);
                                setRomSenhaError('');
                              }
                            } catch (err: any) {
                              setRomSenhaError(err.error || 'Senha incorreta.');
                            }
                          }}
                          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-95">
                          Desbloquear
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const validItems = romItens.filter(i => i.descricao.trim() && i.quantidade);
                      if (!romSolicitante.trim() || validItems.length === 0) return;
                      setRomSaving(true);
                      
                      let geo = 'Não fornecida';
                      try {
                        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
                        geo = `${pos.coords.latitude}, ${pos.coords.longitude}`;
                      } catch (err) { console.warn('Geolocation failed:', err); }

                      try {
                        await api.post('/romaneios/public', {
                          senha: romSenha, empresa: romEmpresa,
                          motivo: romMotivo, solicitante_nome: romSolicitante, 
                          itens: validItems, localizacao: geo
                        });
                        setRomSuccess(true);
                      } catch (err: any) {
                        setRomSenhaError(err?.error || 'Erro ao enviar. Verifique a senha.');
                        setRomSenhaOk(false);
                      } finally { setRomSaving(false); }
                    }} className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <Input label="Solicitante / Responsável" value={romSolicitante} onChange={setRomSolicitante} placeholder="Nome completo" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Empresa</label>
                          <div className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-black text-slate-600">
                            CTDI do brasil ltda.
                          </div>
                        </div>
                        <Input label="Motivo" value={romMotivo} onChange={setRomMotivo} placeholder="Ex: Reparo" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lista de Materiais</h4>
                          <button type="button" onClick={() => setRomItens(p => [...p, { descricao: '', quantidade: '' }])}
                            className="px-2 py-1 text-blue-600 text-[10px] font-black uppercase flex items-center gap-1 hover:bg-blue-50 rounded-lg transition-colors">
                            <Plus size={12} /> Add Item
                          </button>
                        </div>
                        
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
                          <AnimatePresence initial={false}>
                            {romItens.map((item, i) => (
                              <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                                className="flex gap-2 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                                <input value={item.descricao} onChange={e => setRomItens(p => p.map((x, idx) => idx === i ? { ...x, descricao: e.target.value } : x))}
                                  placeholder="Item" className="flex-1 bg-transparent text-xs font-bold outline-none" required />
                                <input value={item.quantidade} onChange={e => setRomItens(p => p.map((x, idx) => idx === i ? { ...x, quantidade: e.target.value } : x))}
                                  placeholder="Qtd" type="number" className="w-12 bg-transparent text-xs font-black text-blue-600 text-center outline-none" required />
                                {romItens.length > 1 && (
                                  <button type="button" onClick={() => setRomItens(p => p.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      </div>

                      <button type="submit" disabled={romSaving || romItens.some(i => !i.descricao || !i.quantidade)}
                        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-2xl shadow-blue-500/20 hover:bg-blue-700 transition-all disabled:opacity-50 transform active:scale-95">
                        {romSaving ? 'Enviando...' : 'Finalizar Solicitação'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Success Modal */}
      <AnimatePresence>
        {romSuccess && (
          <Modal title="Sucesso" onClose={resetRomaneio} size="sm">
            <div className="text-center py-6 space-y-6">
              <div className="w-24 h-24 bg-emerald-100 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner animate-bounce">
                <CheckCircle2 size={48} className="text-emerald-600" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-900 leading-tight">Solicitação Enviada!</h3>
                <p className="text-sm text-slate-500 max-w-xs mx-auto">Seu romaneio foi encaminhado e os administradores foram notificados por e-mail com o documento em anexo.</p>
              </div>
              <Button onClick={resetRomaneio} className="w-full h-14">
                Entendido
              </Button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Forgot Password */}
      <AnimatePresence>
        {showForgot && (
          <Modal title="Recuperar Senha" onClose={() => setShowForgot(false)}>
            <form onSubmit={async (e) => {
              e.preventDefault(); setForgotLoading(true); setForgotMsg('');
              try { const d = await api.post<{message:string}>('/auth/forgot-password', { email: forgotEmail }); setForgotMsg(d.message); }
              catch(err:any){ setForgotMsg(err.error || 'Erro.'); } finally { setForgotLoading(false); }
            }} className="space-y-4">
              <p className="text-sm text-slate-500">Insira seu e-mail cadastrado para redefinir a senha.</p>
              <Input label="E-mail" value={forgotEmail} onChange={setForgotEmail} placeholder="seu@email.com" required />
              {forgotMsg && <p className={cn('text-xs font-bold text-center', forgotMsg.includes('enviado') ? 'text-emerald-600' : 'text-red-600')}>{forgotMsg}</p>}
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" className="flex-1" onClick={() => setShowForgot(false)}>Cancelar</Button>
                <Button type="submit" className="flex-1" disabled={forgotLoading || forgotMsg.includes('enviado')}>
                  {forgotLoading ? 'Enviando...' : (forgotMsg.includes('enviado') ? 'E-mail Enviado' : 'Enviar Link')}
                </Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header({ profile, onLogout }: { profile: UserProfile; onLogout: () => void }) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-30 shadow-sm">
      <div className="flex items-center gap-3">
        <img src="/LogoCompleto.png" alt="PortALL Logo" className="h-10 w-auto object-contain" />
      </div>
      
      <div className="flex items-center gap-3">
        <button onClick={onLogout} className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all group" title="Sair do sistema">
          <LogOut size={20} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </header>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

type TabId = 'portaria' | 'pessoas' | 'empresas_terceiro' | 'treinamentos' | 'companies' | 'usuarios' | 'logs' | 'notificacoes' | 'nfc_scanner' | 'admin_patrimonios' | 'romaneios';

function Sidebar({ activeTab, setActiveTab, profile, collapsed, setCollapsed, mobileOpen, setMobileOpen, onLogout }: {
  activeTab: TabId; setActiveTab: (t: TabId) => void;
  profile: UserProfile; collapsed: boolean; setCollapsed: (v: boolean) => void;
  mobileOpen: boolean; setMobileOpen: (v: boolean) => void;
  onLogout: () => void;
}) {
  const operacional: { id: TabId; label: string; icon: any; roles: string[] }[] = [
    { id: 'portaria',          label: 'Portaria',                 icon: Home,          roles: ['master','admin','viewer'] },
    { id: 'nfc_scanner',       label: 'Patrimônio',               icon: Camera,        roles: ['master','admin','viewer'] },
    { id: 'romaneios',         label: 'Romaneios',                icon: FileText,      roles: ['master','admin','viewer'] },
    { id: 'pessoas',           label: 'Visitantes e Prestadores', icon: Users,         roles: ['master','admin'] },
    { id: 'empresas_terceiro', label: 'Provedores',               icon: Building2,     roles: ['master','admin'] },
    { id: 'treinamentos',      label: 'Treinamentos',             icon: BookOpen,      roles: ['master','admin'] },
  ];
  const administrativo: { id: TabId; label: string; icon: any; roles: string[] }[] = [
    { id: 'notificacoes',      label: 'Notificações',             icon: Mail,          roles: ['master','admin'] },
    { id: 'admin_patrimonios', label: 'Gestão de Patrimônio',     icon: Briefcase,     roles: ['master','admin'] },
    { id: 'companies',         label: 'Empresas',                 icon: ShieldCheck,   roles: ['master','admin'] },
    { id: 'usuarios',          label: 'Usuários do Sistema',      icon: UserCog,       roles: ['master','admin'] },
    { id: 'logs',              label: 'Auditoria de Logs',        icon: ClipboardList, roles: ['master'] },
  ];

  const visOp  = operacional.filter(i => i.roles.includes(profile.role));
  const visAdm = administrativo.filter(i => i.roles.includes(profile.role));

  const navItem = (item: (typeof operacional)[0]) => (
    <button key={item.id} onClick={() => { setActiveTab(item.id); setMobileOpen(false); }}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all',
        activeTab === item.id
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
        collapsed && 'justify-center'
      )}>
      <item.icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full overflow-hidden">
      <nav className="flex-1 px-3 py-4 overflow-y-auto custom-scrollbar space-y-1">
        {visOp.length > 0 && (
          <>
            {!collapsed && <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest px-3 pb-1 pt-3">Operacional</p>}
            {visOp.map(navItem)}
          </>
        )}
        {visAdm.length > 0 && (
          <>
            {!collapsed && <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest px-3 pb-1 pt-5">Administração</p>}
            {collapsed && <div className="my-3 mx-3 h-px bg-white/10" />}
            {visAdm.map(navItem)}
          </>
        )}
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative h-full bg-slate-900 text-white shrink-0 z-50 hidden md:block border-r border-white/5 shadow-2xl shadow-slate-900/50"
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3.5 top-8 z-40 w-7 h-7 rounded-full bg-white border-2 border-slate-900 flex items-center justify-center text-slate-900 hover:bg-blue-600 hover:text-white transition-all shadow-xl hover:scale-110 active:scale-90"
        >
          {collapsed ? <ChevronRight size={14} strokeWidth={3} /> : <ChevronLeft size={14} strokeWidth={3} />}
        </button>
        {sidebarContent}
      </motion.aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
        </div>
      )}

      {/* Mobile Drawer */}
      <motion.aside
        initial={{ x: '-100%' }}
        animate={{ x: mobileOpen ? 0 : '-100%' }}
        transition={{ type: 'spring', stiffness: 350, damping: 35 }}
        className="fixed left-0 top-0 bottom-0 w-72 bg-slate-900 text-white z-50 md:hidden shadow-2xl border-r border-white/5"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <img src="/LogoCompleto.png" alt="PortALL" className="h-8 w-auto object-contain" />
          <div className="flex items-center gap-1">
            <button onClick={onLogout} className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all" title="Sair do sistema">
              <LogOut size={20} />
            </button>
            <button onClick={() => setMobileOpen(false)} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
              <X size={20} />
            </button>
          </div>
        </div>
        {sidebarContent}
      </motion.aside>
    </>
  );
}

// ─── Portaria (Viewer) ────────────────────────────────────────────────────────
function PortariaView({ profile, companies }: { profile: UserProfile, companies: Company[] }) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusAcesso | ''>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'visitante' | 'prestador'>('all');
  const [selected, setSelected] = useState<Pessoa | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [viewType, setViewType] = useState<'card' | 'list'>('card');
  const [lockerPrompt, setLockerPrompt] = useState<{pessoaId: string, status: 'entrada'|'saida'} | null>(null);
  const [termPrompt, setTermPrompt] = useState<Pessoa | null>(null);
  const [isVerifyingTerm, setIsVerifyingTerm] = useState(false);
  const [lockerInput, setLockerInput] = useState('');
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'on-site' | 'off-site'>('all');
  const [showTermsFor, setShowTermsFor] = useState<Pessoa | null>(null);
  const [approvingPessoa, setApprovingPessoa] = useState<{ id: string; nome: string } | null>(null);

  useEffect(() => { fetchPessoas(); }, []);

  const fetchPessoas = async () => {
    try { setPessoas(await api.get<Pessoa[]>('/pessoas')); } catch {}
  };

  const baseFiltered = pessoas.filter(p => {
    const term = search.toLowerCase();
    const matchesText = !search || 
      p.nomeCompleto.toLowerCase().includes(term) ||
      (p.empresaOrigemNome || '').toLowerCase().includes(term) ||
      (term.replace(/\D/g, '') && p.documento.replace(/\D/g, '').includes(term.replace(/\D/g, ''))) ||
      p.documento.toLowerCase().includes(term);
    
    const matchesStatus = true; // Handled later
    const matchesType = typeFilter === 'all' || p.tipoAcesso === typeFilter;
    
    return matchesText && matchesType;
  });

  const filtered = baseFiltered.filter(p => {
    const matchesStatus = !statusFilter || p.statusAcesso === statusFilter;
    const matchesPresence = 
      presenceFilter === 'all' ? true :
      presenceFilter === 'on-site' ? p.lastPresenceStatus === 'entrada' :
      p.lastPresenceStatus !== 'entrada';
    
    return matchesStatus && matchesPresence;
  });

  const confirmRegistrar = async () => {
    if (!lockerPrompt) return;
    setActionLoading(true);
    try {
      await api.post('/presencas', { 
        pessoaId: lockerPrompt.pessoaId, 
        status: lockerPrompt.status,
        armario: lockerInput.trim() || undefined
      });
      setSelected(null);
      setLockerPrompt(null);
      setLockerInput('');
      fetchPessoas();
    } catch (err: any) {
      alert(err.error || 'Erro ao registrar.');
    } finally { setActionLoading(false); }
  };

  const checkSignature = async (idPessoa: string) => {
    setIsVerifyingTerm(true);
    try {
      const p = await api.get<Pessoa>(`/pessoas/${idPessoa}`);
      if (p.termoAssinadoEm) {
        setTermPrompt(null);
        await api.post('/presencas', { pessoaId: idPessoa, status: 'entrada' });
        fetchPessoas();
      } else {
        alert('O termo ainda não foi assinado no celular do colaborador.');
      }
    } catch (err) {
      alert('Erro ao verificar assinatura.');
    } finally {
      setIsVerifyingTerm(false);
    }
  };

  const handleRegistrar = (pessoaId: string, status: 'entrada' | 'saida') => {
    if (!pessoaId) return;
    const pessoa = pessoas.find(p => p.id === pessoaId);
    if (!pessoa) return;
    
    if (status === 'entrada' && pessoa.tipoAcesso === 'prestador') {
      // Busca a unidade de destino da pessoa para saber se ela exige termo de segurança
      const personUnit = (companies || []).find((c: any) => c.id === pessoa.companyId);
      
      if (personUnit?.requiresSafetyTerm && !pessoa.termoAssinadoEm) {
        setSelected(null); // Fecha o detalhe imediatamente
        setTermPrompt(pessoa);
        return;
      }
    }

    setSelected(null); // Fecha o detalhe imediatamente para abrir o próximo modal
    if (status === 'entrada') {
      setLockerPrompt({ pessoaId, status });
      setLockerInput('');
    } else {
      setLockerPrompt({ pessoaId, status });
    }
  };

  const confirmOutput = async (pessoaId: string, status: 'saida') => {
    setActionLoading(true);
    setSelected(null); // Fecha o detalhe imediatamente para evitar conflito de render
    try {
      await api.post('/presencas', { pessoaId, status });
      setLockerPrompt(null);
      fetchPessoas();
    } catch (err: any) { alert(err.error || 'Erro ao registrar.'); } 
    finally { setActionLoading(false); }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      await api.post(`/pessoas/${id}/approve`, {});
      fetchPessoas();
      setSelected(prev => prev ? { ...prev, isApproved: true } : null);
      setApprovingPessoa(null);
    } catch (err: any) {
      alert(err.error || 'Erro ao aprovar.');
    } finally {
      setActionLoading(false);
    }
  };

  const statusCount = {
    liberado:  baseFiltered.filter(p => p.statusAcesso === 'liberado').length,
    a_vencer:  baseFiltered.filter(p => p.statusAcesso === 'a_vencer').length,
    bloqueado: baseFiltered.filter(p => p.statusAcesso === 'bloqueado').length,
    onSite:    baseFiltered.filter(p => p.lastPresenceStatus === 'entrada').length,
    offSite:   baseFiltered.filter(p => p.lastPresenceStatus !== 'entrada').length,
  };

  const shareUrl = termPrompt 
    ? `${window.location.origin}${window.location.pathname}?termToken=${termPrompt.id}`
    : '';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Portaria</h1>
        <p className="text-sm text-slate-500 mt-1">Registre a entrada e saída de visitantes e prestadores.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { id: 'liberado', label: 'Liberados', count: statusCount.liberado, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { id: 'a_vencer', label: 'A Vencer',  count: statusCount.a_vencer,  color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200' },
          { id: 'bloqueado',label: 'Bloqueados',count: statusCount.bloqueado, color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200' },
        ].map(s => (
          <button key={s.label} onClick={() => setStatusFilter(statusFilter === s.id ? '' : s.id as any)} className={cn('p-4 rounded-2xl text-left transition-all hover:scale-[1.02] active:scale-95 border cursor-pointer', s.border, s.bg, statusFilter === s.id ? 'ring-2 ring-offset-2 ring-slate-400 scale-[1.02]' : '')}>
            <p className={cn('text-3xl font-black', s.color)}>{s.count}</p>
            <p className={cn('text-sm font-medium mt-0.5', s.color)}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* Search & Toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Buscar por nome, empresa ou documento..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm" 
          />
        </div>
        
        <select 
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as any)}
          className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
        >
          <option value="all">Todas Categorias</option>
          <option value="visitante">Visitantes</option>
          <option value="prestador">Prestadores</option>
        </select>

        <select 
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
        >
          <option value="">Todos os Status</option>
          <option value="liberado">Liberado</option>
          <option value="a_vencer">A Vencer</option>
          <option value="bloqueado">Bloqueado</option>
        </select>
      </div>

      {/* Presence Tabs & View Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200">
        <div className="flex">
          {[
            { id: 'all',      label: 'Todos',          count: baseFiltered.length },
            { id: 'on-site',  label: 'Na Unidade',     count: statusCount.onSite },
            { id: 'off-site', label: 'Fora da Unidade', count: statusCount.offSite },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setPresenceFilter(t.id as any)}
              className={cn(
                'px-6 py-4 text-sm font-bold transition-all border-b-2 relative',
                presenceFilter === t.id 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              )}
            >
              {t.label}
              <span className={cn(
                'ml-2 px-1.5 py-0.5 rounded-md text-[10px] font-black',
                presenceFilter === t.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
              )}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm mb-2">
          <button 
            onClick={() => setViewType('card')}
            className={cn('p-1.5 rounded-lg transition-all', viewType === 'card' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600')}
            title="Visualização em Cards"
          >
            <LayoutGrid size={18} />
          </button>
          <button 
            onClick={() => setViewType('list')}
            className={cn('p-1.5 rounded-lg transition-all', viewType === 'list' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600')}
            title="Visualização em Lista"
          >
            <List size={18} />
          </button>
        </div>
      </div>
      {viewType === 'card' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(p => (
              <button key={p.id} onClick={() => setSelected(p)}
                className={cn(
                  'bg-white rounded-2xl border-2 p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5',
                  p.statusAcesso === 'liberado'  ? 'border-emerald-200 hover:border-emerald-400' :
                  p.statusAcesso === 'a_vencer'  ? 'border-amber-200 hover:border-amber-400' :
                                                   'border-red-200 hover:border-red-400'
                )}>
                <div className="flex items-center gap-3 mb-3">
                  {p.foto ? (
                    <img src={p.foto} alt={p.nomeCompleto} className="w-12 h-12 rounded-xl object-cover border-2 border-white shadow" />
                  ) : (
                    <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white',
                      p.statusAcesso === 'liberado' ? 'bg-emerald-500' : p.statusAcesso === 'a_vencer' ? 'bg-amber-500' : 'bg-red-500')}>
                      {p.nomeCompleto[0]}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">{p.nomeCompleto}</p>
                    <p className="text-xs text-slate-500 truncate">{p.empresaOrigemNome || '—'}</p>
                    {p.tipoAcesso === 'prestador' && !p.isApproved && (
                      <span className="inline-block text-[9px] font-black bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded mt-1 uppercase tracking-tighter">
                        Pendente Segurança
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {p.lastPresenceStatus === 'entrada' ? <OnSitePulse /> : <StatusBadge status={p.statusAcesso} />}
                  <span className="text-xs text-slate-400 capitalize bg-slate-50 px-2 py-0.5 rounded-full font-medium">{p.tipoAcesso}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Pessoa</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Empresa Origem</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Status / Operação</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map(p => (
                    <tr 
                      key={p.id} 
                      onClick={() => setSelected(p)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.foto ? (
                            <img src={p.foto} alt="" className="w-8 h-8 rounded-lg object-cover" />
                          ) : (
                            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-white',
                              p.statusAcesso === 'liberado' ? 'bg-emerald-500' : p.statusAcesso === 'a_vencer' ? 'bg-amber-500' : 'bg-red-500')}>
                              {p.nomeCompleto[0]}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">{p.nomeCompleto}</p>
                            {p.tipoAcesso === 'prestador' && !p.isApproved && (
                              <span className="inline-block text-[9px] font-black bg-amber-50 text-amber-700 border border-amber-200 px-1 rounded mt-0.5 uppercase tracking-tighter">
                                Pendente Segurança
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 italic">
                        {p.empresaOrigemNome || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {p.lastPresenceStatus === 'entrada' ? <OnSitePulse /> : <StatusBadge status={p.statusAcesso} />}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-black uppercase text-slate-400 border border-slate-200 px-2 py-0.5 rounded">
                          {p.tipoAcesso}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

      {filtered.length === 0 && (
        <div className="pt-8 text-center bg-white rounded-2xl border border-slate-100 p-12">
          <EmptyState icon={Users} title="Nenhum registro encontrado" subtitle="Tente buscar por outro nome ou empresa." />
        </div>
      )}

      {/* Detail Modal */}
      {/* Detail Modal */}
      {selected && (
        <Modal title="Detalhes do Acesso" onClose={() => setSelected(null)} size="lg">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              {selected.foto ? (
                <img src={selected.foto} alt="" className="w-20 h-20 rounded-2xl object-cover border-2 border-slate-200" />
              ) : (
                <div className={cn('w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-white',
                  selected.statusAcesso === 'liberado' ? 'bg-emerald-500' : selected.statusAcesso === 'a_vencer' ? 'bg-amber-500' : 'bg-red-500')}>
                  {selected.nomeCompleto ? selected.nomeCompleto[0] : '?'}
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold text-slate-900">{selected.nomeCompleto}</h3>
                <p className="text-sm text-slate-500">{selected.empresaOrigemNome || 'Empresa não informada'}</p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge status={selected.statusAcesso} />
                  {selected.lastPresenceStatus === 'entrada' && selected.lastPresenceTimestamp && (
                    <TimeCounter startTime={selected.lastPresenceTimestamp} />
                  )}
                  {selected.tipoAcesso === 'prestador' && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 h-7"
                      onClick={() => setShowTermsFor(selected)}
                    >
                      <History size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Histórico de Termos</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Blocking Reasons Alert */}
            {selected.statusAcesso !== 'liberado' && (
              <div className={cn(
                'p-4 rounded-2xl border-2 flex items-start gap-4',
                selected.statusAcesso === 'bloqueado' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'
              )}>
                <div className={cn('p-2 rounded-xl', selected.statusAcesso === 'bloqueado' ? 'bg-red-100' : 'bg-amber-100')}>
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <p className="font-black text-xs uppercase tracking-widest mb-1">Motivo do Impedimento</p>
                  <ul className="space-y-1">
                    {getBlockingReasons(selected).map((r, i) => (
                      <li key={i} className="text-sm font-bold flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Info Grid - Completo */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Tipo de Acesso', value: selected.tipoAcesso === 'visitante' ? 'Visitante' : 'Prestador' },
                { label: 'Documento', value: maskLGPD(selected.documento || '') },
                { label: 'Responsável Interno', value: selected.responsavelInterno || '—' },
                { label: 'Liberado Até', value: fmtDate(selected.liberadoAte) },
                { label: 'Celular Autorizado', value: selected.celularAutorizado ? 'Sim' : 'Não' },
                { label: 'Notebook Autorizado', value: selected.notebookAutorizado ? 'Sim' : 'Não' },
                ...(selected.tipoAcesso === 'prestador' ? [
                  { label: 'ASO / Saúde', value: fmtDate(selected.asoDataRealizacao) },
                  { label: 'EPI Obrigatório', value: selected.epiObrigatorio ? `Sim — ${selected.epiDescricao || ''}` : 'Não' },
                ] : []),
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{value}</p>
                </div>
              ))}
            </div>

            {/* Treinamentos */}
            {selected.tipoAcesso === 'prestador' && selected.treinamentos && selected.treinamentos.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Treinamentos</h4>
                  <ShieldCheck size={16} className="text-blue-500" />
                </div>
                <div className="grid gap-2">
                  {selected.treinamentos.map((t, i) => (
                    <div key={i} className={cn('flex items-center justify-between p-3 rounded-xl border', 
                      t.statusTreinamento === 'Vencido' ? 'border-red-200 bg-red-50' : 'border-emerald-100 bg-emerald-50/50')}>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{t.treinamentoNome}</p>
                        <p className="text-[11px] text-slate-500">Vencimento: {fmtDate(t.dataVencimento)}</p>
                      </div>
                      <span className={cn('text-[10px] font-black uppercase px-2 py-1 rounded-md text-white', 
                        t.statusTreinamento === 'Vencido' ? 'bg-red-600' : 'bg-emerald-600')}>
                        {t.statusTreinamento}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ações */}
            <div className="flex flex-col gap-3 pt-2">
              {selected.tipoAcesso === 'prestador' && !selected.isApproved && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-2 mb-1">
                  <p className="text-xs text-slate-500 font-medium">Este prestador necessita de aprovação da Segurança do Trabalho para liberação de acesso.</p>
                  {(profile.isSafety || profile.role === 'master') ? (
                    <Button 
                      variant="primary" 
                      className="w-full h-11 text-sm bg-blue-600 hover:bg-blue-700 font-bold uppercase tracking-wider flex items-center justify-center gap-2"
                      onClick={() => setApprovingPessoa({ id: selected.id, nome: selected.nomeCompleto })}
                      disabled={actionLoading}
                    >
                      <ShieldCheck size={18} /> Aprovar Terceiro (Segurança)
                    </Button>
                  ) : (
                    <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl flex items-center gap-2">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>Apenas um responsável pela Segurança do Trabalho pode aprovar este cadastro.</span>
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex gap-3">
                {selected.lastPresenceStatus === 'entrada' ? (
                  <Button variant="danger" className="flex-1 h-12 text-base shadow-lg shadow-red-600/20" disabled={actionLoading}
                    onClick={() => handleRegistrar(selected.id, 'saida')}>
                    <ArrowLeftCircle size={20} /> Registrar Saída
                  </Button>
                ) : (
                  <Button variant="success" className="flex-1 h-12 text-base shadow-lg shadow-emerald-600/20" 
                    disabled={actionLoading || selected.statusAcesso === 'bloqueado'}
                    onClick={() => handleRegistrar(selected.id, 'entrada')}>
                    <ArrowRightCircle size={20} /> Registrar Entrada
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Locker Prompt Modal */}
      {lockerPrompt && (
        <Modal 
          title={lockerPrompt.status === 'entrada' ? "Uso de Armário" : "Confirmar Saída"} 
          onClose={() => setLockerPrompt(null)} 
          size="xs"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{lockerPrompt.status === 'entrada' ? 'Deseja informar um guarda-volumes?' : 'Deseja confirmar a saída?'}</p>
            
            {lockerPrompt.status === 'saida' && (() => {
              const p = pessoas.find(x => x.id === lockerPrompt.pessoaId);
              return p?.armario ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                  <AlertTriangle className="text-amber-600" size={20} />
                  <p className="text-[11px] font-bold text-amber-800 uppercase">Lembrete: Devolver Armário {p.armario}</p>
                </div>
              ) : null;
            })()}

            {lockerPrompt.status === 'entrada' && (
              <Input label="Número do Armário (Opcional)" value={lockerInput} onChange={setLockerInput} placeholder="Ex: 15" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => lockerPrompt.status === 'entrada' ? confirmRegistrar() : setLockerPrompt(null)}>
                {lockerPrompt.status === 'entrada' ? 'Pular' : 'Cancelar'}
              </Button>
              <Button variant={lockerPrompt.status === 'entrada' ? 'primary' : 'danger'} onClick={() => lockerPrompt.status === 'entrada' ? confirmRegistrar() : confirmOutput(lockerPrompt.pessoaId, 'saida')}>
                Confirmar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Term Prompt Modal */}
      {termPrompt && (
        <Modal title="Assinatura Digital" onClose={() => setTermPrompt(null)} size="sm">
          <div className="space-y-6 text-center">
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
               <p className="text-sm text-blue-900 font-bold">Termo de Segurança Obrigatório</p>
               <p className="text-xs text-blue-700 mt-1">O prestador deve assinar o termo para entrar na unidade.</p>
            </div>
            
            <div className="bg-white p-6 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center">
               <p className="text-[11px] text-slate-500 leading-relaxed mb-4">Escanear QR Code para assinar:</p>
               {QRCodeSVG && shareUrl && (
                  <div className="mb-4 bg-white p-2 rounded-xl shadow-sm border border-slate-100">
                    <QRCodeSVG value={shareUrl} size={160} level="H" includeMargin={true} />
                  </div>
               )}
               <p className="text-[10px] bg-slate-50 p-2 rounded border font-mono break-all select-all text-blue-600">{shareUrl}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => setTermPrompt(null)}>Cancelar</Button>
              <Button onClick={() => termPrompt && checkSignature(termPrompt.id)} disabled={isVerifyingTerm}>
                {isVerifyingTerm ? 'Verificando...' : 'Já Assinei'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <AnimatePresence>
        {showTermsFor && (
          <PersonTermsModal 
            pessoa={showTermsFor} 
            onClose={() => setShowTermsFor(null)} 
          />
        )}
      </AnimatePresence>

      {approvingPessoa && (
        <SafetyApproveModal 
          nome={approvingPessoa.nome}
          onConfirm={() => handleApprove(approvingPessoa.id)}
          onCancel={() => setApprovingPessoa(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

// ─── Foto Uploader ────────────────────────────────────────────────────────────

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000; // Resolução suficiente para crachá/perfil
        const MAX_HEIGHT = 1000;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          else resolve(file);
        }, 'image/jpeg', 0.7); // 70% de qualidade economiza muito espaço
      };
    };
  });
}

function PhotoPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setLoading(true);
    try {
      const compressed = await compressImage(file);
      const res = await api.uploadFile(compressed);
      onChange(res.url);
    } catch (err: any) {
      alert(err.error || 'Erro ao fazer upload da imagem.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Foto</label>
      <div className="flex gap-3 items-end">
        <div className={cn('w-24 h-24 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden relative',
          value ? 'border-blue-400' : 'border-slate-300 bg-slate-50')}>
          {value ? <img src={value} alt="foto" className="w-full h-full object-cover" /> : <Camera size={24} className="text-slate-400" />}
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
              <RefreshCw size={20} className="text-blue-600 animate-spin" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={loading}>
            <Upload size={14} /> {loading ? 'Subindo...' : 'Carregar arquivo'}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
      </div>
    </div>
  );
}

// ─── Pessoas (Admin) ──────────────────────────────────────────────────────────

type PessoaForm = {
  tipoAcesso: string; foto: string; nomeCompleto: string; documento: string;
  empresaOrigemId: string; responsavelInterno: string; celularAutorizado: boolean;
  celularImei: string; notebookAutorizado: boolean; notebookMarca: string; 
  notebookPatrimonio: string;
  liberadoAte: string; descricaoAtividade: string;
  atividadeId: string; asoDataRealizacao: string; epiObrigatorio: boolean; epiDescricao: string;
  treinamentos: { treinamentoId: string; dataRealizacao: string }[];
  companyId: string;
};

const emptyPessoaForm = (): PessoaForm => ({
  tipoAcesso: 'visitante', foto: '', nomeCompleto: '', documento: '',
  empresaOrigemId: '', responsavelInterno: '', celularAutorizado: false,
  celularImei: '', notebookAutorizado: false, notebookMarca: '', notebookPatrimonio: '',
  liberadoAte: '', descricaoAtividade: '',
  atividadeId: '',
  asoDataRealizacao: '', epiObrigatorio: false, epiDescricao: '',
  treinamentos: [],
  companyId: '',
});

function CompanySelectOptions({ companies }: { companies: Company[] }) {
  const matrices = companies.filter(c => !c.parentId);
  const filiais = companies.filter(c => c.parentId);

  return (
    <>
      <option value="">— Selecione —</option>
      {matrices.map(m => (
        <optgroup key={m.id} label={m.name}>
          <option value={m.id}>{m.name} (Matriz)</option>
          {filiais.filter(f => f.parentId === m.id).map(f => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </optgroup>
      ))}
      {/* Fallback para filiais cujas matrizes não foram carregadas ou não existem */}
      {filiais.filter(f => !matrices.some(m => m.id === f.parentId)).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </>
  );
}

function PessoasView({ profile }: { profile: UserProfile }) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [empresasTerceiro, setEmpresasTerceiro] = useState<EmpresaTerceiro[]>([]);
  const [treiTipos, setTreiTipos] = useState<TipoTreinamento[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Pessoa | null>(null);
  const [form, setForm] = useState<PessoaForm>(emptyPessoaForm());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [docType, setDocType] = useState<'CPF' | 'RG'>('CPF');
  const [coSearch, setCoSearch] = useState('');
  const [origSearch, setOrigSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [situationFilter, setSituationFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [successMsg, setSuccessMsg] = useState('');
  const [termView, setTermView] = useState<Pessoa | null>(null);
  const [showTermsFor, setShowTermsFor] = useState<Pessoa | null>(null);
  const [approvingPessoa, setApprovingPessoa] = useState<{ id: string; nome: string } | null>(null);

  useEffect(() => { fetchAll(); }, []);

  const maskCPF = (v: string) => {
    v = v.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const handleDocChange = (v: string) => {
    if (docType === 'CPF') {
      const numeric = v.replace(/\D/g, '');
      if (numeric.length <= 11) setForm(f => ({ ...f, documento: maskCPF(v) }));
    } else {
      setForm(f => ({ ...f, documento: v }));
    }
  };

  const handleAsoUpdate = (date: string) => {
    setForm(f => {
      const newF = { ...f, asoDataRealizacao: date };
      if (date) {
        const d = new Date(date + 'T12:00:00'); // avoid timezone shifts
        if (f.tipoAcesso === 'visitante') { d.setDate(d.getDate() + 7); } else { d.setFullYear(d.getFullYear() + 1); }
        newF.liberadoAte = d.toISOString().split('T')[0];
      }
      return newF;
    });
  };

  const calculateAutoExpiration = useCallback(() => {
    try {
      const parseSafe = (dStr: string) => {
        if (!dStr) return null;
        // Limpa strings do Postgres (ex: "2024-04-20 00:00:00") para "2024-04-20"
        const clean = dStr.split(' ')[0].split('T')[0];
        const date = new Date(clean + 'T12:00:00');
        return isNaN(date.getTime()) ? null : date;
      };

      if (form.tipoAcesso === 'visitante') {
        const d = parseSafe(form.asoDataRealizacao);
        if (!d) return '';
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
      } else {
        const dates: number[] = [];
        const asoDate = parseSafe(form.asoDataRealizacao);
        if (asoDate) {
          asoDate.setFullYear(asoDate.getFullYear() + 1);
          dates.push(asoDate.getTime());
        }
        form.treinamentos.forEach(t => {
          const tipo = treiTipos.find(tt => tt.id === t.treinamentoId);
          const tDate = parseSafe(t.dataRealizacao);
          if (tipo && tDate) {
            tDate.setMonth(tDate.getMonth() + (tipo.validadeMeses || 12));
            dates.push(tDate.getTime());
          }
        });
        if (dates.length === 0) return '';
        const minTime = Math.min(...dates);
        if (isNaN(minTime)) return '';
        return new Date(minTime).toISOString().split('T')[0];
      }
    } catch (e) {
      console.error('Erro ao calcular expiração:', e);
      return '';
    }
  }, [form.tipoAcesso, form.asoDataRealizacao, form.treinamentos, treiTipos]);

  useEffect(() => {
    const expiredAt = calculateAutoExpiration();
    if (expiredAt !== form.liberadoAte) {
      setForm(f => ({ ...f, liberadoAte: expiredAt }));
    }
  }, [calculateAutoExpiration, form.liberadoAte]);

  useEffect(() => { 
    const inc = situationFilter === 'inactive' || situationFilter === 'all';
    fetchAll(inc); 
  }, [situationFilter]);

  const fetchAll = async (inc: boolean = false) => {
    try {
      const include = inc || situationFilter === 'inactive' || situationFilter === 'all';
      const [p, e, t, c] = await Promise.all([
        api.get<Pessoa[]>(`/pessoas?includeInactive=${include}`),
        api.get<EmpresaTerceiro[]>('/empresas-terceiro'),
        api.get<TipoTreinamento[]>('/treinamentos/tipos'),
        api.get<Company[]>('/companies'),
      ]);
      
      // Aplicar filtro local de situação para Ativos/Inativos se necessário
      let data = p || [];
      if (situationFilter === 'active') data = data.filter(x => x.isActive);
      if (situationFilter === 'inactive') data = data.filter(x => !x.isActive);

      setPessoas(data);
      setEmpresasTerceiro(e || []);
      setTreiTipos(t || []);
      setCompanies(c || []);
    } catch {}
  };

  const openNew = () => { setForm(emptyPessoaForm()); setEditTarget(null); setShowForm(true); };
  
  const openEdit = (p: Pessoa) => {
    setEditTarget(p);
    setForm({
      tipoAcesso: p.tipoAcesso,
      foto: p.foto || '',
      nomeCompleto: p.nomeCompleto,
      documento: p.documento,
      empresaOrigemId: p.empresaOrigemId || '',
      responsavelInterno: p.responsavelInterno,
      celularAutorizado: p.celularAutorizado,
      celularImei: p.celularImei || '',
      notebookAutorizado: p.notebookAutorizado,
      notebookMarca: p.notebookMarca || '',
      notebookPatrimonio: p.notebookPatrimonio || '',
      liberadoAte: p.liberadoAte ? p.liberadoAte.split('T')[0] : '',
      descricaoAtividade: p.descricaoAtividade || '',
      asoDataRealizacao: p.asoDataRealizacao ? p.asoDataRealizacao.split('T')[0] : '',
      epiObrigatorio: p.epiObrigatorio,
      epiDescricao: p.epiDescricao || '',
      treinamentos: p.treinamentos ? p.treinamentos.map(t => ({ 
        treinamentoId: t.treinamentoId, 
        dataRealizacao: t.dataRealizacao ? t.dataRealizacao.split('T')[0] : '' 
      })) : [],
      companyId: p.companyId
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (editTarget) await api.put(`/pessoas/${editTarget.id}`, payload);
      else await api.post('/pessoas', payload);
      fetchAll();
      setShowForm(false);
    } catch (err: any) { alert(err.error || 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  const handleToggleStatus = async (p: Pessoa) => {
    setSaving(true);
    try {
      const newStatus = !p.isActive;
      await api.patch(`/pessoas/${p.id}/status`, { isActive: newStatus });
      await fetchAll();
      setSuccessMsg(newStatus ? `"${p.nomeCompleto}" reativado com sucesso!` : `"${p.nomeCompleto}" desativado com sucesso.`);
    } catch (err: any) { alert(err.error || 'Erro ao alterar status.'); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setSaving(true);
    try { 
      await api.delete(`/pessoas/${deleteId}`); 
      fetchAll(); 
      setDeleteId(null);
    } catch (err: any) { alert(err.error || 'Erro.'); } 
    finally { setSaving(false); }
  };

  const handleApprove = async (id: string, nome: string) => {
    setSaving(true);
    try {
      await api.post(`/pessoas/${id}/approve`, {});
      fetchAll(situationFilter === 'inactive' || situationFilter === 'all');
      setSuccessMsg(`Cadastro de "${nome}" aprovado com sucesso!`);
      setApprovingPessoa(null);
    } catch (err: any) {
      alert(err.error || 'Erro ao aprovar.');
    } finally {
      setSaving(false);
    }
  };

  const addTreinamento = () => setForm(f => ({ ...f, treinamentos: [...f.treinamentos, { treinamentoId: '', dataRealizacao: '' }] }));
  const updateTreinamento = (i: number, field: string, val: string) => {
    setForm(f => ({ ...f, treinamentos: f.treinamentos.map((t, idx) => idx === i ? { ...t, [field]: val } : t) }));
  };
  const removeTreinamento = (i: number) => setForm(f => ({ ...f, treinamentos: f.treinamentos.filter((_, idx) => idx !== i) }));

  const filtered = pessoas
    .filter(p => !search || p.nomeCompleto.toLowerCase().includes(search.toLowerCase()) || (p.empresaOrigemNome || '').toLowerCase().includes(search.toLowerCase()) || p.documento.toLowerCase().includes(search.toLowerCase()))
    .filter(p => !filterStatus || p.statusAcesso === filterStatus);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Visitantes e Prestadores</h1>
          <p className="text-sm text-slate-500 mt-0.5">Cadastre e gerencie os acessos da sua empresa.</p>
        </div>
        <Button onClick={openNew}><Plus size={16} /> Novo Cadastro</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, empresa ou documento..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
        </div>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white outline-none shadow-sm">
          <option value="">Todos os status</option>
          <option value="liberado">Liberados</option>
          <option value="a_vencer">A Vencer</option>
          <option value="bloqueado">Bloqueados</option>
        </select>

        <select value={situationFilter} onChange={e => setSituationFilter(e.target.value as any)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white outline-none shadow-sm font-semibold text-slate-600">
          <option value="active">Situação: Ativos</option>
          <option value="inactive">Situação: Inativos</option>
          <option value="all">Situação: Todos</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Pessoa</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Empresa Origem</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Liberado Até</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.foto ? <img src={p.foto} className="w-9 h-9 rounded-lg object-cover" alt="" />
                        : <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600">{p.nomeCompleto[0]}</div>}
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{p.nomeCompleto}</p>
                        <p className="text-xs text-slate-400">{p.documento}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs capitalize bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{p.tipoAcesso}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{p.empresaOrigemNome || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(p.liberadoAte)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={p.statusAcesso} />
                      {p.tipoAcesso === 'prestador' && !p.isApproved && (
                        <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded tracking-tighter uppercase w-fit">
                          Pendente Segurança
                        </span>
                      )}
                      {!p.isActive && (
                        <span className="text-[10px] font-black bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded tracking-tighter uppercase w-fit">
                          Desativado
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {p.tipoAcesso === 'prestador' && !p.isApproved && (profile.isSafety || profile.role === 'master') && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setApprovingPessoa({ id: p.id, nome: p.nomeCompleto })}
                          title="Aprovar Cadastro (Segurança)"
                          disabled={saving}
                        >
                          <CheckCircle2 size={14} className="text-emerald-600 hover:text-emerald-700" />
                        </Button>
                      )}
                      {p.tipoAcesso === 'prestador' && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setShowTermsFor(p)}
                          title="Histórico de Termos"
                        >
                          <History size={14} className="text-blue-600" />
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setTermView(p)}
                        title="Visualizar Termo de Segurança"
                      >
                        <ShieldCheck size={14} className="text-blue-500" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)} title="Editar"><Pencil size={14} /></Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleToggleStatus(p)} 
                        className={cn(p.isActive ? 'text-slate-400 hover:text-red-600' : 'text-emerald-500 hover:text-emerald-600')}
                        title={p.isActive ? 'Desativar (Bloquear)' : 'Reativar (Liberar)'}
                        disabled={saving}
                      >
                        <Power size={14} />
                      </Button>
                      {profile.role === 'master' && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(p.id)} title="Excluir Permanentemente"><Trash2 size={14} className="text-slate-300 hover:text-red-600" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon={Users} title="Nenhum registro encontrado" />}
        </div>
      </Card>

      {/* Form Modal */}
      <AnimatePresence>
        {showForm && (
          <Modal title={editTarget ? 'Editar Cadastro' : 'Novo Cadastro'} onClose={() => setShowForm(false)} size="xl">
            <form onSubmit={handleSave} className="space-y-6">
              {/* Tipo + Foto */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <PhotoPicker value={form.foto} onChange={v => setForm(f => ({ ...f, foto: v }))} />
                <Select label="Tipo de Acesso" value={form.tipoAcesso} onChange={v => setForm(f => ({ ...f, tipoAcesso: v }))} required>
                  <option value="visitante">Visitante</option>
                  <option value="prestador">Prestador de Serviço</option>
                </Select>
              </div>

              {/* Dados Principais */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Nome Completo" value={form.nomeCompleto} onChange={v => setForm(f => ({ ...f, nomeCompleto: v }))} required placeholder="Nome completo" />
                
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Documento <span className="text-red-500">*</span></label>
                    <div className="flex bg-slate-100 p-0.5 rounded-lg">
                      <button type="button" onClick={() => setDocType('CPF')} className={cn('px-2 py-0.5 text-[10px] rounded-md font-bold transition-all', docType === 'CPF' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400')}>CPF</button>
                      <button type="button" onClick={() => setDocType('RG')} className={cn('px-2 py-0.5 text-[10px] rounded-md font-bold transition-all', docType === 'RG' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400')}>RG</button>
                    </div>
                  </div>
                  <input 
                    value={form.documento} 
                    onChange={e => handleDocChange(e.target.value)} 
                    required 
                    placeholder={docType === 'CPF' ? '000.000.000-00' : 'Número do RG'}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500" 
                  />
                </div>

                <div className="space-y-1 relative">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Empresa de Origem <span className="text-red-500">*</span></label>
                  <SearchableSelect 
                    placeholder="Pesquisar empresa..."
                    value={form.empresaOrigemId}
                    onChange={v => setForm(f => ({ ...f, empresaOrigemId: v }))}
                    options={empresasTerceiro.map(e => ({ value: e.id, label: e.name }))}
                    required
                    allowCustom
                  />
                </div>

                <Input label="Responsável Interno" value={form.responsavelInterno} onChange={v => setForm(f => ({ ...f, responsavelInterno: v }))} required placeholder="Nome do acompanhante" />
                
                {(profile.role === 'master' || profile.role === 'admin') && (
                  <div className="space-y-1 relative">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Empresa de Acesso (Unidade) <span className="text-red-500">*</span></label>
                    <SearchableSelect 
                      placeholder="Pesquisar unidade..."
                      value={form.companyId}
                      onChange={v => setForm(f => ({ ...f, companyId: v }))}
                      options={companies.map(c => ({ value: c.id, label: c.name }))}
                      required
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Input 
                    label={form.tipoAcesso === 'visitante' ? 'Data da Visita' : 'Último ASO'} 
                    type="date" 
                    value={form.asoDataRealizacao} 
                    onChange={handleAsoUpdate} 
                    required 
                    hint={form.tipoAcesso === 'visitante' ? 'Acesso liberado por 1 semana' : 'Calcula validade mínima (ASO + Treinamentos)'} 
                  />
                </div>
                <Input label="Acesso Válido Até" type="date" value={form.liberadoAte} onChange={v => setForm(f => ({ ...f, liberadoAte: v }))} required hint="Data calculada automaticamente" />
                <Input label="Descrição da Atividade / Visita" value={form.descricaoAtividade} onChange={v => setForm(f => ({ ...f, descricaoAtividade: v }))} placeholder="Descreva o motivo do acesso" />
              </div>

              {/* Permissões */}
              <div className="p-4 bg-slate-50 rounded-2xl space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Permissões e Objetos</h4>
                <div className="space-y-3">
                  <Toggle label="Celular autorizado" checked={form.celularAutorizado} onChange={v => setForm(f => ({ ...f, celularAutorizado: v, celularImei: v ? f.celularImei : '' }))} />
                  {form.celularAutorizado && (
                    <Input 
                      label="IMEI do Celular (15 dígitos)" 
                      value={form.celularImei} 
                      onChange={v => {
                        const numeric = v.replace(/\D/g, '').slice(0, 15);
                        setForm(f => ({ ...f, celularImei: numeric }));
                      }} 
                      placeholder="Somente números" 
                      required
                    />
                  )}
                  
                  <div className="border-t border-slate-100 pt-3">
                    <Toggle label="Notebook autorizado" checked={form.notebookAutorizado} onChange={v => setForm(f => ({ ...f, notebookAutorizado: v }))} />
                    {form.notebookAutorizado && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                        <Input 
                          label="Marca" 
                          value={form.notebookMarca} 
                          onChange={v => setForm(f => ({ ...f, notebookMarca: v }))} 
                          placeholder="Ex: Dell, HP..." 
                          required
                        />
                        <Input 
                          label="Patrimônio / Etiqueta" 
                          value={form.notebookPatrimonio} 
                          onChange={v => setForm(f => ({ ...f, notebookPatrimonio: v }))} 
                          placeholder="Ex: TAG-123456" 
                          required
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Prestador específico */}
              {form.tipoAcesso === 'prestador' && (
                <div className="space-y-4 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                  <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider">Dados do Prestador</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <p className="text-xs text-blue-500 italic md:col-span-2">A data do ASO e treinamentos determinam a validade do acesso no campo acima.</p>
                  </div>
                  <Toggle label="EPI obrigatório" checked={form.epiObrigatorio} onChange={v => setForm(f => ({ ...f, epiObrigatorio: v }))} />
                  {form.epiObrigatorio && (
                    <Input label="Descrição do EPI" value={form.epiDescricao} onChange={v => setForm(f => ({ ...f, epiDescricao: v }))} placeholder="Ex: Bota de segurança, capacete..." />
                  )}
                  {/* Treinamentos */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="text-xs font-bold text-blue-600 uppercase tracking-wider">Treinamentos do Prestador</h5>
                      <Button variant="ghost" size="sm" onClick={addTreinamento}><Plus size={14} /> Vincular Treinamento</Button>
                    </div>
                    <div className="space-y-3">
                      {form.treinamentos.map((t, i) => {
                        const tipo = treiTipos.find(tt => tt.id === t.treinamentoId);
                        let statusNode = null;
                        if (tipo && t.dataRealizacao) {
                          const valMeses = tipo.validadeMeses || 12;
                          const d = new Date(t.dataRealizacao + 'T12:00:00');
                          d.setMonth(d.getMonth() + valMeses);
                          const isExpired = d < new Date();
                          statusNode = (
                            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase', isExpired ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}>
                              {isExpired ? 'Vencido' : 'Válido'} até {d.toLocaleDateString('pt-BR')}
                            </span>
                          );
                        }

                        return (
                          <div key={i} className="p-3 bg-white rounded-xl border border-blue-100 space-y-2">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <Select label="Tipo de Treinamento" value={t.treinamentoId} onChange={v => updateTreinamento(i, 'treinamentoId', v)} required>
                                  <option value="">— Selecione —</option>
                                  {[...treiTipos].sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '')).map(tt => (
                                    <option key={tt.id} value={tt.id}>{tt.codigo} — {tt.nome}</option>
                                  ))}
                                </Select>
                              </div>
                              <Button variant="ghost" size="sm" className="mt-6 ml-2" onClick={() => removeTreinamento(i)}><Trash2 size={14} className="text-red-400" /></Button>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <Input label="Data de Realização" type="date" value={t.dataRealizacao} onChange={v => updateTreinamento(i, 'dataRealizacao', v)} required />
                              </div>
                              <div className="flex-1 pt-4 text-right">
                                {statusNode}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {form.treinamentos.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum treinamento vinculado. Adicione as capacitações necessárias.</p>}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar Cadastro'}</Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteId && (
          <ConfirmModal 
            title="Excluir Cadastro"
            message="Esta ação excluirá permanentemente os dados desta pessoa e seu histórico de acessos. Deseja continuar?"
            onConfirm={confirmDelete}
            onCancel={() => setDeleteId(null)}
            loading={saving}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {successMsg && (
          <Modal title="Sucesso" onClose={() => setSuccessMsg('')} size="sm">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={24} />
              </div>
              <p className="text-sm font-medium text-slate-600">{successMsg}</p>
              <Button className="w-full" onClick={() => setSuccessMsg('')}>Entendido</Button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {termView && (
          <Modal title="Termo de Segurança" onClose={() => setTermView(null)} size="md">
            <div className="space-y-6">
              {(() => {
                const unit = companies.find(c => c.id === termView.companyId);
                if (!unit?.requiresSafetyTerm) {
                  return (
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 text-amber-700 text-sm flex items-start gap-3">
                      <AlertTriangle size={18} className="shrink-0" />
                      <p>Esta unidade não exige a assinatura de termo de segurança para prestadores.</p>
                    </div>
                  );
                }
                if (termView.termoAssinadoEm) {
                  return (
                    <div className="space-y-4">
                      <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-700 text-sm flex items-center gap-3">
                        <CheckCircle2 size={20} />
                        <div>
                          <p className="font-bold">Termo assinado!</p>
                          <p className="text-xs">Assinado em {new Date(termView.termoAssinadoEm).toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                      {termView.termoAssinatura && (
                        <div className="border border-slate-200 rounded-xl p-2 bg-slate-50">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 text-center">Assinatura Digital</p>
                          <img src={termView.termoAssinatura} alt="Assinatura" className="max-h-32 mx-auto" />
                        </div>
                      )}
                      <Button variant="ghost" className="w-full" onClick={() => window.open(`${window.location.origin}${window.location.pathname}?termToken=${termView.id}`, '_blank')}>
                        <ExternalLink size={14} /> Ver Página do Termo
                      </Button>
                    </div>
                  );
                }
                return (
                  <div className="text-center space-y-4">
                    <div className="bg-slate-50 p-6 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center">
                      <QRCodeSVG value={`${window.location.origin}${window.location.pathname}?termToken=${termView.id}`} size={160} />
                      <p className="text-xs text-slate-500 mt-4 max-w-[200px]">Peça para o colaborador ler o QR Code com o celular para assinar o termo.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="flex-1" onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?termToken=${termView.id}`);
                        alert('Link copiado para a área de transferência!');
                      }}>
                        <Copy size={14} /> Copiar Link
                      </Button>
                      <Button className="flex-1" onClick={() => window.open(`${window.location.origin}${window.location.pathname}?termToken=${termView.id}`, '_blank')}>
                        <ExternalLink size={14} /> Abrir Termo
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTermsFor && (
          <PersonTermsModal 
            pessoa={showTermsFor} 
            onClose={() => setShowTermsFor(null)} 
          />
        )}
      </AnimatePresence>

      {approvingPessoa && (
        <SafetyApproveModal 
          nome={approvingPessoa.nome}
          onConfirm={() => handleApprove(approvingPessoa.id, approvingPessoa.nome)}
          onCancel={() => setApprovingPessoa(null)}
          loading={saving}
        />
      )}
    </div>
  );
}

// ─── Generic CRUD View ─────────────────────────────────────────────────────────

function SimpleListView<T extends { id: string; name?: string; nome?: string }>({
  title, subtitle, endpoint, columns, renderForm, icon: Icon
}: {
  title: string; subtitle: string; endpoint: string;
  columns: { label: string; render: (item: T) => React.ReactNode }[];
  renderForm: (item: T | null, onSave: () => void, onClose: () => void) => React.ReactNode;
  icon: any;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<T | null>(null);
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { fetchAll(); }, []);
  const fetchAll = async () => { try { setItems(await api.get<T[]>(endpoint)); } catch {} };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { 
      await api.delete(`${endpoint}/${deleteId}`); 
      fetchAll(); 
      setDeleteId(null);
    } catch (err: any) { alert(err.error || 'Erro.'); } 
    finally { setDeleting(false); }
  };

  const filtered = items.filter(item => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (item.name?.toLowerCase().includes(s) || item.nome?.toLowerCase().includes(s));
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <Button onClick={() => { setEditItem(null); setShowForm(true); }}><Plus size={16} /> Novo</Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          placeholder="Buscar nesta lista..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {columns.map(c => <th key={c.label} className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">{c.label}</th>)}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  {columns.map((c, i) => <td key={i} className="px-4 py-3 text-sm text-slate-700">{c.render(item)}</td>)}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditItem(item); setShowForm(true); }} title="Editar"><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(item.id)} title="Excluir"><Trash2 size={14} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon={Icon} title="Nenhum item encontrado" subtitle={search ? "Tente buscar por outro termo." : "Clique em Novo para adicionar."} />}
        </div>
      </Card>
      <AnimatePresence>
        {showForm && (
          <Modal title={editItem ? 'Editar' : 'Novo'} onClose={() => setShowForm(false)}>
            {renderForm(editItem, () => { fetchAll(); setShowForm(false); }, () => setShowForm(false))}
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteId && (
          <ConfirmModal 
            title="Confirmar Exclusão"
            message="Tem certeza que deseja excluir este item? Esta ação não poderá ser desfeita."
            onConfirm={confirmDelete}
            onCancel={() => setDeleteId(null)}
            loading={deleting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Empresas Terceiro View ──────────────────────────────────────────────────

function EmpresasTerceiroView({ profile }: { profile: UserProfile }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => { 
    if (profile.role === 'master' || profile.role === 'admin') {
      api.get<Company[]>('/companies').then(setCompanies); 
    }
  }, [profile.role]);

  const maskCNPJ = (v: string) => {
    v = v.replace(/\D/g, '');
    if (v.length > 14) v = v.slice(0, 14);
    if (v.length > 12) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, '$1.$2.$3/$4-$5');
    if (v.length > 8) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4}).*/, '$1.$2.$3/$4');
    if (v.length > 5) return v.replace(/^(\d{2})(\d{3})(\d{3}).*/, '$1.$2.$3');
    if (v.length > 2) return v.replace(/^(\d{2})(\d{3}).*/, '$1.$2');
    return v;
  };

  const EmpresaForm = ({ item, onSave, onClose }: { item: EmpresaTerceiro | null; onSave: () => void; onClose: () => void }) => {
    const [name, setName] = useState(item?.name || '');
    const [cnpj, setCnpj] = useState(item?.cnpj || '');
    const [email, setEmail] = useState(item?.email || '');
    const [selectedCompanyId, setSelectedCompanyId] = useState(item?.companyId || '');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault(); setSaving(true);
      try {
        const payload = { 
          name, 
          cnpj: cnpj.replace(/\D/g, ''), 
          email: email.trim().toLowerCase(),
          companyId: (profile.role === 'master' || profile.role === 'admin') ? selectedCompanyId : profile.companyId 
        };
        if (item) await api.put(`/empresas-terceiro/${item.id}`, payload);
        else await api.post('/empresas-terceiro', payload);
        onSave();
      } catch (err: any) { alert(err.error || 'Erro.'); } finally { setSaving(false); }
    };
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {(profile.role === 'master' || profile.role === 'admin') && (
          <Select label="Companhia Mandante" value={selectedCompanyId} onChange={setSelectedCompanyId} required>
            <option value="">— Selecione a Empresa —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        <Input label="Nome da Empresa de Origem" value={name} onChange={setName} required placeholder="Ex: CTDI, Logística Express..." />
        <Input label="CNPJ" value={cnpj} onChange={v => setCnpj(maskCNPJ(v))} placeholder="00.000.000/0000-00" />
        <Input label="E-mail de Notificação (Provedor)" value={email} onChange={setEmail} type="email" placeholder="contato@empresa.com.br" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar Empresa'}</Button>
        </div>
      </form>
    );
  };
  return (
    <SimpleListView<EmpresaTerceiro>
      title="Provedores" subtitle="Gerencie as empresas prestadoras de serviço (terceirizadas)."
      endpoint="/empresas-terceiro" icon={Building2}
      columns={[
        { label: 'Nome / Razão Social', render: e => <div className="font-semibold text-slate-800">{e.name}</div> },
        { label: 'CNPJ', render: e => e.cnpj || '—' },
        { label: 'E-mail de Notificação', render: e => (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Mail size={12} className="text-slate-400" /> {e.email || 'Não configurado'}
          </div>
        )},
      ]}
      renderForm={(item, onSave, onClose) => <EmpresaForm item={item as any} onSave={onSave} onClose={onClose} />}
    />
  );
}

// ─── Treinamentos View ────────────────────────────────────────────────────────

function TreinamentosView({ profile }: { profile: UserProfile }) {
  const [items, setItems] = useState<TipoTreinamento[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<TipoTreinamento | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: '', validadeMeses: '12', escopo: 'personalizado', companyId: '' });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { fetchAll(); }, []);
  const fetchAll = async () => { 
    try {
      const [t, c] = await Promise.all([api.get<TipoTreinamento[]>('/treinamentos/tipos'), api.get<Company[]>('/companies')]);
      const sorted = (t || []).sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true }));
      setItems(sorted); setCompanies(c || []);
    } catch {} 
  };

  const openNew = () => {
    setEditTarget(null);
    setForm({ nome: '', validadeMeses: '12', escopo: 'personalizado', companyId: '' });
    setShowForm(true);
  };

  const openEdit = (t: TipoTreinamento) => {
    setEditTarget(t);
    setForm({ 
      nome: t.nome, 
      validadeMeses: String(t.validadeMeses), 
      escopo: t.escopo, 
      companyId: t.companyId || '' 
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { 
      if (editTarget) {
        await api.put(`/treinamentos/tipos/${editTarget.id}`, form);
      } else {
        await api.post('/treinamentos/tipos', form); 
      }
      fetchAll(); setShowForm(false); 
      setForm({ nome: '', validadeMeses: '12', escopo: 'personalizado', companyId: '' }); 
    }
    catch (err: any) { alert(err.error || 'Erro.'); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/treinamentos/tipos/${deleteId}`);
      fetchAll();
      setDeleteId(null);
    } catch (err: any) { alert(err.error || 'Erro ao excluir treinamento.'); }
    finally { setDeleting(false); }
  };

  const filtered = items.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return t.nome.toLowerCase().includes(s) || t.codigo.toLowerCase().includes(s);
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Treinamentos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie os treinamentos obrigatórios.</p>
        </div>
        <Button onClick={openNew}><Plus size={16} /> Novo</Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          placeholder="Buscar por código ou descrição de treinamento..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {['Código', 'Nome', 'Validade', 'Escopo', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono text-sm font-bold text-blue-600">{t.codigo}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{t.nome}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{t.validadeMeses} meses</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', t.escopo === 'global' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600')}>
                      {t.escopo === 'global' ? 'Global' : 'Personalizado'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(t.id)}><Trash2 size={14} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon={BookOpen} title={search ? "Nenhum treinamento encontrado" : "Nenhum treinamento cadastrado"} subtitle={search ? "Tente buscar por outro código ou nome." : ""} />}
        </div>
      </Card>
      <AnimatePresence>
        {showForm && (
          <Modal title={editTarget ? 'Editar Treinamento' : 'Novo Tipo de Treinamento'} onClose={() => setShowForm(false)}>
            <form onSubmit={handleSave} className="space-y-4">
              <Input label="Descrição do Treinamento" value={form.nome} onChange={v => setForm(f => ({ ...f, nome: v }))} required placeholder="Ex: NR 10 - Segurança em Eletricidade" />
              <Input label="Validade (meses)" type="number" value={form.validadeMeses} onChange={v => setForm(f => ({ ...f, validadeMeses: v }))} required />
              {profile.role === 'master' && (
                <Select label="Escopo" value={form.escopo} onChange={v => setForm(f => ({ ...f, escopo: v }))}>
                  <option value="personalizado">Personalizado (apenas esta empresa)</option>
                  <option value="global">Global (todas as empresas)</option>
                </Select>
              )}
              {(profile.role === 'master' || (profile.role === 'admin' && form.escopo === 'personalizado')) && (profile.role === 'admin' || form.escopo === 'personalizado') && (
                <Select label="Empresa Responsável" value={form.companyId} onChange={v => setForm(f => ({ ...f, companyId: v }))} required>
                  <CompanySelectOptions companies={companies} />
                </Select>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteId && (
          <ConfirmModal 
            title="Excluir Treinamento"
            message="Esta ação excluirá este tipo de treinamento do sistema. Isso não afetará históricos já registrados, mas impedirá novos registros com este tipo. Deseja continuar?"
            onConfirm={confirmDelete}
            onCancel={() => setDeleteId(null)}
            loading={deleting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}




// ─── Companies View (Master + Admin) ─────────────────────────────────────────

function CompaniesView({ profile }: { profile: UserProfile }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allAdmins, setAllAdmins] = useState<UserProfile[]>([]);
  const [linkedAdmins, setLinkedAdmins] = useState<Record<string, UserProfile>>({});
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  // Modals
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [showBranchFor, setShowBranchFor] = useState<Company | null>(null);   // parent company
  const [showAdminsFor, setShowAdminsFor] = useState<Company | null>(null);   // company managing admins
  const [editTarget, setEditTarget] = useState<Company | null>(null);         // company/branch being edited
  const [sendingReport, setSendingReport] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Forms
  const [companyForm, setCompanyForm] = useState({ name: '', cnpj: '', requiresSafetyTerm: false });
  const [branchForm, setBranchForm] = useState({ name: '', cnpj: '', requiresSafetyTerm: false });
  const [saving, setSaving] = useState(false);
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);

  // Auto-fill CNPJ se o nome for 'Matriz'
  useEffect(() => {
    if (showBranchFor && branchForm.name.toLowerCase() === 'matriz') {
      setBranchForm(f => ({ ...f, cnpj: maskCNPJ(showBranchFor.cnpj || '') }));
    }
  }, [branchForm.name, showBranchFor]);

  useEffect(() => { fetchAll(); }, []);

  const maskCNPJ = (v: string) => {
    v = v.replace(/\D/g, '');
    if (v.length > 14) v = v.slice(0, 14);
    if (v.length > 12) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, '$1.$2.$3/$4-$5');
    if (v.length > 8)  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4}).*/,        '$1.$2.$3/$4');
    if (v.length > 5)  return v.replace(/^(\d{2})(\d{3})(\d{3}).*/,               '$1.$2.$3');
    if (v.length > 2)  return v.replace(/^(\d{2})(\d{3}).*/,                      '$1.$2');
    return v;
  };

  const fetchAll = async () => {
    try {
      const [comps, users] = await Promise.all([
        api.get<Company[]>('/companies'),
        profile.role === 'master' ? api.get<UserProfile[]>('/users') : Promise.resolve<UserProfile[]>([]),
      ]);
      setCompanies(comps || []);
      if (profile.role === 'master') {
        // Master vê todos para vincular
        setAllAdmins((users || []).filter(u => u.role === 'admin' || u.role === 'viewer'));
      } else {
        // Admin não vê Master na listagem de vinculação (segurança)
        setAllAdmins((users || []).filter(u => u.role === 'admin' || u.role === 'viewer'));
      }
    } catch {}
  };

  const fetchLinkedAdmins = async (companyId: string) => {
    try {
      const admins = await api.get<UserProfile[]>(`/companies/${companyId}/admins`);
      setLinkedAdmins(prev => ({ ...prev, [companyId]: admins || [] }));
    } catch {}
  };

  const openAdminsModal = async (company: Company) => {
    setShowAdminsFor(company);
    await fetchLinkedAdmins(company.id);
  };

  const toggleAdmin = async (companyId: string, userId: string, isLinked: boolean) => {
    setTogglingAdmin(userId);
    try {
      if (isLinked) {
        await api.delete(`/companies/${companyId}/admins/${userId}`);
      } else {
        await api.post(`/companies/${companyId}/admins`, { userId });
      }
      await fetchLinkedAdmins(companyId);
    } catch (err: any) {
      alert(err.error || 'Erro ao alterar vínculo.');
    } finally {
      setTogglingAdmin(null);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/companies', {
        name: companyForm.name,
        cnpj: companyForm.cnpj.replace(/\D/g, ''),
        requiresSafetyTerm: companyForm.requiresSafetyTerm
      });
      setCompanyForm({ name: '', cnpj: '', requiresSafetyTerm: false });
      setShowNewCompany(false);
      fetchAll();
    } catch (err: any) { alert(err.error || 'Erro ao criar empresa.'); }
    finally { setSaving(false); }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showBranchFor) return;
    setSaving(true);
    try {
      await api.post('/companies', {
        name: branchForm.name,
        cnpj: branchForm.cnpj.replace(/\D/g, ''),
        parentId: showBranchFor.id,
        requiresSafetyTerm: branchForm.requiresSafetyTerm
      });
      setBranchForm({ name: '', cnpj: '', requiresSafetyTerm: false });
      setShowBranchFor(null);
      fetchAll();
    } catch (err: any) { alert(err.error || 'Erro ao criar filial.'); }
    finally { setSaving(false); }
  };

  const handleUpdateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      await api.put(`/companies/${editTarget.id}`, {
        name: companyForm.name,
        cnpj: companyForm.cnpj.replace(/\D/g, ''),
        requiresSafetyTerm: companyForm.requiresSafetyTerm
      });
      setCompanyForm({ name: '', cnpj: '', requiresSafetyTerm: false });
      setEditTarget(null);
      fetchAll();
    } catch (err: any) { alert(err.error || 'Erro ao atualizar.'); }
    finally { setSaving(false); }
  };

  const confirmDeleteCompany = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try { 
      await api.delete(`/companies/${deleteTarget.id}`); 
      fetchAll(); 
      setDeleteTarget(null);
    } catch (err: any) { alert(err.error || 'Erro ao excluir.'); } 
    finally { setSaving(false); }
  };

  const handleSendReport = async (company: Company) => {
    setSendingReport(company.id);
    try {
      const res = await api.post<any>(`/companies/${company.id}/send-report`, {});
      setSuccessMsg(res.sent ? `Relatório enviado com sucesso para os contatos da empresa ${company.name}.` : res.message);
    } catch (err: any) {
      alert(err.error || 'Erro ao enviar relatório.');
    } finally {
      setSendingReport(null);
    }
  };

  // Separar matrizes de filiais
  const matrices = companies
    .filter(c => !c.parentId)
    .filter(c => profile.role === 'master' || c.id === profile.companyId)
    .filter(c => {
      if (!search) return true;
      const s = search.toLowerCase();
      return c.name.toLowerCase().includes(s) || (c.cnpj || '').includes(s);
    });

  const branches = companies.filter(c => !!c.parentId);
  const getBranches = (parentId: string) => branches.filter(b => b.parentId === parentId);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empresas Contratantes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {profile.role === 'master'
              ? 'Cadastre empresas, vincule administradores e gerencie filiais.'
              : 'Visualize suas empresas e cadastre filiais.'}
          </p>
        </div>
        {(profile.role === 'master' || profile.role === 'admin') && (
          <Button onClick={() => setShowNewCompany(true)}>
            <Plus size={16} /> Nova Empresa
          </Button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          placeholder="Buscar por nome da empresa ou CNPJ..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
        />
      </div>

      {/* Company Cards */}
      <div className="space-y-4">
        {matrices.length === 0 && (
          <Card className="p-8">
            <EmptyState icon={ShieldCheck} title="Nenhuma empresa cadastrada"
              subtitle={profile.role === 'master' ? 'Você ainda não cadastrou nenhuma empresa contratante.' : 'Aguarde o master vincular você a uma empresa.'} />
            {(profile.role === 'master' || profile.role === 'admin') && (
              <div className="flex justify-center pt-4">
                <Button onClick={() => setShowNewCompany(true)} size="md">
                  <Plus size={18} /> Cadastrar Minha Primeira Empresa
                </Button>
              </div>
            )}
          </Card>
        )}

        {matrices.map(company => {
          const compBranches = getBranches(company.id);
          const linked = linkedAdmins[company.id] || [];

          return (
            <Card key={company.id} className="overflow-hidden">
              {/* Company Header */}
              <div className="p-5 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shrink-0 shadow-lg shadow-blue-200">
                    <ShieldCheck size={22} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">{company.name}</h2>
                    {company.cnpj && (
                      <p className="text-xs text-slate-400 font-mono mt-0.5">CNPJ: {company.cnpj}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                        company.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                        {company.isActive ? 'Ativa' : 'Inativa'}
                      </span>
                      <span className="text-xs text-slate-400">
                        {compBranches.length} {compBranches.length === 1 ? 'filial' : 'filiais'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {profile.role === 'master' && (
                    <button
                      onClick={() => openAdminsModal(company)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-all"
                    >
                      <UserCog size={14} />
                      Administradores
                      {linked.length > 0 && (
                        <span className="ml-1 bg-purple-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                                                   {linked.length}
                        </span>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => { setBranchForm({ name: '', cnpj: '' }); setShowBranchFor(company); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all"
                  >
                    <Plus size={14} /> Filial
                  </button>
                  <button
                    onClick={() => handleSendReport(company)}
                    disabled={!!sendingReport}
                    className={cn(
                      "p-1.5 rounded-xl transition-all",
                      sendingReport === company.id ? "bg-blue-50 text-blue-600 animate-pulse" : "text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                    )}
                    title="Disparar Relatório de Conformidade por E-mail"
                  >
                    <Mail size={14} className={sendingReport === company.id ? "animate-spin" : ""} />
                  </button>
                  <button
                    onClick={() => { 
                      setCompanyForm({ name: company.name, cnpj: company.cnpj || '', requiresSafetyTerm: company.requiresSafetyTerm || false }); 
                      setEditTarget(company); 
                    }}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                    title="Editar Empresa"
                  >
                    <UserCog size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(company)}
                    className="p-1.5 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Excluir Empresa"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Branches List */}
              <div className="border-t border-slate-100 divide-y divide-slate-50">
                {/* Always show the Matrix/Headquarters row first */}
                <div className="flex flex-col sm:flex-row items-center justify-between px-5 py-5 bg-blue-50/40 border-l-4 border-blue-500 gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-800">Unidade Sede Principal</p>
                        <span className="text-[9px] font-black bg-blue-600 text-white px-2 py-0.5 rounded shadow-sm tracking-wide uppercase">
                          Matriz
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5 tracking-tight">
                        CNPJ da Sede: {maskCNPJ(company.cnpj || '')}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-blue-600 bg-white border border-blue-100 hover:bg-blue-50 shadow-sm"
                    onClick={() => { setBranchForm({ name: '', cnpj: '' }); setShowBranchFor(company); }}>
                    <Plus size={14} /> Cadastrar Nova Filial
                  </Button>
                </div>

                {/* List registered branches */}
                {compBranches.map(branch => {
                  const isMatriz = branch.name.toLowerCase() === 'matriz';
                  return (
                    <div key={branch.id} className={cn(
                      "flex items-center justify-between px-5 py-4 transition-all border-l-4",
                      isMatriz ? "bg-blue-50/30 border-blue-500" : "bg-slate-50/40 border-slate-100 hover:bg-slate-50"
                    )}>
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-9 h-9 rounded-xl flex items-center justify-center shadow-sm transition-transform hover:scale-105",
                          isMatriz ? "bg-blue-600 text-white" : "bg-white text-slate-400 border border-slate-200"
                        )}>
                          {isMatriz ? <ShieldCheck size={18} /> : <Building2 size={18} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-slate-800">{branch.name}</p>
                            {isMatriz ? (
                              <span className="text-[9px] font-black bg-blue-600 text-white px-2 py-0.5 rounded shadow-sm tracking-wide">
                                UNIDADE SEDE
                              </span>
                            ) : (
                              <span className="text-[9px] font-black text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded uppercase">
                                Filial
                              </span>
                            )}
                          </div>
                          {branch.cnpj && (
                            <p className="text-[11px] text-slate-500 font-mono mt-0.5 tracking-tight">
                              CNPJ: {maskCNPJ(branch.cnpj)}
                            </p>
                          )}
                          {branch.requiresSafetyTerm && (
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md w-fit ring-1 ring-blue-100">
                              <ShieldCheck size={10} /> TERMO ATIVO
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1 group">
                        <button
                          onClick={() => handleSendReport(branch)}
                          disabled={!!sendingReport}
                          className={cn(
                            "p-2 rounded-xl border border-slate-100 transition-all",
                            sendingReport === branch.id ? "bg-blue-50 text-blue-600 animate-pulse" : "text-slate-400 hover:text-blue-600 hover:bg-white shadow-sm"
                          )}
                          title="Disparar Relatório desta Unidade"
                        >
                          <Mail size={14} className={sendingReport === branch.id ? "animate-spin" : ""} />
                        </button>
                        <button
                          onClick={() => { 
                            setCompanyForm({ 
                              name: branch.name, 
                              cnpj: branch.cnpj || '',
                              requiresSafetyTerm: !!branch.requiresSafetyTerm
                            }); 
                            setEditTarget(branch); 
                            setShowBranchFor(company); // abre o modal como edição de filial
                          }}
                          className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-white shadow-sm border border-slate-100 transition-all"
                          title="Editar Unidade"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(branch)}
                          className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-white shadow-sm border border-slate-100 transition-all"
                          title="Excluir Unidade"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {/* ─── Modal: Nova Empresa (Master only) ─── */}
      <AnimatePresence>
        {showNewCompany && (
          <Modal title="Nova Empresa Contratante" onClose={() => setShowNewCompany(false)}>
            <form onSubmit={handleCreateCompany} className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 font-medium">
                ℹ️ Cadastre a empresa que irá receber terceiros e visitantes. Após criá-la, vincule os administradores responsáveis.
              </div>
              <Input label="Razão Social / Nome da Empresa" value={companyForm.name}
                onChange={v => setCompanyForm(f => ({ ...f, name: v }))} required
                placeholder="Ex: Acme Indústria e Comércio Ltda" />
              <Input label="CNPJ" value={companyForm.cnpj}
                onChange={v => setCompanyForm(f => ({ ...f, cnpj: maskCNPJ(v) }))}
                placeholder="00.000.000/0000-00" />

              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <input 
                  type="checkbox" 
                  id="req_term_new"
                  checked={companyForm.requiresSafetyTerm}
                  onChange={e => setCompanyForm(f => ({ ...f, requiresSafetyTerm: e.target.checked }))}
                  className="w-5 h-5 rounded-lg text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <label htmlFor="req_term_new" className="text-sm font-semibold text-slate-700 cursor-pointer">
                  Exigir Termo de Segurança Digital na entrada
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowNewCompany(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Criando...' : 'Criar Empresa'}</Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      {/* ─── Modal: Nova Filial ─── */}
      <AnimatePresence>
        {showBranchFor && (
          <Modal title={`Nova Filial — ${showBranchFor.name}`} onClose={() => setShowBranchFor(null)}>
            <form onSubmit={handleCreateBranch} className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 flex items-center gap-2">
                <Building2 size={14} className="shrink-0 text-slate-400" />
                Esta filial será vinculada a <strong>{showBranchFor.name}</strong>.
              </div>
              <Input label="Nome da Filial / Unidade" value={branchForm.name}
                onChange={v => setBranchForm(f => ({ ...f, name: v }))} required
                placeholder="Ex: Filial Santos, Unidade Centro..." />
              <Input label="CNPJ" value={branchForm.cnpj}
                onChange={v => setBranchForm(f => ({ ...f, cnpj: maskCNPJ(v) }))}
                placeholder="00.000.000/0000-00" />

              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <input 
                  type="checkbox" 
                  id="req_term_branch"
                  checked={branchForm.requiresSafetyTerm}
                  onChange={e => setBranchForm(f => ({ ...f, requiresSafetyTerm: e.target.checked }))}
                  className="w-5 h-5 rounded-lg text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <label htmlFor="req_term_branch" className="text-sm font-semibold text-slate-700 cursor-pointer">
                  Exigir Termo de Segurança Digital na entrada
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowBranchFor(null)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Criando...' : 'Criar Filial'}</Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      {/* ─── Modal: Editar Empresa / Unidade ─── */}
      <AnimatePresence>
        {editTarget && (
          <Modal title={`Editar — ${editTarget.name}`} onClose={() => setEditTarget(null)}>
            <form onSubmit={handleUpdateCompany} className="space-y-4">
              <Input label="Nome" value={companyForm.name}
                onChange={v => setCompanyForm(f => ({ ...f, name: v }))} required />
              <Input label="CNPJ" value={companyForm.cnpj}
                onChange={v => setCompanyForm(f => ({ ...f, cnpj: maskCNPJ(v) }))}
                placeholder="00.000.000/0000-00" />

              <div className="flex items-center gap-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                <input 
                  type="checkbox" 
                  id="req_term_edit"
                  checked={companyForm.requiresSafetyTerm}
                  onChange={e => setCompanyForm(f => ({ ...f, requiresSafetyTerm: e.target.checked }))}
                  className="w-5 h-5 rounded-lg text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <label htmlFor="req_term_edit" className="text-sm font-semibold text-slate-700 cursor-pointer">
                  Exigir Termo de Segurança Digital nesta unidade
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Atualizando...' : 'Salvar Alterações'}</Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      {/* ─── Modal: Gerenciar Administradores (Master only) ─── */}
      <AnimatePresence>
        {showAdminsFor && (
          <Modal title={`Administradores — ${showAdminsFor.name}`} onClose={() => setShowAdminsFor(null)} size="lg">
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Selecione quais usuários têm acesso a esta empresa. Administradores vinculados poderão cadastrar filiais, terceiros e visitantes.
              </p>

              {allAdmins.length === 0 ? (
                <EmptyState icon={UserCog} title="Nenhum administrador cadastrado"
                  subtitle="Cadastre usuários com nível Administrador primeiro." />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {allAdmins
                    .filter(admin => admin.role !== 'master') // Blindagem: Admin nunca vê Master aqui
                    .map(admin => {
                      const linked = (linkedAdmins[showAdminsFor.id] || []).some(a => (a.uid || a.id) === (admin.uid || admin.id));
                      const isToggling = togglingAdmin === (admin.uid || admin.id);
                    return (
                      <div key={admin.uid || admin.id}
                        className={cn(
                          'flex items-center justify-between p-3 rounded-xl border-2 transition-all',
                          linked ? 'border-blue-200 bg-blue-50/50' : 'border-slate-100 bg-white hover:border-slate-200'
                        )}>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold',
                            linked ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                          )}>
                            {admin.displayName?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{admin.displayName}</p>
                            <p className="text-xs text-slate-400">{admin.email}</p>
                          </div>
                          <span className={cn('text-[10px] font-black px-2 py-0.5 rounded-full',
                            admin.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600')}>
                            {admin.role === 'admin' ? 'Admin' : 'Viewer'}
                          </span>
                        </div>
                        <button
                          disabled={isToggling}
                          onClick={() => toggleAdmin(showAdminsFor.id, admin.uid || admin.id || '', linked)}
                          className={cn(
                            'relative w-12 h-6 rounded-full transition-all flex-shrink-0',
                            linked ? 'bg-blue-600' : 'bg-slate-200',
                            isToggling && 'opacity-50 cursor-not-allowed'
                          )}>
                          <div className={cn(
                            'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all',
                            linked ? 'left-7' : 'left-1'
                          )} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button onClick={() => setShowAdminsFor(null)}>Fechar</Button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <ConfirmModal 
            title="Excluir Empresa"
            message={`Deseja realmente excluir "${deleteTarget.name}"? Todas as filiais e dados associados a esta unidade serão removidos permanentemente.`}
            onConfirm={confirmDeleteCompany}
            onCancel={() => setDeleteTarget(null)}
            loading={saving}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {successMsg && (
          <Modal title="Sucesso" onClose={() => setSuccessMsg('')} size="sm">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={24} />
              </div>
              <p className="text-sm font-medium text-slate-600">{successMsg}</p>
              <Button className="w-full" onClick={() => setSuccessMsg('')}>Entendido</Button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function PublicRomaneioApprover({ romId, approverId }: { romId: string, approverId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'already' | 'error'>('idle');
  const [data, setData] = useState<{ approvedBy?: string, approvedAt?: string, error?: string }>({});

  const handleApprove = async () => {
    setStatus('loading');
    
    let geo = 'Não fornecida';
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => 
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      geo = `${pos.coords.latitude}, ${pos.coords.longitude}`;
    } catch (err) { console.warn('Geolocation failed:', err); }

    try {
      const res: any = await api.post('/romaneios/approve-direct', { id: romId, approverId, localizacao: geo });
      if (res.alreadyApproved) {
        setData({ approvedBy: res.approvedBy, approvedAt: res.approvedAt });
        setStatus('already');
      } else {
        setData({ approvedBy: res.approvedBy });
        setStatus('success');
      }
    } catch (err: any) {
      setData({ error: err.error || 'Erro ao processar aprovação.' });
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#001A33] flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#000d1a] via-[#001A33] to-[#000a14]" />
      <div className="absolute inset-0 bg-grid-tech opacity-20" />
      
      <div className="max-w-md w-full relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8 md:p-12 text-center">
          <div className="flex justify-center mb-8">
            <img src="/LogoCompleto.png" alt="PortALL" className="h-16 w-auto" />
          </div>

          {status === 'idle' && (
            <div className="space-y-6">
              <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldCheck size={40} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 leading-tight">Aprovação de Romaneio</h2>
              <p className="text-slate-500 text-sm">Você foi designado para aprovar este documento. Sua assinatura digital será vinculada ao relatório oficial.</p>
              <button onClick={handleApprove} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-500/20 active:scale-95">
                Confirmar Aprovação
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="py-12 space-y-4">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-blue-600 font-bold uppercase tracking-widest text-xs">Processando Aprovação...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-6">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={40} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 leading-tight">Aprovado com Sucesso!</h2>
              <p className="text-slate-500 text-sm">O romaneio foi assinado digitalmente e os vigilantes já foram notificados da liberação.</p>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Assinado Por</p>
                <p className="text-sm font-bold text-slate-700">{data.approvedBy}</p>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest pt-4">Pode fechar esta janela agora.</p>
            </div>
          )}

          {status === 'already' && (
            <div className="space-y-6">
              <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock size={40} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 leading-tight">Já Aprovado</h2>
              <p className="text-slate-500 text-sm">Este romaneio já foi processado anteriormente por outro responsável.</p>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left space-y-3">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Aprovado Por</p>
                  <p className="text-sm font-bold text-slate-700">{data.approvedBy}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Data/Hora</p>
                  <p className="text-sm font-bold text-slate-700">{fmtDate(data.approvedAt)} às {data.approvedAt ? new Date(data.approvedAt).toLocaleTimeString() : '—'}</p>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest pt-4">Pode fechar esta janela agora.</p>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-6">
              <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle size={40} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 leading-tight">Ops! Algo deu errado</h2>
              <p className="text-red-500 text-sm font-medium">{data.error}</p>
              <Button onClick={() => setStatus('idle')} variant="ghost" className="w-full h-14 rounded-2xl">Tentar Novamente</Button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('portaria');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMsg, setResetMsg] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Detecção de rotas públicas via link
  const [publicApproveData, setPublicApproveData] = useState<{ id: string, approver: string } | null>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = modalStyles;
    document.head.append(style);
    
    const params = new URLSearchParams(window.location.search);
    
    // Reset de senha
    const token = params.get('reset_token');
    if (token) { setResetToken(token); window.history.replaceState({}, '', window.location.pathname); }
    
    // Aprovação de Romaneio
    const romId = params.get('id');
    const approver = params.get('approver');
    if (romId && approver && window.location.pathname.includes('approve-romaneio')) {
      setPublicApproveData({ id: romId, approver });
      window.history.replaceState({}, '', window.location.pathname);
    }

    checkSession();
  }, []);

  const [urlTermToken] = useState(() => new URLSearchParams(window.location.search).get('termToken'));

  useEffect(() => {
    if (profile) {
      api.get<Company[]>('/companies').then(c => {
        setCompanies(c || []);
        (window as any).__COMPANIES__ = c || [];
      }).catch(() => {});
    }
  }, [profile]);

  const checkSession = async () => {
    const stored = getStoredUser();
    if (stored) {
      try {
        const fresh = await api.get<UserProfile>('/auth/me');
        setProfile(fresh);
      } catch { clearSession(); }
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    try { await api.post('/auth/logout', {}); } catch {}
    clearSession(); setProfile(null);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPw !== resetConfirm) { setResetMsg('As senhas não coincidem.'); return; }
    setResetLoading(true);
    try {
      await api.post('/auth/reset-password', { token: resetToken, newPassword: resetPw });
      setResetMsg('Senha definida com sucesso! Redirecionando...');
      setTimeout(() => { setResetToken(null); setResetMsg(''); setResetPw(''); setResetConfirm(''); }, 2500);
    } catch (err: any) { setResetMsg(err.error || 'Link inválido ou expirado.'); }
    finally { setResetLoading(false); }
  };

  // Rendering Logic (Ensuring all hooks are called before any early returns)
  if (urlTermToken) return <PublicTermSigner pessoaId={urlTermToken} />;
  if (publicApproveData) return <PublicRomaneioApprover romId={publicApproveData.id} approverId={publicApproveData.approver} />;

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (resetToken) return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#001A33]">
      {/* Dark blue background with subtle gradient and glows to match login */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#000d1a] via-[#001A33] to-[#000a14]" />
      <div className="absolute inset-0 bg-grid-tech opacity-20" />
      
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.4, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] bg-blue-500/10 mix-blend-screen pointer-events-none" 
      />

      <motion.div 
        animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.3, 0.2] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[150px] bg-sky-400/5 mix-blend-screen pointer-events-none" 
      />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="bg-white/90 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl p-10 border border-white">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-6">
              <img src="/LogoCompleto.png" alt="PortALL" className="h-24 w-auto object-contain" />
            </div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Definir Senha</h1>
            <p className="text-sm font-medium text-slate-500 mt-1">Crie sua nova senha de acesso.</p>
          </div>

          <form onSubmit={handleResetPassword} className="space-y-5">
            <div className="space-y-4">
              <Input label="Nova Senha" type="password" value={resetPw} onChange={setResetPw} required placeholder="Mínimo 8 caracteres" />
              <Input label="Confirmar Senha" type="password" value={resetConfirm} onChange={setResetConfirm} required placeholder="Repita a senha" />
            </div>

            {resetMsg && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }} 
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'p-3 rounded-xl text-xs font-bold text-center border',
                  resetMsg.includes('sucesso') 
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                    : 'bg-red-50 text-red-600 border-red-100'
                )}
              >
                {resetMsg}
              </motion.div>
            )}

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={resetLoading} 
                className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-all disabled:opacity-60 shadow-xl shadow-blue-500/25 active:scale-95"
              >
                {resetLoading ? 'Salvando...' : 'Confirmar Nova Senha'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );

  if (!profile) return <LoginPage onLogin={p => setProfile(p)} />;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between px-4 h-14 bg-slate-900 border-b border-white/5 shrink-0 z-30">
        <button onClick={() => setMobileSidebarOpen(true)} className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all">
          <Menu size={22} />
        </button>
        <img src="/LogoCompleto.png" alt="PortALL" className="h-8 w-auto object-contain" />
        <div className="w-10" />
      </div>

      {/* Desktop Header */}
      <div className="hidden md:block">
        <Header profile={profile} onLogout={handleLogout} />
      </div>
      
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          profile={profile} 
          collapsed={sidebarCollapsed} 
          setCollapsed={setSidebarCollapsed}
          mobileOpen={mobileSidebarOpen}
          setMobileOpen={setMobileSidebarOpen}
          onLogout={handleLogout}
        />

        <main className="flex-1 overflow-y-auto relative z-10">
          <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-8">
            <AnimatePresence mode="wait">
              <motion.div 
                key={activeTab} 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }} 
                transition={{ duration: 0.15 }}
              >
                {activeTab === 'treinamentos'      && <TreinamentosView profile={profile} />}
                {activeTab === 'pessoas'           && <PessoasView profile={profile} />}
                {activeTab === 'empresas_terceiro' && <EmpresasTerceiroView profile={profile} />}
                {activeTab === 'companies'         && (profile.role === 'master' || profile.role === 'admin') && <CompaniesView profile={profile} />}
                {activeTab === 'usuarios'          && <UsuariosView profile={profile} />}
                {activeTab === 'portaria'          && <PortariaView profile={profile} companies={companies} />}
                {activeTab === 'logs'              && profile.role === 'master' && <LogsView />}
                {activeTab === 'notificacoes'      && <NotificacoesView profile={profile} companies={companies} />}
                {activeTab === 'nfc_scanner'       && <NFCScannerView />}
                {activeTab === 'admin_patrimonios' && <PatrimoniosView profile={profile} companies={companies} />}
                {activeTab === 'romaneios'         && <RomaneiosView profile={profile} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

function UsuariosView({ profile }: { profile: UserProfile }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ 
    email: '', 
    displayName: '', 
    role: 'viewer', 
    companyId: '', 
    managedCompanyIds: [] as string[], 
    manageAllBranches: false,
    isSafety: false,
    canApproveRomaneio: false
  });

  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);

  useEffect(() => { fetchAll(); }, []);
  
  const fetchAll = async () => {
    try {
      const [u, c] = await Promise.all([
        api.get<UserProfile[]>('/users'),
        api.get<Company[]>('/companies'),
      ]);
      setUsers(u || []);
      setCompanies(c || []);
    } catch {}
  };

  const openNew = () => {
    setEditTarget(null);
    setForm({ 
      email: '', 
      displayName: '', 
      role: 'viewer', 
      companyId: profile.role === 'admin' ? (profile.companyId || '') : '', 
      managedCompanyIds: [], 
      manageAllBranches: false,
      isSafety: false,
      canApproveRomaneio: false
    });
    setShowForm(true);
  };

  const openEdit = (user: UserProfile) => {
    setEditTarget(user);
    setForm({ 
      email: user.email || '', 
      displayName: user.displayName || '', 
      role: user.role || 'viewer', 
      companyId: user.companyId || '',
      managedCompanyIds: user.managedCompanyIds || [],
      manageAllBranches: user.manageAllBranches || false,
      isSafety: user.isSafety || false,
      canApproveRomaneio: user.canApproveRomaneio || false
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (profile.role === 'admin') {
        payload.role = 'viewer';
        payload.companyId = profile.companyId || form.companyId;
      }
      if (editTarget) {
        await api.put(`/users/${editTarget.uid || editTarget.id}`, payload);
      } else {
        await api.post('/users', payload);
      }
      fetchAll();
      setShowForm(false);
    } catch (err: any) { alert(err.error || 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.delete(`/users/${deleteTarget.uid || deleteTarget.id}`);
      fetchAll();
      setDeleteTarget(null);
    } catch (err: any) { alert(err.error || 'Erro ao excluir.'); }
    finally { setSaving(false); }
  };

  const roleLabel = (role: string) => {
    if (role === 'master') return 'Master';
    if (role === 'admin') return 'Administrador';
    return 'Visualizador';
  };

  const roleColor = (role: string) => {
    if (role === 'master') return 'bg-purple-100 text-purple-700';
    if (role === 'admin') return 'bg-blue-100 text-blue-700';
    return 'bg-slate-100 text-slate-600';
  };

  const getCompanyName = (companyId?: string) => {
    if (!companyId) return '—';
    return companies.find(c => c.id === companyId)?.name || '—';
  };

  const filtered = users.filter(u => {
    // Blindagem: Admin não vê Master
    if (profile.role !== 'master' && u.role === 'master') return false;
    
    if (!search) return true;
    const s = search.toLowerCase();
    return (u.displayName || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s);
  });

  const canInvite = profile.role === 'master' || profile.role === 'admin';
  const canEditRole = profile.role === 'master';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Usuários do Sistema</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie os usuários e suas permissões de acesso.</p>
        </div>
        {canInvite && (
          <Button onClick={openNew}><Plus size={16} /> Convidar Usuário</Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou e-mail..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {['Usuário', 'E-mail', 'Perfil', 'Empresa', 'Unidades', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(user => (
                <tr key={user.uid || user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold ${roleColor(user.role || 'viewer')}`}>
                        {(user.displayName || user.email || '?')[0].toUpperCase()}
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{user.displayName || '—'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-sm text-slate-500">
                      <Mail size={13} className="text-slate-300" />
                      {user.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full w-fit ${roleColor(user.role || 'viewer')}`}>
                        {roleLabel(user.role || 'viewer')}
                      </span>
                      {user.isSafety && (
                        <span className="text-[9px] font-black bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md uppercase tracking-wider w-fit">
                          Segurança do Trabalho
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {getCompanyName(user.companyId)}
                  </td>
                  <td className="px-4 py-3">
                    {user.manageAllBranches ? (
                      <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase">Todas</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(user.managedCompanyIds || []).length > 0 ? (
                          user.managedCompanyIds?.map(id => {
                            const name = companies.find(c => c.id === id)?.name;
                            return name ? (
                              <span key={id} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                {name}
                              </span>
                            ) : null;
                          })
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Nenhuma</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Admin não pode editar outros Admins (apenas Master ou a si mesmo) */}
                      {canInvite && (profile.role === 'master' || user.role !== 'admin' || user.uid === profile.uid || user.id === profile.id) && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(user)}><Pencil size={14} /></Button>
                      )}
                      {/* Apenas Master deleta usuários. E Admin deleta viewers? (Não, mantendo restrito por segurança) */}
                      {profile.role === 'master' && (user.uid || user.id) !== (profile.uid || profile.id) && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(user)}><Trash2 size={14} /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon={UserCog} title="Nenhum usuário encontrado" subtitle="Convide usuários clicando em 'Convidar Usuário'." />}
        </div>
      </Card>

      {/* Form Modal */}
      <AnimatePresence>
        {showForm && (
          <Modal title={editTarget ? 'Editar Usuário' : 'Convidar Usuário'} onClose={() => setShowForm(false)}>
            <form onSubmit={handleSave} className="space-y-4">
              {!editTarget && (
                <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 font-medium">
                  ℹ️ Um e-mail de convite será enviado para o usuário definir sua senha.
                </div>
              )}
              <Input label="Nome Completo" value={form.displayName} onChange={v => setForm(f => ({ ...f, displayName: v }))} required placeholder="Nome do usuário" />
              <Input label="E-mail" type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} required placeholder="usuario@empresa.com" />
              {canEditRole && (
                <div className="space-y-4">
                  <Select label="Perfil de Acesso" value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} required>
                    <option value="viewer">Visualizador (Portaria)</option>
                    <option value="admin">Administrador</option>
                    {profile.role === 'master' && <option value="master">Master</option>}
                  </Select>
                  
                  {(form.role === 'admin' || form.role === 'master') && (
                    <div className="space-y-4">
                      <Toggle 
                        label="Este administrador pertence à Segurança do Trabalho?" 
                        checked={form.isSafety} 
                        onChange={v => setForm(f => ({ ...f, isSafety: v }))} 
                      />
                      <Toggle 
                        label="Pode aprovar romaneios de materiais?" 
                        checked={form.canApproveRomaneio} 
                        onChange={v => setForm(f => ({ ...f, canApproveRomaneio: v }))} 
                      />
                    </div>
                  )}
                </div>
              )}
              {(profile.role === 'master' && form.role !== 'master') && (
                <div className="space-y-4">
                  <Select label="Empresa Responsável" value={form.companyId} onChange={v => setForm(f => ({ ...f, companyId: v }))} required>
                    <CompanySelectOptions companies={companies} />
                  </Select>
                  {form.role === 'admin' && (
                    <div className="space-y-3">
                      <Toggle label="Gerenciar todas as filiais desta empresa?" checked={form.manageAllBranches} onChange={v => setForm(f => ({ ...f, manageAllBranches: v }))} />
                      
                      {!form.manageAllBranches && (
                        <div className="p-4 bg-slate-50 rounded-2xl space-y-3">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Selecionar Unidades Autorizadas</label>
                          <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                            {companies.filter(c => c.parentId === form.companyId || c.id === form.companyId).map(site => (
                              <label key={site.id} className="flex items-center gap-3 p-2 bg-white rounded-xl border border-slate-100 hover:border-blue-200 transition-colors cursor-pointer group">
                                <input 
                                  type="checkbox" 
                                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  checked={form.managedCompanyIds.includes(site.id)}
                                  onChange={e => {
                                    const ids = e.target.checked 
                                      ? [...form.managedCompanyIds, site.id]
                                      : form.managedCompanyIds.filter(id => id !== site.id);
                                    setForm(f => ({ ...f, managedCompanyIds: ids }));
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-700 truncate">{site.name}</p>
                                  <p className="text-[10px] text-slate-400 truncate">{site.parentId ? 'Filial' : 'Matriz'}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {profile.role === 'admin' && form.role === 'viewer' && (
                <div className="space-y-4">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Unidades Autorizadas para Visualizador</label>
                  <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-2 custom-scrollbar p-3 bg-slate-50 rounded-2xl">
                    {/* Admin só pode dar acesso às unidades que ele mesmo gerencia */}
                    {companies.filter(c => 
                      profile.manageAllBranches 
                        ? (c.id === profile.companyId || c.parentId === profile.companyId)
                        : (profile.managedCompanyIds || []).includes(c.id)
                    ).map(site => (
                      <label key={site.id} className="flex items-center gap-3 p-2 bg-white rounded-xl border border-slate-100 hover:border-blue-200 transition-colors cursor-pointer group">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={form.managedCompanyIds.includes(site.id)}
                          onChange={e => {
                            const ids = e.target.checked 
                              ? [...form.managedCompanyIds, site.id]
                              : form.managedCompanyIds.filter(id => id !== site.id);
                            setForm(f => ({ ...f, managedCompanyIds: ids }));
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-700 truncate">{site.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{site.parentId ? 'Filial' : 'Matriz'}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : editTarget ? 'Salvar Alterações' : 'Enviar Convite'}</Button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <ConfirmModal 
            title="Excluir Usuário"
            message={`Deseja realmente remover o acesso de "${deleteTarget.displayName || deleteTarget.email}"? Esta ação não poderá ser desfeita.`}
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
            loading={saving}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificacoesView({ profile, companies }: { profile: UserProfile, companies: Company[] }) {
  const [emails, setEmails] = useState<NotificationEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputEmail, setInputEmail] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    profile.role !== 'master' ? profile.companyId : (companies[0]?.id || '')
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedCompanyId || profile.role !== 'master') {
      fetchEmails();
    }
  }, [selectedCompanyId, profile.role]);

  const fetchEmails = async () => {
    try {
      setLoading(true);
      const data = await api.get<NotificationEmail[]>(`/notifications${profile.role === 'master' && selectedCompanyId ? `?companyId=${selectedCompanyId}` : ''}`);
      setEmails(data || []);
    } catch (err: any) { alert(err.error || 'Erro ao carregar e-mails.'); } 
    finally { setLoading(false); }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputEmail || !selectedCompanyId) return;
    setSaving(true);
    try {
      await api.post('/notifications', { companyId: selectedCompanyId, email: inputEmail });
      setInputEmail('');
      fetchEmails();
    } catch (err: any) { alert(err.error || 'Erro ao salvar e-mail.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/notifications/${id}`);
      fetchEmails();
    } catch (err: any) { alert(err.error || 'Erro ao remover.'); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notificações e Alertas</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie quem recebe e-mails de entrada de novos Visitantes ou Prestadores.</p>
        </div>
      </div>

      <Card className="p-6 space-y-6">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          {profile.role === 'master' && (
            <div className="flex-1 min-w-[200px]">
              <Select label="Filial / Base Operacional" value={selectedCompanyId} onChange={setSelectedCompanyId} required>
                <option value="">Selecione a empresa...</option>
                <CompanySelectOptions companies={companies} />
              </Select>
            </div>
          )}
          <div className="flex-1 min-w-[200px]">
             <Input label="E-mail" type="email" placeholder="nome@empresa.com.br" value={inputEmail} onChange={setInputEmail} required />
          </div>
          <Button type="submit" disabled={saving || !selectedCompanyId || !inputEmail}>
            <Plus size={16} /> Adicionar
          </Button>
        </form>

        <div className="border-t border-slate-100 pt-6">
          {loading ? (
            <div className="py-8 flex justify-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : emails.length === 0 ? (
            <EmptyState icon={Mail} title="Nenhum e-mail cadastrado" subtitle="Adicione endereços de e-mail acima para começar a receber os alertas desta unidade." />
          ) : (
            <div className="space-y-3">
              {emails.map(email => (
                <div key={email.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Mail size={16} /></div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{email.email}</p>
                      {profile.role === 'master' && (
                         <p className="text-[10px] text-slate-400">Unidade ID: {email.companyId}</p>
                      )}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(email.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function LogsView() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const data = await api.get<SystemLog[]>('/logs');
      setLogs(data || []);
    } catch (e: any) {
      alert(e.error || 'Erro ao carregar logs.');
    } finally {
      setLoading(false);
    }
  };

  const parseAction = (action: string) => {
    switch (action) {
      case 'PESSOA_CRIADA': return { label: 'Cadastro Realizado', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
      case 'PESSOA_ATUALIZADA': return { label: 'Cadastro Atualizado', color: 'bg-blue-100 text-blue-700 border-blue-200' };
      case 'PESSOA_EXCLUIDA': return { label: 'Cadastro Excluído', color: 'bg-red-100 text-red-700 border-red-200' };
      case 'ENTRADA': return { label: 'Entrada na Unidade', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
      case 'SAIDA': return { label: 'Saída Registrada', color: 'bg-amber-100 text-amber-700 border-amber-200' };
      default: return { label: action, color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }
  };

  const filtered = logs.filter(l => 
    !search || 
    (l.user_name || '').toLowerCase().includes(search.toLowerCase()) || 
    (l.details?.pessoa_nome || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="text-blue-600" /> Auditoria de Logs
          </h1>
          <p className="text-sm text-slate-500 mt-1">Monitore e rastreie todas as atividades críticas realizadas no sistema.</p>
        </div>
        <Button variant="ghost" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </Button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          placeholder="Buscar por Operador (Usuário) ou Nome da Pessoa afetada..."
          className="w-full pl-9 pr-3 py-3 rounded-xl border border-slate-200 shadow-sm bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" 
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Data / Hora</th>
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Operador Responsável</th>
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Ação / Evento</th>
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest max-w-sm">Detalhes / Permanência</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(log => {
                const actionConf = parseAction(log.action);
                const dt = new Date(log.timestamp);
                
                return (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-slate-700">{format(dt, 'dd/MM/yyyy')}</div>
                      <div className="text-xs font-bold text-slate-400 tracking-wider flex items-center gap-1 mt-0.5">
                        <Clock size={10} /> {format(dt, 'HH:mm:ss')}
                      </div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-slate-800">{log.user_name || 'Usuário Removido'}</div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={cn('text-[10px] font-black uppercase tracking-wider border px-2.5 py-1 rounded-full', actionConf.color)}>
                        {actionConf.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 max-w-sm">
                      {log.details && (
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 group-hover:bg-white group-hover:shadow-sm transition-all text-sm">
                          {log.details.pessoa_nome && (
                            <p className="font-semibold text-slate-700 truncate line-clamp-1" title={log.details.pessoa_nome}>
                              🙎‍♂️ <span className="font-bold underline decoration-slate-300 underline-offset-2">{log.details.pessoa_nome}</span>
                            </p>
                          )}
                          {log.details.documento && (
                            <p className="text-xs text-slate-500 font-mono mt-1">Doc: {log.details.documento}</p>
                          )}
                          {log.details.duracao && (
                            <div className="mt-2 text-xs font-bold flex items-center gap-1.5 text-blue-700 drop-shadow-sm">
                              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                              DURAÇÃO NA OPERAÇÃO: {log.details.duracao}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && (
            <div className="p-12 text-center">
              <EmptyState icon={ClipboardList} title="Sem registros" subtitle="Nenhuma ação foi registrada ainda ou corresponde à sua busca." />
            </div>
          )}
          {loading && (
             <div className="flex justify-center p-8">
               <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
             </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Patrimonios (NFC) ────────────────────────────────────────────────────────
function PatrimoniosView({ profile, companies }: { profile: UserProfile, companies: Company[] }) {
  const [patrimonios, setPatrimonios] = useState<Patrimonio[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState<Partial<Patrimonio>>({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<PatrimonioLog[]>([]);

  useEffect(() => { fetchPatrimonios(); }, []);

  const fetchPatrimonios = async () => {
    try {
      setLoading(true);
      const data = await api.get<Patrimonio[]>('/patrimonios');
      setPatrimonios(data || []);
    } catch (e: any) { alert(e.error || 'Erro ao carregar patrimônios.'); }
    finally { setLoading(false); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current.serial_number || !current.descricao || !current.proprietario) return;
    setSaving(true);
    try {
      if (current.id) {
        await api.put(`/patrimonios/${current.id}`, {
          companyId: current.company_id, 
          nfcTag: current.serial_number, // Usa o S/N como a tag para o backend
          descricao: current.descricao, 
          proprietario: current.proprietario, 
          setor: current.setor,
          marca: current.marca,
          serialNumber: current.serial_number,
          liberadoAte: current.liberado_ate,
          statusAcesso: current.status_acesso || 'liberado'
        });
      } else {
        await api.post('/patrimonios', {
          companyId: current.company_id || (profile.role !== 'master' ? profile.companyId : undefined),
          nfcTag: current.serial_number, // Usa o S/N como a tag para o backend
          descricao: current.descricao, 
          proprietario: current.proprietario, 
          setor: current.setor,
          marca: current.marca,
          serialNumber: current.serial_number,
          liberadoAte: current.liberado_ate,
          statusAcesso: current.status_acesso || 'liberado'
        });
      }
      setModalOpen(false);
      fetchPatrimonios();
    } catch (e: any) { alert(e.error || 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/patrimonios/${deleteId}`);
      setDeleteId(null);
      fetchPatrimonios();
    } catch (e: any) { alert(e.error || 'Erro ao excluir.'); }
  };

  const fetchLogs = async () => {
    try {
      const data = await api.get<PatrimonioLog[]>('/patrimonios/logs');
      setLogs(data || []);
      setLogsOpen(true);
    } catch (e: any) { alert(e.error || 'Erro ao carregar histórico.'); }
  };

  const filtered = patrimonios.filter(p => 
    !search || 
    p.descricao.toLowerCase().includes(search.toLowerCase()) || 
    p.proprietario.toLowerCase().includes(search.toLowerCase()) || 
    (p.serial_number || p.nfc_tag).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Briefcase className="text-blue-600" /> Gestão de Patrimônios (NFC)
          </h1>
          <p className="text-sm text-slate-500 mt-1">Cadastre e gerencie dispositivos móveis (Celulares, Notebooks, Tablets) da empresa.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={fetchLogs}><ClipboardList size={16} /> Histórico Geral</Button>
          <Button onClick={() => { setCurrent({ status_acesso: 'liberado' }); setModalOpen(true); }}><Plus size={16} /> Novo Patrimônio</Button>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por descrição, proprietário ou tag..." className="w-full pl-9 pr-3 py-3 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Dispositivo</th>
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Proprietário / Área</th>
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Número de Série</th>
                {profile.role === 'master' && <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Empresa</th>}
                <th className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="text-right px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-5 py-4 text-sm font-bold text-slate-800">{p.descricao}</td>
                  <td className="px-5 py-4 text-sm font-semibold text-slate-600">{p.proprietario}</td>
                  <td className="px-5 py-4 text-sm font-mono text-slate-500">{p.serial_number || p.nfc_tag}</td>
                  {profile.role === 'master' && <td className="px-5 py-4 text-xs text-slate-500">{p.company_name || 'Todas'}</td>}
                  <td className="px-5 py-4">
                    <StatusBadge status={p.status_acesso} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setCurrent(p); setModalOpen(true); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={16} /></button>
                      <button onClick={() => setDeleteId(p.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>}
          {!loading && filtered.length === 0 && <EmptyState icon={Briefcase} title="Nenhum patrimônio encontrado" />}
        </div>
      </Card>

      <AnimatePresence>
        {modalOpen && (
          <Modal title={current.id ? 'Editar Patrimônio' : 'Novo Patrimônio'} onClose={() => setModalOpen(false)} size="lg">
            <form onSubmit={handleSave} className="space-y-6">
              {profile.role === 'master' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Empresa (Opcional)</label>
                  <select 
                    value={current.company_id || ''} 
                    onChange={e => setCurrent({ ...current, company_id: e.target.value })}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-sm font-medium"
                  >
                    <option value="">Todas (Global)</option>
                    <CompanySelectOptions companies={companies} />
                  </select>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Número de Série (S/N)" value={current.serial_number || ''} onChange={v => setCurrent({ ...current, serial_number: v })} placeholder="Ex: PE0A0H10" required />
                <Input label="Descrição do Dispositivo" value={current.descricao || ''} onChange={v => setCurrent({ ...current, descricao: v })} placeholder="Ex: Notebook Dell Latitude" required />
                <Input label="Funcionário / Proprietário" value={current.proprietario || ''} onChange={v => setCurrent({ ...current, proprietario: v })} placeholder="Nome completo do colaborador" required />
                <Input label="Setor / Área" value={current.setor || ''} onChange={v => setCurrent({ ...current, setor: v })} placeholder="Ex: Logística, TI, RH" />
                <Input label="Marca do Equipamento" value={current.marca || ''} onChange={v => setCurrent({ ...current, marca: v })} placeholder="Ex: Dell, Apple, Samsung" />
                <Input label="Liberado Até" type="date" value={current.liberado_ate ? current.liberado_ate.split('T')[0] : ''} onChange={v => setCurrent({ ...current, liberado_ate: v })} />
                
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Status de Acesso</label>
                  <select 
                    value={current.status_acesso || 'liberado'} 
                    onChange={e => setCurrent({ ...current, status_acesso: e.target.value as 'liberado' | 'bloqueado' })}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-sm font-medium"
                  >
                    <option value="liberado">Liberado</option>
                    <option value="bloqueado">Bloqueado</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="ghost" className="flex-1 h-12 rounded-xl" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button type="submit" variant="primary" className="flex-1 h-12 rounded-xl shadow-xl shadow-blue-500/20" disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar Patrimônio'}
                </Button>
              </div>
            </form>
          </Modal>
        )}

        {deleteId && (
          <ConfirmModal title="Excluir Patrimônio" message="Tem certeza que deseja remover este dispositivo? Os logs de acesso não serão apagados, mas a tag não será mais reconhecida." onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
        )}

        {logsOpen && (
          <Modal title="Histórico Geral de Patrimônios" onClose={() => setLogsOpen(false)} size="lg">
            <div className="max-h-[60vh] overflow-y-auto no-scrollbar space-y-3">
              {logs.length === 0 ? <p className="text-center text-slate-500 py-10">Nenhum log encontrado.</p> :
                logs.map(log => (
                  <div key={log.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full', 
                          log.acao === 'entrada' ? 'bg-indigo-100 text-indigo-700' :
                          log.acao === 'saida' ? 'bg-amber-100 text-amber-700' :
                          log.acao === 'bloqueado' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-700'
                        )}>{log.acao}</span>
                        <span className="text-xs text-slate-400 font-mono">{fmtDate(log.timestamp)} às {new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="font-bold text-sm text-slate-800 mt-1">{log.descricao || 'Dispositivo Desconhecido'}</p>
                      <p className="text-xs text-slate-500">
                        Proprietário: {log.proprietario || '—'} | Porteiro: {log.porteiro_nome || 'Sistema'}
                        {log.duracao && <span className="ml-2 font-bold text-blue-600">| Tempo: {log.duracao}</span>}
                      </p>
                    </div>
                  </div>
                ))
              }
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function NFCScannerView() {
  const [patrimonios, setPatrimonios] = useState<Patrimonio[]>([]);
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [assetData, setAssetData] = useState<{
    patrimonio: Patrimonio;
    ultimoEstado: 'entrada' | 'saida';
    ultimaData: string | null;
  } | null>(null);
  
  const [result, setResult] = useState<{ success: boolean, message: string, acao?: string, duracao?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Web NFC States
  const [nfcSupported, setNfcSupported] = useState(false);
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'scanning' | 'error'>('idle');

  useEffect(() => {
    if ('NDEFReader' in window) {
      setNfcSupported(true);
    }
  }, []);

  const startNfcScan = async () => {
    if (!('NDEFReader' in window)) return;
    try {
      setNfcStatus('scanning');
      const ndef = new (window as any).NDEFReader();
      await ndef.scan();
      
      ndef.addEventListener("readingerror", () => {
        setResult({ success: false, message: 'Erro ao ler a Tag NFC. Aproxime novamente.' });
        setTimeout(() => setResult(null), 3000);
      });

      ndef.addEventListener("reading", (event: any) => {
        let tagData = event.serialNumber; // Fallback para o UID do cartão
        
        try {
          const decoder = new TextDecoder();
          for (const record of event.message.records) {
            if (record.recordType === "text") {
              const text = decoder.decode(record.data);
              // Tenta extrair N/S: XXXXXXX
              const match = text.match(/N\/S:\s*([A-Za-z0-9_-]+)/i);
              if (match && match[1]) {
                tagData = match[1];
                break;
              } else {
                // Se não tiver N/S:, mas o texto for curto, pode ser o próprio ID
                if (text.length < 20 && !text.includes('\n')) {
                  tagData = text.trim();
                }
              }
            }
          }
        } catch (e) {
          console.error('Erro ao decodificar NDEF', e);
        }

        if (tagData) {
          // Usamos um pequeno hack para fazer a submissão logo em seguida
          setTag(tagData);
          // Chamamos a API de busca diretamente para evitar problemas de concorrência com o estado
          handleSearchFromNFC(tagData);
        }
      });
    } catch (error) {
      console.error(error);
      setNfcStatus('error');
      setResult({ success: false, message: 'Permissão NFC negada ou indisponível.' });
      setTimeout(() => setResult(null), 3000);
    }
  };

  const handleSearchFromNFC = async (tagValue: string) => {
    if (!tagValue.trim()) return;
    setLoading(true);
    setResult(null);
    setAssetData(null);
    try {
      const res = await api.get<any>(`/patrimonios/tag/${tagValue.trim()}`);
      setAssetData(res);
    } catch (e: any) {
      setResult({ success: false, message: e.error || 'Erro ao consultar tag NFC.' });
      setTimeout(() => { setResult(null); setTag(''); }, 4000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const focusTimer = setInterval(() => {
      if (document.activeElement !== inputRef.current && !assetData && !result) {
        inputRef.current?.focus();
      }
    }, 1000);
    return () => clearInterval(focusTimer);
  }, [assetData, result]);

  const fetchStats = async () => {
    try {
      const data = await api.get<Patrimonio[]>('/patrimonios');
      setPatrimonios(data || []);
    } catch {}
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tag.trim()) return;
    
    setLoading(true);
    setResult(null);
    setAssetData(null);
    try {
      const res = await api.get<any>(`/patrimonios/tag/${tag.trim()}`);
      setAssetData(res);
    } catch (e: any) {
      setResult({ success: false, message: e.error || 'Erro ao consultar tag NFC.' });
      setTimeout(() => { setResult(null); setTag(''); }, 4000);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (acao: 'entrada' | 'saida') => {
    if (!assetData) return;
    setLoading(true);
    try {
      const res = await api.post<any>('/patrimonios/scan', { nfcTag: tag, acao });
      setResult({
        success: true,
        message: acao === 'entrada' ? 'Entrada Registrada' : 'Saída Registrada',
        acao: res.acao,
        duracao: res.duracao
      });
      setAssetData(null);
      setTag('');
      fetchStats(); // Update stats after action
      setTimeout(() => { setResult(null); }, 5000);
    } catch (e: any) {
      setResult({ success: false, message: e.error || 'Erro ao registrar ação.' });
      setTimeout(() => setResult(null), 4000);
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    naOperacao: patrimonios.filter(p => p.ultimo_estado === 'entrada').length,
    fora: patrimonios.filter(p => p.ultimo_estado !== 'entrada').length,
    total: patrimonios.length
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col min-h-[calc(100vh-140px)]">
      {/* Header matching Portaria */}
      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Patrimônio</h1>
        <p className="text-sm text-slate-500 mt-1">Identifique e registre a entrada/saída de dispositivos CTDI.</p>
      </div>

      {/* Stats Grid matching Portaria */}
      <div className="grid grid-cols-3 gap-4 mb-8 shrink-0">
        {[
          { label: 'Na Operação', count: stats.naOperacao, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { label: 'Fora', count: stats.fora, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
          { label: 'Total Cadastrados', count: stats.total, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
        ].map(s => (
          <div key={s.label} className={cn('p-4 rounded-2xl border transition-all shadow-sm', s.border, s.bg)}>
            <p className={cn('text-3xl font-black', s.color)}>{s.count}</p>
            <p className={cn('text-sm font-medium mt-0.5', s.color)}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Main Action Area */}
      <div className="flex-1 flex flex-col justify-center items-center pb-10">
        <Card className="w-full max-w-xl relative overflow-hidden border-none shadow-2xl shadow-slate-200/50 bg-white/80 backdrop-blur-xl rounded-[2.5rem]">
          {/* Subtle decorative elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-sky-50 rounded-full blur-3xl -ml-16 -mb-16 pointer-events-none" />

          <div className="p-6 md:p-10 relative z-10">
            {!assetData && !result && (
              <motion.form 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                onSubmit={handleSearch} className="space-y-6 md:space-y-8"
              >
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 mb-2">
                    <div className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest">Aguardando Leitura</div>
                    <h2 className="text-lg font-bold text-slate-800">Aproxime o dispositivo ou digite</h2>
                  </div>
                  
                  <div className="relative group">
                    <input
                      ref={inputRef}
                      type="text"
                      value={tag}
                      onChange={e => setTag(e.target.value)}
                      placeholder="TAG / SERIAL"
                      className="w-full text-center text-3xl font-black font-mono h-24 rounded-[1.5rem] border-4 border-slate-100 bg-slate-50/50 focus:border-blue-500 focus:bg-white focus:ring-8 focus:ring-blue-500/5 transition-all outline-none placeholder:text-slate-200"
                      autoFocus
                      disabled={loading}
                    />
                  </div>
                  
                  {nfcSupported && (
                    <div className="flex justify-center mt-2">
                      <Button 
                        variant={nfcStatus === 'scanning' ? 'success' : 'primary'} 
                        onClick={startNfcScan}
                        disabled={nfcStatus === 'scanning' || loading}
                        className="rounded-full px-6 shadow-md"
                      >
                        {nfcStatus === 'scanning' ? 'Leitor NFC Ativo' : 'Ativar Leitor NFC (Celular)'}
                      </Button>
                    </div>
                  )}
                </div>
                
                {loading && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-widest">Processando...</span>
                  </div>
                )}
              </motion.form>
            )}

            <AnimatePresence mode="wait">
              {assetData && !result && (
                <motion.div
                  initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                  className="space-y-6 md:space-y-8"
                >
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 md:p-8 rounded-[2rem] text-white shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <LayoutGrid size={80} />
                    </div>
                    <div className="relative z-10 space-y-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter",
                            assetData.ultimoEstado === 'entrada' ? "bg-emerald-500 text-white" : "bg-blue-500 text-white"
                          )}>
                            {assetData.ultimoEstado === 'entrada' ? 'NA OPERAÇÃO' : 'FORA'}
                          </span>
                          {assetData.patrimonio.liberado_ate && (
                            <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold">Até {fmtDate(assetData.patrimonio.liberado_ate)}</span>
                          )}
                        </div>
                        <h2 className="text-3xl font-black leading-tight truncate">{assetData.patrimonio.descricao}</h2>
                        <p className="text-slate-400 font-medium truncate">{assetData.patrimonio.marca} | S/N: {assetData.patrimonio.serial_number || 'N/A'}</p>
                      </div>
                      
                      <div className="pt-4 border-t border-white/10 flex flex-col gap-1">
                        <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Colaborador</p>
                        <p className="text-xl font-bold truncate">{assetData.patrimonio.proprietario}</p>
                        <p className="text-sm text-blue-400 font-semibold truncate">{assetData.patrimonio.setor}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:gap-4">
                    {assetData.ultimoEstado === 'saida' ? (
                      <button
                        onClick={() => handleConfirm('entrada')}
                        disabled={loading}
                        className="group relative h-16 md:h-20 rounded-[1.5rem] bg-blue-600 hover:bg-blue-700 text-white font-black text-base md:text-lg transition-all shadow-xl shadow-blue-600/30 overflow-hidden active:scale-95"
                      >
                        <div className="flex items-center justify-center gap-3">
                          <ArrowRightCircle size={28} />
                          CONFIRMAR ENTRADA
                        </div>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConfirm('saida')}
                        disabled={loading}
                        className="group relative h-16 md:h-20 rounded-[1.5rem] bg-amber-500 hover:bg-amber-600 text-white font-black text-base md:text-lg transition-all shadow-xl shadow-amber-500/30 overflow-hidden active:scale-95"
                      >
                        <div className="flex items-center justify-center gap-3">
                          <ArrowLeftCircle size={28} />
                          CONFIRMAR SAÍDA
                        </div>
                      </button>
                    )}
                    
                    <button 
                      onClick={() => { setAssetData(null); setTag(''); }} 
                      className="h-12 md:h-14 rounded-[1.2rem] text-slate-400 font-bold hover:bg-slate-50 transition-all uppercase text-xs tracking-widest"
                    >
                      Cancelar Leitura
                    </button>
                  </div>
                </motion.div>
              )}

              {result && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "p-10 rounded-[2.5rem] text-center space-y-6 shadow-2xl",
                    result.success 
                      ? (result.acao === 'entrada' ? 'bg-blue-50 text-blue-900 border border-blue-100' : 'bg-amber-50 text-amber-900 border border-amber-100') 
                      : 'bg-red-50 text-red-900 border border-red-100'
                  )}
                >
                  <motion.div initial={{ rotate: -15, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring" }}>
                    {result.success ? (
                      <CheckCircle2 size={80} className={result.acao === 'entrada' ? 'text-blue-600 mx-auto' : 'text-amber-500 mx-auto'} />
                    ) : (
                      <XCircle size={80} className="text-red-600 mx-auto" />
                    )}
                  </motion.div>
                  
                  <div>
                    <h3 className="text-3xl font-black tracking-tight">{result.message}</h3>
                    {result.duracao && (
                      <div className="mt-6 pt-6 border-t border-amber-200/50">
                        <p className="text-amber-800/60 font-black uppercase text-[10px] tracking-widest mb-1">Tempo na Operação</p>
                        <p className="text-5xl font-black font-mono text-amber-600">{result.duracao}</p>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-4">
                     <button onClick={() => { setResult(null); setTag(''); }} className="px-8 py-3 bg-white rounded-full shadow-sm text-xs font-black uppercase tracking-widest border border-slate-100">Próximo</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
        
        {!assetData && !result && (
          <p className="text-center mt-6 text-slate-400 text-[10px] font-bold uppercase tracking-widest opacity-50">Sistema Automático de Foco Ativado</p>
        )}
      </div>

      {/* Dispositivos na Operação */}
      <div className="pb-10 w-full">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Briefcase className="text-emerald-600" size={20} />
          Dispositivos na Operação
        </h3>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Dispositivo</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Proprietário / Setor</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Número de Série</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {patrimonios.filter(p => p.ultimo_estado === 'entrada').map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold text-slate-800">{p.descricao}</p>
                      <p className="text-xs text-slate-500">{p.marca || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-700">{p.proprietario}</p>
                      <p className="text-xs text-slate-500">{p.setor || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-500">
                      {p.serial_number || p.nfc_tag}
                    </td>
                    <td className="px-4 py-3">
                      <OnSitePulse />
                    </td>
                  </tr>
                ))}
                {patrimonios.filter(p => p.ultimo_estado === 'entrada').length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">
                      Nenhum dispositivo na operação no momento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Romaneios ───────────────────────────────────────────────────────────────

interface RomaneioItem { descricao: string; quantidade: number; }
interface Romaneio {
  id: string; tipo: string; empresa: string; motivo?: string;
  solicitante_nome: string; aprovador_nome?: string; vigilante_nome?: string;
  status: 'pendente' | 'aprovado' | 'na_operacao' | 'concluido' | 'rejeitado';
  created_at: string; approved_at?: string; entrada_at?: string; completed_at?: string;
  items: RomaneioItem[];
  pdf_url?: string;
  codigo_sequencial?: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pendente:    { label: 'Aguardando Aprovação', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  aprovado:    { label: 'Aprovado / Aguard. Entrada', color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200'  },
  na_operacao: { label: 'Em Operação / No Pátio', color: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200'},
  concluido:   { label: 'Concluído / Saída Realizada', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  rejeitado:   { label: 'Rejeitado',            color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200'   },
};

function RomaneioStatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] || STATUS_LABELS.pendente;
  return (
    <span className={cn('px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border', s.color, s.bg, s.border)}>
      {s.label}
    </span>
  );
}

function RomaneiosView({ profile }: { profile: UserProfile }) {
  const [romaneios, setRomaneios] = useState<Romaneio[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Romaneio | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('');
  const [vigilanteNome, setVigilanteNome] = useState('');

  const isAdmin = profile.role === 'master' || profile.role === 'admin';
  const isPortaria = profile.role === 'portaria' || profile.role === 'viewer' || profile.role === 'master' || profile.role === 'admin';

  const fetchRomaneios = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Romaneio[]>('/romaneios');
      setRomaneios(data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!activeFilter) {
      if (isAdmin) setActiveFilter('pendente');
      else if (isPortaria) setActiveFilter('aprovado');
      else setActiveFilter('all');
    }
  }, [isAdmin, isPortaria, activeFilter]);

  useEffect(() => { fetchRomaneios(); }, [fetchRomaneios]);

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try { await api.put(`/romaneios/${id}/approve`, {}); fetchRomaneios(); setDetail(null); }
    catch {} finally { setActionLoading(false); }
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try { await api.put(`/romaneios/${id}/reject`, {}); fetchRomaneios(); setDetail(null); }
    catch {} finally { setActionLoading(false); }
  };

  const handleComplete = async (id: string, currentStatus: string) => {
    if (actionLoading) return;
    // Só exige nome se estiver dando entrada. Na saída, usa o que já foi registrado.
    if (currentStatus === 'aprovado' && !vigilanteNome.trim()) {
      alert('Por favor, insira o nome do vigilante responsável pela entrada.');
      return;
    }

    setActionLoading(true);
    let loc = 'PORTARIA CTDI';

    try {
      if ('geolocation' in navigator) {
        const pos = await new Promise<GeolocationPosition>((res, rej) => {
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 });
        }).catch(() => null);
        if (pos) loc = `${pos.coords.latitude},${pos.coords.longitude}`;
      }

      await api.put(`/romaneios/${id}/complete`, { vigilanteNome, localizacao: loc }); 
      fetchRomaneios(); 
      setDetail(null);
      setVigilanteNome('');
    }
    catch (err: any) { alert(err.error || 'Erro ao processar.'); }
    finally { setActionLoading(false); }
  };

  const pendentes = romaneios.filter(r => r.status === 'pendente');
  const aprovados = romaneios.filter(r => r.status === 'aprovado' || r.status === 'na_operacao');
  const concluidos = romaneios.filter(r => r.status === 'concluido');

  const filteredRomaneios = romaneios.filter(r => {
    if (activeFilter === 'pendente') return r.status === 'pendente';
    if (activeFilter === 'aprovado') return r.status === 'aprovado' || r.status === 'na_operacao';
    if (activeFilter === 'concluido') return r.status === 'concluido';
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="text-blue-600" size={24} />
            Romaneios de Materiais
          </h1>
          <p className="text-sm text-slate-500 mt-1">Gestão, assinaturas e controle de fluxo (F-5000341)</p>
        </div>
        <button onClick={fetchRomaneios} className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all" title="Atualizar">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { id: 'pendente', label: 'Pendentes (Gestão)', count: pendentes.length, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
          { id: 'aprovado', label: 'Aguardando Portaria', count: aprovados.length, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
          { id: 'concluido', label: 'Concluídos', count: concluidos.length, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveFilter(s.id)} 
            className={cn('p-4 rounded-2xl border shadow-sm text-left transition-all relative overflow-hidden group active:scale-95', 
              s.bg, s.border, activeFilter === s.id ? 'ring-2 ring-offset-2 ring-blue-500 scale-[1.02]' : 'opacity-70 grayscale-[0.3] hover:opacity-100 hover:grayscale-0')}>
            <p className={cn('text-3xl font-black', s.color)}>{s.count}</p>
            <p className={cn('text-[10px] font-black uppercase tracking-wider mt-0.5 opacity-60', s.color)}>{s.label}</p>
            {activeFilter === s.id && (
              <motion.div layoutId="active-dot" className={cn("absolute top-3 right-3 w-2 h-2 rounded-full", s.color.replace('text', 'bg'))} />
            )}
          </button>
        ))}
      </div>

      {isAdmin && pendentes.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-4 bg-amber-50 border border-amber-200 rounded-3xl">
          <div className="w-10 h-10 rounded-xl bg-amber-200 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-black text-amber-900">Ação Necessária</p>
            <p className="text-xs text-amber-700 font-medium">{pendentes.length} romaneio{pendentes.length > 1 ? 's' : ''} aguardando sua assinatura digital para liberação.</p>
          </div>
        </div>
      )}

      <Card className="overflow-hidden shadow-2xl shadow-slate-200/50">
        {loading ? (
          <div className="p-20 text-center">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">Carregando...</p>
          </div>
        ) : romaneios.length === 0 ? (
          <div className="p-20 text-center text-slate-500">
            <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-slate-100">
              <FileText size={32} className="opacity-20" />
            </div>
            <p className="font-bold text-slate-900">Nenhum romaneio ativo</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">Novas solicitações criadas no portal de acesso aparecerão aqui para gestão.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filteredRomaneios.sort((a,b) => (b.codigo_sequencial || 0) - (a.codigo_sequencial || 0)).map(r => (
              <button key={r.id} onClick={() => setDetail(r)}
                className="w-full text-left px-6 py-5 hover:bg-slate-50/80 transition-colors group relative overflow-hidden">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">#{r.codigo_sequencial || '—'}</span>
                      {r.status === 'concluido' && (
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider',
                          r.tipo === 'entrada' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700')}>
                          {r.tipo === 'entrada' ? '↓ Entrada' : '↑ Saída'}
                        </span>
                      )}
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{r.empresa}</span>
                    </div>
                    <p className="font-black text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{r.solicitante_nome}</p>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <Clock size={12} /> {format(parseISO(r.created_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                      <span className="opacity-30">|</span>
                      {r.items.length} {r.items.length === 1 ? 'item' : 'itens'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <RomaneioStatusBadge status={r.status} />
                    <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {detail && (
        <Modal title={`Controle de Romaneio #${detail.codigo_sequencial || '—'}`} onClose={() => setDetail(null)} size="lg">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-5">
              <RomaneioStatusBadge status={detail.status} />
              <div className="h-4 w-px bg-slate-200" />
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{detail.empresa}</span>
              {detail.status === 'concluido' && (
                <span className={cn('px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm',
                  detail.tipo === 'entrada' ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white')}>
                  EFETIVADO: {detail.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA'}
                </span>
              )}
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                { step: '1ª', label: 'Solicitante', name: detail.solicitante_nome, date: detail.created_at, ok: true },
                { step: '2ª', label: 'Gestor (Admin)', name: detail.aprovador_nome, date: detail.approved_at, ok: !!detail.aprovador_nome },
                { step: '3ª', label: 'Portaria (Check)', name: detail.vigilante_nome, date: detail.completed_at, ok: !!detail.vigilante_nome },
              ].map((s, i) => (
                <div key={i} className={cn('p-4 rounded-2xl border transition-all', s.ok ? 'bg-emerald-50/30 border-emerald-100' : 'bg-slate-50/50 border-slate-100')}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.step} Assinatura</span>
                    {s.ok ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Clock size={16} className="text-slate-300" />}
                  </div>
                  <p className="text-[10px] font-black text-slate-500 uppercase mb-1">{s.label}</p>
                  <p className={cn("text-xs font-black truncate", s.ok ? "text-slate-800" : "text-slate-400 italic")}>
                    {s.name || 'Pendente...'}
                  </p>
                  {s.date && <p className="text-[10px] text-slate-400 font-bold mt-1">{format(parseISO(s.date), "dd/MM/yy HH:mm")}</p>}
                </div>
              ))}
            </div>

            {detail.motivo && (
              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Motivo / Observações</p>
                <p className="text-xs text-blue-900 leading-relaxed font-medium">{detail.motivo}</p>
              </div>
            )}

            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <LayoutGrid size={14} /> Itens do Romaneio
              </p>
              <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-5 py-3 font-black text-slate-400 uppercase tracking-widest">Descrição do Material</th>
                      <th className="text-center w-24 px-5 py-3 font-black text-slate-400 uppercase tracking-widest">Qtd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {detail.items.map((item, i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3.5 text-slate-700 font-black">{item.descricao}</td>
                        <td className="px-5 py-3.5 text-center font-black text-slate-900 bg-slate-50/30">{item.quantidade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              {isAdmin && detail.status === 'pendente' && (
                <div className="flex gap-3">
                  <button onClick={() => handleReject(detail.id)} disabled={actionLoading}
                    className="flex-1 py-4 border-2 border-red-100 text-red-500 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-red-50 transition-all">
                    Rejeitar
                  </button>
                  <button onClick={() => handleApprove(detail.id)} disabled={actionLoading}
                    className="flex-1 py-4 bg-emerald-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-500/20">
                    ✓ Assinar e Autorizar
                  </button>
                </div>
              )}

              {detail.pdf_url && detail.status === 'concluido' && (
                <a 
                  href={`/api/romaneios/${detail.id}/pdf`} 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-12 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <FileDown size={18} /> Baixar Romaneio Final Assinado (PDF)
                </a>
              )}
              
              <div className="mt-8 space-y-4">
                {isPortaria && detail.status === 'aprovado' && (
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Identificação do Vigilante (Assinatura Digital)</p>
                    <input 
                      type="text" 
                      placeholder="Nome completo do Vigilante" 
                      value={vigilanteNome} 
                      onChange={e => setVigilanteNome(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>
                )}

                <div className="flex gap-3">
                  {isPortaria && detail.status === 'aprovado' && (
                    <button onClick={() => handleComplete(detail.id, detail.status)} disabled={actionLoading || !vigilanteNome.trim()}
                      className="flex-1 h-12 bg-emerald-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-50">
                      {actionLoading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <><ArrowRightCircle size={18} /> Confirmar Entrada</>
                      )}
                    </button>
                  )}
                  {isPortaria && detail.status === 'na_operacao' && (
                    <button onClick={() => handleComplete(detail.id, detail.status)} disabled={actionLoading}
                      className="flex-1 h-12 bg-amber-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50">
                      {actionLoading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <><ArrowLeftCircle size={18} /> Confirmar Saída de Material</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Rejeição Romaneio */}
    </div>
  );
}
