import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowRight, ArrowUpRight, BookOpen, Boxes, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Coins, Copy, Cpu, CreditCard,
  Gauge, KeyRound, LayoutDashboard, LoaderCircle, LogOut, Menu, Moon, Network, Plus, RefreshCw, Search,
  Settings2, ShieldCheck, Sun, TerminalSquare, Trash2, X, Zap,
} from 'lucide-react';
import {
  getGetCreditsQueryKey, getGetCurrentUserQueryKey, getGetDashboardQueryKey,
  getGetRoutingSettingsQueryKey, getListApiKeysQueryKey, getListModelsQueryKey,
  getHealthCheckQueryKey, getListProvidersQueryKey, getListUsageQueryKey, useCreateApiKey, useCreateModel,
  useCreateProvider, useDeleteModel, useDeleteProvider, useGetCredits,
  useGetCurrentUser, useGetDashboard, useGetRoutingSettings, useHealthCheck, useListApiKeys,
  useListModels, useListProviders, useListUsage, useRevokeApiKey,
  useSyncProviderModels, useUpdateModel, useUpdateProvider, useUpdateRoutingSettings,
} from '@workspace/api-client-react';
import type {
  ApiKeyCreated, ChatCompletionInput, Model, ModelInput, ModelUpdate,
  Provider, ProviderInput, ProviderUpdate, RoutingSettingsInput, UsageRecord,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function money(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 5 }).format(value);
}

function number(value: number) {
  return new Intl.NumberFormat('id-ID').format(value);
}

function date(value?: string | null) {
  if (!value) return 'Belum pernah';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Permintaan tidak berhasil. Silakan coba lagi.';
}

function useNotice() {
  const [notice, setNotice] = useState('');
  const show = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3600);
  };
  return { notice, show };
}

function Notice({ message }: { message: string }) {
  return message ? <div role="status" className="toast-message" data-testid="status-notice">{message}</div> : null;
}

function Brand({ light = false }: { light?: boolean }) {
  return <span className={`brand-lockup ${light ? 'brand-light' : ''}`}><img src={`${basePath}/logo.svg`} alt="" /><span>kawata<span className="brand-period">.</span></span></span>;
}

function Button({ children, variant = 'quiet', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }) {
  return <button className={`btn btn-${variant} ${className}`} {...props}>{children}</button>;
}

function PageHeading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{kicker}</div><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function EmptyState({ title, detail, icon: Icon = Boxes, action }: { title: string; detail: string; icon?: typeof Boxes; action?: ReactNode }) {
  return <div className="empty-state"><div><span className="empty-mark"><Icon size={16} /></span><strong>{title}</strong><p>{detail}</p>{action}</div></div>;
}

