'use client';

import React, { useState, useEffect } from 'react';
import {
  Building2,
  Database,
  Palette,
  Plus,
  RefreshCw,
  Globe,
  CheckCircle2,
  AlertCircle,
  Search,
  Cpu,
  Download,
  Terminal,
  Sliders,
  UserCheck,
  Copy,
  Power,
  Trash2,
  LogOut,
  LayoutDashboard,
  Shield,
  Wallet,
  Users,
  X,
  Activity,
} from 'lucide-react';
import { Tenant } from '@/lib/types';
import { AVAILABLE_TEMPLATES } from '@/lib/templates';
import TenantCreationWizard from './components/TenantCreationWizard';
import ThemePreviewStudio from './components/ThemePreviewStudio';

type TabId = 'clients' | 'studio' | 'templates' | 'domains' | 'builds' | 'databases';

const NAV_GROUPS: {
  label: string;
  items: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[];
}[] = [
  {
    label: 'Tenants',
    items: [
      { id: 'clients', label: 'Clients', icon: Building2 },
      { id: 'templates', label: 'Templates', icon: Palette },
      { id: 'studio', label: 'Theme Studio', icon: Sliders },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { id: 'databases', label: 'Databases', icon: Database },
      { id: 'domains', label: 'Domains & SSL', icon: Globe },
    ],
  },
  {
    label: 'Operations',
    items: [{ id: 'builds', label: 'Mobile Builds', icon: Cpu }],
  },
];

const PAGE_META: Record<TabId, { title: string; description: string }> = {
  clients: {
    title: 'Clients',
    description: 'Manage tenants, their dedicated databases, plans and access.',
  },
  studio: {
    title: 'Theme Studio',
    description: 'Live-preview and tune branding and panel overrides for a tenant.',
  },
  templates: {
    title: 'Templates',
    description: 'Design system templates available for new and existing tenants.',
  },
  domains: {
    title: 'Domains & SSL',
    description: 'Map custom hostnames to tenant storefronts and admin panels.',
  },
  builds: {
    title: 'Mobile Builds',
    description: 'Generate branded Android and iOS artifacts for each tenant application.',
  },
  databases: {
    title: 'Databases',
    description: 'Each tenant runs on its own isolated MongoDB database.',
  },
};

/* ---------- Shared UI primitives (admin panel look) ---------- */

const CARD = 'rounded-xl border border-slate-800 bg-[#0F1522]';
const TABLE_HEAD = 'bg-slate-900/60 text-left text-xs font-medium text-slate-400 border-b border-slate-800';
const TH = 'px-5 py-3 font-medium whitespace-nowrap';
const TD = 'px-5 py-3.5 text-sm text-slate-300 align-middle';
const INPUT =
  'w-full rounded-lg border border-slate-700 bg-[#0A0F1A] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40';
const LABEL = 'block text-xs font-medium text-slate-400 mb-1.5';
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition';
const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition';
const BTN_ICON =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 transition';

type Tone = 'green' | 'amber' | 'red' | 'slate' | 'cyan' | 'violet';
const TONES: Record<Tone, string> = {
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  red: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  slate: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
  cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
};

