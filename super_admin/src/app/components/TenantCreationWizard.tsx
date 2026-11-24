'use client';

import React, { useState } from 'react';
import {
  Building2,
  Database,
  Palette,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Shield,
  Layers,
  Lock,
  Mail,
  Phone,
  Globe,
  Loader2,
  Check,
  Upload,
  RefreshCw,
} from 'lucide-react';
import { THEMES_REGISTRY } from '@/lib/themesRegistry';

interface WizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TenantCreationWizard({ isOpen, onClose, onSuccess }: WizardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Brand assets and the real provisioning job
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [uploadedKinds, setUploadedKinds] = useState<string[]>([]);
  const [job, setJob] = useState<any>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Real-time Provisioning Progress States
  const [provisionProgress, setProvisionProgress] = useState<{
    step: number;
    text: string;
    completed: boolean;
    failed: boolean;
  }>({
    step: 0,
    text: '',
    completed: false,
    failed: false,
  });

  // Step 1: Business Details
  const [businessData, setBusinessData] = useState({
    name: '',
    brandName: '',
    slug: '',
    companyEmail: '',
    supportPhone: '+91 98000 00000',
    country: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    timeZone: 'Asia/Kolkata',
    websiteTitle: '',
    businessType: 'recommerce_retail',
    gstEnabled: true,
    gstNumber: '',
  });

  // Step 2: Database Provisioning Options
  const [dbConfig, setDbConfig] = useState({
    dbName: '',
    seedCatalog: true,
    seedValuationTree: true,
    seedRoles: true,
    seedCms: true,
  });

  // Step 3: Platform & 15-Theme Selection
  const [selectedThemeId, setSelectedThemeId] = useState(THEMES_REGISTRY[0].id);
  const selectedTheme = THEMES_REGISTRY.find((t) => t.id === selectedThemeId) || THEMES_REGISTRY[0];
  const [customColors, setCustomColors] = useState({
    primary: selectedTheme.tokens.primaryColor,
    secondary: selectedTheme.tokens.secondaryColor,
    accent: selectedTheme.tokens.accentColor,
  });

  // Step 4: Client Administrator Setup
  const [adminType, setAdminType] = useState<'invite'>('invite');
  const [adminData, setAdminData] = useState({
    name: '',
    email: '',
    password: '',
  });

  if (!isOpen) return null;

  const handleNameChange = (val: string) => {
    const slug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const cleanDb = `casmik_tenant_${slug.replace(/-/g, '_')}`;

    setBusinessData((prev) => ({
      ...prev,
      name: val,
      brandName: prev.brandName === '' || prev.brandName === prev.name ? val : prev.brandName,
      slug: prev.slug === '' || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') ? slug : prev.slug,
      websiteTitle: prev.websiteTitle === '' ? `${val} — Instant Device ReCommerce` : prev.websiteTitle,
    }));

    setDbConfig((prev) => ({
      ...prev,
      dbName: cleanDb,
    }));

    if (!adminData.email) {
      setAdminData((prev) => ({
        ...prev,
        email: `admin@${slug || 'tenant'}.com`,
        name: `${val} Admin`,
      }));
    }
  };

  const handleThemeSelect = (themeId: string) => {
    setSelectedThemeId(themeId);
    const th = THEMES_REGISTRY.find((t) => t.id === themeId);
    if (th) {
      setCustomColors({
        primary: th.tokens.primaryColor,
        secondary: th.tokens.secondaryColor,
        accent: th.tokens.accentColor,
      });
    }
  };

  const executeProvisioning = async () => {
    setLoading(true);
    setError(null);
    setCurrentStep(5);
    setProvisionProgress({ step: 1, text: 'Starting...', completed: false, failed: false });

    try {
      // 1. Tenant record. Created once; a retry reuses it instead of creating a duplicate.
      let id = tenantId;
      if (!id) {
        setProvisionProgress({ step: 1, text: 'Creating tenant record...', completed: false, failed: false });
        const res = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Could not create the tenant record');
        id = data.client.id as string;
        setTenantId(id);
      }

      // 2. Brand assets. Each kind is uploaded once; a retry skips what is already stored.
      for (const [kind, file] of [['logo', logoFile], ['favicon', faviconFile]] as const) {
        if (!file || uploadedKinds.includes(kind)) continue;
        setProvisionProgress({ step: 2, text: `Uploading ${kind}...`, completed: false, failed: false });
        const form = new FormData();
        form.append('kind', kind);
        form.append('file', file);
        const r = await fetch(`/api/clients/${id}/assets`, { method: 'POST', body: form });
        const d = await r.json();
        if (!d.success) throw new Error(`${kind} was rejected: ${d.message}`);
        setUploadedKinds((prev) => [...prev, kind]);
      }

      // 3. Provisioning job. Creating it runs nothing; the run below does the work.
      setProvisionProgress({ step: 3, text: 'Creating provisioning job...', completed: false, failed: false });
      const jr = await fetch('/api/provisioning-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: id,
          adminEmail: adminData.email || businessData.companyEmail,
          adminName: adminData.name || `${businessData.name} Admin`,
        }),
      });
      const jd = await jr.json();
      if (!jd.success) throw new Error(jd.message || 'Could not create the provisioning job');
      if (jd.inviteToken) setInviteToken(jd.inviteToken);
      const jobId = jd.job.id as string;
      setJob(jd.job);

      // 4. Run, while polling the job for live step status.
      const poll = setInterval(async () => {
        try {
          const g = await fetch(`/api/provisioning-jobs/${jobId}`);
          const gd = await g.json();
          if (gd.success) setJob(gd.job);
        } catch {
          /* the next tick retries */
        }
      }, 1000);
      let rd: any;
      try {
        const rr = await fetch(`/api/provisioning-jobs/${jobId}/run`, { method: 'POST' });
        rd = await rr.json();
      } finally {
        clearInterval(poll);
      }
      if (rd.job) setJob(rd.job);
      if (!rd.success) {
        const failed = rd.job?.steps?.find((st: any) => st.status === 'failed');
        throw new Error(failed ? `${failed.label}: ${failed.error}` : rd.message || 'Provisioning failed');
      }

      setProvisionProgress({ step: 4, text: 'Tenant provisioned and verified.', completed: true, failed: false });
      setLoading(false);
    } catch (err: any) {
      const message = err?.message || 'Provisioning failed';
      setError(message);
      setProvisionProgress((prev) => ({ ...prev, text: message, failed: true, completed: false }));
      setLoading(false);
    }
  };

  const buildPayload = () => ({
    name: businessData.name,
    slug: businessData.slug,
    dbName: dbConfig.dbName || `casmik_tenant_${businessData.slug.replace(/-/g, '_')}`,
    templateId: selectedThemeId,
    status: 'active',
    branding: {
      brandName: businessData.brandName || businessData.name,
      tagline: 'Instant Cash for Used Electronics at Your Doorstep',
      primaryColor: customColors.primary,
      secondaryColor: customColors.secondary,
      accentColor: customColors.accent,
      supportEmail: businessData.companyEmail || adminData.email,
      supportPhone: businessData.supportPhone,
      currency: businessData.currency,
      currencySymbol: businessData.currencySymbol,
      timeZone: businessData.timeZone,
      country: businessData.country,
    },
    features: { buyback: true, refurbished: true, rentals: false, repairs: true, exchange: true },
    subscription: {
      plan: 'growth',
      status: 'active',
      validUntil: new Date(Date.now() + 365 * 86400000).toISOString(),
      maxOrdersPerMonth: 2500,
      customDomainEnabled: true,
      priceMonthly: 7999,
    },
    // The owner always sets their own password through a single-use invite. The control plane never
    // sets or sees client passwords.
    adminEmail: adminData.email || businessData.companyEmail,
    adminName: adminData.name || `${businessData.name} Admin`,
    autoProvision: false,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-[#0D121F] border border-slate-800 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col my-8">
        {/* Wizard Header */}
        <div className="px-8 py-6 border-b border-slate-800/80 bg-[#111728] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-black font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Onboard New White-Label Client</h2>
              <p className="text-xs text-slate-400">Step {currentStep} of 5 — Automated Tenant Provisioning</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-semibold transition"
          >
            ✕
          </button>
        </div>

        {/* Stepper Progress Bar */}
        <div className="px-8 pt-4 pb-2 bg-[#0E1422] border-b border-slate-800/60">
          <div className="grid grid-cols-5 gap-2">
            {[
              { num: 1, label: 'Business Details', icon: Building2 },
              { num: 2, label: 'Database Setup', icon: Database },
              { num: 3, label: 'Branding & Theme', icon: Palette },
              { num: 4, label: 'Client Admin', icon: UserCheck },
              { num: 5, label: 'Review & Deploy', icon: Shield },
            ].map((step) => {
              const Icon = step.icon;
              const isActive = currentStep === step.num;
              const isDone = currentStep > step.num;
              return (
                <div
                  key={step.num}
                  className={`flex items-center space-x-2 py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                    isActive
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                      : isDone
                      ? 'bg-slate-800/50 border-slate-700/60 text-slate-300'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] shrink-0 font-bold ${
                      isActive
                        ? 'bg-emerald-500 text-black'
                        : isDone
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {isDone ? <Check className="w-3.5 h-3.5" /> : step.num}
                  </div>
                  <span className="hidden sm:inline truncate">{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Wizard Body */}
        <div className="p-8 flex-1 overflow-y-auto max-h-[60vh] space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300 text-xs flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: BUSINESS DETAILS */}
          {currentStep === 1 && (
            <div className="space-y-5 animate-fadeIn">
              <div>
                <h3 className="text-sm font-bold text-white">Step 1: Client & Business Information</h3>
                <p className="text-xs text-slate-400 mt-0.5">Define client identification and regional settings.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Business / Company Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ReCyclePro Technologies Pvt Ltd"
                    value={businessData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-full bg-[#121827] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Consumer Brand Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ReCyclePro"
                    value={businessData.brandName}
                    onChange={(e) => setBusinessData({ ...businessData, brandName: e.target.value })}
                    className="w-full bg-[#121827] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Unique Tenant Slug *</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="recyclepro"
                      value={businessData.slug}
                      onChange={(e) => {
                        const s = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setBusinessData({ ...businessData, slug: s });
                        setDbConfig({ ...dbConfig, dbName: `casmik_tenant_${s.replace(/-/g, '_')}` });
                      }}
                      className="w-full bg-[#121827] border border-slate-700/80 rounded-xl pl-3.5 pr-28 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <span className="absolute right-3 top-2.5 text-[11px] text-slate-500 font-mono">.camsik.com</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Company Official Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="contact@recyclepro.com"
                    value={businessData.companyEmail}
                    onChange={(e) => setBusinessData({ ...businessData, companyEmail: e.target.value })}
                    className="w-full bg-[#121827] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Customer Support Phone</label>
                  <input
                    type="tel"
                    placeholder="+91 98000 00000"
                    value={businessData.supportPhone}
                    onChange={(e) => setBusinessData({ ...businessData, supportPhone: e.target.value })}
                    className="w-full bg-[#121827] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Currency & Timezone</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={businessData.currency}
                      onChange={(e) => setBusinessData({ ...businessData, currency: e.target.value, currencySymbol: e.target.value === 'INR' ? '₹' : '$' })}
                      className="bg-[#121827] border border-slate-700/80 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                      <option value="AED">AED (AED)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                    <select
                      value={businessData.timeZone}
                      onChange={(e) => setBusinessData({ ...businessData, timeZone: e.target.value })}
                      className="bg-[#121827] border border-slate-700/80 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                      <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                      <option value="America/New_York">America/New_York (EST)</option>
                      <option value="Europe/London">Europe/London (GMT)</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-white">Brand assets</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    SVG, PNG or WebP. The server checks the file contents, not just the extension.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AssetPicker
                    label="Company logo (max 512 KB)"
                    maxKb={512}
                    file={logoFile}
                    onReject={setAssetError}
                    onChange={(f) => {
                      setLogoFile(f);
                      setUploadedKinds((prev) => prev.filter((k) => k !== 'logo'));
                    }}
                  />
                  <AssetPicker
                    label="Favicon (max 128 KB)"
                    maxKb={128}
                    file={faviconFile}
                    onReject={setAssetError}
                    onChange={(f) => {
                      setFaviconFile(f);
                      setUploadedKinds((prev) => prev.filter((k) => k !== 'favicon'));
                    }}
                  />
                </div>
                {assetError && <p className="text-xs text-rose-400">{assetError}</p>}
              </div>
            </div>
          )}

          {/* STEP 2: DATABASE PROVISIONING */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-fadeIn">
              <div>
                <h3 className="text-sm font-bold text-white">Step 2: Database Isolation & Provisioning</h3>
                <p className="text-xs text-slate-400 mt-0.5">Automated provisioning of a dedicated, physically isolated MongoDB database.</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#121827] border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-medium text-slate-300">Dedicated MongoDB Database Name</label>
                    <p className="text-[11px] text-slate-400">Strictly isolated cluster database for this tenant.</p>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg">
                    Database-per-Tenant Model
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                  <input
                    type="text"
                    value={dbConfig.dbName}
                    onChange={(e) => setDbConfig({ ...dbConfig, dbName: e.target.value })}
                    className="w-full bg-[#0A0D15] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-emerald-300 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Automated Seed Modules</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {[
                    { key: 'seedCatalog', title: 'Electronic Catalog & Brands', desc: 'Pre-seeds Smartphones, Laptops, DSLR Cameras, and 30+ top brands' },
                    { key: 'seedValuationTree', title: '45-Point Diagnostics Tree', desc: 'Pre-seeds condition deduction questions, screen tests, and pricing algorithms' },
                    { key: 'seedRoles', title: 'RBAC Roles & Permissions', desc: 'Owner, Admin, Operations, Rider Manager, and Support roles' },
                    { key: 'seedCms', title: 'CMS Sections & Badges', desc: 'Home hero banners, trust badges, and ReCommerce FAQs' },
                  ].map((seedItem) => (
                    <div
                      key={seedItem.key}
                      onClick={() => setDbConfig({ ...dbConfig, [seedItem.key]: !(dbConfig as any)[seedItem.key] })}
                      className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start space-x-3 ${
                        (dbConfig as any)[seedItem.key]
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                          : 'bg-slate-900/40 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                          (dbConfig as any)[seedItem.key] ? 'bg-emerald-500 text-black' : 'bg-slate-800 text-slate-600'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="font-semibold text-xs">{seedItem.title}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{seedItem.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: BRANDING & 15-THEME SELECTION */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-fadeIn">
              <div>
                <h3 className="text-sm font-bold text-white">Step 3: Select Design System & Brand Palette</h3>
                <p className="text-xs text-slate-400 mt-0.5">Choose from 15 pre-engineered design systems or customize colors.</p>
              </div>

              {/* Theme Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-h-60 overflow-y-auto pr-1">
                {THEMES_REGISTRY.map((theme) => {
                  const isSelected = selectedThemeId === theme.id;
                  return (
                    <div
                      key={theme.id}
                      onClick={() => handleThemeSelect(theme.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        isSelected
                          ? 'bg-emerald-500/15 border-emerald-500 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500'
                          : 'bg-[#121827] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-xs text-white">{theme.name}</span>
                          <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-slate-800 text-slate-300 rounded">
                            {theme.badge}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1.5 mb-2">
                          <div className="w-4 h-4 rounded-full border border-slate-600" style={{ backgroundColor: theme.tokens.primaryColor }} />
                          <div className="w-4 h-4 rounded-full border border-slate-600" style={{ backgroundColor: theme.tokens.secondaryColor }} />
                          <div className="w-4 h-4 rounded-full border border-slate-600" style={{ backgroundColor: theme.tokens.accentColor }} />
                        </div>
                        <p className="text-[10px] text-slate-400 line-clamp-2">{theme.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Custom Colors */}
              <div className="p-4 rounded-2xl bg-[#121827] border border-slate-800 grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">Primary Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={customColors.primary}
                      onChange={(e) => setCustomColors({ ...customColors, primary: e.target.value })}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <input
                      type="text"
                      value={customColors.primary}
                      onChange={(e) => setCustomColors({ ...customColors, primary: e.target.value })}
                      className="w-full bg-[#0A0D15] border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">Secondary Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={customColors.secondary}
                      onChange={(e) => setCustomColors({ ...customColors, secondary: e.target.value })}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <input
                      type="text"
                      value={customColors.secondary}
                      onChange={(e) => setCustomColors({ ...customColors, secondary: e.target.value })}
                      className="w-full bg-[#0A0D15] border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">Accent / CTA Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={customColors.accent}
                      onChange={(e) => setCustomColors({ ...customColors, accent: e.target.value })}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <input
                      type="text"
                      value={customColors.accent}
                      onChange={(e) => setCustomColors({ ...customColors, accent: e.target.value })}
                      className="w-full bg-[#0A0D15] border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono uppercase"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: CLIENT ADMINISTRATOR SETUP */}
          {currentStep === 4 && (
            <div className="space-y-5 animate-fadeIn">
              <div>
                <h3 className="text-sm font-bold text-white">Step 4: Client Administrator Credentials</h3>
                <p className="text-xs text-slate-400 mt-0.5">Configure initial owner access for the client to manage their ReCommerce platform.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div
                  onClick={() => setAdminType('invite')}
                  className={`p-4 rounded-xl border cursor-pointer transition ${
                    adminType === 'invite'
                      ? 'bg-emerald-500/10 border-emerald-500 text-white'
                      : 'bg-[#121827] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-xs mb-1">Secure Onboarding Invitation</div>
                  <div className="text-[11px] text-slate-400">Client receives secure invite link to set up their own password and 2FA.</div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-[#121827] border border-slate-800 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Administrator Full Name</label>
                  <input
                    type="text"
                    value={adminData.name}
                    onChange={(e) => setAdminData({ ...adminData, name: e.target.value })}
                    className="w-full bg-[#0A0D15] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Administrator Email Address</label>
                  <input
                    type="email"
                    value={adminData.email}
                    onChange={(e) => setAdminData({ ...adminData, email: e.target.value })}
                    className="w-full bg-[#0A0D15] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

              </div>
            </div>
          )}

          {/* STEP 5: REVIEW & PROVISIONING (driven by the real job, not timers) */}
          {currentStep === 5 && (
            <div className="space-y-5 animate-fadeIn">
              <div>
                <h3 className="text-sm font-bold text-white">Step 5: Review & Provisioning</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  A step is marked done only after its real operation succeeds. If one fails, the exact reason is shown and you can retry.
                </p>
              </div>

              {(job || loading) && (
                <div className="p-5 rounded-2xl bg-[#121827] border border-slate-800 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {provisionProgress.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      ) : provisionProgress.failed ? (
                        <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                      ) : (
                        <Loader2 className="w-5 h-5 text-emerald-400 animate-spin shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          {provisionProgress.completed
                            ? 'Tenant provisioned and verified'
                            : provisionProgress.failed
                              ? 'Provisioning stopped'
                              : 'Provisioning tenant...'}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono break-words">{provisionProgress.text}</div>
                      </div>
                    </div>
                    {job && <span className="text-[10px] font-mono text-slate-500 shrink-0">{job.id}</span>}
                  </div>

                  {job && (
                    <ol className="divide-y divide-slate-800/70 rounded-xl border border-slate-800 overflow-hidden">
                      {job.steps.map((st: any, i: number) => (
                        <li key={st.key} className="flex items-start gap-3 px-3.5 py-2.5 text-xs">
                          <StepIcon status={st.status} />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-slate-200">
                              {i + 1}. {st.label}
                            </div>
                            {st.detail && <div className="text-[11px] text-slate-400 mt-0.5 break-words">{st.detail}</div>}
                            {st.error && <div className="text-[11px] text-rose-400 mt-0.5 break-words">{st.error}</div>}
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">{st.status}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {provisionProgress.completed && inviteToken && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                      <div className="font-semibold text-amber-300">Owner invite token (shown once)</div>
                      <div className="mt-1 font-mono break-all text-slate-200 select-all">{inviteToken}</div>
                      <div className="mt-1 text-slate-400">
                        Send it to the owner securely. It expires in 72 hours and is stored only as a hash.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!job && !loading && (
                <div className="p-5 rounded-2xl bg-[#121827] border border-slate-800 space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-slate-400">Business Name:</span>
                      <div className="font-semibold text-white">{businessData.name}</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Tenant Domain:</span>
                      <div className="font-semibold text-emerald-400">{businessData.slug}.camsik.com</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Dedicated Database:</span>
                      <div className="font-semibold text-cyan-400 font-mono">{dbConfig.dbName}</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Design System Theme:</span>
                      <div className="font-semibold text-white">{selectedTheme.name}</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Administrator:</span>
                      <div className="font-semibold text-white">{adminData.email}</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Brand assets:</span>
                      <div className="font-semibold text-white">
                        {[logoFile && 'logo', faviconFile && 'favicon'].filter(Boolean).join(', ') || 'Default'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="px-8 py-5 border-t border-slate-800/80 bg-[#111728] flex items-center justify-between">
          {currentStep > 1 && currentStep < 5 && (
            <button
              onClick={() => setCurrentStep((prev) => (prev - 1) as any)}
              disabled={loading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center space-x-2 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
          )}

          <div className="ml-auto flex items-center space-x-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-white text-xs font-semibold rounded-xl transition"
            >
              Cancel
            </button>

            {currentStep < 4 && (
              <button
                onClick={() => {
                  if (currentStep === 1 && (!businessData.name || !businessData.slug)) {
                    setError('Please fill in business name and slug');
                    return;
                  }
                  setError(null);
                  setCurrentStep((prev) => (prev + 1) as any);
                }}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-black font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center space-x-2 transition"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 4 && (
              <button
                onClick={() => setCurrentStep(5)}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-black font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center space-x-2 transition"
              >
                <span>Review & Finalize</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 5 && !loading && !provisionProgress.completed && (
              <button
                onClick={executeProvisioning}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-500/30 flex items-center space-x-2 transition transform hover:-translate-y-0.5"
              >
                {provisionProgress.failed ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                <span>{provisionProgress.failed ? 'Retry from failed step' : 'Confirm & Auto-Provision Tenant'}</span>
              </button>
            )}

            {currentStep === 5 && provisionProgress.completed && (
              <button
                onClick={onSuccess}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-500/30 flex items-center space-x-2 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Done</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  const base = 'w-4 h-4 shrink-0 mt-0.5';
  if (status === 'succeeded') return <CheckCircle2 className={`${base} text-emerald-400`} />;
  if (status === 'skipped') return <Check className={`${base} text-slate-500`} />;
  if (status === 'failed') return <AlertCircle className={`${base} text-rose-400`} />;
  if (status === 'running') return <Loader2 className={`${base} text-emerald-400 animate-spin`} />;
  return <span className="w-4 h-4 shrink-0 mt-0.5 rounded-full border border-slate-700" />;
}

function AssetPicker({
  label,
  maxKb,
  file,
  onChange,
  onReject,
}: {
  label: string;
  maxKb: number;
  file: File | null;
  onChange: (f: File | null) => void;
  onReject: (msg: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">{label}</label>
      <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#121827] border border-dashed border-slate-700 hover:border-emerald-500/60 cursor-pointer transition">
        <Upload className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-300 truncate">
          {file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : 'Choose file'}
        </span>
        <input
          type="file"
          accept="image/svg+xml,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > maxKb * 1024) {
              onReject(`${label.split(' (')[0]} must be ${maxKb} KB or smaller`);
              e.target.value = '';
              return;
            }
            onReject(null);
            onChange(f);
          }}
        />
      </label>
    </div>
  );
}