function QueryState({ loading, error, retry, children, label }: { loading: boolean; error: boolean; retry: () => void; children: ReactNode; label: string }) {
  if (loading) return <div className="panel state-panel" aria-label="Memuat"><div className="loading-line" /><div className="loading-line short" /><div className="loading-line medium" /></div>;
  if (error) return <div className="panel"><EmptyState title="Data belum dapat dimuat" detail={`Gagal mengambil ${label} dari server. Coba muat ulang.`} icon={Activity} action={<Button onClick={retry}><RefreshCw size={14} /> Coba lagi</Button>} /></div>;
  return <>{children}</>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal panel" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><div className="eyebrow">KONFIGURASI</div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Tutup" onClick={onClose} data-testid="button-close-dialog"><X size={17} /></button></div>{children}</section></div>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('kawata-theme') === 'dark');
  const { signOut } = useClerk();
  const { user } = useUser();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('kawata-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => setMobileOpen(false), [location]);
  const groups = [
    { label: 'RUANG KERJA', links: [
      { href: '/dashboard', label: 'Ikhtisar', icon: LayoutDashboard },
      { href: '/playground', label: 'Playground', icon: TerminalSquare },
      { href: '/providers', label: 'Provider', icon: Network },
      { href: '/models', label: 'Model', icon: Cpu },
    ] },
    { label: 'OPERASIONAL', links: [
      { href: '/api-keys', label: 'API keys', icon: KeyRound },
      { href: '/usage', label: 'Penggunaan', icon: Activity },
      { href: '/credits', label: 'Kredit', icon: Coins },
      { href: '/routing', label: 'Routing', icon: Settings2 },
    ] },
    { label: 'REFERENSI', links: [{ href: '/docs', label: 'Dokumentasi', icon: BookOpen }] },
  ];
  return <div className="shell">
    {mobileOpen && <button aria-label="Tutup menu" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <Link href="/dashboard" className="side-brand" data-testid="link-brand"><Brand light /><span className="env-tag">CONSOLE</span></Link>
      <div className="workspace-label"><span className="workspace-glyph">K</span><span><b>Workspace pribadi</b><small>Gateway environment</small></span><ChevronDown size={13} /></div>
      <nav className="side-nav">{groups.map((group) => <div className="nav-group" key={group.label}><div className="eyebrow nav-eyebrow">{group.label}</div>{group.links.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`nav-link ${location === href ? 'is-active' : ''}`} data-testid={`link-nav-${href.slice(1)}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{location === href && <span className="nav-active-mark" />}</Link>)}</div>)}</nav>
      <div className="sidebar-bottom">
        <div className="system-note"><span className={`status-dot ${health.data?.status.toLowerCase() === 'healthy' || health.data?.status.toLowerCase() === 'ok' ? 'healthy' : health.isError ? 'unhealthy' : ''}`} /><span>{health.data?.status || (health.isLoading ? 'Memeriksa status gateway' : health.isError ? 'Status gateway tidak tersedia' : 'Status gateway belum diketahui')}</span></div>
        <div className="profile-row"><span className="profile-avatar">{(user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'K').toUpperCase()}</span><span className="profile-copy"><b>{user?.fullName || 'Pengguna'}</b><small>{user?.primaryEmailAddress?.emailAddress}</small></span><button aria-label="Keluar" className="logout-button" onClick={() => void signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={15} /></button></div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar"><button className="mobile-menu" aria-label="Buka menu" onClick={() => setMobileOpen(true)} data-testid="button-menu"><Menu size={19} /></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><b>{groups.flatMap((item) => item.links).find((item) => item.href === location)?.label || 'Konsol'}</b></div><div className="topbar-tools"><span className="region-chip" data-testid="status-gateway"><span className={`status-dot ${health.data?.status.toLowerCase() === 'healthy' || health.data?.status.toLowerCase() === 'ok' ? 'healthy' : health.isError ? 'unhealthy' : ''}`} />{health.data?.status || (health.isLoading ? 'Memeriksa gateway' : health.isError ? 'Gateway tidak tersedia' : 'Status tidak diketahui')}</span><Link href="/docs" className="help-link" data-testid="link-help"><CircleHelp size={16} /></Link><button className="icon-button theme-button" aria-label="Ganti tema" onClick={() => setDark((value) => !value)} data-testid="button-theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button></div></header>
      {children}
    </div>
  </div>;
}

function Protected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => { if (isLoaded && !isSignedIn) setLocation('/sign-in'); }, [isLoaded, isSignedIn, setLocation]);
  if (!isLoaded || !isSignedIn) return <div className="auth-loading"><span className="loading-line" /><span className="loading-line short" /></div>;
  return <AppShell>{children}</AppShell>;
}

function ConsoleRoute({ page }: { page: ReactNode }) {
  return <Protected>{page}</Protected>;
}

function Landing() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => { if (isLoaded && isSignedIn) setLocation('/dashboard'); }, [isLoaded, isSignedIn, setLocation]);
  return <main className="landing">
    <header className="landing-nav"><Link href="/" className="landing-brand" data-testid="link-public-brand"><Brand /></Link><nav><Link href="/docs" data-testid="link-public-docs">Dokumentasi</Link>{isLoaded && isSignedIn ? <Link href="/dashboard" className="btn btn-primary" data-testid="link-open-console">Buka console <ArrowRight size={14} /></Link> : <><Link href="/sign-in" data-testid="link-sign-in">Masuk</Link><Link href="/sign-up" className="btn btn-primary" data-testid="link-sign-up">Mulai sekarang <ArrowRight size={14} /></Link></>}</nav></header>
    <section className="hero landing-grid"><div className="hero-copy fade-in"><div className="hero-label"><span className="status-dot healthy" /> INFERENCE GATEWAY · OPENAI-COMPATIBLE</div><h1>Satu jalur.<br /><span>Banyak model.</span></h1><p>Router AI yang memberi tim kendali nyata atas provider, biaya, dan lalu lintas model — melalui satu API yang sudah Anda kenal.</p><div className="hero-actions"><Link href="/sign-up" className="btn btn-primary" data-testid="link-hero-create">Buat workspace <ArrowRight size={15} /></Link><Link href="/docs" className="btn btn-quiet" data-testid="link-hero-docs">Baca dokumentasi <BookOpen size={14} /></Link></div><div className="hero-footnote"><ShieldCheck size={14} /> API key Anda tetap berada di jalur gateway yang terisolasi.</div></div>
      <div className="hero-visual fade-in"><div className="diagram-top"><span className="eyebrow">REQUEST FLOW</span><span className="mono diagram-id">TRACE / --</span></div><div className="flow-stack"><div className="flow-node client-node"><span className="node-icon"><TerminalSquare size={17} /></span><span><b>Aplikasi Anda</b><small>OpenAI SDK · REST</small></span><span className="node-label">IN</span></div><div className="connector"><span /><i /></div><div className="flow-node router-node"><span className="router-orbit"><Network size={19} /></span><span><b>Kawata Router</b><small>Routing · fallback · observability</small></span><span className="node-label">ROUTE</span></div><div className="provider-branches"><div className="branch-line" /><div className="provider-pills"><span>Provider A</span><span>Provider B</span><span>Provider N</span></div></div></div><div className="diagram-footer"><span><span className="status-dot healthy" /> HEALTH CHECK</span><span className="mono">Satu endpoint, kendali penuh</span></div></div>
    </section>
    <section className="manifesto"><div className="eyebrow">INFRASTRUKTUR YANG TERLIHAT</div><h2>Ketika model berubah,<br />integrasi Anda <em>tetap.</em></h2><p>Ubah konfigurasi dari satu permukaan. Klien tetap berbicara dengan protokol yang sama.</p></section>
    <section className="capabilities"><div className="cap-intro"><div className="eyebrow">DIBUAT UNTUK OPERASIONAL</div><h2>Alat yang dibutuhkan.<br />Tanpa lapisan misteri.</h2></div><div className="cap-list"><article><span className="cap-index">01</span><span className="cap-icon"><Network size={17} /></span><div><h3>Provider yang terhubung</h3><p>Kelola endpoint OpenAI-compatible, kredensial, prioritas, dan penemuan model.</p></div><ArrowUpRight size={15} /></article><article><span className="cap-index">02</span><span className="cap-icon"><Gauge size={17} /></span><div><h3>Routing yang bisa dijelaskan</h3><p>Pilih strategi berdasarkan prioritas, latensi, atau biaya. Tetapkan markup secara eksplisit.</p></div><ArrowUpRight size={15} /></article><article><span className="cap-index">03</span><span className="cap-icon"><Activity size={17} /></span><div><h3>Jejak penggunaan</h3><p>Lihat request, token, latensi, dan biaya per panggilan yang tercatat.</p></div><ArrowUpRight size={15} /></article></div></section>
    <section className="landing-code"><div><div className="eyebrow">MULAI DENGAN SATU PERUBAHAN</div><h2>SDK yang ada.<br />Endpoint yang baru.</h2><p>Base URL diarahkan ke gateway. Bentuk request tetap familiar.</p><Link href="/docs" className="text-link" data-testid="link-read-guide">Lihat panduan integrasi <ArrowRight size={14} /></Link></div><div className="code-window"><div className="code-head"><span className="code-dot" /><span className="code-dot" /><span className="code-dot" /><span className="mono">quickstart.ts</span></div><pre className="code-block"><span className="syntax-faint">import</span> OpenAI <span className="syntax-faint">from</span> <span className="syntax-green">'openai'</span>;<br /><br /><span className="syntax-faint">const</span> client = <span className="syntax-faint">new</span> OpenAI({'{'}<br />  apiKey: process.env.KAWATA_API_KEY,<br />  baseURL: <span className="syntax-green">'https://gateway.your-domain/v1'</span>,<br />{'}'});<br /><br /><span className="syntax-faint">const</span> response = <span className="syntax-faint">await</span> client.chat.completions.create({'{'}<br />  model: <span className="syntax-green">'model-anda'</span>,<br />  messages: [{'{'} role: <span className="syntax-green">'user'</span>, content: <span className="syntax-green">'Halo'</span> {'}'}],<br />{'}'});</pre></div></section>
    <section className="closing-cta"><div className="eyebrow">MULAI DARI PERMUKAAN YANG JELAS</div><h2>Bangun jalur AI<br />yang bisa Anda pahami.</h2><Link href="/sign-up" className="btn btn-primary" data-testid="link-final-sign-up">Buat akun Kawata <ArrowRight size={15} /></Link></section>
    <footer className="landing-footer"><Link href="/" className="landing-brand"><Brand /></Link><span>Control plane untuk inference yang terbuka.</span><span className="mono">© {new Date().getFullYear()} KAWATA</span></footer>
  </main>;
}

function DashboardPage() {
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } });
  const data = dashboard.data;
  const metrics = data ? [
    { label: 'Total request', value: number(data.totalRequests), suffix: 'permintaan' },
    { label: 'Token diproses', value: number(data.totalTokens), suffix: 'token' },
    { label: 'Total biaya', value: money(data.totalSpend), suffix: 'periode berjalan' },
    { label: 'Latensi rata-rata', value: number(data.avgLatencyMs), suffix: 'ms' },
  ] : [];
  return <main className="content-wrap fade-in"><PageHeading kicker="IKHTISAR WORKSPACE" title="Selamat datang kembali." description={`Pantau aktivitas gateway dan kesehatan konfigurasi Anda.${currentUser.data?.displayName ? ` Halo, ${currentUser.data.displayName}.` : ''}`} action={<Link href="/playground" className="btn btn-primary" data-testid="link-try-playground"><TerminalSquare size={14} /> Buka playground</Link>} />
    <QueryState loading={dashboard.isLoading} error={dashboard.isError} retry={() => void dashboard.refetch()} label="ikhtisar">
      {data && <><div className="metrics-grid">{metrics.map((metric) => <div className="panel metric-card" key={metric.label} data-testid={`metric-${metric.label.toLowerCase().replaceAll(' ', '-')}`}><span className="metric-label">{metric.label}</span><strong className="metric-value">{metric.value}</strong><span className="metric-foot">{metric.suffix}</span></div>)}</div>
        <div className="dashboard-grid"><section className="panel chart-panel"><div className="section-head"><div><div className="eyebrow">LALU LINTAS</div><h2>Request harian</h2></div><span className="range-tag">DATA API</span></div>{data.daily.length ? <DailyChart daily={data.daily} /> : <EmptyState title="Belum ada metrik harian" detail="Grafik akan muncul setelah gateway menerima lalu lintas yang tercatat." icon={Activity} />}</section>
        <div className="side-metrics"><div className="panel side-metric"><span className="side-metric-icon"><ShieldCheck size={16} /></span><div><small>Rasio error</small><b>{number(data.errorRate)}%</b></div><span className="side-caption">error tercatat</span></div><div className="panel side-metric"><span className="side-metric-icon"><Network size={16} /></span><div><small>Provider aktif</small><b>{number(data.activeProviders)}</b></div><span className="side-caption">dari konfigurasi</span></div><div className="panel side-metric"><span className="side-metric-icon"><Cpu size={16} /></span><div><small>Model aktif</small><b>{number(data.activeModels)}</b></div><span className="side-caption">tersedia di gateway</span></div><Link href="/credits" className="balance-tile" data-testid="link-dashboard-balance"><span>Saldo kredit</span><b>{money(data.creditBalance)}</b><span>Lihat transaksi <ArrowRight size={12} /></span></Link></div></div>
        <section className="panel recent-panel"><div className="section-head"><div><div className="eyebrow">AKTIVITAS TERBARU</div><h2>Request terakhir</h2></div><Link href="/usage" className="text-link" data-testid="link-all-usage">Semua penggunaan <ArrowRight size={13} /></Link></div><UsageTable items={data.recentUsage} compact /></section>
      </>}
    </QueryState>
  </main>;
}

function DailyChart({ daily }: { daily: { date: string; requests: number; tokens: number; cost: number }[] }) {
  const width = 720, height = 195, padX = 12, padY = 18;
  const max = Math.max(...daily.map((point) => point.requests), 1);
  const coords = daily.map((point, index) => `${padX + (daily.length < 2 ? 0 : index * (width - padX * 2) / (daily.length - 1))},${height - padY - point.requests / max * (height - padY * 2)}`).join(' ');
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik request harian" className="chart-svg"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="hsl(158 47% 39%)" stopOpacity=".22" /><stop offset="1" stopColor="hsl(158 47% 39%)" stopOpacity=".01" /></linearGradient></defs>{[.25, .5, .75, 1].map((step) => <line key={step} x1="0" x2={width} y1={height - padY - (height - padY * 2) * step} y2={height - padY - (height - padY * 2) * step} className="chart-grid" />)}<polyline points={`${padX},${height - padY} ${coords} ${width - padX},${height - padY}`} fill="url(#chartFill)" stroke="none" /><polyline points={coords} fill="none" stroke="hsl(158 47% 39%)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{daily.map((point, index) => { const x = padX + (daily.length < 2 ? 0 : index * (width - padX * 2) / (daily.length - 1)); const y = height - padY - point.requests / max * (height - padY * 2); return <circle key={`${point.date}-${index}`} cx={x} cy={y} r="3.5" fill="hsl(var(--card))" stroke="hsl(158 47% 39%)" strokeWidth="2" />; })}</svg><div className="chart-labels"><span>{daily[0] ? new Date(daily[0].date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : ''}</span><span>{daily[daily.length - 1] ? new Date(daily[daily.length - 1].date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : ''}</span></div></div>;
}

function UsageTable({ items, compact = false }: { items: UsageRecord[]; compact?: boolean }) {
  if (!items.length) return <EmptyState title="Belum ada request" detail="Riwayat request akan tercatat di sini setelah gateway digunakan." icon={Activity} />;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Waktu</th><th>Model</th><th>Provider</th><th>Token</th><th>Latensi</th><th>Biaya</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} data-testid={`row-usage-${item.id}`}><td className="mono">{date(item.createdAt)}</td><td><b>{item.model}</b>{!compact && <small className="cell-sub mono">{item.requestId}</small>}</td><td>{item.provider}</td><td className="mono">{number(item.totalTokens)}</td><td className="mono">{number(item.latencyMs)} ms</td><td className="mono">{money(item.userCost)}</td><td><span className={`status-dot ${/2\\d\\d|success|ok/i.test(item.status) ? 'success' : 'failed'}`} />{item.status}{item.error && <small className="cell-sub">{item.error}</small>}</td></tr>)}</tbody></table></div>;
}

function ProvidersPage() {
  const client = useQueryClient();
  const query = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const modelsQuery = useListModels({ query: { queryKey: getListModelsQueryKey() } });
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const remove = useDeleteProvider();
  const sync = useSyncProviderModels();
  const [dialog, setDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const { notice, show } = useNotice();
  const [busy, setBusy] = useState('');
  const invalidate = () => Promise.all([client.invalidateQueries({ queryKey: getListProvidersQueryKey() }), client.invalidateQueries({ queryKey: getListModelsQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]);
  function addProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (editingProvider) {
      const patch: ProviderUpdate = { name: String(form.get('name')), baseUrl: String(form.get('baseUrl')), priority: Number(form.get('priority')), timeoutMs: Number(form.get('timeoutMs')) };
      const key = String(form.get('apiKey') || '');
      if (key) patch.apiKey = key;
      update.mutate({ providerId: editingProvider.id, data: patch }, { onSuccess: async () => { await invalidate(); setEditingProvider(null); show('Provider berhasil diperbarui.'); }, onError: (error) => show(errorText(error)) });
      return;
    }
    const input: ProviderInput = { name: String(form.get('name')), providerType: String(form.get('providerType')), baseUrl: String(form.get('baseUrl')), apiKey: String(form.get('apiKey')), priority: Number(form.get('priority')), timeoutMs: Number(form.get('timeoutMs')) };
    create.mutate({ data: input }, { onSuccess: async () => { await invalidate(); setDialog(false); show('Provider berhasil ditambahkan.'); }, onError: (error) => show(errorText(error)) });
  }
  function toggle(provider: Provider) {
    update.mutate({ providerId: provider.id, data: { enabled: !provider.enabled } }, { onSuccess: () => void invalidate(), onError: (error) => show(errorText(error)) });
  }
  function syncModels(provider: Provider) {
    setBusy(provider.id);
    sync.mutate({ providerId: provider.id }, { onSuccess: async (result) => { await invalidate(); show(`${result.length} model disinkronkan.`); setBusy(''); }, onError: (error) => { show(errorText(error)); setBusy(''); } });
  }
  function deleteProvider(provider: Provider) {
    if (!window.confirm(`Hapus provider “${provider.name}”?`)) return;
    remove.mutate({ providerId: provider.id }, { onSuccess: async () => { await invalidate(); show('Provider dihapus.'); }, onError: (error) => show(errorText(error)) });
  }
  return <main className="content-wrap fade-in"><PageHeading kicker="KONEKTIVITAS" title="Provider" description="Hubungkan endpoint model yang kompatibel dengan protokol OpenAI." action={<Button variant="primary" onClick={() => setDialog(true)} data-testid="button-add-provider"><Plus size={15} /> Tambah provider</Button>} />
    <div className="inline-notice"><ShieldCheck size={15} /><span>Kredensial provider disimpan di gateway dan tidak ditampilkan kembali setelah disimpan.</span></div>
    <QueryState loading={query.isLoading} error={query.isError} retry={() => void query.refetch()} label="provider">{query.data && (query.data.length ? <section className="panel"><div className="section-head table-title"><div><div className="eyebrow">PROVIDER TERDAFTAR</div><h2>{number(query.data.length)} koneksi</h2></div><span className="range-tag">{modelsQuery.data?.length ?? '—'} model ditemukan</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Provider</th><th>Endpoint</th><th>Health</th><th>Prioritas</th><th>Timeout</th><th>Model</th><th>Status</th><th /></tr></thead><tbody>{query.data.map((provider) => <tr key={provider.id} data-testid={`row-provider-${provider.id}`}><td><b>{provider.name}</b><small className="cell-sub">{provider.providerType}</small></td><td className="mono endpoint-cell">{provider.baseUrl}</td><td><span className={`status-dot ${provider.healthStatus}`} />{provider.healthStatus}</td><td className="mono">{provider.priority}</td><td className="mono">{number(provider.timeoutMs)} ms</td><td>{number(provider.modelCount)}</td><td><button className={`switch ${provider.enabled ? 'switch-on' : ''}`} role="switch" aria-checked={provider.enabled} aria-label={`Status ${provider.name}`} onClick={() => toggle(provider)} data-testid={`toggle-provider-${provider.id}`}><span /></button><span className="switch-label">{provider.enabled ? 'Aktif' : 'Nonaktif'}</span></td><td><div className="row-actions"><button aria-label={`Edit ${provider.name}`} className="icon-button" onClick={() => setEditingProvider(provider)} data-testid={`button-edit-provider-${provider.id}`}><Settings2 size={15} /></button><button aria-label={`Sinkronkan model ${provider.name}`} className="icon-button" onClick={() => syncModels(provider)} disabled={busy === provider.id} data-testid={`button-sync-provider-${provider.id}`}>{busy === provider.id ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button><button aria-label={`Hapus ${provider.name}`} className="icon-button danger-hover" onClick={() => deleteProvider(provider)} data-testid={`button-delete-provider-${provider.id}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div></section> : <section className="panel"><EmptyState title="Belum ada provider" detail="Tambahkan koneksi OpenAI-compatible untuk mulai mengelola model dan routing." icon={Network} action={<Button variant="primary" onClick={() => setDialog(true)} data-testid="button-add-first-provider"><Plus size={14} /> Tambah provider</Button>} /></section>)}</QueryState>
    {(dialog || editingProvider) && <Modal title={editingProvider ? 'Edit provider' : 'Tambah provider'} subtitle={editingProvider ? 'Perbarui konfigurasi koneksi provider.' : 'Daftarkan endpoint dan kredensial server provider.'} onClose={() => { setDialog(false); setEditingProvider(null); }}><form className="form-stack" onSubmit={addProvider}><label className="field">Nama provider<input name="name" required maxLength={120} defaultValue={editingProvider?.name} placeholder="Contoh: Provider utama" data-testid="input-provider-name" /></label>{!editingProvider && <label className="field">Jenis provider<input name="providerType" required placeholder="openai-compatible" data-testid="input-provider-type" /></label>}<label className="field">Base URL<input type="url" name="baseUrl" required defaultValue={editingProvider?.baseUrl} placeholder="https://endpoint-provider/v1" data-testid="input-provider-url" /></label><label className="field">API key<input type="password" name="apiKey" required={!editingProvider} placeholder={editingProvider ? 'Kosongkan untuk mempertahankan key saat ini' : 'Kunci rahasia provider'} data-testid="input-provider-key" /></label><div className="form-pair"><label className="field">Prioritas<input type="number" min="1" max="1000" name="priority" defaultValue={editingProvider?.priority ?? 10} required data-testid="input-provider-priority" /></label><label className="field">Timeout (ms)<input type="number" min="1000" max="120000" step="1000" name="timeoutMs" defaultValue={editingProvider?.timeoutMs ?? 30000} required data-testid="input-provider-timeout" /></label></div><div className="modal-actions"><Button type="button" onClick={() => { setDialog(false); setEditingProvider(null); }}>Batal</Button><Button variant="primary" type="submit" disabled={create.isPending || update.isPending} data-testid="button-submit-provider">{create.isPending || update.isPending ? 'Menyimpan…' : editingProvider ? 'Simpan perubahan' : 'Simpan provider'}</Button></div></form></Modal>}<Notice message={notice} />
  </main>;
}

function ModelsPage() {
  const client = useQueryClient();
  const models = useListModels({ query: { queryKey: getListModelsQueryKey() } });
  const providers = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const create = useCreateModel(), update = useUpdateModel(), remove = useDeleteModel();
  const [dialog, setDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const { notice, show } = useNotice();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => (models.data || []).filter((model) => `${model.name} ${model.modelName} ${model.providerName}`.toLowerCase().includes(search.toLowerCase())), [models.data, search]);
  const invalidate = () => Promise.all([client.invalidateQueries({ queryKey: getListModelsQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]);
  function addModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (editingModel) {
      const patch: ModelUpdate = { name: String(form.get('name')), contextWindow: Number(form.get('contextWindow')), inputPricePerMillion: Number(form.get('inputPricePerMillion')), outputPricePerMillion: Number(form.get('outputPricePerMillion')), supportsStreaming: form.get('supportsStreaming') === 'on', supportsVision: form.get('supportsVision') === 'on', supportsTools: form.get('supportsTools') === 'on' };
      update.mutate({ modelId: editingModel.id, data: patch }, { onSuccess: async () => { await invalidate(); setEditingModel(null); show('Model berhasil diperbarui.'); }, onError: (error) => show(errorText(error)) });
      return;
    }
    const input: ModelInput = { providerId: String(form.get('providerId')), name: String(form.get('name')), modelName: String(form.get('modelName')), contextWindow: Number(form.get('contextWindow')), inputPricePerMillion: Number(form.get('inputPricePerMillion')), outputPricePerMillion: Number(form.get('outputPricePerMillion')), supportsStreaming: form.get('supportsStreaming') === 'on', supportsVision: form.get('supportsVision') === 'on', supportsTools: form.get('supportsTools') === 'on' };
    create.mutate({ data: input }, { onSuccess: async () => { await invalidate(); setDialog(false); show('Model ditambahkan.'); }, onError: (error) => show(errorText(error)) });
  }
  return <main className="content-wrap fade-in"><PageHeading kicker="KATALOG GATEWAY" title="Model" description="Kelola model yang tersedia, kapabilitas, dan tarif per sejuta token." action={<Button variant="primary" onClick={() => setDialog(true)} disabled={!providers.data?.length} data-testid="button-add-model"><Plus size={15} /> Tambah model</Button>} />
    <div className="toolbar"><div className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari model atau provider" aria-label="Cari model" data-testid="input-search-models" /></div><span className="range-tag">{models.data ? `${filtered.length} / ${models.data.length} model` : '— model'}</span></div>
     <QueryState loading={models.isLoading} error={models.isError} retry={() => void models.refetch()} label="katalog model">{models.data && (filtered.length ? <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Nama model</th><th>Provider</th><th>Context</th><th>Input / 1M</th><th>Output / 1M</th><th>Kapabilitas</th><th>Status</th><th /></tr></thead><tbody>{filtered.map((model) => <tr key={model.id} data-testid={`row-model-${model.id}`}><td><b>{model.name}</b><small className="cell-sub mono">{model.modelName}</small></td><td>{model.providerName}</td><td className="mono">{number(model.contextWindow)}</td><td className="mono">{money(model.inputPricePerMillion)}</td><td className="mono">{money(model.outputPricePerMillion)}</td><td><div className="capability-tags">{model.supportsStreaming && <span>SSE</span>}{model.supportsVision && <span>Vision</span>}{model.supportsTools && <span>Tools</span>}{!model.supportsStreaming && !model.supportsVision && !model.supportsTools && <span className="muted-copy">—</span>}</div></td><td><button className={`switch ${model.enabled ? 'switch-on' : ''}`} role="switch" aria-checked={model.enabled} aria-label={`Status ${model.name}`} onClick={() => update.mutate({ modelId: model.id, data: { enabled: !model.enabled } }, { onSuccess: () => void invalidate(), onError: (error) => show(errorText(error)) })} data-testid={`toggle-model-${model.id}`}><span /></button></td><td><div className="row-actions"><button aria-label={`Edit ${model.name}`} className="icon-button" onClick={() => setEditingModel(model)} data-testid={`button-edit-model-${model.id}`}><Settings2 size={15} /></button><button aria-label={`Hapus ${model.name}`} className="icon-button danger-hover" onClick={() => { if (window.confirm(`Hapus model “${model.name}”?`)) remove.mutate({ modelId: model.id }, { onSuccess: () => { void invalidate(); show('Model dihapus.'); }, onError: (error) => show(errorText(error)) }); }} data-testid={`button-delete-model-${model.id}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div></section> : <section className="panel"><EmptyState title={search ? 'Model tidak ditemukan' : 'Belum ada model'} detail={search ? 'Periksa kata kunci pencarian Anda.' : 'Sinkronkan model dari provider atau tambahkan model secara manual.'} icon={Cpu} action={!search && <Link href="/providers" className="text-link" data-testid="link-configure-provider">Konfigurasi provider <ArrowRight size={13} /></Link>} /></section>)}</QueryState>
     {(dialog || editingModel) && <Modal title={editingModel ? 'Edit model' : 'Tambah model'} subtitle={editingModel ? 'Perbarui tarif dan kapabilitas model.' : 'Hubungkan katalog dengan model dari provider yang tersedia.'} onClose={() => { setDialog(false); setEditingModel(null); }}><form className="form-stack" onSubmit={addModel}>{!editingModel && <label className="field">Provider<select name="providerId" required data-testid="select-model-provider"><option value="">Pilih provider</option>{providers.data?.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>}<label className="field">Nama tampilan<input name="name" required defaultValue={editingModel?.name} placeholder="Nama yang terlihat di console" data-testid="input-model-name" /></label>{!editingModel && <label className="field">Model upstream<input name="modelName" required placeholder="ID model pada provider" data-testid="input-upstream-model" /></label>}<div className="form-pair"><label className="field">Context window<input type="number" min="1" name="contextWindow" required defaultValue={editingModel?.contextWindow} data-testid="input-model-context" /></label><label className="field">Input / 1M token<input type="number" min="0" step="0.000001" name="inputPricePerMillion" required defaultValue={editingModel?.inputPricePerMillion} data-testid="input-model-input-price" /></label></div><label className="field">Output / 1M token<input type="number" min="0" step="0.000001" name="outputPricePerMillion" required defaultValue={editingModel?.outputPricePerMillion} data-testid="input-model-output-price" /></label><div className="check-row"><label><input type="checkbox" name="supportsStreaming" defaultChecked={editingModel?.supportsStreaming} /> Streaming</label><label><input type="checkbox" name="supportsVision" defaultChecked={editingModel?.supportsVision} /> Vision</label><label><input type="checkbox" name="supportsTools" defaultChecked={editingModel?.supportsTools} /> Tools</label></div><div className="modal-actions"><Button type="button" onClick={() => { setDialog(false); setEditingModel(null); }}>Batal</Button><Button variant="primary" type="submit" disabled={create.isPending || update.isPending} data-testid="button-submit-model">{create.isPending || update.isPending ? 'Menyimpan…' : editingModel ? 'Simpan perubahan' : 'Simpan model'}</Button></div></form></Modal>}<Notice message={notice} />
  </main>;
}

function ApiKeysPage() {
  const client = useQueryClient(); const keys = useListApiKeys({ query: { queryKey: getListApiKeysQueryKey() } }); const create = useCreateApiKey(); const revoke = useRevokeApiKey();
  const [dialog, setDialog] = useState(false); const [created, setCreated] = useState<ApiKeyCreated | null>(null); const { notice, show } = useNotice(); const [copied, setCopied] = useState(false);
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: getListApiKeysQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const name = String(new FormData(event.currentTarget).get('name')); create.mutate({ data: { name } }, { onSuccess: async (response) => { await refresh(); setDialog(false); setCreated(response); }, onError: (error) => show(errorText(error)) }); }
  async function copySecret() { if (created) { await navigator.clipboard.writeText(created.secret); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } }
  return <main className="content-wrap fade-in"><PageHeading kicker="AKSES APLIKASI" title="API keys" description="Kunci aplikasi mengautentikasi request Anda ke OpenAI-compatible gateway." action={<Button variant="primary" onClick={() => setDialog(true)} data-testid="button-create-key"><Plus size={15} /> Buat API key</Button>} /><div className="key-warning"><span className="key-warning-icon"><KeyRound size={16} /></span><p><b>Rahasia hanya ditampilkan sekali.</b> Simpan secret di tempat aman. Gunakan kunci ini saat memanggil endpoint gateway — bukan token sesi Clerk.</p></div>
    <QueryState loading={keys.isLoading} error={keys.isError} retry={() => void keys.refetch()} label="API keys">{keys.data && (keys.data.length ? <section className="panel"><div className="section-head table-title"><div><div className="eyebrow">DAFTAR KUNCI</div><h2>{number(keys.data.length)} API key</h2></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Nama</th><th>Prefix</th><th>Status</th><th>Dibuat</th><th>Terakhir digunakan</th><th /></tr></thead><tbody>{keys.data.map((key) => <tr key={key.id} data-testid={`row-api-key-${key.id}`}><td><b>{key.name}</b></td><td className="mono">{key.prefix}••••••••</td><td><span className={`status-dot ${key.status}`} />{key.status === 'active' ? 'Aktif' : 'Dicabut'}</td><td>{date(key.createdAt)}</td><td>{date(key.lastUsedAt)}</td><td>{key.status === 'active' && <Button variant="danger" onClick={() => { if (window.confirm(`Cabut API key “${key.name}”? Request menggunakan kunci ini akan ditolak.`)) revoke.mutate({ keyId: key.id }, { onSuccess: async () => { await refresh(); show('API key dicabut.'); }, onError: (error) => show(errorText(error)) }); }} data-testid={`button-revoke-key-${key.id}`}><X size={13} /> Cabut</Button>}</td></tr>)}</tbody></table></div></section> : <section className="panel"><EmptyState title="Belum ada API key" detail="Buat kunci untuk mengautentikasi aplikasi Anda terhadap gateway." icon={KeyRound} action={<Button variant="primary" onClick={() => setDialog(true)} data-testid="button-create-first-key"><Plus size={14} /> Buat API key</Button>} /></section>)}</QueryState>
    {dialog && <Modal title="Buat API key" subtitle="Beri nama agar kunci mudah dikenali dan dikelola." onClose={() => setDialog(false)}><form className="form-stack" onSubmit={submit}><label className="field">Nama key<input name="name" required maxLength={120} autoFocus placeholder="Contoh: Backend produksi" data-testid="input-api-key-name" /></label><div className="modal-actions"><Button type="button" onClick={() => setDialog(false)}>Batal</Button><Button variant="primary" type="submit" disabled={create.isPending} data-testid="button-submit-api-key">{create.isPending ? 'Membuat…' : 'Buat kunci'}</Button></div></form></Modal>}
    {created && <Modal title="Simpan secret sekarang" subtitle="Kunci rahasia ini tidak akan ditampilkan kembali." onClose={() => setCreated(null)}><div className="secret-reveal"><div className="secret-name"><Check size={15} /> {created.key.name} berhasil dibuat</div><label className="field">API secret<div className="secret-value mono">{created.secret}</div></label><Button variant="primary" onClick={() => void copySecret()} data-testid="button-copy-api-secret">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Tersalin' : 'Salin secret'}</Button><p className="muted-copy">Simpan secret ini pada secret manager aplikasi. Jangan bagikan atau masukkan ke repositori.</p></div></Modal>}<Notice message={notice} />
  </main>;
}

function UsagePageView() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState('');
  const params = useMemo(() => ({ page, pageSize: 20, ...(search.trim() ? { search: search.trim() } : {}) }), [page, search]);
  const usage = useListUsage(params, { query: { queryKey: getListUsageQueryKey(params) } });
  useEffect(() => setPage(1), [search]);
  return <main className="content-wrap fade-in"><PageHeading kicker="OBSERVABILITAS" title="Penggunaan" description="Riwayat request gateway beserta token, biaya, dan latensi." action={<span className="range-tag">PAGING SERVER</span>} /><div className="toolbar"><div className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari request, model, atau provider" aria-label="Cari penggunaan" data-testid="input-search-usage" /></div>{usage.data && <span className="range-tag">{number(usage.data.total)} request</span>}</div>
    <QueryState loading={usage.isLoading} error={usage.isError} retry={() => void usage.refetch()} label="riwayat penggunaan">{usage.data && <section className="panel"><UsageTable items={usage.data.items} /><div className="pagination"><span>Halaman {usage.data.page} · {number(usage.data.total)} catatan</span><div><Button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} data-testid="button-usage-previous"><ChevronLeft size={14} /> Sebelumnya</Button><Button disabled={usage.data.items.length < usage.data.pageSize || page * usage.data.pageSize >= usage.data.total} onClick={() => setPage((value) => value + 1)} data-testid="button-usage-next">Berikutnya <ChevronRight size={14} /></Button></div></div></section>}</QueryState>
  </main>;
}

function CreditsPage() {
  const credits = useGetCredits({ query: { queryKey: getGetCreditsQueryKey() } });
  return <main className="content-wrap fade-in">
    <PageHeading kicker="SALDO WORKSPACE" title="Kredit" description="Saldo dan transaksi kredit yang tercatat pada akun Anda." />
    <QueryState loading={credits.isLoading} error={credits.isError} retry={() => void credits.refetch()} label="saldo kredit">
      {credits.data && <>
        <section className="balance-hero panel">
          <div><div className="eyebrow">SALDO TERSEDIA</div><strong>{money(credits.data.balance)}</strong><p>Saldo dari data akun yang dikembalikan gateway.</p></div>
          <span className="balance-hero-icon"><Coins size={22} /></span>
        </section>
        <section className="panel credits-history">
          <div className="section-head table-title"><div><div className="eyebrow">BUKU TRANSAKSI</div><h2>Riwayat kredit</h2></div><span className="range-tag">{number(credits.data.transactions.length)} transaksi</span></div>
          {credits.data.transactions.length ? <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Jenis</th><th>Deskripsi</th><th>Waktu</th><th>Perubahan</th><th>Saldo akhir</th></tr></thead>
            <tbody>{credits.data.transactions.map((transaction) => <tr key={transaction.id} data-testid={`row-credit-${transaction.id}`}>
              <td><span className={`transaction-type type-${transaction.type}`}>{transaction.type}</span></td>
              <td>{transaction.description}</td><td>{date(transaction.createdAt)}</td>
              <td className={`mono amount-${transaction.type}`}>{['credit', 'refund'].includes(transaction.type) ? '+' : '−'}{money(Math.abs(transaction.amount))}</td>
              <td className="mono">{money(transaction.balanceAfter)}</td>
            </tr>)}</tbody>
          </table></div> : <EmptyState title="Belum ada transaksi" detail="Transaksi kredit akan muncul setelah ada perubahan saldo." icon={CreditCard} />}
        </section>
      </>}
    </QueryState>
  </main>;
}

const strategies = [
  { value: 'priority', label: 'Prioritas', detail: 'Pilih provider aktif dengan urutan prioritas yang ditetapkan.' },
  { value: 'lowest_cost', label: 'Biaya terendah', detail: 'Arahkan request ke opsi dengan biaya model paling rendah.' },
  { value: 'lowest_latency', label: 'Latensi terendah', detail: 'Utamakan provider dengan latensi yang lebih rendah.' },
  { value: 'round_robin', label: 'Round robin', detail: 'Sebarkan request bergiliran di antara provider yang tersedia.' },
  { value: 'weighted', label: 'Berbobot', detail: 'Distribusikan request mengikuti bobot prioritas provider.' },
] as const;

function RoutingPage() {
  const client = useQueryClient(); const query = useGetRoutingSettings({ query: { queryKey: getGetRoutingSettingsQueryKey() } }); const save = useUpdateRoutingSettings();
  const [strategy, setStrategy] = useState<RoutingSettingsInput['strategy']>('priority'); const [markup, setMarkup] = useState('0'); const [fallback, setFallback] = useState(false); const { notice, show } = useNotice();
  useEffect(() => { if (query.data) { setStrategy(query.data.strategy); setMarkup(String(query.data.markupPercent)); setFallback(query.data.fallbackEnabled); } }, [query.data]);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const input: RoutingSettingsInput = { strategy, markupPercent: Number(markup), fallbackEnabled: fallback }; save.mutate({ data: input }, { onSuccess: async () => { await client.invalidateQueries({ queryKey: getGetRoutingSettingsQueryKey() }); show('Pengaturan routing berhasil diperbarui.'); }, onError: (error) => show(errorText(error)) }); }
  return <main className="content-wrap fade-in"><PageHeading kicker="KEBIJAKAN GATEWAY" title="Routing" description="Atur cara request dipilih, markup biaya, dan penanganan kegagalan." /><QueryState loading={query.isLoading} error={query.isError} retry={() => void query.refetch()} label="pengaturan routing">{query.data && <form onSubmit={submit} className="routing-layout"><section className="panel routing-main"><div className="section-head"><div><div className="eyebrow">STRATEGI PEMILIHAN</div><h2>Pilih cara merutekan</h2></div></div><div className="strategy-list">{strategies.map((option) => <label className={`strategy-option ${strategy === option.value ? 'strategy-selected' : ''}`} key={option.value}><input type="radio" name="strategy" value={option.value} checked={strategy === option.value} onChange={() => setStrategy(option.value)} data-testid={`radio-strategy-${option.value}`} /><span className="radio-mark" /><span className="strategy-copy"><b>{option.label}</b><small>{option.detail}</small></span>{strategy === option.value && <Check size={15} className="strategy-check" />}</label>)}</div></section><div className="routing-side"><section className="panel routing-option"><div className="eyebrow">PENYESUAIAN HARGA</div><h2>Markup biaya</h2><p>Persentase markup yang diterapkan pada biaya provider.</p><div className="percent-field"><input type="number" min="0" max="1000" step="0.01" value={markup} onChange={(event) => setMarkup(event.target.value)} required data-testid="input-markup" /><span>%</span></div><small className="muted-copy">Nilai saat ini dari pengaturan server: {query.data.markupPercent}%</small></section><section className="panel fallback-option"><div className="fallback-copy"><span className="eyebrow">KETERSEDIAAN</span><b>Fallback provider</b><small>Coba provider lain ketika provider terpilih gagal.</small></div><button type="button" role="switch" aria-checked={fallback} aria-label="Fallback provider" className={`switch ${fallback ? 'switch-on' : ''}`} onClick={() => setFallback((value) => !value)} data-testid="toggle-fallback"><span /></button></section><div className="routing-save-note"><ShieldCheck size={15} /> Perubahan berlaku untuk request gateway berikutnya.</div></div><div className="routing-actions"><Button type="button" onClick={() => { setStrategy(query.data!.strategy); setMarkup(String(query.data!.markupPercent)); setFallback(query.data!.fallbackEnabled); }}>Batalkan perubahan</Button><Button variant="primary" type="submit" disabled={save.isPending || (strategy === query.data.strategy && Number(markup) === query.data.markupPercent && fallback === query.data.fallbackEnabled)} data-testid="button-save-routing">{save.isPending ? 'Menyimpan…' : <><Check size={14} /> Simpan perubahan</>}</Button></div></form>}</QueryState><Notice message={notice} /></main>;
}

function PlaygroundPage() {
  const models = useListModels({ query: { queryKey: getListModelsQueryKey() } });
  const [appKey, setAppKey] = useState(''); const [model, setModel] = useState(''); const [prompt, setPrompt] = useState(''); const [system, setSystem] = useState(''); const [result, setResult] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [meta, setMeta] = useState('');
  useEffect(() => { if (!model && models.data?.length) setModel(models.data.find((entry) => entry.enabled)?.modelName || models.data[0].modelName); }, [models.data, model]);
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setResult(''); setMeta('');
    const messages: ChatCompletionInput['messages'] = [];
    if (system.trim()) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    try {
      const response = await fetch(`${basePath}/api/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appKey.trim()}` }, body: JSON.stringify({ model, messages, temperature: 0.7, stream: false } satisfies ChatCompletionInput) });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = payload as { error?: string; message?: string };
        throw new Error(apiError.error || apiError.message || `Gateway mengembalikan status ${response.status}.`);
      }
      const completion = payload as { choices?: { message?: { content?: string | { text?: string }[] } }[]; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      const content = completion.choices?.[0]?.message?.content;
      setResult(typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part.text || '').join('') : 'Respons tidak menyertakan konten teks.');
      setMeta(`${completion.model || model}${completion.usage ? ` · ${number(completion.usage.total_tokens || 0)} token` : ''}`);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  return <main className="content-wrap fade-in"><PageHeading kicker="UJI GATEWAY" title="Playground" description="Kirim chat completion nyata melalui gateway menggunakan API key aplikasi Anda." /><div className="playground-warning"><KeyRound size={15} /><span>Gunakan app API key dari console. Kunci hanya digunakan langsung di browser untuk request ini, bukan token sesi Clerk.</span></div><div className="playground-grid"><form className="panel playground-form" onSubmit={run}><div className="section-head"><div><div className="eyebrow">PARAMETER REQUEST</div><h2>Chat completion</h2></div><span className="mono method-label">POST /v1/chat/completions</span></div><label className="field">App API key<div className="secret-input"><input type="password" required value={appKey} onChange={(event) => setAppKey(event.target.value)} placeholder="key_…" autoComplete="off" data-testid="input-playground-key" /><KeyRound size={14} /></div></label><label className="field">Model<select value={model} onChange={(event) => setModel(event.target.value)} required disabled={!models.data?.length} data-testid="select-playground-model"><option value="">Pilih model yang tersedia</option>{models.data?.filter((entry) => entry.enabled).map((entry: Model) => <option key={entry.id} value={entry.modelName}>{entry.name} · {entry.providerName}</option>)}</select>{models.data?.length === 0 && <small className="muted-copy">Belum ada model terdaftar. Tambahkan provider dan model terlebih dahulu.</small>}</label><label className="field">System prompt <span className="optional-label">OPSIONAL</span><textarea rows={3} value={system} onChange={(event) => setSystem(event.target.value)} placeholder="Aturan atau konteks untuk asisten…" data-testid="input-playground-system" /></label><label className="field">Pesan Anda<textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} required placeholder="Tulis prompt untuk mengirim request ke gateway…" data-testid="input-playground-prompt" /></label><div className="playground-form-bottom"><span className="muted-copy">stream: false · temperature: 0.7</span><Button type="submit" variant="primary" disabled={busy || !appKey || !model || !prompt.trim()} data-testid="button-run-playground">{busy ? <><LoaderCircle size={14} className="spin" /> Mengirim…</> : <><Zap size={14} /> Jalankan request</>}</Button></div></form><section className="panel response-panel"><div className="section-head"><div><div className="eyebrow">HASIL GATEWAY</div><h2>Respons</h2></div>{meta && <span className="range-tag">{meta}</span>}</div>{busy ? <div className="response-loading"><span className="loading-line" /><span className="loading-line" /><span className="loading-line short" /></div> : error ? <div className="response-error"><div className="eyebrow">REQUEST GAGAL</div><p>{error}</p></div> : result ? <pre className="response-output" data-testid="text-playground-response">{result}</pre> : <EmptyState title="Belum ada respons" detail="Isi API key dan prompt, lalu jalankan request nyata ke gateway." icon={TerminalSquare} />}</section></div></main>;
}

function DocsPage() {
  const [copied, setCopied] = useState('');
  const snippet = `import OpenAI from 'openai';\n\nconst client = new OpenAI({\n  apiKey: process.env.KAWATA_API_KEY,\n  baseURL: 'https://gateway.your-domain/v1',\n});`;
  async function copy() { await navigator.clipboard.writeText(snippet); setCopied('Contoh tersalin.'); window.setTimeout(() => setCopied(''), 1800); }
  return <main className="content-wrap fade-in"><PageHeading kicker="REFERENSI PENGEMBANG" title="Dokumentasi" description="Integrasikan aplikasi dengan OpenAI-compatible gateway Kawata." /><div className="docs-layout"><nav className="docs-nav"><div className="eyebrow">MULAI</div><a href="#quickstart">Quickstart</a><a href="#authentication">Autentikasi</a><a href="#request">Chat completion</a><a href="#errors">Respons dan error</a><a href="#security">Keamanan</a><div className="docs-callout"><BookOpen size={15} /><p>Gateway memakai bentuk request dan response yang kompatibel dengan OpenAI Chat Completions.</p></div></nav><div className="docs-content"><article id="quickstart" className="docs-article"><div className="eyebrow">01 / QUICKSTART</div><h2>Sambungkan SDK Anda</h2><p>Gunakan SDK OpenAI yang sudah ada. Arahkan base URL ke gateway dan gunakan API key aplikasi yang dibuat di console.</p><div className="doc-code-head"><span className="mono">quickstart.ts</span><button className="text-link" onClick={() => void copy()} data-testid="button-copy-doc-code">{copied ? <Check size={13} /> : <Copy size={13} />}{copied || 'Salin'}</button></div><pre className="code-block">{snippet}</pre></article><article id="authentication" className="docs-article"><div className="eyebrow">02 / AUTENTIKASI</div><h2>Gunakan app API key</h2><p>Kirim kunci sebagai Bearer token pada header Authorization. Kunci sesi Clerk hanya mengautentikasi console; kunci tersebut bukan kredensial gateway.</p><div className="inline-code">Authorization: Bearer YOUR_APP_API_KEY</div><p>Buat atau cabut kunci di <Link href="/api-keys" className="text-link" data-testid="link-docs-api-keys">API keys <ArrowRight size={12} /></Link>. Secret baru hanya dapat dilihat saat dibuat.</p></article><article id="request" className="docs-article"><div className="eyebrow">03 / CHAT COMPLETION</div><h2>Kirim request</h2><p>Endpoint chat completion menerima model yang sudah dikonfigurasi dan pesan berbasis role.</p><div className="endpoint-row"><span className="method-label">POST</span><code className="mono">/v1/chat/completions</code></div><pre className="code-block">{`{\n  "model": "model-id-anda",\n  "messages": [\n    { "role": "user", "content": "Halo" }\n  ]\n}`}</pre><p>Model yang dapat dirutekan tercermin pada katalog model Anda. Periksa respons gateway untuk penggunaan token aktual.</p></article><article id="errors" className="docs-article"><div className="eyebrow">04 / PENANGANAN</div><h2>Periksa respons dan error</h2><p>Respons berhasil mengikuti bentuk Chat Completions. Periksa HTTP status serta payload error saat request gagal, dan gunakan ID request yang dikembalikan gateway untuk menelusuri log penggunaan.</p><div className="doc-note"><ShieldCheck size={15} /><span>Jangan mencatat app API key atau kredensial upstream dalam log aplikasi.</span></div></article><article id="security" className="docs-article"><div className="eyebrow">05 / KEAMANAN</div><h2>Jaga kredensial tetap aman</h2><ul><li>Simpan app API key hanya pada environment server atau secret manager.</li><li>Batasi akses key dan cabut segera jika tidak lagi digunakan.</li><li>Jangan mengekspos key di kode frontend produksi.</li></ul></article></div></div><Notice message={copied} /></main>;
}

function SignInPage() {
  return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}

function SignUpPage() {
  return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-page"><div className="auth-side"><Link href="/" className="auth-brand" data-testid="link-auth-brand"><Brand light /></Link><div className="auth-message"><div className="eyebrow">AI ROUTER CONTROL PLANE</div><h1>Satu jalur<br />untuk semua<br /><em>model Anda.</em></h1><p>Konfigurasi dengan tenang. Kirim dengan percaya diri.</p></div><div className="auth-footer">Kawata · Inference gateway</div></div><div className="auth-form-side"><Link href="/" className="auth-mobile-brand"><Brand /></Link>{children}<div className="auth-privacy">Autentikasi workspace dilindungi oleh Clerk.</div></div></main>;
}

function HomeRedirect() {
  return <Landing />;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })} appearance={{
    cssLayerName: 'clerk',
    options: { logoPlacement: 'inside', logoLinkUrl: `${basePath || ''}/`, logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
    variables: { colorPrimary: '#205e56', colorForeground: '#203431', colorMutedForeground: '#71807a', colorDanger: '#b34f46', colorBackground: '#fbfaf5', colorInput: '#f6f4ed', colorInputForeground: '#203431', colorNeutral: '#d8d9ce', fontFamily: 'Manrope, sans-serif', borderRadius: '0.6rem' },
    elements: { rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden', card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none', headerTitle: 'font-bold tracking-tight', headerSubtitle: 'text-muted-foreground', formButtonPrimary: 'bg-[#205e56] hover:bg-[#194d47] text-white', formFieldInput: 'bg-[#f6f4ed] border-[#d8d9ce]' },
  }} localization={{ signIn: { start: { title: 'Selamat datang kembali', subtitle: 'Masuk untuk mengelola workspace Anda' } }, signUp: { start: { title: 'Buat workspace Kawata', subtitle: 'Mulai kelola gateway AI Anda' } } }}>
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard">{() => <ConsoleRoute page={<DashboardPage />} />}</Route>
      <Route path="/playground">{() => <ConsoleRoute page={<PlaygroundPage />} />}</Route>
      <Route path="/providers">{() => <ConsoleRoute page={<ProvidersPage />} />}</Route>
      <Route path="/models">{() => <ConsoleRoute page={<ModelsPage />} />}</Route>
      <Route path="/api-keys">{() => <ConsoleRoute page={<ApiKeysPage />} />}</Route>
      <Route path="/usage">{() => <ConsoleRoute page={<UsagePageView />} />}</Route>
      <Route path="/credits">{() => <ConsoleRoute page={<CreditsPage />} />}</Route>
      <Route path="/routing">{() => <ConsoleRoute page={<RoutingPage />} />}</Route>
      <Route path="/docs">{() => <ConsoleRoute page={<DocsPage />} />}</Route>
      <Route component={NotFound} />
    </Switch>
  </ClerkProvider>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter></QueryClientProvider>;
}

export default App;