function Badge({ tone = 'slate', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80">
          <Icon className="h-4 w-4 text-slate-300" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

function Modal({
  title,
  icon: Icon,
  onClose,
  footer,
  width = 'max-w-lg',
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClose: () => void;
  footer?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`${CARD} w-full ${width} shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="h-4 w-4 text-slate-400" />}
            <h3 className="text-sm font-semibold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className={BTN_ICON} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export default function SuperAdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('clients');
  const [clients, setClients] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTemplate, setFilterTemplate] = useState('all');
  const [showWizard, setShowWizard] = useState(false);
  const [selectedClientForDb, setSelectedClientForDb] = useState<Tenant | null>(null);
  const [selectedClientForStudio, setSelectedClientForStudio] = useState<Tenant | null>(null);
  const [dbStatusDetails, setDbStatusDetails] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [overview, setOverview] = useState<any>(null);

  // Domains State
  const [domains, setDomains] = useState<any[]>([]);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [newDomainTenantId, setNewDomainTenantId] = useState('');

  // Builds State
  const [builds, setBuilds] = useState<any[]>([]);
  const [buildTenantId, setBuildTenantId] = useState('');
  const [buildPanelType, setBuildPanelType] = useState('user_android');
  const [buildType, setBuildType] = useState('release_apk');
  const [selectedBuildLogs, setSelectedBuildLogs] = useState<string[] | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4500);
  };

  const fetchClients = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (data.success && data.clients) {
        setClients(data.clients);
        if (data.clients.length > 0) {
          if (!newDomainTenantId) setNewDomainTenantId(data.clients[0].id);
          if (!buildTenantId) setBuildTenantId(data.clients[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load clients:', err);
      showToast('error', 'Failed to fetch SaaS clients');
    } finally {
      setLoading(false);
    }
  };

  const fetchDomains = async () => {
    try {
      const res = await fetch('/api/domains');
      const data = await res.json();
      if (data.success) setDomains(data.domains || []);
    } catch (err) {
      console.error('Failed to load domains:', err);
    }
  };

  const fetchBuilds = async () => {
    try {
      const res = await fetch('/api/builds');
      const data = await res.json();
      if (data.success) setBuilds(data.builds || []);
    } catch (err) {
      console.error('Failed to load builds:', err);
    }
  };

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/overview');
      const data = await res.json();
      if (data.success) setOverview(data.stats);
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  };

  const refreshAll = () => {
    fetchClients();
    fetchOverview();
    fetchDomains();
    fetchBuilds();
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const handleInspectDb = async (client: Tenant) => {
    setSelectedClientForDb(client);
    setDbStatusDetails(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`);
      const data = await res.json();
      if (data.success) {
        setDbStatusDetails(data.database);
      }
    } catch (err) {
      console.error('Failed to inspect database:', err);
    }
  };

  const handleReprovisionDb = async (clientId: string) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/clients/${clientId}/provision`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', data.message);
        setDbStatusDetails(data.database);
        fetchClients();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Provisioning request failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDuplicateClient = async (client: Tenant) => {
    if (!confirm(`Duplicate configuration and dedicated database for '${client.name}'?`)) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/clients/${client.id}/duplicate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', data.message);
        fetchClients();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Failed to duplicate client');
    } finally {
      setActionLoading(false);
    }
  };

  const handleImpersonateAdmin = async (client: Tenant) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/clients/${client.id}/impersonate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success && data.portalUrl) {
        showToast('success', `Impersonating ${client.name} — opening tenant admin...`);
        window.open(data.portalUrl, '_blank');
      } else {
        showToast('error', data.message || 'Impersonation failed');
      }
    } catch (err) {
      showToast('error', 'Failed to impersonate tenant admin');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (client: Tenant) => {
    const newStatus = client.status === 'active' ? 'suspended' : 'active';
    try {
      setActionLoading(true);
      const res = await fetch(`/api/clients/${client.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', `Tenant status set to '${newStatus}'!`);
        fetchClients();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Failed to update tenant status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteClient = async (client: Tenant) => {
    const typed = window.prompt(
      `Permanently delete '${client.name}'? The client must be suspended first.\nType the slug "${client.slug}" to confirm:`
    );
    if (typed === null) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmSlug: typed.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Client deleted successfully');
        fetchClients();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Failed to delete client');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomainInput || !newDomainTenantId) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: newDomainTenantId, domain: newDomainInput }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', data.message);
        setNewDomainInput('');
        fetchDomains();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Failed to register domain');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyDomain = async (domainStr: string) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/domains/${encodeURIComponent(domainStr)}/verify`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', `Domain '${domainStr}' verification completed!`);
        fetchDomains();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Domain verification failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTriggerBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildTenantId) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: buildTenantId,
          panelType: buildPanelType,
          buildType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', data.message);
        fetchBuilds();
      } else {
        showToast('error', data.message);
      }
    } catch (err) {
      showToast('error', 'Failed to trigger build');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenStudio = (client: Tenant) => {
    setSelectedClientForStudio(client);
    setActiveTab('studio');
  };

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.dbName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTemplate = filterTemplate === 'all' || c.templateId === filterTemplate;
    return matchesSearch && matchesTemplate;
  });

  const pageMeta = PAGE_META[activeTab];

  const countFor = (id: TabId): number | undefined => {
    if (id === 'clients') return clients.length;
    if (id === 'templates') return AVAILABLE_TEMPLATES.length;
    if (id === 'domains') return domains.length;
    if (id === 'builds') return builds.length;
    if (id === 'databases') return clients.length;
    return undefined;
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/login');
  };

  return (
    <div className="flex min-h-screen bg-[#0A0D14] text-slate-200 font-sans antialiased">
      {/* Toast */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-[60] flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            notification.type === 'success'
              ? 'border-emerald-500/30 bg-[#0F1F1A] text-emerald-300'
              : 'border-rose-500/30 bg-[#21131A] text-rose-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-[#0C1119] md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">CAMSIK</div>
            <div className="truncate text-[11px] text-slate-500">Super Admin</div>
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          <div>
            <button
              onClick={() => setActiveTab('clients')}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                activeTab === 'clients' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Overview</span>
            </button>
          </div>

          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = activeTab === item.id;
                  const count = countFor(item.id);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        active
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </span>
                      {count !== undefined && (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] ${
                            active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800 p-3">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/50 hover:text-slate-100 transition"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-800 bg-[#0C1119]/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-slate-500 sm:inline">Super Admin</span>
            <span className="hidden text-slate-700 sm:inline">/</span>
            <span className="truncate font-medium text-slate-100">{pageMeta.title}</span>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={BTN_ICON} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
            <button onClick={() => setShowWizard(true)} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New client</span>
            </button>
            <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200 md:hidden">
              SA
            </div>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-[#0C1119] px-4 py-2 md:hidden">
          {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                activeTab === item.id ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 sm:p-6">
          {/* Page header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">{pageMeta.title}</h1>
              <p className="mt-1 text-sm text-slate-400">{pageMeta.description}</p>
            </div>
            {activeTab === 'clients' && (
              <button onClick={() => setShowWizard(true)} className={BTN_PRIMARY}>
                <Plus className="h-4 w-4" />
                Onboard client
              </button>
            )}
          </div>

          {/* KPI row: every figure comes from /api/overview (backend records) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total clients"
              value={overview ? overview.clients.total : '—'}
              hint={overview ? `${overview.clients.active} active · ${overview.clients.trial} trial · ${overview.clients.suspended} suspended` : 'Loading'}
              icon={Users}
            />
            <StatCard
              label="Provisioned databases"
              value={overview ? overview.databases.provisioned : '—'}
              hint={overview ? `${overview.databases.pending} pending provisioning` : 'Loading'}
              icon={Database}
            />
            <StatCard
              label="Connected domains"
              value={overview ? (overview.domains.connected ?? 'Not tracked') : '—'}
              hint={overview ? `SSL active: ${overview.domains.sslActive ?? 'not issued yet'}` : 'Loading'}
              icon={Globe}
            />
            <StatCard
              label="Monthly recurring revenue"
              value={overview ? `₹${(overview.subscriptions.monthlyRecurringRevenue / 1000).toFixed(1)}k` : '—'}
              hint={overview ? `${overview.subscriptions.active} active subscriptions` : 'Loading'}
              icon={Wallet}
            />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Design templates"
              value={overview ? overview.templates.total : AVAILABLE_TEMPLATES.length}
              hint="In the template catalogue"
              icon={Palette}
            />
            <StatCard
              label="Android builds"
              value={overview ? overview.builds.android.total : '—'}
              hint={overview ? `${overview.builds.android.completed} completed · ${overview.builds.android.queued} queued` : 'Loading'}
              icon={Cpu}
            />
            <StatCard
              label="iOS builds"
              value={overview ? overview.builds.ios.total : '—'}
              hint={overview ? `${overview.builds.ios.completed} completed · ${overview.builds.ios.queued} queued` : 'Loading'}
              icon={Cpu}
            />
            <StatCard
              label="Failed deployments"
              value={overview && overview.deployments.failed !== null ? overview.deployments.failed : 'Not tracked'}
              hint="Deployment pipeline not built yet"
              icon={Activity}
            />
          </div>

          {activeTab === 'clients' && overview && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
                <h2 className="text-sm font-semibold text-white">Recent activity</h2>
                <span className="text-xs text-slate-500">Latest 15 audited actions</span>
              </div>
              <ul className="divide-y divide-slate-800/70">
                {overview.recentActivity.length === 0 && (
                  <li className="px-5 py-6 text-center text-sm text-slate-500">No activity recorded yet.</li>
                )}
                {overview.recentActivity.map((a: any, i: number) => (
                  <li key={`${a.createdAt}-${i}`} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-emerald-300">{a.action}</span>
                      {a.tenantSlug && <span className="ml-2 text-xs text-slate-400">{a.tenantSlug}</span>}
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      <div>{a.actorEmail}</div>
                      <div>{new Date(a.createdAt).toLocaleString()}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* TAB: CLIENTS */}
          {activeTab === 'clients' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search by name, slug or database"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`${INPUT} pl-9`}
                  />
                </div>
                <select
                  value={filterTemplate}
                  onChange={(e) => setFilterTemplate(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-[#0A0F1A] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">All templates</option>
                  {AVAILABLE_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px]">
                    <thead className={TABLE_HEAD}>
                      <tr>
                        <th className={TH}>Client</th>
                        <th className={TH}>Database</th>
                        <th className={TH}>Template</th>
                        <th className={TH}>Plan</th>
                        <th className={TH}>Status</th>
                        <th className={`${TH} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredClients.map((client) => {
                        const template = AVAILABLE_TEMPLATES.find((t) => t.id === client.templateId);
                        return (
                          <tr key={client.id} className="hover:bg-slate-800/30 transition">
                            <td className={TD}>
                              <div className="flex items-center gap-3">
                                <div
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-black"
                                  style={{ backgroundColor: client.branding?.primaryColor || '#10B981' }}
                                >
                                  {client.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-white">{client.name}</div>
                                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                    <Globe className="h-3 w-3" />
                                    <span>{client.slug}.camsik.com</span>
                                    {client.customDomain && (
                                      <>
                                        <span className="text-slate-700">•</span>
                                        <span className="text-cyan-400">{client.customDomain}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className={TD}>
                              <div className="font-mono text-xs text-slate-200">{client.dbName}</div>
                              <div className="mt-1 text-xs">
                                {client.dbProvisioned ? (
                                  <Badge tone="green">Provisioned</Badge>
                                ) : (
                                  <Badge tone="amber">Pending</Badge>
                                )}
                              </div>
                            </td>

                            <td className={TD}>
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: template?.previewColor || '#10B981' }}
                                />
                                <span className="text-slate-100">{template?.name || client.templateId}</span>
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-slate-500">{template?.layoutStyle}</div>
                            </td>

                            <td className={TD}>
                              <div className="text-slate-100 capitalize">{client.subscription?.plan || 'starter'}</div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                ₹{(client.subscription?.priceMonthly || 0).toLocaleString()} / mo
                              </div>
                            </td>

                            <td className={TD}>
                              {client.status === 'active' ? (
                                <Badge tone="green">Active</Badge>
                              ) : client.status === 'suspended' ? (
                                <Badge tone="red">Suspended</Badge>
                              ) : (
                                <Badge tone="amber">{client.status}</Badge>
                              )}
                            </td>

                            <td className={`${TD} text-right`}>
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleOpenStudio(client)}
                                  className={BTN_ICON}
                                  title="Open Theme Studio"
                                >
                                  <Sliders className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleImpersonateAdmin(client)}
                                  disabled={actionLoading}
                                  className={BTN_ICON}
                                  title="Impersonate tenant admin"
                                >
                                  <UserCheck className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDuplicateClient(client)}
                                  disabled={actionLoading}
                                  className={BTN_ICON}
                                  title="Duplicate tenant & database"
                                >
                                  <Copy className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleInspectDb(client)}
                                  className={BTN_ICON}
                                  title="Inspect database"
                                >
                                  <Database className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleToggleStatus(client)}
                                  disabled={actionLoading}
                                  className={`${BTN_ICON} ${
                                    client.status === 'active' ? 'hover:text-amber-400' : 'hover:text-emerald-400'
                                  }`}
                                  title={client.status === 'active' ? 'Suspend tenant' : 'Activate tenant'}
                                >
                                  <Power className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteClient(client)}
                                  disabled={actionLoading}
                                  className={`${BTN_ICON} hover:border-rose-500/50 hover:text-rose-400`}
                                  title="Delete tenant"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredClients.length === 0 && (
                        <EmptyRow colSpan={6}>
                          {clients.length === 0
                            ? 'No clients yet. Create your first client to get started.'
                            : 'No clients match your filters.'}
                        </EmptyRow>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: THEME STUDIO */}
          {activeTab === 'studio' && (
            <ThemePreviewStudio
              tenant={selectedClientForStudio || clients[0]}
              onSave={async (tokens, overrides) => {
                const target = selectedClientForStudio || clients[0];
                if (!target) return;
                try {
                  setActionLoading(true);
                  const res = await fetch(`/api/clients/${target.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      branding: {
                        ...target.branding,
                        primaryColor: tokens.primaryColor,
                        secondaryColor: tokens.secondaryColor,
                        accentColor: tokens.accentColor,
                        panelOverrides: overrides,
                      },
                    }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    showToast('success', `Branding saved for ${target.name}!`);
                    fetchClients();
                  }
                } catch (err) {
                  showToast('error', 'Failed to save branding');
                } finally {
                  setActionLoading(false);
                }
              }}
            />
          )}

          {/* TAB: TEMPLATES */}
          {activeTab === 'templates' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {AVAILABLE_TEMPLATES.map((tmpl) => {
                const assignedCount = clients.filter((c) => c.templateId === tmpl.id).length;
                return (
                  <div key={tmpl.id} className={`${CARD} flex flex-col overflow-hidden`}>
                    <div className="h-1" style={{ backgroundColor: tmpl.previewColor }} />
                    <div className="flex flex-1 flex-col gap-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-white">{tmpl.name}</h3>
                            <Badge tone="violet">{tmpl.badge}</Badge>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">{tmpl.description}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs text-slate-500">Tenants</div>
                          <div className="text-lg font-semibold text-white">{assignedCount}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">Palette</span>
                        <div className="flex items-center gap-1.5">
                          <span className="h-4 w-4 rounded-full border border-white/10" style={{ backgroundColor: tmpl.tokens.primaryColor }} />
                          <span className="h-4 w-4 rounded-full border border-white/10" style={{ backgroundColor: tmpl.tokens.secondaryColor }} />
                          <span className="h-4 w-4 rounded-full border border-white/10" style={{ backgroundColor: tmpl.tokens.accentColor }} />
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs">
                        <span className="text-slate-500">Recommended for: </span>
                        <span className="text-slate-200">{tmpl.recommendedFor}</span>
                      </div>

                      <div className="mt-auto border-t border-slate-800 pt-4">
                        <button
                          onClick={() => {
                            setSelectedClientForStudio(clients[0] || null);
                            setActiveTab('studio');
                          }}
                          className={`${BTN_SECONDARY} w-full`}
                        >
                          <Sliders className="h-4 w-4" />
                          Inspect in Theme Studio
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB: DOMAINS */}
          {activeTab === 'domains' && (
            <div className="space-y-4">
              <form onSubmit={handleAddDomain} className={`${CARD} p-5`}>
                <h2 className="text-sm font-semibold text-white">Map a new domain</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Point the hostname&apos;s CNAME to <span className="font-mono text-slate-300">camsik-proxy.camsik.com</span>, then verify.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className={LABEL}>Tenant</label>
                    <select
                      value={newDomainTenantId}
                      onChange={(e) => setNewDomainTenantId(e.target.value)}
                      className={INPUT}
                    >
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.slug}.camsik.com)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL}>Hostname</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        placeholder="sell.gadgethub.in"
                        value={newDomainInput}
                        onChange={(e) => setNewDomainInput(e.target.value)}
                        className={`${INPUT} font-mono`}
                      />
                      <button type="submit" disabled={actionLoading} className={`${BTN_PRIMARY} whitespace-nowrap`}>
                        Add domain
                      </button>
                    </div>
                  </div>
                </div>
              </form>

              <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className={TABLE_HEAD}>
                      <tr>
                        <th className={TH}>Hostname</th>
                        <th className={TH}>Tenant</th>
                        <th className={TH}>DNS record</th>
                        <th className={TH}>Status</th>
                        <th className={`${TH} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {domains.map((dom) => (
                        <tr key={dom.id} className="hover:bg-slate-800/30 transition">
                          <td className={TD}>
                            <div className="flex items-center gap-2 font-mono text-sm text-white">
                              <Globe className="h-3.5 w-3.5 text-slate-500" />
                              {dom.domain}
                            </div>
                          </td>
                          <td className={`${TD} font-medium text-slate-100`}>{dom.tenantSlug}</td>
                          <td className={`${TD} font-mono text-xs`}>
                            CNAME → <span className="text-cyan-400">camsik-proxy.camsik.com</span>
                          </td>
                          <td className={TD}>
                            <div className="flex items-center gap-2">
                              {dom.status === 'active' ? (
                                <Badge tone="green">Active</Badge>
                              ) : (
                                <Badge tone="amber">{dom.status}</Badge>
                              )}
                              <span className="text-xs text-slate-500">SSL: {dom.sslStatus}</span>
                            </div>
                          </td>
                          <td className={`${TD} text-right`}>
                            <button
                              onClick={() => handleVerifyDomain(dom.domain)}
                              disabled={actionLoading}
                              className={BTN_SECONDARY}
                            >
                              Verify DNS
                            </button>
                          </td>
                        </tr>
                      ))}
                      {domains.length === 0 && (
                        <EmptyRow colSpan={5}>No custom domains yet. Add one above to connect a hostname.</EmptyRow>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: MOBILE BUILDS */}
          {activeTab === 'builds' && (
            <div className="space-y-4">
              <form onSubmit={handleTriggerBuild} className={`${CARD} p-5`}>
                <h2 className="text-sm font-semibold text-white">New build</h2>
                <p className="mt-1 text-xs text-slate-400">Compile a branded artifact for a tenant application.</p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div>
                    <label className={LABEL}>Tenant</label>
                    <select value={buildTenantId} onChange={(e) => setBuildTenantId(e.target.value)} className={INPUT}>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Application</label>
                    <select value={buildPanelType} onChange={(e) => setBuildPanelType(e.target.value)} className={INPUT}>
                      <option value="user_android">User App (Android)</option>
                      <option value="user_ios">User App (iOS)</option>
                      <option value="partner_android">Partner POS (Android)</option>
                      <option value="partner_ios">Partner POS (iOS)</option>
                      <option value="delivery_android">Delivery Rider (Android)</option>
                      <option value="delivery_ios">Delivery Rider (iOS)</option>
                      <option value="admin_android">Admin Mobile (Android)</option>
                      <option value="admin_ios">Admin Mobile (iOS)</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Format</label>
                    <select value={buildType} onChange={(e) => setBuildType(e.target.value)} className={INPUT}>
                      <option value="release_apk">Release APK (sideload)</option>
                      <option value="aab">Android App Bundle (Play Store)</option>
                      <option value="ipa">iOS IPA (TestFlight / App Store)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button type="submit" disabled={actionLoading} className={`${BTN_PRIMARY} w-full`}>
                      <Cpu className="h-4 w-4" />
                      Compile build
                    </button>
                  </div>
                </div>
              </form>

              <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className={TABLE_HEAD}>
                      <tr>
                        <th className={TH}>Build ID</th>
                        <th className={TH}>Tenant / application</th>
                        <th className={TH}>Format</th>
                        <th className={TH}>Status</th>
                        <th className={`${TH} text-right`}>Artifacts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {builds.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-800/30 transition">
                          <td className={`${TD} font-mono text-xs text-slate-400`}>{b.id}</td>
                          <td className={TD}>
                            <div className="font-medium text-white">{b.appName || b.tenantSlug}</div>
                            <div className="mt-0.5 font-mono text-xs text-slate-500">{b.panelType}</div>
                          </td>
                          <td className={TD}>
                            <Badge tone="slate">
                              {b.buildType} · {b.artifactSizeMb} MB
                            </Badge>
                          </td>
                          <td className={TD}>
                            <Badge tone="green">
                              <CheckCircle2 className="h-3 w-3" />
                              {b.status}
                            </Badge>
                          </td>
                          <td className={`${TD} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => setSelectedBuildLogs(b.buildLogs || [])} className={BTN_SECONDARY}>
                                <Terminal className="h-3.5 w-3.5" />
                                Logs
                              </button>
                              {b.artifactUrl && (
                                <a href={b.artifactUrl} download className={BTN_SECONDARY}>
                                  <Download className="h-3.5 w-3.5" />
                                  Download
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {builds.length === 0 && (
                        <EmptyRow colSpan={5}>No builds yet. Select a tenant and compile the first build.</EmptyRow>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: DATABASES */}
          {activeTab === 'databases' && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead className={TABLE_HEAD}>
                    <tr>
                      <th className={TH}>Tenant</th>
                      <th className={TH}>Database</th>
                      <th className={TH}>Plan</th>
                      <th className={TH}>Provisioned</th>
                      <th className={`${TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {clients.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-800/30 transition">
                        <td className={`${TD} font-medium text-white`}>{c.name}</td>
                        <td className={`${TD} font-mono text-xs text-slate-300`}>{c.dbName}</td>
                        <td className={`${TD} capitalize`}>{c.subscription?.plan || 'starter'}</td>
                        <td className={TD}>
                          {c.dbProvisioned ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">Pending</Badge>}
                        </td>
                        <td className={`${TD} text-right`}>
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleInspectDb(c)} className={BTN_SECONDARY}>
                              <Database className="h-3.5 w-3.5" />
                              Inspect
                            </button>
                            <button
                              onClick={() => handleReprovisionDb(c.id)}
                              disabled={actionLoading}
                              className={BTN_ICON}
                              title="Re-seed diagnostic catalog"
                            >
                              <RefreshCw className={`h-4 w-4 ${actionLoading ? 'animate-spin' : ''}`} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {clients.length === 0 && <EmptyRow colSpan={5}>No databases provisioned yet.</EmptyRow>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Onboarding wizard */}
      <TenantCreationWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onSuccess={() => {
          setShowWizard(false);
          showToast('success', 'Client provisioned and catalog seeded.');
          fetchClients();
        }}
      />

      {/* Database inspector */}
      {selectedClientForDb && (
        <Modal
          title="Database inspector"
          icon={Database}
          onClose={() => setSelectedClientForDb(null)}
          footer={
            <>
              <button
                onClick={() => handleReprovisionDb(selectedClientForDb.id)}
                disabled={actionLoading}
                className={BTN_SECONDARY}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
                Re-seed catalog
              </button>
              <button onClick={() => setSelectedClientForDb(null)} className={BTN_PRIMARY}>
                Done
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium text-white">{selectedClientForDb.name}</div>
                <div className="mt-0.5 font-mono text-xs text-slate-400">{selectedClientForDb.dbName}</div>
              </div>
              {dbStatusDetails ? <Badge tone="green">Connected</Badge> : <Badge tone="slate">Loading</Badge>}
            </div>

            {dbStatusDetails ? (
              <div className="overflow-hidden rounded-lg border border-slate-800">
                <div className="border-b border-slate-800 bg-slate-900/60 px-3.5 py-2 text-xs font-medium text-slate-400">
                  Collections
                </div>
                <div className="max-h-64 divide-y divide-slate-800/70 overflow-y-auto">
                  {dbStatusDetails.collections?.length > 0 ? (
                    dbStatusDetails.collections.map((col: any) => (
                      <div key={col.name} className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="font-mono text-slate-200">{col.name}</span>
                        <span className="text-xs text-slate-400">{col.count} docs</span>
                      </div>
                    ))
                  ) : (
                    <div className="px-3.5 py-6 text-center text-sm text-slate-500">No collections yet.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Inspecting collections…
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Build logs */}
      {selectedBuildLogs && (
        <Modal
          title="Build logs"
          icon={Terminal}
          width="max-w-2xl"
          onClose={() => setSelectedBuildLogs(null)}
          footer={
            <button onClick={() => setSelectedBuildLogs(null)} className={BTN_PRIMARY}>
              Close
            </button>
          }
        >
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-[#05070B] p-4 font-mono text-xs leading-relaxed text-slate-300">
            {selectedBuildLogs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
